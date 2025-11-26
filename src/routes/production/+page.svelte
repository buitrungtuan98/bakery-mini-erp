<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission, permissionStore } from '$lib/stores/permissionStore';
    import { productStore, ingredientStore, type Product, type Ingredient } from '$lib/stores/masterDataStore';
	import { collection, query, orderBy, doc, runTransaction, serverTimestamp, Timestamp, onSnapshot, limit, deleteDoc } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Save, Trash2, Plus } from 'lucide-svelte';

	// --- Types ---
	interface ProductionInput {
		ingredientId: string; theoreticalQuantity: number;
		actualQuantityUsed: number; snapshotCost: number;
	}
    interface ProductionRun {
        id: string; code?: string; productId: string; productName: string;
        productionDate: { toDate: () => Date }; actualYield: number;
        actualCostPerUnit: number; theoreticalCostSnapshot: number;
        totalActualCost: number; createdBy: string;
        createdAt: { toDate: () => Date }; consumedInputs: any[];
    }

	// --- State ---
	let products: Product[] = [];
    let ingredients: Ingredient[] = [];
	let loading = true;
	let processing = false;

    let productionHistory: ProductionRun[] = []; 
    let productionDate: string = new Date().toISOString().split('T')[0];
    
	let selectedProductId = '';
    let selectedProduct: Product | undefined;
    let actualYield = 0;
    let productionInputs: ProductionInput[] = [];
    let batchScale = 1; 
    let customScaleValue = 1;
    
    // UI State
    let isCreateModalOpen = false;
    let isProductModalOpen = false;
    let historyLimit = 10;
    let unsubscribe: () => void;
    let productSearchTerm = '';

    // --- Data Binding & Derived ---
    $: products = $productStore;
    $: ingredients = $ingredientStore;
    $: selectedProduct = products.find(p => p.id === selectedProductId);
    $: totalActualCost = productionInputs.reduce((sum, input) => sum + (input.actualQuantityUsed * input.snapshotCost), 0);
    $: actualCostPerUnit = (actualYield > 0 && totalActualCost > 0) ? totalActualCost / actualYield : 0;
    $: filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()));

	// --- Lifecycle ---
    function fetchHistory(limitCount: number) {
        if (unsubscribe) unsubscribe();
        const historyQuery = query(collection(db, 'production_runs'), orderBy('createdAt', 'desc'), limit(limitCount));
        unsubscribe = onSnapshot(historyQuery, (snapshot) => {
            productionHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionRun));
            loading = false;
        });
    }
	onMount(() => { fetchHistory(historyLimit); });
    onDestroy(() => { if (unsubscribe) unsubscribe(); });

    // --- Handlers ---
    function openCreateModal() {
        if (!checkPermission('create_production')) return showErrorToast("Bạn không có quyền.");
        selectedProductId = '';
        actualYield = 0;
        productionInputs = [];
        batchScale = 1;
        isCreateModalOpen = true;
    }

    function selectProduct(id: string) {
        selectedProductId = id;
        isProductModalOpen = false;
        const prod = products.find(p => p.id === selectedProductId);
        if (!prod) {
            productionInputs = [];
            actualYield = 0;
            return;
        }
        batchScale = 1;
        customScaleValue = 1;
        actualYield = prod.estimatedYieldQty || 0;
        productionInputs = prod.items.map(recipeItem => {
            const ing = ingredients.find(i => i.id === recipeItem.ingredientId);
            return {
                ingredientId: recipeItem.ingredientId,
                theoreticalQuantity: recipeItem.quantity,
                actualQuantityUsed: recipeItem.quantity,
                snapshotCost: ing?.avgCost || 0,
            };
        });
    }

    function handleScaleChange() {
        let effectiveScale = (batchScale === -1) ? customScaleValue : batchScale;
        if (effectiveScale <= 0 || !selectedProduct) return;
        if (selectedProduct.estimatedYieldQty) actualYield = Math.round(selectedProduct.estimatedYieldQty * effectiveScale);
        productionInputs = productionInputs.map(input => ({
            ...input,
            actualQuantityUsed: Number((input.theoreticalQuantity * effectiveScale).toFixed(2))
        }));
    }
    
    async function handleDeleteRun(run: ProductionRun) {
        const canDelete = checkPermission('manage_roles') || checkPermission('create_production');
        if (!canDelete) return showErrorToast("Bạn không có quyền xóa lệnh sản xuất.");
        if (!confirm(`Xác nhận xóa lệnh SX "${run.productName}"? Kho sẽ được đảo ngược.`)) return;
        try {
            await runTransaction(db, async (t) => {
                const prodRef = doc(db, 'products', run.productId);
                const prodSnap = await t.get(prodRef);
                if (!prodSnap.exists()) throw new Error("Sản phẩm không tồn tại.");

                for (const input of run.consumedInputs) {
                    const ingRef = doc(db, 'ingredients', input.ingredientId);
                    const ingSnap = await t.get(ingRef);
                    if (ingSnap.exists()) t.update(ingRef, { currentStock: (ingSnap.data().currentStock || 0) + input.actualQuantityUsed });
                }
                t.update(prodRef, { currentStock: (prodSnap.data().currentStock || 0) - run.actualYield });
                t.delete(doc(db, 'production_runs', run.id));
            });
            await logAction($authStore.user!, 'DELETE', 'production_runs', `Đảo ngược và xóa lệnh SX: ${run.code}`);
            showSuccessToast("Đảo ngược lệnh sản xuất thành công!");
        } catch (e: any) { showErrorToast("LỖI: " + e.message); }
    }
    
	async function handleProduction() {
        if (!selectedProductId || actualYield <= 0 || !selectedProduct) return showErrorToast("Vui lòng chọn SP và nhập số lượng thành phẩm.");
        for (const input of productionInputs) {
            const stock = ingredients.find(i => i.id === input.ingredientId)?.currentStock || 0;
            if (input.actualQuantityUsed > stock) return showErrorToast(`Lỗi: ${ingredients.find(i=>i.id===input.ingredientId)?.name} không đủ tồn kho!`);
        }
        if (!confirm(`Xác nhận sản xuất ${actualYield.toLocaleString()} ${selectedProduct?.name}?`)) return;
		processing = true;
		try {
            const code = await generateNextCode('production_runs', 'SX');
			await runTransaction(db, async (t) => {
                const prodRef = doc(db, 'products', selectedProductId);
                for (const input of productionInputs) {
                    const ingRef = doc(db, 'ingredients', input.ingredientId);
                    const ingSnap = await t.get(ingRef);
                    if (!ingSnap.exists()) throw new Error(`Nguyên liệu ID ${input.ingredientId} không tồn tại.`);
                    t.update(ingRef, { currentStock: (ingSnap.data().currentStock || 0) - input.actualQuantityUsed });
                }
                const prodSnap = await t.get(prodRef);
                if (!prodSnap.exists()) throw new Error("Sản phẩm không tồn tại.");
                t.update(prodRef, { currentStock: (prodSnap.data().currentStock || 0) + actualYield });

                t.set(doc(collection(db, 'production_runs')), {
                    code, productId: selectedProductId, productName: selectedProduct.name,
                    theoreticalCostSnapshot: selectedProduct.theoreticalCost,
                    productionDate: Timestamp.fromDate(new Date(productionDate)),
                    actualYield, totalActualCost, actualCostPerUnit,
                    consumedInputs: productionInputs.map(i => ({ ingredientId: i.ingredientId, actualQuantityUsed: i.actualQuantityUsed, snapshotCost: i.snapshotCost })),
                    createdBy: $authStore.user?.email, createdAt: serverTimestamp()
                });
                await logAction($authStore.user!, 'TRANSACTION', 'production_runs', `SX ${selectedProduct.name}, Yield: ${actualYield} (${code})`);
            });
            showSuccessToast(`Sản xuất thành công! Mã: ${code}`);
            isCreateModalOpen = false;
		} catch (error: any) {
			showErrorToast('Lỗi: ' + error.message);
		} finally {
			processing = false;
		}
	}
</script>

<div class="max-w-4xl mx-auto pb-24">
    <PageHeader title="Sản xuất (Production)">
        <svelte:fragment slot="action">
            {#if $permissionStore.userPermissions.has('create_production')}
                <button class="btn btn-primary btn-sm" on:click={openCreateModal}>
                    <Plus class="h-4 w-4 mr-1" /> Tạo Lệnh SX
                </button>
            {/if}
        </svelte:fragment>
    </PageHeader>

    <div class="flex justify-end mb-2">
        <select bind:value={historyLimit} on:change={() => fetchHistory(historyLimit)} class="select select-xs select-ghost">
            <option value={10}>10 dòng</option>
            <option value={20}>20 dòng</option>
            <option value={30}>30 dòng</option>
        </select>
    </div>

    <ResponsiveTable>
        <svelte:fragment slot="mobile">
            {#each productionHistory as run}
                <div class="bg-base-100 p-3 rounded-lg border border-base-200 shadow-sm flex justify-between items-center">
                    <div>
                        <div class="flex items-center gap-2">
                            <div class="font-bold text-sm">{run.productName}</div>
                            {#if run.code}<span class="badge badge-xs badge-ghost font-mono">{run.code}</span>{/if}
                        </div>
                        <div class="text-xs text-base-content/60 mt-1">
                            {run.productionDate?.toDate().toLocaleDateString('vi-VN')}
                            <span class="mx-1">•</span>
                            <span class="text-success font-bold">+{run.actualYield} SP</span>
                        </div>
                    </div>
                    {#if $permissionStore.userPermissions.has('create_production') || $permissionStore.userPermissions.has('manage_roles')}
                        <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDeleteRun(run)}><Trash2 class="h-4 w-4" /></button>
                    {/if}
                </div>
            {/each}
        </svelte:fragment>
        <svelte:fragment slot="desktop">
            <thead>
                <tr><th>Sản phẩm</th><th>Ngày SX</th><th class="text-right">Sản lượng</th><th class="text-right">Giá vốn/SP</th><th class="text-center">Thao tác</th></tr>
            </thead>
            <tbody>
                {#each productionHistory as run}
                    <tr>
                        <td>
                            <div class="font-bold">{run.productName}</div>
                            <div class="text-xs font-mono">{run.code}</div>
                        </td>
                        <td>{run.productionDate?.toDate().toLocaleDateString('vi-VN')}</td>
                        <td class="text-right font-bold text-success">+{run.actualYield}</td>
                        <td class="text-right font-mono text-sm">{Math.round(run.actualCostPerUnit).toLocaleString()} đ</td>
                        <td class="text-center">
                             {#if $permissionStore.userPermissions.has('create_production') || $permissionStore.userPermissions.has('manage_roles')}
                                <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDeleteRun(run)}><Trash2 class="h-4 w-4" /></button>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </svelte:fragment>
    </ResponsiveTable>
</div>

<!-- Create Modal -->
<Modal title="Tạo Lệnh Sản xuất" isOpen={isCreateModalOpen} onConfirm={handleProduction} onCancel={() => isCreateModalOpen = false} loading={processing} confirmText="Hoàn tất & Trừ kho">
    <div class="form-control mb-4" on:click={() => isProductModalOpen = true}>
        <label class="label"><span class="label-text">Sản phẩm (Công thức)</span></label>
        <div class="flex items-center justify-between border rounded-lg p-3 bg-base-200">
            <span class:font-bold={selectedProduct} class:text-base-content/50={!selectedProduct}>
                {selectedProduct ? selectedProduct.name : 'Chọn công thức...'}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
        </div>
    </div>

    {#if selectedProductId}
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="form-control">
                <label class="label"><span class="label-text">Ngày SX</span></label>
                <input type="date" bind:value={productionDate} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
                <label class="label"><span class="label-text">Thành phẩm (Yield)</span></label>
                <input type="number" bind:value={actualYield} class="input input-bordered w-full font-bold text-center" />
            </div>
        </div>

        <div class="bg-base-200 p-3 rounded-lg">
            <h4 class="text-xs font-bold uppercase mb-2">Nguyên liệu thực dùng</h4>
            <div class="space-y-2 max-h-48 overflow-y-auto">
                {#each productionInputs as input}
                    {@const ing = ingredients.find(i => i.id === input.ingredientId)}
                    <div class="grid grid-cols-3 gap-2 items-center">
                        <span class="text-sm truncate col-span-2">{ing?.name}</span>
                        <div class="flex items-center gap-1">
                            <input type="number" bind:value={input.actualQuantityUsed} class="input input-bordered input-xs w-full text-right font-bold" />
                            <span class="text-xs text-base-content/50 w-6 text-center">{ing?.baseUnit}</span>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</Modal>

<!-- Product Select Modal -->
<Modal title="Chọn Công thức" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    {#if isProductModalOpen}
        <input type="text" bind:value={productSearchTerm} placeholder="Tìm tên sản phẩm..." class="input input-bordered w-full mb-4 sticky top-0" autofocus />
        <div class="space-y-1">
            {#each filteredProducts as prod}
                <button class="w-full text-left p-3 rounded-lg border-b border-base-200 active:bg-base-200 flex justify-between items-center" on:click={() => selectProduct(prod.id)}>
                    <span class="font-bold">{prod.name}</span>
                    <span class="text-xs text-base-content/50">GV: {prod.theoreticalCost.toLocaleString()}</span>
                </button>
            {/each}
        </div>
    {/if}
</Modal>
