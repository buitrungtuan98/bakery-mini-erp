<script lang="ts">
    import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { onMount, onDestroy } from 'svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus, Trash2 } from 'lucide-svelte';
    import { expenseService, type Category } from '$lib/services/expenseService';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import FloatingActionButton from '$lib/components/ui/FloatingActionButton.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import SyncButton from '$lib/components/ui/SyncButton.svelte';

    let categories: Category[] = [];
    let loading = true;
    let newCategoryName = '';
    let unsubscribe: () => void;
    let isModalOpen = false;
    let processing = false;

    onMount(() => {
        loading = true;
        unsubscribe = expenseService.subscribeCategories((cats) => {
            categories = cats;
            loading = false;
        });
    });

    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });

    function openAddModal() {
        if (!checkPermission('manage_expenses')) return showErrorToast("Bạn không có quyền thêm danh mục.");
        newCategoryName = '';
        isModalOpen = true;
    }

    async function handleAddCategory() {
        if (!newCategoryName.trim()) return showErrorToast("Tên danh mục không được trống");
        processing = true;

        try {
            await expenseService.addCategory($authStore.user!, newCategoryName);
            showSuccessToast("Thêm danh mục thành công!");
            isModalOpen = false;
        } catch (e: any) {
            showErrorToast("Lỗi thêm danh mục: " + e.message);
        } finally {
            processing = false;
        }
    }
</script>

<div class="max-w-7xl mx-auto pb-20">
    <PageHeader>
        <div slot="title">Danh mục Chi phí</div>
        <div slot="actions">
            {#if checkPermission('manage_expenses')}
                 <SyncButton type="categories" label="Sync Danh Mục" />
            {/if}
        </div>
    </PageHeader>

    {#if loading}
        <Loading />
    {:else if categories.length === 0}
        <EmptyState message="Chưa có danh mục nào." />
    {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {#each categories as cat}
                <div class="p-4 bg-white rounded-lg border border-slate-100 shadow-sm flex justify-between items-center">
                    <span class="font-medium text-slate-700">{cat.name}</span>
                    <!-- Placeholder for future actions like Edit/Delete -->
                </div>
            {/each}
        </div>
    {/if}

    <FloatingActionButton
        visible={checkPermission('manage_expenses')}
        onClick={openAddModal}
        label="Thêm Danh mục"
    />
</div>

<Modal
    title="Thêm Danh mục Chi phí"
    isOpen={isModalOpen}
    onClose={() => isModalOpen = false}
    onConfirm={handleAddCategory}
    loading={processing}
>
    <div class="form-control w-full">
        <label class="label">Tên danh mục</label>
        <input
            type="text"
            bind:value={newCategoryName}
            class="input input-bordered w-full"
            placeholder="VD: Tiền điện, Tiền nhà, Lương..."
            on:keydown={(e) => e.key === 'Enter' && handleAddCategory()}
            autofocus
        />
    </div>
</Modal>
