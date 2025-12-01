<script lang="ts">
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission, userPermissions } from '$lib/stores/permissionStore';
	import { onDestroy, onMount } from 'svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import SearchableSelect from '$lib/components/ui/SearchableSelect.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus, Save, Trash2, Import, History, Download } from 'lucide-svelte';
    import { inventoryService, type Partner, type Ingredient, type ImportReceipt, type ImportItem } from '$lib/services/inventoryService';
    import SwipeableTabs from '$lib/components/ui/SwipeableTabs.svelte';

	// --- State ---
	let ingredients: Ingredient[] = []; 
    let suppliers: Partner[] = [];
	let importHistory: ImportReceipt[] = [];
	let loading = true;
	let processing = false;
    let isDataFetched = false; 

    // Dữ liệu phiếu nhập hiện tại
    let importDate: string = new Date().toISOString().split('T')[0];
	let selectedSupplierId: string | number | null = null;
	let importItems: ImportItem[] = [];

    // UI State
    let activeTab: string = 'history';
    let tabs: { id: string, label: string, icon: any }[] = [
         { id: 'history', label: 'Lịch sử', icon: History }
    ];

    let isItemModalOpen = false;
    let editingIndex = -1;
    let editingItem: ImportItem = { ingredientId: '', quantity: 0, price: 0 };

	// --- Realtime Subscription ---
	let unsubscribeHistory: () => void;
    
    async function fetchImportData() {
        if (isDataFetched) return;
        loading = true;
        isDataFetched = true;
        
        try {
            const [fetchedSuppliers, fetchedIngredients] = await Promise.all([
                inventoryService.fetchSuppliers(),
                inventoryService.fetchIngredients()
            ]);
            suppliers = fetchedSuppliers;
            ingredients = fetchedIngredients;
            
            unsubscribeHistory = inventoryService.subscribeHistory((receipts) => {
                importHistory = receipts;
                loading = false;
            });
            
        } catch (e: any) {
            console.error(e);
            loading = false;
        }
    }
    
    $: if ($authStore.user && !isDataFetched) {
        fetchImportData();
    }

    // Set default tab based on permission
    $: if ($userPermissions) {
         if ($userPermissions.has('manage_imports')) {
             // Only add if not present
             if (!tabs.find(t => t.id === 'create')) {
                 tabs = [{ id: 'create', label: 'Tạo Phiếu Nhập', icon: Download }, ...tabs];
             }
             // Prioritize Create tab if permission exists
             if (activeTab === 'history') {
                 activeTab = 'create';
             }
         } else {
             // Remove if present
             tabs = tabs.filter(t => t.id !== 'create');
             activeTab = 'history';
         }
    }

    onDestroy(() => { if (unsubscribeHistory) unsubscribeHistory(); });

	// --- Helpers ---
    function openAddItem() {
        editingIndex = -1;
        editingItem = { ingredientId: '', quantity: 0, price: 0 };
        isItemModalOpen = true;
    }

    function openEditItem(index: number) {
        editingIndex = index;
        editingItem = { ...importItems[index] };
        isItemModalOpen = true;
    }

    function saveItem() {
        if (!editingItem.ingredientId) return;
        const ing = ingredients.find(i => i.id === editingItem.ingredientId);
        editingItem.tempIngredient = ing;

        if (editingIndex === -1) {
            importItems = [...importItems, editingItem];
        } else {
            importItems[editingIndex] = editingItem;
        }
        isItemModalOpen = false;
    }

	function removeItem(index: number) {
		importItems = importItems.filter((_, i) => i !== index);
        isItemModalOpen = false;
	}

    $: totalAmount = importItems.reduce((sum, item) => sum + (item.price || 0), 0);

    // --- Computeds for Selects ---
    $: supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));
    $: ingredientOptions = ingredients.map(i => ({
        value: i.id,
        label: i.name,
        subLabel: `${i.code} (${i.baseUnit})`
    }));

	// --- Submit Logic ---
	async function handleImport() {
        if (!selectedSupplierId) {
            return showErrorToast('Vui lòng chọn nhà cung cấp');
        }
        if (!confirm(`Xác nhận nhập kho với tổng tiền: ${totalAmount.toLocaleString()} đ?`)) return;

		processing = true;

		try {
            const code = await inventoryService.createImportReceipt(
                $authStore.user as any,
                selectedSupplierId as string,
                importDate,
                importItems,
                suppliers,
                ingredients
            );

            showSuccessToast(`Nhập kho thành công! Mã: ${code}`);
            selectedSupplierId = null;
            importItems = [];

		} catch (error: any) {
			console.error(error);
			showErrorToast('Lỗi: ' + error.message || error);
		} finally {
			processing = false;
		}
	}
    
    async function deleteReceipt(receipt: ImportReceipt) {
        if (!checkPermission('manage_imports')) return showErrorToast("Không có quyền xóa.");
        if(!confirm(`Xóa phiếu nhập ${receipt.code} sẽ đảo ngược tồn kho. Chắc chắn?`)) return;
        try {
            await inventoryService.deleteImportReceipt($authStore.user as any, receipt);
            showSuccessToast("Đã xóa phiếu nhập và hoàn tác kho.");
        } catch (error: any) { showErrorToast("Lỗi xóa: " + error.message); }
    }
</script>

<div class="h-full flex flex-col max-w-7xl mx-auto">
    <PageHeader>
        <div slot="title">Nhập kho</div>
    </PageHeader>
    
    <SwipeableTabs
        tabs={tabs}
        bind:activeTab={activeTab}
        on:change={(e) => activeTab = e.detail}
    >
        <div class="p-2 h-full">
            {#if activeTab === 'create' && $userPermissions.has('manage_imports')}
                <div class="card bg-base-100 shadow-sm border border-slate-200 mb-8 p-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div class="form-control w-full">
                            <label class="label"><span class="label-text">Ngày Nhập</span></label>
                            <input type="date" bind:value={importDate} class="input input-bordered w-full" />
                        </div>

                        <div class="form-control w-full">
                            <label class="label"><span class="label-text">Nhà cung cấp</span></label>
                            <SearchableSelect
                                options={supplierOptions}
                                bind:value={selectedSupplierId}
                                placeholder="-- Chọn Nhà cung cấp --"
                            />
                        </div>
                    </div>

                    <!-- Items List (Card Style) -->
                    <div class="space-y-3 mb-4">
                        {#each importItems as item, i}
                            <div class="bg-base-50 p-3 rounded-lg border border-slate-200 relative cursor-pointer hover:bg-slate-100 transition-colors" on:click={() => openEditItem(i)}>
                                <div class="font-bold text-slate-700">{item.tempIngredient?.name || 'Chọn NVL...'}</div>
                                <div class="flex justify-between items-end mt-1">
                                    <div class="text-sm">
                                        {item.quantity} <span class="text-gray-500">{item.tempIngredient?.baseUnit}</span>
                                    </div>
                                    <div class="text-primary font-bold">
                                        {item.price.toLocaleString()} đ
                                    </div>
                                </div>
                                <div class="text-xs text-gray-400 mt-1 text-right">Chạm để sửa</div>
                            </div>
                        {/each}

                        {#if importItems.length === 0}
                            <div class="text-center py-6 border-2 border-dashed border-base-300 rounded-lg text-gray-400">
                                Chưa có dòng hàng nào.
                            </div>
                        {/if}
                    </div>

                    <div class="flex justify-between items-center mt-4 border-t pt-4">
                        <button class="btn btn-sm btn-outline" on:click={openAddItem}>
                            <Plus class="h-4 w-4 mr-2" /> Thêm Dòng
                        </button>
                        <div class="text-lg font-bold text-success">
                            {totalAmount.toLocaleString()} đ
                        </div>
                    </div>

                    <button class="btn btn-primary w-full mt-6" on:click={handleImport} disabled={processing}>
                        <Save class="h-4 w-4 mr-2" />
                        {#if processing}<span class="loading loading-spinner"></span>{/if}
                        Lưu Phiếu & Nhập Kho
                    </button>
                </div>
            {/if}

            {#if activeTab === 'history'}
                {#if loading}
                    <Loading />
                {:else if importHistory.length === 0}
                    <EmptyState message="Chưa có phiếu nhập kho nào." />
                {:else}
                    <ResponsiveTable>
                        <svelte:fragment slot="mobile">
                            {#each importHistory as receipt}
                                <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-100 mb-3 {receipt.status === 'canceled' ? 'opacity-60 grayscale bg-slate-50' : ''}">
                                    <div class="flex justify-between items-start mb-2">
                                        <div>
                                            <div class="font-bold">{receipt.supplierName}</div>
                                            <div class="flex gap-2 items-center">
                                                {#if receipt.code}
                                                    <span class="badge badge-xs badge-ghost font-mono">{receipt.code}</span>
                                                {/if}
                                                {#if receipt.status === 'canceled'}
                                                    <span class="badge badge-xs badge-error">Đã hủy</span>
                                                {/if}
                                                <div class="text-xs text-gray-400">{receipt.importDate?.toDate().toLocaleDateString('vi-VN')}</div>
                                            </div>
                                        </div>
                                        <div class="font-bold text-success">{receipt.totalAmount.toLocaleString()} đ</div>
                                    </div>
                                    <div class="text-xs text-slate-500 bg-slate-50 p-2 rounded mb-2">
                                        {#each receipt.items as item, idx}
                                            <span>{idx > 0 ? ', ' : ''}{item.quantity} {item.ingredientName}</span>
                                        {/each}
                                    </div>
                                    {#if $userPermissions.has('manage_imports') && receipt.status !== 'canceled'}
                                        <div class="text-right">
                                            <button class="btn btn-xs btn-ghost text-error" on:click={() => deleteReceipt(receipt)}>
                                                <Trash2 class="h-4 w-4" />
                                            </button>
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </svelte:fragment>

                        <svelte:fragment slot="desktop">
                            <thead>
                                <tr>
                                    <th>Ngày nhập</th>
                                    <th>Nhà cung cấp</th>
                                    <th>Chi tiết</th>
                                    <th class="text-right">Tổng tiền</th>
                                    <th>Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each importHistory as receipt}
                                    <tr class="hover group {receipt.status === 'canceled' ? 'opacity-50 grayscale' : ''}">
                                        <td>
                                            {receipt.importDate?.toDate().toLocaleDateString('vi-VN') || 'N/A'}
                                            {#if receipt.status === 'canceled'}
                                                <span class="badge badge-xs badge-error ml-2">Đã hủy</span>
                                            {/if}
                                        </td>
                                        <td>{receipt.supplierName}</td>
                                        <td>
                                            <div class="text-xs truncate max-w-xs">
                                                {#each receipt.items as item}
                                                    <span class="badge badge-ghost badge-xs mr-1">{item.quantity} {item.ingredientCode}</span>
                                                {/each}
                                            </div>
                                        </td>
                                        <td class="text-right font-mono text-success">{receipt.totalAmount.toLocaleString()} đ</td>
                                        <td>
                                            {#if $userPermissions.has('manage_imports') && receipt.status !== 'canceled'}
                                                <button
                                                    class="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity"
                                                    on:click={() => deleteReceipt(receipt)}
                                                >
                                                    <Trash2 class="h-4 w-4" />
                                                </button>
                                            {/if}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </svelte:fragment>
                    </ResponsiveTable>
                {/if}
            {/if}
        </div>
    </SwipeableTabs>
</div>

<!-- ITEM MODAL -->
<Modal title="Chi tiết Dòng hàng" isOpen={isItemModalOpen} onClose={() => isItemModalOpen = false} onConfirm={saveItem}>
    <div class="form-control w-full mb-4">
        <label class="label">Nguyên liệu</label>
        <SearchableSelect
            options={ingredientOptions}
            bind:value={editingItem.ingredientId}
            placeholder="-- Chọn NVL --"
        />
    </div>

    <div class="grid grid-cols-2 gap-4">
        <div class="form-control">
            <label class="label">Số lượng</label>
            <input type="number" bind:value={editingItem.quantity} min="0" class="input input-bordered w-full" />
        </div>
        <div class="form-control">
            <label class="label">Thành tiền</label>
            <input type="number" bind:value={editingItem.price} min="0" class="input input-bordered w-full" />
        </div>
    </div>

    {#if editingIndex !== -1}
        <button class="btn btn-outline btn-error btn-sm w-full mt-6" on:click={() => removeItem(editingIndex)}>
            <Trash2 class="h-4 w-4 mr-2" /> Xóa dòng này
        </button>
    {/if}
</Modal>
