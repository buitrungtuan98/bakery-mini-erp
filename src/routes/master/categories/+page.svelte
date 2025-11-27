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

    let categories: Category[] = [];
    let loading = true;
    let newCategoryName = '';
    let unsubscribe: () => void;

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

    async function handleAddCategory() {
        if (!checkPermission('manage_expenses')) return showErrorToast("Bạn không có quyền thêm danh mục.");
        if (!newCategoryName.trim()) return;

        try {
            await expenseService.addCategory($authStore.user!, newCategoryName);
            showSuccessToast("Thêm danh mục thành công!");
            newCategoryName = '';
        } catch (e: any) {
            showErrorToast("Lỗi thêm danh mục: " + e.message);
        }
    }

    // Note: expenseService currently doesn't have deleteCategory.
    // If needed, we should add it. For now, just View/Create.
</script>

<PageHeader>
    <div slot="title">Danh mục Chi phí</div>
</PageHeader>

<div class="max-w-3xl mx-auto">
    <div class="card bg-white shadow-sm border border-slate-200 mb-6">
        <div class="card-body p-4">
            <h3 class="font-bold text-sm mb-2">Thêm danh mục mới</h3>
            <div class="flex gap-2">
                <input
                    type="text"
                    bind:value={newCategoryName}
                    class="input input-bordered w-full"
                    placeholder="VD: Tiền điện, Tiền nhà, Lương..."
                    on:keydown={(e) => e.key === 'Enter' && handleAddCategory()}
                />
                <button class="btn btn-primary" on:click={handleAddCategory}>
                    <Plus class="h-4 w-4 mr-2" /> Thêm
                </button>
            </div>
        </div>
    </div>

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
</div>
