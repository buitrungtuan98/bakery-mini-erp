<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { permissionStore } from '$lib/stores/permissionStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, updateDoc, addDoc, onSnapshot, limit } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';

    // --- Types ---
    interface Ingredient { 
        id: string; name: string; currentStock: number; baseUnit: string; 
        actualStock?: number; reason?: string; avgCost: number; minStock: number; 
    }
    interface Asset { 
        id: string; name: string; 
        quantity: { total: number; good: number; broken: number; lost: number }; 
        actualGood?: number; actualBroken?: number; actualLost?: number; 
    }
    interface StocktakeLog { 
        id: string;
        type: 'ingredient_adjustment' | 'asset_update';
        itemName: string;
        differenceQty: number;
        differenceValue: number;
        reason: string;
        createdBy: string;
        createdAt: { toDate: () => Date };
    }

    // --- State ---
    let activeTab: 'ingredients' | 'assets' = 'ingredients';
    let ingredients: Ingredient[] = [];
    let assets: Asset[] = [];
    let stocktakeHistory: StocktakeLog[] = [];
    let loading = true;
    let processing = false;

    // Quản lý Subscriptions
    let unsubscribeHistory: () => void;
    let unsubscribeIngredients: () => void;
    let unsubscribeAssets: () => void;


    onMount(async () => {
        await loadData();
    });

    // Hàm tải dữ liệu
    async function loadData() {
        if (unsubscribeHistory) unsubscribeHistory();
        if (unsubscribeIngredients) unsubscribeIngredients();
        if (unsubscribeAssets) unsubscribeAssets();
        
        loading = true;
        
        // 1. Load Ingredients
        const ingSnap = await getDocs(query(collection(db, 'ingredients'), orderBy('name')));
        unsubscribeIngredients = onSnapshot(query(collection(db, 'ingredients'), orderBy('name')), (snapshot) => {
            ingredients = snapshot.docs.map(doc => ({ 
                id: doc.id, ...doc.data(), 
                actualStock: doc.data().currentStock, 
                reason: ''
            } as Ingredient));
        });

        // 2. Load Assets
        const assetSnap = await getDocs(query(collection(db, 'assets'), orderBy('name')));
        unsubscribeAssets = onSnapshot(query(collection(db, 'assets'), orderBy('name')), (snapshot) => {
            assets = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    ...data, 
                    id: doc.id, 
                    actualGood: data.quantity.good,
                    actualBroken: data.quantity.broken,
                    actualLost: data.quantity.lost
                } as Asset;
            });
        });
        
        // 3. Load History
        const historyQuery = query(collection(db, 'stocktake_logs'), orderBy('createdAt', 'desc'), limit(15));
        unsubscribeHistory = onSnapshot(historyQuery, (snapshot) => {
            stocktakeHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StocktakeLog));
            loading = false;
        });
        
        loading = false;
    }

    onDestroy(() => {
        if (unsubscribeHistory) unsubscribeHistory();
        if (unsubscribeIngredients) unsubscribeIngredients();
        if (unsubscribeAssets) unsubscribeAssets();
    });


    // --- LOGIC ---
    async function handleStocktakeIngredients() {
        if (!checkPermission('edit_inventory')) return alert("Bạn không có quyền cân bằng kho.");
        if (!confirm("Xác nhận cập nhật tồn kho theo số liệu thực tế này?")) return;
        processing = true;
        
        try {
            const changedItems = ingredients.filter(i => (i.actualStock || 0) !== i.currentStock);
            
            await runTransaction(db, async (transaction) => {
                for (const item of changedItems) {
                    const ref = doc(db, 'ingredients', item.id);
                    const diff = (item.actualStock || 0) - item.currentStock;
                    const diffAmount = diff * item.avgCost;

                    transaction.update(ref, { currentStock: item.actualStock });
                    
                    const logRef = doc(collection(db, 'stocktake_logs'));
                    transaction.set(logRef, {
                        type: 'ingredient_adjustment',
                        itemId: item.id,
                        itemName: item.name,
                        systemStock: item.currentStock,
                        actualStock: item.actualStock,
                        differenceQty: diff,
                        differenceValue: diffAmount,
                        reason: item.reason || 'Kiểm kê định kỳ',
                        createdBy: $authStore.user?.email,
                        createdAt: serverTimestamp()
                    });
                    
                    await logAction($authStore.user!, 'UPDATE', 'ingredients', `Kiểm kê kho NVL: ${item.name}. Thay đổi: ${diff} ${item.baseUnit}`);
                }
            });
            alert("Đã cân bằng kho nguyên liệu thành công!");
            // await loadData();
        } catch (e) { 
            alert("Lỗi: Không thể cân bằng kho. " + e); 
        } 
        finally { processing = false; }
    }

    async function handleStocktakeAssets(asset: Asset) {
        if (!checkPermission('manage_assets')) return alert("Bạn không có quyền cập nhật tài sản.");
        if (!asset.id) return alert("Lỗi dữ liệu: Tài sản bị thiếu ID.");
        
        const newTotal = (asset.actualGood || 0) + (asset.actualBroken || 0) + (asset.actualLost || 0);
        const originalTotal = asset.quantity.total;
        
        if (newTotal > originalTotal) return alert(`Lỗi: Tổng số lượng mới (${newTotal}) không thể lớn hơn số lượng đã mua ban đầu (${originalTotal}).`);

        try {
            const ref = doc(db, 'assets', asset.id);
            await updateDoc(ref, {
                quantity: {
                    total: newTotal, 
                    good: asset.actualGood,
                    broken: asset.actualBroken,
                    lost: asset.actualLost 
                }
            });
            await logAction($authStore.user!, 'UPDATE', 'assets', `Kiểm kê: ${asset.name} (Tốt: ${asset.actualGood}, Hỏng: ${asset.actualBroken}, Mất: ${asset.actualLost})`);
            alert("Đã cập nhật tài sản!");

        } catch (e) { 
            alert("Lỗi: " + e); 
        }
    }
</script>

<div class="max-w-7xl mx-auto pb-24">
    <h1 class="text-2xl font-bold mb-6 text-primary">Kiểm Kê Kho (Stocktake)</h1>

    <div class="tabs tabs-boxed mb-4">
        <a class="tab {activeTab === 'ingredients' ? 'tab-active' : ''}" on:click={() => activeTab = 'ingredients'}>Nguyên liệu</a>
        <a class="tab {activeTab === 'assets' ? 'tab-active' : ''}" on:click={() => activeTab = 'assets'}>Công cụ & Tài sản</a>
    </div>

    {#if loading}
        <div class="flex justify-center py-8"><span class="loading loading-spinner loading-lg"></span></div>
    {:else}
        {#if activeTab === 'ingredients'}
            <div class="mb-4 text-right">
                <button class="btn btn-primary" on:click={handleStocktakeIngredients} disabled={processing}>
                    {processing ? 'Đang lưu...' : 'Lưu Điều Chỉnh'}
                </button>
            </div>

            <ResponsiveTable>
                <svelte:fragment slot="mobile">
                    {#each ingredients as item}
                        {@const diff = (item.actualStock || 0) - item.currentStock}
                        <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-100 mb-2 {diff !== 0 ? 'border-l-4 border-l-warning' : ''}">
                            <div class="flex justify-between items-start mb-2">
                                <div class="font-bold text-slate-700">{item.name}</div>
                                <div class="text-xs text-slate-400">Sys: {item.currentStock} {item.baseUnit}</div>
                            </div>

                            <div class="flex items-center gap-4 mb-2">
                                <div class="form-control w-1/2">
                                    <label class="label text-xs p-0 pb-1">Thực tế</label>
                                    <input type="number" bind:value={item.actualStock} class="input input-bordered input-sm font-bold text-primary" />
                                </div>
                                <div class="w-1/2 text-right">
                                    <div class="text-xs text-slate-400">Chênh lệch</div>
                                    <div class="font-bold {diff < 0 ? 'text-error' : (diff > 0 ? 'text-success' : 'text-slate-300')}">
                                        {diff > 0 ? '+' : ''}{diff} {item.baseUnit}
                                    </div>
                                </div>
                            </div>

                            {#if diff !== 0}
                                <input type="text" bind:value={item.reason} placeholder="Lý do..." class="input input-bordered input-xs w-full" />
                            {/if}
                        </div>
                    {/each}
                </svelte:fragment>

                <svelte:fragment slot="desktop">
                    <thead>
                        <tr>
                            <th>Tên NVL</th>
                            <th class="w-1/6">Tồn Hệ thống</th>
                            <th class="w-1/6 bg-warning/20">Tồn Thực tế (Nhập)</th>
                            <th class="w-1/12">Chênh lệch</th>
                            <th>Lý do</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each ingredients as item}
                            {@const diff = (item.actualStock || 0) - item.currentStock}
                            <tr class={diff !== 0 ? 'bg-base-200' : ''}>
                                <td>{item.name}</td>
                                <td class="font-bold">{item.currentStock} {item.baseUnit}</td>
                                <td>
                                    <input type="number" bind:value={item.actualStock} class="input input-bordered input-sm w-24 font-bold text-primary" />
                                </td>
                                <td class={diff < 0 ? 'text-error' : (diff > 0 ? 'text-success' : 'text-gray-400')}>
                                    {diff > 0 ? '+' : ''}{diff} {item.baseUnit}
                                </td>
                                <td>
                                    {#if diff !== 0}
                                        <input type="text" bind:value={item.reason} placeholder="VD: Đổ bể, Hư hỏng..." class="input input-bordered input-sm w-full" />
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </svelte:fragment>
            </ResponsiveTable>
        {/if}

        {#if activeTab === 'assets'}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                {#each assets as item}
                    <div class="card bg-white shadow-sm border border-slate-200">
                        <div class="card-body p-4">
                            <h3 class="font-bold">{item.name}</h3>
                            <div class="text-xs text-slate-400 mb-2">Tổng mua: {item.quantity.total}</div>
                            
                            <div class="grid grid-cols-3 gap-2">
                                <div class="form-control">
                                    <label class="label text-xs p-0 pb-1 text-success">Tốt</label>
                                    <input type="number" bind:value={item.actualGood} class="input input-bordered input-sm font-bold" />
                                </div>
                                <div class="form-control">
                                    <label class="label text-xs p-0 pb-1 text-warning">Hỏng</label>
                                    <input type="number" bind:value={item.actualBroken} class="input input-bordered input-sm font-bold" />
                                </div>
                                <div class="form-control">
                                    <label class="label text-xs p-0 pb-1 text-error">Mất</label>
                                    <input type="number" bind:value={item.actualLost} class="input input-bordered input-sm font-bold" />
                                </div>
                            </div>
                            <button class="btn btn-sm btn-ghost w-full mt-2" on:click={() => handleStocktakeAssets(item)} disabled={processing}>Cập nhật</button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
        
        <div class="mt-8 opacity-60">
            <h2 class="text-lg font-bold mb-4">Lịch sử Điều chỉnh</h2>
            <div class="overflow-x-auto bg-base-100 shadow rounded-box">
                <table class="table table-xs w-full">
                    <thead>
                        <tr>
                            <th>Ngày</th>
                            <th>Mục</th>
                            <th class="text-right">SL</th>
                            <th>Lý do</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each stocktakeHistory as log}
                            <tr>
                                <td>{log.createdAt.toDate().toLocaleDateString('vi-VN')}</td>
                                <td class="max-w-[120px] truncate">{log.itemName}</td>
                                <td class="text-right {log.differenceQty < 0 ? 'text-error' : 'text-success'}">
                                    {log.differenceQty > 0 ? '+' : ''}{log.differenceQty}
                                </td>
                                <td class="max-w-[100px] truncate">{log.reason}</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
        
    {/if}
</div>