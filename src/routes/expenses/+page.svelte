<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission, permissionStore } from '$lib/stores/permissionStore';
	import { collection, addDoc, getDocs, query, orderBy, onSnapshot, serverTimestamp, Timestamp, limit, where } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus } from 'lucide-svelte';

	// --- Types ---
    interface Category {
        id: string;
        name: string;
    }
    interface Partner {
        id: string;
        name: string;
    }
    interface ExpenseLog {
        id: string;
        code?: string;
        date: { toDate: () => Date };
        categoryName: string;
        amount: number;
        description: string;
        supplier: string;
        supplierId: string;
        createdAt: { toDate: () => Date };
    }

	// --- State ---
    let categories: Category[] = [];
    let suppliers: Partner[] = [];
    let expensesLog: ExpenseLog[] = [];
	let loading = true;
	let processing = false;
    
    // UI State
    let isExpenseModalOpen = false;
    let isCategoryModalOpen = false;

    let expenseData = {
        date: new Date().toISOString().split('T')[0],
        categoryId: '',
        amount: 0,
        description: '',
        selectedSupplierId: ''
    };
    
    let newCategoryName = '';
    let isAssetPurchase = false;
    
    let unsubscribeLog: () => void;
    let unsubscribeCat: () => void;
    let unsubscribeSuppliers: () => void;

    onMount(async () => {
        const catQuery = query(collection(db, 'expense_categories'), orderBy('name'));
        unsubscribeCat = onSnapshot(catQuery, (snapshot) => {
            categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        });
        
        const supplierQuery = query(collection(db, 'partners'), where('type', '==', 'supplier'), orderBy('name'));
        unsubscribeSuppliers = onSnapshot(supplierQuery, (snapshot) => {
            suppliers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));
        });
        
        const logQuery = query(collection(db, 'expenses_log'), orderBy('date', 'desc'), limit(50));
        unsubscribeLog = onSnapshot(logQuery, (snapshot) => {
            expensesLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseLog));
            loading = false;
        });
	});

	onDestroy(() => {
		if (unsubscribeCat) unsubscribeCat();
        if (unsubscribeLog) unsubscribeLog();
        if (unsubscribeSuppliers) unsubscribeSuppliers();
	});

    function openAddModal() {
        if (!checkPermission('manage_expenses')) return showErrorToast("Bạn không có quyền.");
        isExpenseModalOpen = true;
        expenseData = {
            date: new Date().toISOString().split('T')[0],
            categoryId: '',
            amount: 0,
            description: '',
            selectedSupplierId: ''
        };
        isAssetPurchase = false;
    }
    
    async function handleAddCategory() {
        if (!checkPermission('manage_expenses')) return showErrorToast("Bạn không có quyền thêm danh mục.");
        if (!newCategoryName.trim()) return;

        try {
            await addDoc(collection(db, 'expense_categories'), {
                name: newCategoryName.trim(),
                createdAt: serverTimestamp()
            });
            await logAction($authStore.user!, 'CREATE', 'expense_categories', `Thêm mới danh mục: ${newCategoryName}`);
            showSuccessToast("Thêm danh mục thành công!");
            newCategoryName = '';
        } catch (e) {
            showErrorToast("Lỗi thêm danh mục: " + e.message);
        }
    }

    async function handleAddExpense() {
        if (!expenseData.categoryId) return showErrorToast("Vui lòng chọn danh mục chi phí.");
        if (!expenseData.selectedSupplierId) return showErrorToast("Vui lòng chọn Nhà cung cấp/Người bán.");
        if (expenseData.amount <= 0) return showErrorToast("Số tiền phải lớn hơn 0.");
        
        processing = true;
        const selectedDate = new Date(expenseData.date);

        try {
            const category = categories.find(c => c.id === expenseData.categoryId);
            const supplier = suppliers.find(s => s.id === expenseData.selectedSupplierId);
            const code = await generateNextCode('expenses_log', 'CP');
            
            await addDoc(collection(db, 'expenses_log'), {
                code: code,
                date: Timestamp.fromDate(selectedDate),
                categoryId: expenseData.categoryId,
                categoryName: category?.name || 'N/A',
                amount: Number(expenseData.amount),
                description: expenseData.description || 'Không mô tả',
                supplierId: expenseData.selectedSupplierId,
                supplier: supplier?.name || 'N/A', 
                createdBy: $authStore.user?.email,
                createdAt: serverTimestamp()
            });
            
            if (isAssetPurchase) {
                 const assetCode = await generateNextCode('assets', 'TS');
                 await addDoc(collection(db, 'assets'), {
                    code: assetCode,
                    name: expenseData.description, 
                    category: category?.name || 'Tài sản chung',
                    status: 'Đang dùng',
                    originalPrice: Number(expenseData.amount),
                    quantity: { total: 1, good: 1, broken: 0, lost: 0 }, 
                    purchaseDate: Timestamp.fromDate(selectedDate),
                    createdBy: $authStore.user?.email,
                    createdAt: serverTimestamp()
                });
                await logAction($authStore.user!, 'CREATE', 'assets', `Tự động tạo tài sản từ chi phí: ${expenseData.description} (${assetCode})`);
            }

            await logAction($authStore.user!, 'TRANSACTION', 'expenses_log', 
                `Chi tiền: ${category?.name}, ${expenseData.amount.toLocaleString()} đ từ NCC ${supplier?.name || 'N/A'} (${code})`
            );

            showSuccessToast(`Ghi nhận chi phí ${code} thành công!`);
            isExpenseModalOpen = false;
            
        } catch (e) {
            showErrorToast("Lỗi ghi nhận chi phí: " + e.message);
        } finally {
            processing = false;
        }
    }
</script>

<div class="max-w-7xl mx-auto pb-24">
    <PageHeader title="Quản lý Chi phí">
		<svelte:fragment slot="action">
			{#if $permissionStore.userPermissions.has('manage_expenses')}
				<button class="btn btn-primary btn-sm" on:click={openAddModal}>
                    <Plus class="h-4 w-4 mr-1" />
					Ghi Chi phí
				</button>
			{/if}
		</svelte:fragment>
	</PageHeader>

    {#if loading}
        <div class="text-center py-8">Đang tải...</div>
    {:else}
        <ResponsiveTable>
            <svelte:fragment slot="mobile">
                <div class="space-y-3">
                    {#each expensesLog as log}
                        <div class="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
                            <div class="flex justify-between items-start mb-2">
                                <div class="flex items-center gap-2">
                                    {#if log.code}
                                        <span class="badge badge-xs badge-ghost font-mono">{log.code}</span>
                                    {/if}
                                    <div class="text-xs text-gray-500">{log.date?.toDate().toLocaleDateString('vi-VN')}</div>
                                </div>
                                <div class="font-bold text-error">-{log.amount.toLocaleString()} đ</div>
                            </div>
                            <div class="mb-1 font-medium">{log.description}</div>
                            <div class="flex justify-between items-center text-xs">
                                <span class="badge badge-ghost badge-sm">{log.categoryName}</span>
                                <span class="text-gray-500">{log.supplier}</span>
                            </div>
                        </div>
                    {/each}
                </div>
            </svelte:fragment>

            <svelte:fragment slot="desktop">
                <thead>
                    <tr class="bg-slate-50 text-slate-600">
                        <th>Mã</th>
                        <th>Ngày</th>
                        <th>Mục</th>
                        <th>Mô tả chi tiết</th>
                        <th>Nhà cung cấp</th>
                        <th class="text-right">Số tiền</th>
                    </tr>
                </thead>
                <tbody>
                    {#each expensesLog as log}
                        <tr>
                            <td class="font-mono text-xs">{log.code}</td>
                            <td>{log.date?.toDate().toLocaleDateString('vi-VN') || 'N/A'}</td>
                            <td><span class="badge badge-warning badge-outline">{log.categoryName}</span></td>
                            <td>{log.description}</td>
                            <td>{log.supplier}</td>
                            <td class="text-right font-mono text-error">-{log.amount.toLocaleString()} đ</td>
                        </tr>
                    {/each}
                </tbody>
            </svelte:fragment>
        </ResponsiveTable>
    {/if}
</div>

<!-- Modal: Add Expense -->
<Modal
    title="Ghi nhận Chi phí Mới"
    isOpen={isExpenseModalOpen}
    onClose={() => isExpenseModalOpen = false}
    onConfirm={handleAddExpense}
    confirmText="Lưu lại"
    loading={processing}
>
    <div class="flex flex-col gap-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
                <label for="expense-date" class="label"><span class="label-text">Ngày Chi</span></label>
                <input id="expense-date" type="date" bind:value={expenseData.date} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
                <label for="expense-amount" class="label"><span class="label-text">Số tiền (đ)</span></label>
                <input id="expense-amount" type="number" bind:value={expenseData.amount} min="0" class="input input-bordered w-full font-bold text-right" placeholder="0" />
            </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
                <label for="expense-category" class="label justify-between">
                    <span class="label-text">Loại Chi phí</span>
                    <button class="link link-primary text-xs" on:click={() => isCategoryModalOpen = true}>Quản lý</button>
                </label>
                <select id="expense-category" bind:value={expenseData.categoryId} class="select select-bordered w-full" disabled={categories.length === 0}>
                    <option value="" disabled selected>-- Chọn --</option>
                    {#each categories as cat}
                        <option value={cat.id}>{cat.name}</option>
                    {/each}
                </select>
            </div>
            <div class="form-control">
                <label for="expense-supplier" class="label"><span class="label-text">Nhà cung cấp</span></label>
                <select id="expense-supplier" bind:value={expenseData.selectedSupplierId} class="select select-bordered w-full" disabled={suppliers.length === 0}>
                    <option value="" disabled selected>-- Chọn NCC --</option>
                    {#each suppliers as supplier}
                        <option value={supplier.id}>{supplier.name}</option>
                    {/each}
                </select>
            </div>
        </div>
        <div class="form-control">
            <label for="expense-description" class="label"><span class="label-text">Mô tả Chi tiết</span></label>
            <input id="expense-description" type="text" bind:value={expenseData.description} class="input input-bordered w-full" placeholder="VD: Mua lò nướng, Trả tiền điện..." />
        </div>
        <div class="form-control">
            <label for="is-asset" class="label cursor-pointer justify-start gap-3">
                <input id="is-asset" type="checkbox" bind:checked={isAssetPurchase} class="checkbox checkbox-primary" />
                <span class="label-text">Tạo Tài sản (Asset) từ chi phí này?</span>
            </label>
        </div>
    </div>
</Modal>

<!-- Modal: Category Management -->
<Modal title="Quản lý Danh mục Chi phí" isOpen={isCategoryModalOpen} onClose={() => isCategoryModalOpen = false} showConfirm={false}>
    <div class="mb-6">
        <label for="new-category" class="label"><span class="label-text">Thêm danh mục mới</span></label>
        <div class="flex gap-2">
            <input id="new-category" type="text" bind:value={newCategoryName} class="input input-bordered w-full" placeholder="Tên danh mục..." />
            <button class="btn btn-primary" on:click={handleAddCategory}>
                <Plus class="h-4 w-4 mr-1" /> Thêm
            </button>
        </div>
    </div>
    <div>
        <div class="label"><span class="label-text font-bold">Danh sách hiện tại</span></div>
        <div class="flex flex-wrap gap-2 max-h-[40vh] overflow-y-auto p-1">
            {#each categories as cat}
                <span class="badge badge-lg badge-outline bg-base-100 p-3">{cat.name}</span>
            {/each}
            {#if categories.length === 0}
                <span class="text-sm text-slate-400 italic">Chưa có danh mục nào.</span>
            {/if}
        </div>
    </div>
</Modal>
