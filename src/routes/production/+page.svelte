<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { productStore, ingredientStore, type Product, type Ingredient } from '$lib/stores/masterDataStore';
	import { collection, query, orderBy, doc, runTransaction, serverTimestamp, Timestamp, onSnapshot, limit, deleteDoc } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import Modal from '$lib/components/ui/Modal.svelte';

	// --- Types ---
	interface RecipeItem {
		ingredientId: string; quantity: number; unit: string;
	}
	interface ProductionInput {
		ingredientId: string; theoreticalQuantity: number;
		actualQuantityUsed: number; 
        snapshotCost: number; 
	}
    interface ProductionRun {
        id: string;
        code?: string;
        productId: string;
        productName: string;
        productionDate: { toDate: () => Date };
        actualYield: number;
        actualCostPerUnit: number;
        theoreticalCostSnapshot: number;
        totalActualCost: number;
        createdBy: string;
        createdAt: { toDate: () => Date };
        consumedInputs: any[];
    }

	// --- State ---
	let products: Product[] = [];
    let ingredients: Ingredient[] = [];
	let loading = true;
	let processing = false;
    let errorMsg = '';

    let productionHistory: ProductionRun[] = []; 
    let productionDate: string = new Date().toISOString().split('T')[0];
    
	let selectedProductId = '';
    let selectedProduct: Product | undefined; // Reactive helper
    let actualYield = 0;
    let productionInputs: ProductionInput[] = [];
    
    // Scale
    let batchScale = 1; 
    let customScaleValue = 1;
    
    // UI State
    let activeTab: 'create' | 'history' = 'create';
    let isProductModalOpen = false;

    let historyLimit = 10;
    let unsubscribe: () => void;

    // --- Data Binding ---
    $: products = $productStore;
    $: ingredients = $ingredientStore;

    // --- Reactive Calculation ---
    $: selectedProduct = products.find(p => p.id === selectedProductId);

    $: totalActualCost = productionInputs.reduce((sum, input) => {
        return sum + (input.actualQuantityUsed * input.snapshotCost);
    }, 0);

    $: actualCostPerUnit = (actualYield > 0 && totalActualCost > 0) 
        ? totalActualCost / actualYield 
        : 0;

    // Filter Products for Modal
    let productSearchTerm = '';
    $: filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()));

	// --- Load Data ---
    function fetchHistory(limitCount: number) {
        if (unsubscribe) unsubscribe();
        const historyQuery = query(collection(db, 'production_runs'), orderBy('createdAt', 'desc'), limit(limitCount));
        unsubscribe = onSnapshot(historyQuery, (snapshot) => {
            productionHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionRun));
            loading = false;
        });
    }

	onMount(async () => {
		fetchHistory(historyLimit);
	});

    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });

    // --- Handlers ---
    function selectProduct(id: string) {
        selectedProductId = id;
        isProductModalOpen = false;
        errorMsg = '';

        const prod = products.find(p => p.id === selectedProductId);
        if (!prod) {
            productionInputs = [];
            actualYield = 0;
            return;
        }

        // Reset Scale
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
        let effectiveScale = batchScale;

        if (batchScale === -1) {
            effectiveScale = customScaleValue;
        }

        if (effectiveScale <= 0) return;
        
        const prod = products.find(p => p.id === selectedProductId);
        if (!prod) return;

        if (prod.estimatedYieldQty) {
            actualYield = Math.round(prod.estimatedYieldQty * effectiveScale);
        }

        productionInputs = productionInputs.map(input => {
            const newQty = input.theoreticalQuantity * effectiveScale;
            return {
                ...input,
                actualQuantityUsed: Number(newQty.toFixed(2))
            };
        });
    }
    
    // --- Delete/Reverse Logic ---
    async function handleDeleteRun(run: ProductionRun) {
        if (!checkPermission('manage_roles')) {
             if (!checkPermission('create_production')) return alert("Bạn không có quyền xóa lệnh sản xuất.");
        }

        if (!confirm(`Xác nhận xóa lệnh sản xuất "${run.productName}" ngày ${run.productionDate.toDate().toLocaleDateString()}? Hành động này sẽ đảo ngược tồn kho.`)) return;

        try {
            await runTransaction(db, async (transaction) => {
                const productRef = doc(db, 'products', run.productId);
                const productSnap = await transaction.get(productRef);
                const ingRefs = run.consumedInputs.map((input: any) => doc(db, 'ingredients', input.ingredientId));
                const ingSnaps = await Promise.all(ingRefs.map(ref => transaction.get(ref)));

                ingSnaps.forEach((snap, index) => {
                    if (!snap.exists()) return; 
                    const input = run.consumedInputs[index];
                    const currentStock = Number(snap.data()!.currentStock || 0);
                    const newStock = currentStock + input.actualQuantityUsed; 
                    transaction.update(ingRefs[index], { currentStock: newStock });
                });

                if (!productSnap.exists()) throw new Error("Lỗi: Sản phẩm thành phẩm không tồn tại.");
                const currentProductStock = Number(productSnap.data()!.currentStock || 0);
                const newProductStock = currentProductStock - run.actualYield; 

                transaction.update(productRef, { currentStock: newProductStock });
                transaction.delete(doc(db, 'production_runs', run.id)); 
            });

            const displayId = run.code || run.id.substring(0, 8).toUpperCase();
            await logAction($authStore.user!, 'DELETE', 'production_runs', `Đảo ngược và xóa lệnh SX: ${displayId}, Yield: ${run.actualYield}`);
            alert("Đảo ngược lệnh sản xuất thành công!");
        } catch (e: any) {
            console.error("Lỗi đảo ngược:", e);
            alert("LỖI KHÔNG THỂ ĐẢO NGƯỢC: " + e.message);
        }
    }
    
    // --- Submit Logic ---
	async function handleProduction() {
		errorMsg = '';
        const prod = products.find(p => p.id === selectedProductId);

        if (!selectedProductId || actualYield <= 0 || productionInputs.length === 0) {
            return (errorMsg = "Vui lòng chọn sản phẩm và nhập số lượng thành phẩm đạt chuẩn.");
        }
        
        const selectedDate = new Date(productionDate);
        if (isNaN(selectedDate.getTime())) return (errorMsg = 'Ngày sản xuất không hợp lệ!');

        for (const input of productionInputs) {
            const currentStock = ingredients.find(i => i.id === input.ingredientId)?.currentStock || 0;
            if (input.actualQuantityUsed > currentStock) {
                const ingName = ingredients.find(i => i.id === input.ingredientId)?.name;
                return (errorMsg = `Lỗi: ${ingName} không đủ tồn kho! Tồn: ${currentStock}, Cần: ${input.actualQuantityUsed}`);
            }
        }
        
        if (!confirm(`Xác nhận chạy lệnh sản xuất ${actualYield.toLocaleString()} ${prod?.name}?`)) return;

		processing = true;

		try {
            // Generate Code
            const code = await generateNextCode('production_runs', 'SX');

			await runTransaction(db, async (transaction) => {
                if (!prod) throw new Error("Sản phẩm không hợp lệ.");

                const ingRefs = productionInputs.map(input => doc(db, 'ingredients', input.ingredientId));
                const ingSnaps = await Promise.all(ingRefs.map(ref => transaction.get(ref)));
                const productRef = doc(db, 'products', selectedProductId);
                const productSnap = await transaction.get(productRef);

                ingSnaps.forEach((snap, index) => {
                    if (!snap.exists()) throw new Error(`Lỗi: Nguyên liệu ID ${ingRefs[index].id} không tồn tại.`);
                    const input = productionInputs[index];
                    const currentStock = Number(snap.data()!.currentStock || 0);
                    const newStock = currentStock - input.actualQuantityUsed;
                    transaction.update(ingRefs[index], { currentStock: newStock });
                });

                if (!productSnap.exists()) throw new Error("Lỗi: Không tìm thấy sản phẩm trong CSDL.");
                const currentProductStock = Number(productSnap.data()!.currentStock || 0);
                const newProductStock = currentProductStock + actualYield;
                
                transaction.update(productRef, { currentStock: newProductStock });

                const productionLogRef = doc(collection(db, 'production_runs'));
                transaction.set(productionLogRef, {
                    code: code,
                    productId: selectedProductId,
                    productName: prod.name,
                    theoreticalCostSnapshot: prod.theoreticalCost,
                    productionDate: Timestamp.fromDate(selectedDate), 
                    
                    actualYield: actualYield,
                    totalActualCost: totalActualCost,
                    actualCostPerUnit: actualCostPerUnit,
                    
                    consumedInputs: productionInputs.map(input => ({
                        ingredientId: input.ingredientId,
                        actualQuantityUsed: input.actualQuantityUsed,
                        snapshotCost: input.snapshotCost
                    })),

                    createdBy: $authStore.user?.email,
                    createdAt: serverTimestamp()
                });
                
                await logAction($authStore.user!, 'TRANSACTION', 'production_runs', `SX ${prod.name}, Yield: ${actualYield} (${code})`);
            });

            alert(`Sản xuất thành công ${actualYield.toLocaleString()} thành phẩm! Mã: ${code}`);
            // selectedProductId = '';
            // actualYield = 0;
            // productionInputs = [];
            // batchScale = 1;

		} catch (error) {
			console.error(error);
			alert('Lỗi khi chạy lệnh sản xuất: ' + error);
		} finally {
			processing = false;
		}
	}
</script>

<div class="max-w-4xl mx-auto pb-24">
    <h1 class="text-2xl font-bold text-primary mb-4 px-2">Sản xuất (Production)</h1>

    <!-- TABS -->
    <div role="tablist" class="tabs tabs-boxed mx-2 mb-4 bg-base-200">
        <a role="tab" class="tab {activeTab === 'create' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'create'}>Lệnh Sản xuất</a>
        <a role="tab" class="tab {activeTab === 'history' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'history'}>Lịch sử</a>
    </div>

    {#if activeTab === 'create'}
        {#if errorMsg}
            <div role="alert" class="alert alert-error mb-4 mx-2">
                <span>{errorMsg}</span>
            </div>
        {/if}

        <!-- 1. Select Product & Date -->
        <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-4 mx-2">
            <div class="form-control mb-4" on:click={() => isProductModalOpen = true}>
                <label class="label"><span class="label-text">Sản phẩm (Công thức)</span></label>
                <div class="flex items-center justify-between border rounded-lg p-3 bg-slate-50">
                    {#if selectedProduct}
                        <span class="font-bold">{selectedProduct.name}</span>
                    {:else}
                        <span class="text-slate-400">Chọn công thức...</span>
                    {/if}
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </div>
            </div>

            <div class="form-control">
                <label class="label"><span class="label-text">Ngày SX</span></label>
                <input type="date" bind:value={productionDate} class="input input-bordered w-full" />
            </div>
        </div>

        {#if selectedProductId}
            <!-- 2. Scale & Yield -->
            <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-4 mx-2">
                <div class="grid grid-cols-2 gap-4">
                     <div class="form-control col-span-2 sm:col-span-1">
                        <label class="label"><span class="label-text text-xs">Tỉ lệ (Scale)</span></label>
                        <div class="flex gap-2">
                            <select bind:value={batchScale} on:change={handleScaleChange} class="select select-bordered select-sm w-full font-bold text-primary">
                                <option value={0.25}>0.25x (1/4 mẻ)</option>
                                <option value={0.33333333}>0.33x (1/3 mẻ)</option>
                                <option value={0.5}>0.5x (1/2 mẻ)</option>
                                <option value={1}>1x (Chuẩn)</option>
                                <option value={1.5}>1.5x</option>
                                <option value={2}>2x (Nhân đôi)</option>
                                <option value={3}>3x</option>
                                <option value={4}>4x</option>
                                <option value={5}>5x</option>
                                <option value={-1}>Tùy chỉnh...</option>
                            </select>
                            {#if batchScale === -1}
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    bind:value={customScaleValue}
                                    on:input={handleScaleChange}
                                    class="input input-bordered input-sm w-24 font-bold text-primary"
                                />
                            {/if}
                        </div>
                    </div>
                    <div class="form-control col-span-2 sm:col-span-1">
                        <label class="label"><span class="label-text text-xs">Thành phẩm (Yield)</span></label>
                        <input type="number" bind:value={actualYield} class="input input-bordered input-sm w-full font-bold text-center" />
                    </div>
                </div>
            </div>

            <!-- 3. Inputs List (Clean) -->
            <div class="mx-2 mb-4 bg-white rounded-lg border border-slate-100 overflow-hidden">
                 <div class="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500 uppercase flex justify-between">
                    <span>Nguyên liệu</span>
                    <span>Thực dùng</span>
                 </div>
                <div class="divide-y divide-slate-50">
                    {#each productionInputs as input}
                        {@const ing = ingredients.find(i => i.id === input.ingredientId)}
                        <div class="p-3 flex justify-between items-center">
                            <div>
                                <div class="font-medium text-slate-800 text-sm">{ing?.name}</div>
                                <div class="text-[10px] text-slate-400">Kho: {ing?.currentStock} {ing?.baseUnit}</div>
                            </div>
                            <div class="flex items-center gap-1">
                                <input
                                    type="number"
                                    bind:value={input.actualQuantityUsed}
                                    class="input input-bordered input-xs w-20 text-right font-bold"
                                />
                                <span class="text-xs text-slate-400 w-6 text-center">{ing?.baseUnit}</span>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>

            <!-- 4. Summary & Action -->
            <div class="bg-white p-4 mx-2 rounded-lg border border-slate-200 shadow-sm mb-6">
                 <div class="flex justify-between items-center mb-2">
                    <span class="text-sm text-slate-500">Tổng chi phí NVL:</span>
                    <span class="font-bold text-error">{totalActualCost.toLocaleString()} đ</span>
                </div>
                <div class="flex justify-between items-center mb-4">
                    <span class="text-sm text-slate-500">Giá vốn / SP:</span>
                    <span class="font-bold text-accent">{Math.round(actualCostPerUnit).toLocaleString()} đ</span>
                </div>

                <button
                    class="btn btn-primary w-full shadow-lg"
                    on:click={handleProduction}
                    disabled={processing || actualYield <= 0}
                >
                    {processing ? 'Đang xử lý...' : 'HOÀN TẤT & TRỪ KHO'}
                </button>
            </div>
        {/if}
    {/if} <!-- End Create Tab -->

    {#if activeTab === 'history'}
        <!-- History (Simplified with Pagination) -->
        <div class="mx-2 mt-4 pb-10">
            <div class="flex justify-between items-center mb-2">
                 <h3 class="font-bold text-slate-700">Lịch sử sản xuất</h3>
                 <select bind:value={historyLimit} on:change={() => fetchHistory(historyLimit)} class="select select-xs select-ghost">
                     <option value={10}>10 dòng</option>
                     <option value={20}>20 dòng</option>
                     <option value={30}>30 dòng</option>
                 </select>
            </div>

            <div class="space-y-2">
                {#each productionHistory as run}
                     <div class="bg-white p-3 rounded-lg border border-slate-100 shadow-sm flex justify-between items-center">
                         <div>
                             <div class="flex items-center gap-2">
                                 <div class="font-bold text-sm text-slate-800">{run.productName}</div>
                                 {#if run.code}
                                     <span class="badge badge-xs badge-ghost font-mono">{run.code}</span>
                                 {/if}
                             </div>
                             <div class="text-xs text-slate-400 mt-1">
                                 {run.productionDate?.toDate().toLocaleDateString('vi-VN')}
                                 <span class="mx-1">•</span>
                                 <span class="text-emerald-600 font-bold">+{run.actualYield} SP</span>
                             </div>
                         </div>
                         <button
                            class="btn btn-xs btn-ghost text-red-400"
                            on:click={() => handleDeleteRun(run)}
                        >Xóa</button>
                     </div>
                {/each}
            </div>
        </div>
    {/if} <!-- End History Tab -->

</div>

<!-- Modal: Select Product -->
<Modal title="Chọn Công thức" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    {#if isProductModalOpen}
        <input
            type="text"
            bind:value={productSearchTerm}
            placeholder="Tìm tên sản phẩm..."
            class="input input-bordered w-full mb-4 sticky top-0"
            autofocus
        />
        <div class="space-y-1 max-h-[60vh] overflow-y-auto pb-10">
            {#each filteredProducts as prod}
                <button
                    class="w-full text-left p-3 rounded-lg border-b border-slate-50 active:bg-slate-50 flex justify-between items-center"
                    on:click={() => selectProduct(prod.id)}
                >
                    <span class="font-bold text-slate-800">{prod.name}</span>
                    <span class="text-xs text-slate-400">GV: {prod.theoreticalCost.toLocaleString()}</span>
                </button>
            {/each}
        </div>
    {/if}
</Modal>