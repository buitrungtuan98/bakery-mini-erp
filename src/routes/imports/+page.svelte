<script lang="ts">
	import { db } from '$lib/firebase'; 
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission, permissionStore } from '$lib/stores/permissionStore';
    import { ingredientStore, partnerStore, type Ingredient as MasterIngredient } from '$lib/stores/masterDataStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, onSnapshot, where, deleteDoc } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import { Timestamp } from 'firebase/firestore';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus, Save, Trash2 } from 'lucide-svelte';

	// --- Types ---
    interface Partner { id: string; name: string; taxId?: string; }
	interface ImportItem { ingredientId: string; quantity: number; price: number; tempIngredient?: MasterIngredient; }
    interface ImportReceipt {
        id: string; code?: string; supplierName: string; totalAmount: number;
        createdAt: { toDate: () => Date }; importDate: { toDate: () => Date };
        items: any[];
    }

	// --- State ---
	let masterIngredients: MasterIngredient[] = [];
    let suppliers: Partner[] = [];
	let importHistory: ImportReceipt[] = [];
	let loading = true;
	let processing = false;

    // Form State
    let importDate: string = new Date().toISOString().split('T')[0];
	let selectedSupplierId = ''; 
	let importItems: ImportItem[] = [];

    // UI State
    let isCreateModalOpen = false;
    let isItemModalOpen = false;
    let editingIndex = -1;
    let editingItem: ImportItem = { ingredientId: '', quantity: 0, price: 0 };
    let historyLimit = 10;
	let unsubscribe: () => void;
    
    // --- Data Management ---
    $: masterIngredients = $ingredientStore;
    $: suppliers = $partnerStore.filter(p => p.type === 'supplier');
    
    function fetchHistory(limit: number) {
        if (unsubscribe) unsubscribe();
        loading = true;
        const q = query(collection(db, 'imports'), orderBy('createdAt', 'desc'), limit(limit));
        unsubscribe = onSnapshot(q, (snapshot) => {
            importHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportReceipt));
            loading = false;
        });
    }

    onMount(() => { fetchHistory(historyLimit) });
    onDestroy(() => { if (unsubscribe) unsubscribe(); });

	// --- Handlers ---
    function openCreateModal() {
        if (!checkPermission('manage_imports')) return showErrorToast('Không có quyền.');
        selectedSupplierId = '';
        importItems = [];
        importDate = new Date().toISOString().split('T')[0];
        isCreateModalOpen = true;
    }

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
        if (!editingItem.ingredientId) return showErrorToast('Chưa chọn nguyên liệu');
        const ing = masterIngredients.find(i => i.id === editingItem.ingredientId);
        editingItem.tempIngredient = ing;
        if (editingIndex === -1) importItems = [...importItems, editingItem];
        else importItems[editingIndex] = editingItem;
        isItemModalOpen = false;
    }

	function removeItem(index: number) {
		importItems = importItems.filter((_, i) => i !== index);
        isItemModalOpen = false;
	}

    $: totalAmount = importItems.reduce((sum, item) => sum + (item.price || 0), 0);

	async function handleImport() {
		if (!selectedSupplierId) return showErrorToast('Chưa chọn Nhà cung cấp');
        const validItems = importItems.filter(i => i.ingredientId && i.quantity > 0);
		if (validItems.length === 0) return showErrorToast('Chưa có dòng hàng nào hợp lệ');
        if (!confirm(`Xác nhận nhập kho: ${totalAmount.toLocaleString()} đ?`)) return;

		processing = true;
		try {
            const code = await generateNextCode('imports', 'NK');
			await runTransaction(db, async (t) => {
                const supplier = suppliers.find(s => s.id === selectedSupplierId);
                for (const item of validItems) {
                    const ingRef = doc(db, 'ingredients', item.ingredientId);
                    const snap = await t.get(ingRef);
                    if (!snap.exists()) throw `Nguyên liệu ID ${item.ingredientId} không tồn tại!`;
                    const data = snap.data();
                    const newStock = (data.currentStock || 0) + item.quantity;
                    const newAvgCost = newStock > 0 ? (((data.currentStock || 0) * (data.avgCost || 0)) + item.price) / newStock : 0;
                    t.update(ingRef, { currentStock: newStock, avgCost: Math.round(newAvgCost) });
                }
                t.set(doc(collection(db, 'imports')), {
                    code, supplierId: selectedSupplierId, supplierName: supplier?.name,
                    importDate: Timestamp.fromDate(new Date(importDate)),
                    items: validItems.map(i => ({
                        ingredientId: i.ingredientId,
                        ingredientCode: masterIngredients.find(x=>x.id === i.ingredientId)?.code,
                        ingredientName: masterIngredients.find(x=>x.id === i.ingredientId)?.name,
                        quantity: i.quantity, totalPrice: i.price
                    })),
                    totalAmount, createdBy: $authStore.user?.email, createdAt: serverTimestamp()
                });
                await logAction($authStore.user!, 'TRANSACTION', 'imports', `Tạo phiếu nhập ${code}`);
            });
            showSuccessToast(`Nhập kho thành công! Mã: ${code}`);
            isCreateModalOpen = false;
		} catch (error: any) {
			showErrorToast('Lỗi: ' + (error.message || error));
		} finally {
			processing = false;
		}
	}
    
    async function deleteReceipt(id: string) {
        if (!checkPermission('manage_imports')) return showErrorToast("Không có quyền xóa.");
        if(!confirm("Xóa phiếu nhập có thể làm sai lệch tồn kho. Chắc chắn?")) return;
        try {
            await deleteDoc(doc(db, 'imports', id));
            await logAction($authStore.user!, 'DELETE', 'imports', `Xóa phiếu nhập ID: ${id}`);
            showSuccessToast("Đã xóa phiếu nhập.");
        } catch (error: any) { showErrorToast("Lỗi xóa: " + error.message); }
    }
</script>

<div class="max-w-7xl mx-auto pb-24">
    <PageHeader title="Nhập Kho (Imports)">
        <svelte:fragment slot="action">
            {#if $permissionStore.userPermissions.has('manage_imports')}
                <button class="btn btn-primary btn-sm" on:click={openCreateModal}>
                    <Plus class="h-4 w-4 mr-1" /> Tạo Phiếu Nhập
                </button>
            {/if}
        </svelte:fragment>
    </PageHeader>
    
    <div class="flex justify-end mb-2">
        <select bind:value={historyLimit} on:change={() => fetchHistory(historyLimit)} class="select select-xs select-ghost">
            <option value={10}>10 dòng</option>
            <option value={20}>20 dòng</option>
            <option value={50}>50 dòng</option>
        </select>
    </div>

    <ResponsiveTable>
        <svelte:fragment slot="mobile">
            {#each importHistory as receipt}
                <div class="bg-base-100 p-4 rounded-lg shadow-sm border border-base-200 mb-3">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <div class="font-bold">{receipt.supplierName}</div>
                            <div class="flex gap-2 items-center">
                                {#if receipt.code}<span class="badge badge-xs badge-ghost font-mono">{receipt.code}</span>{/if}
                                <div class="text-xs text-base-content/60">{receipt.importDate?.toDate().toLocaleDateString('vi-VN')}</div>
                            </div>
                        </div>
                        <div class="font-bold text-success">{receipt.totalAmount.toLocaleString()} đ</div>
                    </div>
                    <div class="text-xs text-base-content/80 bg-base-200 p-2 rounded mb-2">
                        {#each receipt.items as item, idx}<span>{idx > 0 ? ', ' : ''}{item.quantity} {item.ingredientName}</span>{/each}
                    </div>
                    {#if $permissionStore.userPermissions.has('manage_imports')}
                        <div class="text-right"><button class="btn btn-xs btn-ghost text-error" on:click={() => deleteReceipt(receipt.id)}><Trash2 class="h-4 w-4" /></button></div>
                    {/if}
                </div>
            {/each}
        </svelte:fragment>

        <svelte:fragment slot="desktop">
            <thead>
                <tr><th>Mã</th><th>Ngày nhập</th><th>Nhà cung cấp</th><th>Chi tiết</th><th class="text-right">Tổng tiền</th><th>Thao tác</th></tr>
            </thead>
            <tbody>
                {#each importHistory as receipt}
                    <tr>
                        <td class="font-mono text-xs">{receipt.code}</td>
                        <td>{receipt.importDate?.toDate().toLocaleDateString('vi-VN')}</td>
                        <td>{receipt.supplierName}</td>
                        <td><div class="text-xs truncate max-w-xs">{#each receipt.items as item}<span class="badge badge-ghost badge-xs mr-1">{item.quantity} {item.ingredientCode}</span>{/each}</div></td>
                        <td class="text-right font-mono text-success">{receipt.totalAmount.toLocaleString()} đ</td>
                        <td>
                            {#if $permissionStore.userPermissions.has('manage_imports')}
                                <button class="btn btn-xs btn-ghost text-error" on:click={() => deleteReceipt(receipt.id)}><Trash2 class="h-4 w-4" /></button>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </svelte:fragment>
    </ResponsiveTable>
</div>

<!-- CREATE MODAL -->
<Modal title="Tạo Phiếu Nhập" isOpen={isCreateModalOpen} onConfirm={handleImport} onCancel={() => isCreateModalOpen = false} loading={processing} confirmText="Lưu & Nhập kho">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div class="form-control w-full">
            <label for="import-date" class="label"><span class="label-text">Ngày Nhập</span></label>
            <input id="import-date" type="date" bind:value={importDate} class="input input-bordered w-full" />
        </div>
        <div class="form-control w-full">
            <label for="supplier" class="label"><span class="label-text">Nhà cung cấp</span></label>
            <select id="supplier" bind:value={selectedSupplierId} class="select select-bordered w-full">
                <option value="" disabled selected>-- Chọn --</option>
                {#each suppliers as partner} <option value={partner.id}>{partner.name}</option> {/each}
            </select>
        </div>
    </div>
    <div class="space-y-3 mb-4">
        {#each importItems as item, i}
            <div role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && openEditItem(i)} class="bg-base-200 p-3 rounded-lg relative" on:click={() => openEditItem(i)}>
                <div class="font-bold">{item.tempIngredient?.name || 'Chọn NVL...'}</div>
                <div class="flex justify-between items-end mt-1 text-sm">
                    <div>{item.quantity} <span class="text-base-content/60">{item.tempIngredient?.baseUnit}</span></div>
                    <div class="text-primary font-bold">{item.price.toLocaleString()} đ</div>
                </div>
            </div>
        {/each}
        {#if importItems.length === 0}
            <div class="text-center py-6 border-2 border-dashed border-base-300 rounded-lg text-base-content/50">Chưa có dòng hàng nào.</div>
        {/if}
    </div>
    <div class="flex justify-between items-center mt-4 border-t border-base-200 pt-4">
        <button class="btn btn-sm btn-outline" on:click={openAddItem}><Plus class="h-4 w-4 mr-2" /> Thêm Dòng</button>
        <div class="text-lg font-bold text-success">{totalAmount.toLocaleString()} đ</div>
    </div>
</Modal>

<!-- ITEM MODAL -->
<Modal title="Chi tiết Dòng hàng" isOpen={isItemModalOpen} onClose={() => isItemModalOpen = false} onConfirm={saveItem}>
    <div class="form-control w-full mb-4">
        <label for="ingredient" class="label">Nguyên liệu</label>
        <select id="ingredient" bind:value={editingItem.ingredientId} class="select select-bordered w-full">
            <option value="" disabled selected>-- Chọn NVL --</option>
            {#each masterIngredients as ing} <option value={ing.id}>{ing.code} - {ing.name} ({ing.baseUnit})</option> {/each}
        </select>
    </div>
    <div class="grid grid-cols-2 gap-4">
        <div class="form-control">
            <label for="quantity" class="label">Số lượng</label>
            <input id="quantity" type="number" bind:value={editingItem.quantity} min="0" class="input input-bordered w-full" />
        </div>
        <div class="form-control">
            <label for="price" class="label">Thành tiền</label>
            <input id="price" type="number" bind:value={editingItem.price} min="0" class="input input-bordered w-full" />
        </div>
    </div>
    {#if editingIndex !== -1}
        <button class="btn btn-outline btn-error btn-sm w-full mt-6" on:click={() => removeItem(editingIndex)}><Trash2 class="h-4 w-4 mr-2" /> Xóa dòng này</button>
    {/if}
</Modal>
