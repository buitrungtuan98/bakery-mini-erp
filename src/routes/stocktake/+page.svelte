<script lang="ts">
    import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { onMount, onDestroy } from 'svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import { stockService, type StockItem } from '$lib/services/stockService';
    import { fade } from 'svelte/transition';
    import type { InventoryTransaction } from '$lib/types/erp';
    import { Trash2, History, Package, Box } from 'lucide-svelte';
    import SwipeableTabs from '$lib/components/ui/SwipeableTabs.svelte';

    let activeTab: string = 'ingredients';
    let loading = true;
    let processing = false;

    const tabs = [
        { id: 'ingredients', label: 'Nguyên liệu', icon: Package },
        { id: 'assets', label: 'Tài sản', icon: Box },
        { id: 'history', label: 'Lịch sử', icon: History }
    ];

    let ingredients: StockItem[] = [];
    let assets: StockItem[] = [];
    let history: InventoryTransaction[] = [];
    let unsubscribeHistory: () => void;

    onMount(async () => {
        if (!checkPermission('view_inventory')) return;
        await loadData();
        fetchHistory();
    });

    onDestroy(() => {
        if (unsubscribeHistory) unsubscribeHistory();
    });

    async function loadData() {
        loading = true;
        try {
            const [ingData, assetData] = await Promise.all([
                stockService.fetchIngredients(),
                stockService.fetchAssets()
            ]);
            ingredients = ingData;
            assets = assetData;
        } catch (e: any) {
            console.error(e);
            showErrorToast("Lỗi tải dữ liệu: " + e.message);
        } finally {
            loading = false;
        }
    }

    function fetchHistory() {
        if (unsubscribeHistory) unsubscribeHistory();
        unsubscribeHistory = stockService.subscribeAdjustments(20, (data) => {
            history = data;
        });
    }

    async function handleStocktakeIngredient(item: StockItem) {
        if (!checkPermission('edit_inventory')) return showErrorToast("Không có quyền.");
        processing = true;
        try {
            await stockService.adjustIngredientStock($authStore.user as any, item);
            item.currentStock = item.actualStock; // Optimistic update
            item.difference = 0;
            showSuccessToast(`Đã cập nhật ${item.name}`);
        } catch (e: any) {
            showErrorToast("Lỗi: " + e.message);
        } finally {
            processing = false;
        }
    }

    async function handleStocktakeAssets(item: StockItem) {
        if (!checkPermission('edit_inventory')) return showErrorToast("Không có quyền.");
        processing = true;
        try {
            await stockService.adjustAssetStock($authStore.user as any, item);
            // Optimistic update
            if (item.quantity) {
                item.quantity.good = item.actualGood || 0;
                item.quantity.broken = item.actualBroken || 0;
                item.quantity.lost = item.actualLost || 0;
                item.quantity.total = (item.actualGood || 0) + (item.actualBroken || 0) + (item.actualLost || 0);
            }
            showSuccessToast(`Đã cập nhật ${item.name}`);
        } catch (e: any) {
            showErrorToast("Lỗi: " + e.message);
        } finally {
            processing = false;
        }
    }

    async function handleCancelAdjustment(tx: InventoryTransaction) {
        if (!confirm(`Bạn có chắc muốn hủy điều chỉnh ${tx.itemName} (${tx.quantity > 0 ? '+' : ''}${tx.quantity})?`)) return;
        try {
            await stockService.cancelAdjustment($authStore.user as any, tx.id);
            showSuccessToast("Đã hủy và hoàn tác điều chỉnh kho.");
        } catch (e: any) {
            showErrorToast("Lỗi: " + e.message);
        }
    }
</script>

<div class="h-full flex flex-col max-w-5xl mx-auto">
    <PageHeader>
        <div slot="title">Kiểm Kê Kho</div>
    </PageHeader>

    <SwipeableTabs
        tabs={tabs}
        bind:activeTab={activeTab}
        on:change={(e) => activeTab = e.detail}
    >
        <div class="p-2 h-full">
            {#if loading}
                <Loading />
            {:else}
                {#if activeTab === 'ingredients'}
                    <ResponsiveTable>
                        <svelte:fragment slot="mobile">
                            {#if ingredients.length === 0}
                                <EmptyState message="Không có nguyên liệu." />
                            {:else}
                                <div class="space-y-4">
                                    {#each ingredients as item (item.id)}
                                        <div in:fade={{ duration: 200 }} class="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                                            <div class="flex justify-between items-center mb-2">
                                                <div>
                                                    <div class="font-bold text-slate-800">{item.name}</div>
                                                    <div class="text-xs text-slate-400 font-mono">{item.code}</div>
                                                </div>
                                                <div class="text-sm">
                                                    Lý thuyết: <span class="font-mono font-bold">{item.currentStock}</span>
                                                </div>
                                            </div>

                                            <div class="flex items-center gap-4 mb-2">
                                                <div class="form-control w-1/2">
                                                    <label class="label text-xs p-0 pb-1" for="mobile-stock-{item.id}">Thực tế</label>
                                                    <input id="mobile-stock-{item.id}" type="number" bind:value={item.actualStock} class="input input-bordered input-sm font-bold text-primary" />
                                                </div>
                                                <div class="w-1/2 text-right">
                                                    <div class="text-xs text-slate-400">Chênh lệch</div>
                                                    <div class="font-bold {(item.actualStock - item.currentStock) < 0 ? 'text-red-500' : 'text-green-500'}">
                                                        {item.actualStock - item.currentStock}
                                                    </div>
                                                </div>
                                            </div>
                                            <button class="btn btn-sm btn-ghost w-full bg-slate-50" on:click={() => handleStocktakeIngredient(item)} disabled={processing || item.actualStock === item.currentStock}>
                                                Lưu điều chỉnh
                                            </button>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </svelte:fragment>

                        <svelte:fragment slot="desktop">
                            <thead>
                                <tr>
                                    <th>Mã</th>
                                    <th>Tên NVL</th>
                                    <th class="text-center">ĐVT</th>
                                    <th class="text-right">Lý thuyết</th>
                                    <th class="text-right w-32">Thực tế</th>
                                    <th class="text-right">Chênh lệch</th>
                                    <th class="text-center">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#if ingredients.length === 0}
                                    <tr><td colspan="7"><EmptyState /></td></tr>
                                {:else}
                                    {#each ingredients as item}
                                        <tr class="hover">
                                            <td class="font-mono text-sm">{item.code}</td>
                                            <td class="font-bold">{item.name}</td>
                                            <td class="text-center"><span class="badge badge-ghost badge-sm">{item.baseUnit || 'g'}</span></td>
                                            <td class="text-right font-mono">{item.currentStock}</td>
                                            <td>
                                                <input type="number" bind:value={item.actualStock} class="input input-bordered input-xs w-full text-right font-bold text-primary" />
                                            </td>
                                            <td class="text-right font-bold {(item.actualStock - item.currentStock) < 0 ? 'text-error' : 'text-success'}">
                                                {item.actualStock - item.currentStock}
                                            </td>
                                            <td class="text-center">
                                                {#if item.actualStock !== item.currentStock}
                                                    <button class="btn btn-xs btn-primary" on:click={() => handleStocktakeIngredient(item)} disabled={processing}>Lưu</button>
                                                {/if}
                                            </td>
                                        </tr>
                                    {/each}
                                {/if}
                            </tbody>
                        </svelte:fragment>
                    </ResponsiveTable>
                {/if}

                {#if activeTab === 'assets'}
                    <ResponsiveTable>
                        <svelte:fragment slot="mobile">
                            {#if assets.length === 0}
                                <EmptyState message="Không có tài sản." />
                            {:else}
                                <div class="space-y-4">
                                    {#each assets as item (item.id)}
                                        <div in:fade={{ duration: 200 }} class="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                                            <div class="mb-3">
                                                <div class="font-bold text-slate-800">{item.name}</div>
                                                <div class="text-xs text-slate-400 font-mono">{item.code}</div>
                                                <div class="text-xs mt-1">Tổng lý thuyết: {item.quantity?.total || 0}</div>
                                            </div>

                                            <div class="grid grid-cols-3 gap-2">
                                                <div class="form-control">
                                                    <label class="label text-xs p-0 pb-1 text-success" for="mobile-good-{item.id}">Tốt</label>
                                                    <input id="mobile-good-{item.id}" type="number" bind:value={item.actualGood} class="input input-bordered input-sm font-bold" />
                                                </div>
                                                <div class="form-control">
                                                    <label class="label text-xs p-0 pb-1 text-warning" for="mobile-broken-{item.id}">Hỏng</label>
                                                    <input id="mobile-broken-{item.id}" type="number" bind:value={item.actualBroken} class="input input-bordered input-sm font-bold" />
                                                </div>
                                                <div class="form-control">
                                                    <label class="label text-xs p-0 pb-1 text-error" for="mobile-lost-{item.id}">Mất</label>
                                                    <input id="mobile-lost-{item.id}" type="number" bind:value={item.actualLost} class="input input-bordered input-sm font-bold" />
                                                </div>
                                            </div>
                                            <button class="btn btn-sm btn-ghost w-full mt-2" on:click={() => handleStocktakeAssets(item)} disabled={processing}>Cập nhật</button>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </svelte:fragment>

                        <svelte:fragment slot="desktop">
                            <thead>
                                <tr>
                                    <th>Mã</th>
                                    <th>Tên Tài sản</th>
                                    <th class="text-center">Tổng (Lý thuyết)</th>
                                    <th class="text-center w-24 text-success">Tốt</th>
                                    <th class="text-center w-24 text-warning">Hỏng</th>
                                    <th class="text-center w-24 text-error">Mất</th>
                                    <th class="text-center">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#if assets.length === 0}
                                    <tr><td colspan="7"><EmptyState /></td></tr>
                                {:else}
                                    {#each assets as item}
                                        <tr class="hover">
                                            <td class="font-mono text-sm">{item.code}</td>
                                            <td class="font-bold">{item.name}</td>
                                            <td class="text-center font-mono">{item.quantity?.total || 0}</td>
                                            <td><input type="number" bind:value={item.actualGood} class="input input-bordered input-xs w-full text-center" /></td>
                                            <td><input type="number" bind:value={item.actualBroken} class="input input-bordered input-xs w-full text-center" /></td>
                                            <td><input type="number" bind:value={item.actualLost} class="input input-bordered input-xs w-full text-center" /></td>
                                            <td class="text-center">
                                                <button class="btn btn-xs btn-primary" on:click={() => handleStocktakeAssets(item)} disabled={processing}>Lưu</button>
                                            </td>
                                        </tr>
                                    {/each}
                                {/if}
                            </tbody>
                        </svelte:fragment>
                    </ResponsiveTable>
                {/if}

                {#if activeTab === 'history'}
                    <ResponsiveTable>
                        <svelte:fragment slot="mobile">
                            {#if history.length === 0}
                                <EmptyState message="Chưa có lịch sử kiểm kê." />
                            {:else}
                                <div class="space-y-3">
                                    {#each history as tx}
                                        <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 {tx.status === 'canceled' ? 'opacity-60 grayscale bg-slate-50' : ''}">
                                            <div class="flex justify-between items-start mb-2">
                                                <div>
                                                    <div class="font-bold text-slate-800">{tx.itemName}</div>
                                                    <div class="text-xs text-slate-400">
                                                        {tx.date ? (typeof (tx.date as any).toDate === 'function' ? (tx.date as any).toDate() : new Date(tx.date as any)).toLocaleString('vi-VN') : 'N/A'}
                                                    </div>
                                                    {#if tx.status === 'canceled'}
                                                        <span class="badge badge-xs badge-error mt-1">Đã hủy</span>
                                                    {/if}
                                                </div>
                                                <div class="font-bold {tx.quantity >= 0 ? 'text-success' : 'text-error'}">
                                                    {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                                                </div>
                                            </div>
                                            <div class="flex justify-between items-center text-xs text-slate-500">
                                                <span>Người kiểm: {tx.performerName}</span>
                                                {#if tx.status !== 'canceled'}
                                                    <button class="btn btn-xs btn-ghost text-red-400" on:click={() => handleCancelAdjustment(tx)}>
                                                        <Trash2 class="w-4 h-4" /> Hủy
                                                    </button>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </svelte:fragment>
                        <svelte:fragment slot="desktop">
                            <thead>
                                <tr>
                                    <th>Ngày</th>
                                    <th>Mặt hàng</th>
                                    <th class="text-right">Thay đổi</th>
                                    <th>Người thực hiện</th>
                                    <th class="text-center">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#if history.length === 0}
                                    <tr><td colspan="5"><EmptyState /></td></tr>
                                {:else}
                                    {#each history as tx}
                                        <tr class="hover {tx.status === 'canceled' ? 'opacity-50 grayscale' : ''}">
                                            <td class="text-sm">
                                                {tx.date ? (typeof (tx.date as any).toDate === 'function' ? (tx.date as any).toDate() : new Date(tx.date as any)).toLocaleString('vi-VN') : 'N/A'}
                                                {#if tx.status === 'canceled'}
                                                    <span class="badge badge-xs badge-error ml-2">Đã hủy</span>
                                                {/if}
                                            </td>
                                            <td class="font-bold">{tx.itemName}</td>
                                            <td class="text-right font-bold {tx.quantity >= 0 ? 'text-success' : 'text-error'}">
                                                {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                                            </td>
                                            <td>{tx.performerName}</td>
                                            <td class="text-center">
                                                {#if tx.status !== 'canceled'}
                                                    <button class="btn btn-xs btn-ghost text-red-400" on:click={() => handleCancelAdjustment(tx)}>
                                                        <Trash2 class="w-4 h-4" />
                                                    </button>
                                                {/if}
                                            </td>
                                        </tr>
                                    {/each}
                                {/if}
                            </tbody>
                        </svelte:fragment>
                    </ResponsiveTable>
                {/if}
            {/if}
        </div>
    </SwipeableTabs>
</div>
