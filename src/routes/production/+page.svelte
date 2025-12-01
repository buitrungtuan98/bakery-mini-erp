<script lang="ts">
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { productStore, ingredientStore, type Product, type Ingredient } from '$lib/stores/masterDataStore';
	import { onMount, onDestroy } from 'svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Save, Trash2, Search, Calendar, History, ChefHat } from 'lucide-svelte';
    import { productionService, type ProductionInput, type ProductionRun } from '$lib/services/productionService';
    import SwipeableTabs from '$lib/components/ui/SwipeableTabs.svelte';

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
    let activeTab: string = 'create';
    const tabs = [
        { id: 'create', label: 'Lệnh Sản Xuất', icon: ChefHat },
        { id: 'history', label: 'Lịch sử', icon: History }
    ];

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
        loading = true;
        unsubscribe = productionService.subscribeHistory(limitCount, (runs) => {
             productionHistory = runs;
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
             if (!checkPermission('create_production')) return showErrorToast("Bạn không có quyền xóa lệnh sản xuất.");
        }

        if (!confirm(`Xác nhận xóa lệnh sản xuất "${run.productName}" ngày ${run.productionDate.toDate().toLocaleDateString()}? Hành động này sẽ đảo ngược tồn kho.`)) return;

        try {
            await productionService.deleteProductionRun($authStore.user as any, run);
            showSuccessToast("Đảo ngược lệnh sản xuất thành công!");
        } catch (e: any) {
            console.error("Lỗi đảo ngược:", e);
            showErrorToast("LỖI KHÔNG THỂ ĐẢO NGƯỢC: " + e.message);
        }
    }
    
    // --- Submit Logic ---
	async function handleProduction() {
		errorMsg = '';
        const prod = products.find(p => p.id === selectedProductId);

        if (!selectedProductId || actualYield <= 0 || productionInputs.length === 0) {
            return (errorMsg = "Vui lòng chọn sản phẩm và nhập số lượng thành phẩm đạt chuẩn.");
        }

        if (!confirm(`Xác nhận chạy lệnh sản xuất ${actualYield.toLocaleString()} ${prod?.name}?`)) return;

		processing = true;

		try {
            const code = await productionService.createProductionRun(
                $authStore.user as any,
                prod!,
                productionDate,
                actualYield,
                productionInputs,
                ingredients
            );

            showSuccessToast(`Sản xuất thành công ${actualYield.toLocaleString()} thành phẩm! Mã: ${code}`);

		} catch (error: any) {
			console.error(error);
			showErrorToast('Lỗi khi chạy lệnh sản xuất: ' + error.message);
		} finally {
			processing = false;
		}
	}
</script>

<div class="h-full flex flex-col max-w-4xl mx-auto">
    <PageHeader>
        <div slot="title">Sản xuất</div>
    </PageHeader>

    <SwipeableTabs
        tabs={tabs}
        bind:activeTab={activeTab}
        on:change={(e) => activeTab = e.detail}
    >
        <div class="p-2 h-full">
            {#if activeTab === 'create'}
                {#if errorMsg}
                    <div role="alert" class="alert alert-error mb-4 mx-2 text-white">
                        <span>{errorMsg}</span>
                    </div>
                {/if}

                <!-- 1. Select Product & Date -->
                <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-4">
                    <div class="form-control mb-4" on:click={() => isProductModalOpen = true}>
                        <label class="label"><span class="label-text">Sản phẩm (Công thức)</span></label>
                        <div class="flex items-center justify-between border rounded-lg p-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
                            {#if selectedProduct}
                                <span class="font-bold">{selectedProduct.name}</span>
                            {:else}
                                <span class="text-slate-400">Chọn công thức...</span>
                            {/if}
                            <Search size={18} class="text-slate-400" />
                        </div>
                    </div>

                    <div class="form-control">
                        <label class="label"><span class="label-text">Ngày SX</span></label>
                        <input type="date" bind:value={productionDate} class="input input-bordered w-full" />
                    </div>
                </div>

                {#if selectedProductId}
                    <!-- 2. Scale & Yield -->
                    <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-4">
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
                    <div class="mb-4 bg-white rounded-lg border border-slate-100 overflow-hidden">
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
                    <div class="bg-white p-4 rounded-lg border border-slate-200 shadow-sm mb-24">
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
                            <Save class="h-4 w-4 mr-2" />
                            {processing ? 'Đang xử lý...' : 'HOÀN TẤT & TRỪ KHO'}
                        </button>
                    </div>
                {/if}
            {/if} <!-- End Create Tab -->

            {#if activeTab === 'history'}
                <!-- History (Simplified with Pagination) -->
                <div class="mt-4 pb-10">
                    <div class="flex justify-between items-center mb-2">
                        <h3 class="font-bold text-slate-700">Lịch sử sản xuất</h3>
                        <select bind:value={historyLimit} on:change={() => fetchHistory(historyLimit)} class="select select-xs select-ghost">
                            <option value={10}>10 dòng</option>
                            <option value={20}>20 dòng</option>
                            <option value={30}>30 dòng</option>
                        </select>
                    </div>

                    {#if loading}
                        <Loading />
                    {:else if productionHistory.length === 0}
                        <EmptyState message="Chưa có lịch sử sản xuất." />
                    {:else}
                        <ResponsiveTable>
                            <svelte:fragment slot="mobile">
                                <div class="space-y-2">
                                    {#each productionHistory as run}
                                        <div class="bg-white p-3 rounded-lg border border-slate-100 shadow-sm flex justify-between items-center {run.status === 'canceled' ? 'opacity-60 grayscale bg-slate-50' : ''}">
                                            <div>
                                                <div class="flex items-center gap-2">
                                                    <div class="font-bold text-sm text-slate-800">{run.productName}</div>
                                                    {#if run.code}
                                                        <span class="badge badge-xs badge-ghost font-mono">{run.code}</span>
                                                    {/if}
                                                    {#if run.status === 'canceled'}
                                                        <span class="badge badge-xs badge-error">Đã hủy</span>
                                                    {/if}
                                                </div>
                                                <div class="text-xs text-slate-400 mt-1">
                                                    {run.productionDate?.toDate().toLocaleDateString('vi-VN')}
                                                    <span class="mx-1">•</span>
                                                    <span class="text-emerald-600 font-bold">+{run.actualYield} SP</span>
                                                </div>
                                            </div>
                                            {#if run.status !== 'canceled'}
                                                <button
                                                    class="btn btn-xs btn-ghost text-red-400"
                                                    on:click={() => handleDeleteRun(run)}
                                                ><Trash2 class="h-4 w-4" /></button>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            </svelte:fragment>

                            <svelte:fragment slot="desktop">
                                <thead>
                                    <tr>
                                        <th>Mã Lệnh</th>
                                        <th>Sản phẩm</th>
                                        <th>Ngày SX</th>
                                        <th class="text-right">Sản lượng</th>
                                        <th class="text-right">Tổng chi phí</th>
                                        <th class="text-center">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each productionHistory as run}
                                        <tr class="hover group {run.status === 'canceled' ? 'opacity-50 grayscale' : ''}">
                                            <td class="font-mono text-sm">
                                                {run.code || run.id.slice(0,8)}
                                                {#if run.status === 'canceled'}
                                                    <span class="badge badge-xs badge-error ml-2">Đã hủy</span>
                                                {/if}
                                            </td>
                                            <td class="font-bold">{run.productName}</td>
                                            <td>{run.productionDate?.toDate().toLocaleDateString('vi-VN')}</td>
                                            <td class="text-right font-bold text-emerald-600">{run.actualYield}</td>
                                            <td class="text-right font-mono text-error">{run.totalActualCost.toLocaleString()} đ</td>
                                            <td class="text-center">
                                                {#if run.status !== 'canceled'}
                                                    <button class="btn btn-xs btn-ghost text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" on:click={() => handleDeleteRun(run)}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                {/if}
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </svelte:fragment>
                        </ResponsiveTable>
                    {/if}
                </div>
            {/if} <!-- End History Tab -->
        </div>
    </SwipeableTabs>

</div>

<!-- Modal: Select Product -->
<Modal title="Chọn Công thức" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    {#if isProductModalOpen}
        <div class="sticky top-0 bg-base-100 z-10 pb-2">
            <input
                type="text"
                bind:value={productSearchTerm}
                placeholder="Tìm tên sản phẩm..."
                class="input input-bordered w-full"
                autofocus
            />
        </div>
        <div class="space-y-1 max-h-[50vh] overflow-y-auto pb-10">
            {#each filteredProducts as prod}
                <button
                    class="w-full text-left p-3 rounded-lg border-b border-slate-50 active:bg-slate-50 flex justify-between items-center hover:bg-slate-50"
                    on:click={() => selectProduct(prod.id)}
                >
                    <span class="font-bold text-slate-800">{prod.name}</span>
                    <span class="text-xs text-slate-400">GV: {(prod.costPrice || 0).toLocaleString()}</span>
                </button>
            {/each}
            {#if filteredProducts.length === 0}
                 <div class="text-center py-8 text-slate-400">Không tìm thấy.</div>
            {/if}
        </div>
    {/if}
</Modal>
