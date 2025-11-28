<script lang="ts">
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission, userPermissions } from '$lib/stores/permissionStore';
	import { onDestroy, onMount } from 'svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus, Save, History, Wallet } from 'lucide-svelte';
    import { expenseService, type Category, type Partner, type ExpenseLog } from '$lib/services/expenseService';
    import SwipeableTabs from '$lib/components/ui/SwipeableTabs.svelte';

	// --- State ---
    let categories: Category[] = [];
    let suppliers: Partner[] = [];
    let expensesLog: ExpenseLog[] = [];
	let loading = true;
	let processing = false;
    let errorMsg = '';
    
    // UI State
    let activeTab: string = 'history';
    let tabs: { id: string, label: string, icon: any }[] = [
        { id: 'history', label: 'Lịch sử', icon: History }
    ];

    let expenseData = {
        date: new Date().toISOString().split('T')[0],
        categoryId: '',
        amount: 0,
        description: '',
        selectedSupplierId: ''
    };
    
    let isAssetPurchase = false;
    
    let unsubscribeLog: () => void;
    let unsubscribeCat: () => void;
    let unsubscribeSuppliers: () => void;
    let isDataFetched = false;

    onMount(async () => {
        // Only load expensive listeners on mount
        loading = true;

        unsubscribeCat = expenseService.subscribeCategories((cats) => {
            categories = cats;
        });
        
        unsubscribeSuppliers = expenseService.subscribeSuppliers((supps) => {
            suppliers = supps;
        });
        
        unsubscribeLog = expenseService.subscribeHistory(50, (logs) => {
            expensesLog = logs;
            loading = false;
        });
        isDataFetched = true;
	});

    // Reactive Tabs
    $: if ($userPermissions) {
         if ($userPermissions.has('manage_expenses')) {
             if (!tabs.find(t => t.id === 'create')) {
                 tabs = [{ id: 'create', label: 'Ghi nhận', icon: Wallet }, ...tabs];
             }
             if (activeTab === 'history' && !isDataFetched) {
                 activeTab = 'create';
             }
         } else {
             tabs = tabs.filter(t => t.id !== 'create');
             activeTab = 'history';
         }
    }

	onDestroy(() => {
		if (unsubscribeCat) unsubscribeCat();
        if (unsubscribeLog) unsubscribeLog();
        if (unsubscribeSuppliers) unsubscribeSuppliers();
	});
    
    async function handleAddExpense() {
        if (!checkPermission('manage_expenses')) return showErrorToast("Bạn không có quyền thêm chi phí.");
        
        processing = true;
        errorMsg = '';

        try {
            const code = await expenseService.createExpense(
                $authStore.user!,
                expenseData,
                categories,
                suppliers,
                isAssetPurchase
            );

            showSuccessToast(`Ghi nhận chi phí ${code} thành công!`);
            expenseData.amount = 0;
            expenseData.description = '';
            isAssetPurchase = false;
            
        } catch (e: any) {
            errorMsg = e.message;
            showErrorToast("Lỗi ghi nhận chi phí: " + e.message);
        } finally {
            processing = false;
        }
    }
</script>

<div class="h-full flex flex-col max-w-7xl mx-auto">
    <PageHeader>
        <div slot="title">Chi phí</div>
    </PageHeader>

    <SwipeableTabs
        tabs={tabs}
        bind:activeTab={activeTab}
        on:change={(e) => activeTab = e.detail}
    >
        <div class="p-2 h-full">
            {#if activeTab === 'create' && $userPermissions.has('manage_expenses')}
                <div class="card bg-base-100 shadow-sm border border-slate-200 mb-8">
                    <div class="card-body p-4">
                        <div class="border-b pb-2 mb-4">
                            <h2 class="card-title text-lg">Ghi nhận Chi phí Mới</h2>
                        </div>

                        {#if errorMsg}
                            <div role="alert" class="alert alert-error text-sm mb-4 text-white"><span>{errorMsg}</span></div>
                        {/if}

                        <div class="flex flex-col gap-4">
                            <!-- Row 1 -->
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div class="form-control">
                                    <label class="label"><span class="label-text">Ngày Chi</span></label>
                                    <input type="date" bind:value={expenseData.date} class="input input-bordered w-full" />
                                </div>
                                <div class="form-control">
                                    <label class="label"><span class="label-text">Số tiền (đ)</span></label>
                                    <input type="number" bind:value={expenseData.amount} min="0" class="input input-bordered w-full font-bold text-right" placeholder="0" />
                                </div>
                            </div>

                            <!-- Row 2 -->
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div class="form-control">
                                    <label class="label"><span class="label-text">Loại Chi phí</span></label>
                                    <select bind:value={expenseData.categoryId} class="select select-bordered w-full" disabled={categories.length === 0}>
                                        <option value="" disabled selected>-- Chọn --</option>
                                        {#each categories as cat}
                                            <option value={cat.id}>{cat.name}</option>
                                        {/each}
                                    </select>
                                </div>
                                <div class="form-control">
                                    <label class="label"><span class="label-text">Nhà cung cấp</span></label>
                                    <select bind:value={expenseData.selectedSupplierId} class="select select-bordered w-full" disabled={suppliers.length === 0}>
                                        <option value="" disabled selected>-- Chọn NCC --</option>
                                        {#each suppliers as supplier}
                                            <option value={supplier.id}>{supplier.name}</option>
                                        {/each}
                                    </select>
                                </div>
                            </div>

                            <!-- Row 3 -->
                            <div class="form-control">
                                <label class="label"><span class="label-text">Mô tả Chi tiết</span></label>
                                <input type="text" bind:value={expenseData.description} class="input input-bordered w-full" placeholder="VD: Mua lò nướng, Trả tiền điện..." />
                            </div>

                            <!-- Option -->
                            <div class="form-control">
                                <label class="label cursor-pointer justify-start gap-3">
                                    <input type="checkbox" bind:checked={isAssetPurchase} class="checkbox checkbox-primary" />
                                    <span class="label-text">Tạo Tài sản (Asset) từ chi phí này?</span>
                                </label>
                            </div>

                            <button class="btn btn-primary w-full mt-2" on:click={handleAddExpense} disabled={processing}>
                                <Save class="h-4 w-4 mr-2" />
                                {#if processing}<span class="loading loading-spinner"></span>{/if}
                                Ghi nhận Chi phí
                            </button>
                        </div>
                    </div>
                </div>
            {/if}

            {#if activeTab === 'history'}
                <!-- History Log -->
                {#if loading}
                    <Loading />
                {:else if expensesLog.length === 0}
                    <EmptyState message="Chưa có chi phí nào." />
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
                                            <span class="badge badge-ghost badge-sm">{log.category}</span>
                                            <span class="text-gray-500">{log.supplierName || 'N/A'}</span>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </svelte:fragment>

                        <svelte:fragment slot="desktop">
                            <thead>
                                <tr>
                                    <th class="w-1/6">Ngày</th>
                                    <th class="w-1/6">Mục</th>
                                    <th class="w-2/5">Mô tả chi tiết</th>
                                    <th class="w-1/6">Nhà cung cấp</th>
                                    <th class="text-right w-1/6">Số tiền</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each expensesLog as log}
                                    <tr>
                                        <td>{log.date?.toDate().toLocaleDateString('vi-VN') || 'N/A'}</td>
                                        <td><span class="badge badge-warning badge-outline">{log.category}</span></td>
                                        <td>{log.description}</td>
                                        <td>{log.supplierName || 'N/A'}</td>
                                        <td class="text-right font-mono text-error">-{log.amount.toLocaleString()} đ</td>
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

