<script lang="ts">
	import { db } from '$lib/firebase'; 
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission, userPermissions } from '$lib/stores/permissionStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, onSnapshot, where, deleteDoc } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import { Timestamp } from 'firebase/firestore';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import { showToast } from '$lib/utils/toast';
    import { Plus, Save, Trash2 } from 'lucide-svelte';

	// --- Types ---
    interface Partner { id: string; name: string; taxId?: string; }
	interface Ingredient { id: string; name: string; code: string; baseUnit: string; avgCost: number; currentStock: number; }
	interface ImportItem { ingredientId: string; quantity: number; price: number; tempIngredient?: Ingredient; }
    interface ImportReceipt {
        id: string;
        code?: string;
        supplierName: string;
        totalAmount: number;
        createdAt: { toDate: () => Date }; 
        importDate: { toDate: () => Date };
        items: any[];
    }

	// --- State ---
	let ingredients: Ingredient[] = []; 
    let suppliers: Partner[] = [];
	let importHistory: ImportReceipt[] = [];
	let loading = true;
	let processing = false;
    let isDataFetched = false; 

    // Dữ liệu phiếu nhập hiện tại
    let importDate: string = new Date().toISOString().split('T')[0];
	let selectedSupplierId = ''; 
	let importItems: ImportItem[] = [];

    // UI State
    let activeTab: 'create' | 'history' = 'history'; // Default to history potentially, logic below handles switch
    let isItemModalOpen = false;
    let editingIndex = -1;
    let editingItem: ImportItem = { ingredientId: '', quantity: 0, price: 0 };

	// --- Realtime Subscription & Fetch Logic (Lazy Fetching) ---
	let unsubscribe: () => void;
    
    async function fetchImportData() {
        if (isDataFetched) return;
        loading = true;
        isDataFetched = true;
        
        try {
            const supplierQuery = query(collection(db, 'partners'), where('type', '==', 'supplier'), orderBy('name'));
            const supplierSnap = await getDocs(supplierQuery);
            suppliers = supplierSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));
            
            const ingSnap = await getDocs(query(collection(db, 'ingredients'), orderBy('code')));
            ingredients = ingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ingredient));
            
            const q = query(collection(db, 'imports'), orderBy('createdAt', 'desc')); 
            unsubscribe = onSnapshot(q, (snapshot) => {
                importHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportReceipt));
                loading = false;
            });
            
        } catch (e) { loading = false; }
    }
    
    $: if ($authStore.user && !isDataFetched) {
        fetchImportData();
    }

    // Set default tab based on permission
    $: if ($userPermissions) {
         if ($userPermissions.has('manage_imports')) {
             if (activeTab === 'history' && !isDataFetched) { // Initial load
                 activeTab = 'create';
             }
         } else {
             activeTab = 'history';
         }
    }

    onDestroy(() => { if (unsubscribe) unsubscribe(); });

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
        isItemModalOpen = false; // If open
	}

    $: totalAmount = importItems.reduce((sum, item) => sum + (item.price || 0), 0);

	// --- Submit Logic ---
	async function handleImport() {
		if (!selectedSupplierId) return showToast('Chưa chọn Nhà cung cấp', 'warning');
        const validItems = importItems.filter(i => i.ingredientId && i.quantity > 0);
		if (validItems.length === 0) return showToast('Chưa có dòng hàng nào hợp lệ', 'warning');
        if (!confirm(`Xác nhận nhập kho với tổng tiền: ${totalAmount.toLocaleString()} đ?`)) return;

        const selectedDate = new Date(importDate);
        if (isNaN(selectedDate.getTime())) return showToast('Ngày nhập không hợp lệ!', 'error');

		processing = true;

		try {
            // Generate Code
            const code = await generateNextCode('imports', 'NK');

			await runTransaction(db, async (transaction) => {
                const supplierSnapshot = suppliers.find(s => s.id === selectedSupplierId);
                const ingRefs = validItems.map(item => ({
                    ref: doc(db, 'ingredients', item.ingredientId),
                    itemData: item
                }));
                const ingSnaps = await Promise.all(ingRefs.map(ir => transaction.get(ir.ref)));

                ingSnaps.forEach((snap, idx) => {
                    if (!snap.exists()) throw "Nguyên liệu không tồn tại!";
                    const currentData = snap.data();
                    const inputItem = ingRefs[idx].itemData;
                    const currentStock = Number(currentData.currentStock || 0);
                    const currentAvgCost = Number(currentData.avgCost || 0);
                    const oldValue = currentStock * currentAvgCost;
                    const newValue = inputItem.price; 
                    const newStock = currentStock + inputItem.quantity;
                    const newAvgCost = newStock > 0 ? (oldValue + newValue) / newStock : 0;

                    transaction.update(ingRefs[idx].ref, {
                        currentStock: newStock,
                        avgCost: Math.round(newAvgCost) 
                    });
                });

                const importRef = doc(collection(db, 'imports'));
                transaction.set(importRef, {
                    code: code,
                    supplierId: selectedSupplierId,
                    supplierName: supplierSnapshot?.name || 'N/A',
                    importDate: Timestamp.fromDate(selectedDate),
                    items: validItems.map(i => ({
                        ingredientId: i.ingredientId,
                        ingredientCode: ingredients.find(x=>x.id === i.ingredientId)?.code, 
                        ingredientName: ingredients.find(x=>x.id === i.ingredientId)?.name,
                        quantity: i.quantity,
                        totalPrice: i.price
                    })),
                    totalAmount: totalAmount,
                    createdBy: $authStore.user?.email,
                    createdAt: serverTimestamp()
                });
                
                await logAction($authStore.user!, 'TRANSACTION', 'imports', `Tạo phiếu nhập ${code}`);
            });

            showToast(`Nhập kho thành công! Mã: ${code}`, 'success');
            selectedSupplierId = '';
            importItems = [];

		} catch (error: any) {
			console.error(error);
			showToast('Lỗi: ' + error.message || error, 'error');
		} finally {
			processing = false;
		}
	}
    
    async function deleteReceipt(id: string) {
        if (!checkPermission('manage_imports')) return showToast("Không có quyền xóa.", 'error');
        if(!confirm("Xóa phiếu nhập có thể làm sai lệch tồn kho. Chắc chắn?")) return;
        try {
            await deleteDoc(doc(db, 'imports', id));
            await logAction($authStore.user!, 'DELETE', 'imports', `Xóa phiếu nhập ID: ${id}`);
            showToast("Đã xóa phiếu nhập.", 'success');
        } catch (error) { showToast("Lỗi xóa: " + error, 'error'); }
    }
</script>

<div class="max-w-7xl mx-auto pb-24">
    <h1 class="text-2xl font-bold text-primary mb-6">Nhập Kho (Imports)</h1>
    
    <!-- TABS -->
    <div role="tablist" class="tabs tabs-boxed mb-6 bg-base-200">
        {#if $userPermissions.has('manage_imports')}
            <a role="tab" class="tab {activeTab === 'create' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'create'}>Tạo Phiếu Nhập</a>
        {/if}
        <a role="tab" class="tab {activeTab === 'history' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'history'}>Lịch sử</a>
    </div>

    {#if activeTab === 'create' && $userPermissions.has('manage_imports')}
        <div class="card bg-base-100 shadow-sm border border-slate-200 mb-8 p-4">
            <!-- <h2 class="card-title text-lg border-b pb-2 mb-4">Tạo Phiếu Nhập</h2> -->

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div class="form-control w-full">
                    <label class="label"><span class="label-text">Ngày Nhập</span></label>
                    <input type="date" bind:value={importDate} class="input input-bordered w-full" />
                </div>

                <div class="form-control w-full">
                    <label class="label"><span class="label-text">Nhà cung cấp</span></label>
                    <select
                        bind:value={selectedSupplierId}
                        class="select select-bordered w-full"
                        disabled={loading}
                    >
                        <option value="" disabled selected>-- Chọn Nhà cung cấp --</option>
                        {#each suppliers as partner}
                            <option value={partner.id}>{partner.name}</option>
                        {/each}
                    </select>
                </div>
            </div>

            <!-- Items List (Card Style) -->
            <div class="space-y-3 mb-4">
                {#each importItems as item, i}
                    <div class="bg-base-50 p-3 rounded-lg border border-slate-200 relative" on:click={() => openEditItem(i)}>
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
            <div class="text-center py-10">Đang tải...</div>
        {:else}
            <ResponsiveTable>
                <svelte:fragment slot="mobile">
                    {#each importHistory as receipt}
                        <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-100 mb-3">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <div class="font-bold">{receipt.supplierName}</div>
                                    <div class="flex gap-2 items-center">
                                        {#if receipt.code}
                                            <span class="badge badge-xs badge-ghost font-mono">{receipt.code}</span>
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
                            {#if $userPermissions.has('manage_imports')}
                                <div class="text-right">
                                    <button class="btn btn-xs btn-ghost text-error" on:click={() => deleteReceipt(receipt.id)}>
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
                            <tr>
                                <td>{receipt.importDate?.toDate().toLocaleDateString('vi-VN') || 'N/A'}</td>
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
                                    {#if $userPermissions.has('manage_imports')}
                                        <button
                                            class="btn btn-xs btn-ghost text-error"
                                            on:click={() => deleteReceipt(receipt.id)}
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

<!-- ITEM MODAL -->
<Modal title="Chi tiết Dòng hàng" isOpen={isItemModalOpen} onClose={() => isItemModalOpen = false} onConfirm={saveItem}>
    <div class="form-control w-full mb-4">
        <label class="label">Nguyên liệu</label>
        <select bind:value={editingItem.ingredientId} class="select select-bordered w-full">
            <option value="" disabled selected>-- Chọn NVL --</option>
            {#each ingredients as ing}
                <option value={ing.id}>{ing.code} - {ing.name} ({ing.baseUnit})</option>
            {/each}
        </select>
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