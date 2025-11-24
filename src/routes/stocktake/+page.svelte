<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, updateDoc, addDoc, onSnapshot, limit } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';

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

    // Hàm tải dữ liệu (ĐÃ FIX LỖI MAPPING ID)
    async function loadData() {
        // Tắt listeners cũ (nếu có)
        if (unsubscribeHistory) unsubscribeHistory();
        if (unsubscribeIngredients) unsubscribeIngredients();
        if (unsubscribeAssets) unsubscribeAssets();
        
        loading = true;
        
        // 1. Load Ingredients (Tồn kho NVL)
        const ingSnap = await getDocs(query(collection(db, 'ingredients'), orderBy('name')));
        unsubscribeIngredients = onSnapshot(query(collection(db, 'ingredients'), orderBy('name')), (snapshot) => {
            ingredients = snapshot.docs.map(doc => ({ 
                id: doc.id, ...doc.data(), 
                actualStock: doc.data().currentStock, 
                reason: ''
            } as Ingredient));
        });

        // 2. Load Assets (Tồn kho CCDC - FIX MAPPING)
        const assetSnap = await getDocs(query(collection(db, 'assets'), orderBy('name')));
        unsubscribeAssets = onSnapshot(query(collection(db, 'assets'), orderBy('name')), (snapshot) => {
            assets = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    // FIX: Đảm bảo doc.id là giá trị cuối cùng được gán
                    ...data, 
                    id: doc.id, 
                    actualGood: data.quantity.good,
                    actualBroken: data.quantity.broken,
                    actualLost: data.quantity.lost
                } as Asset;
            });
        });
        
        // 3. Load Lịch sử Kiểm kho (Real-time)
        const historyQuery = query(collection(db, 'stocktake_logs'), orderBy('createdAt', 'desc'), limit(15));
        unsubscribeHistory = onSnapshot(historyQuery, (snapshot) => {
            stocktakeHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StocktakeLog));
            loading = false;
        });
        
        loading = false;
    }

    // Dọn dẹp khi thoát trang
    onDestroy(() => {
        if (unsubscribeHistory) unsubscribeHistory();
        if (unsubscribeIngredients) unsubscribeIngredients();
        if (unsubscribeAssets) unsubscribeAssets();
    });


    // --- XỬ LÝ KIỂM KÊ NGUYÊN LIỆU (INGREDIENTS) ---
    async function handleStocktakeIngredients() {
        if ($authStore.user?.role !== 'admin') return alert("Chỉ Admin mới có quyền cân bằng kho.");
        if (!confirm("Xác nhận cập nhật tồn kho theo số liệu thực tế này?")) return;
        processing = true;
        
        try {
            const changedItems = ingredients.filter(i => (i.actualStock || 0) !== i.currentStock);
            
            await runTransaction(db, async (transaction) => {
                
                for (const item of changedItems) {
                    const ref = doc(db, 'ingredients', item.id);
                    const diff = (item.actualStock || 0) - item.currentStock;
                    const diffAmount = diff * item.avgCost; // Giá trị tiền hao hụt/tăng thêm

                    // 1. Update Kho
                    transaction.update(ref, { currentStock: item.actualStock });
                    
                    // 2. Log Stocktake
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
                    
                    // 3. Log Audit
                    await logAction($authStore.user!, 'UPDATE', 'ingredients', `Kiểm kê kho NVL: ${item.name}. Thay đổi: ${diff} ${item.baseUnit}`);
                }
            });
            alert("Đã cân bằng kho nguyên liệu thành công!");
            await loadData(); // Tải lại để reset view
        } catch (e) { 
            alert("Lỗi: Không thể cân bằng kho. " + e); 
        } 
        finally { processing = false; }
    }

    // --- XỬ LÝ KIỂM KÊ CÔNG CỤ (ASSETS) ---
    async function handleStocktakeAssets(asset: Asset) {
        if ($authStore.user?.role !== 'admin') return alert("Chỉ Admin mới có quyền cập nhật tài sản.");
        
        // KIỂM TRA BẮT BUỘC ID
        if (!asset.id) {
            alert("Lỗi dữ liệu: Tài sản bị thiếu ID vật lý. Vui lòng tải lại trang.");
            return;
        }
        
        const newTotal = (asset.actualGood || 0) + (asset.actualBroken || 0) + (asset.actualLost || 0);
        const originalTotal = asset.quantity.total;
        
        // Validation
        if (newTotal > originalTotal) return alert(`Lỗi: Tổng số lượng mới (${newTotal}) không thể lớn hơn số lượng đã mua ban đầu (${originalTotal}).`);

        try {
            const ref = doc(db, 'assets', asset.id); // Tham chiếu đã được an toàn
            
            // Update Kho
            await updateDoc(ref, {
                quantity: {
                    total: newTotal, 
                    good: asset.actualGood,
                    broken: asset.actualBroken,
                    lost: asset.actualLost 
                }
            });
            
            // Log Audit
            await logAction($authStore.user!, 'UPDATE', 'assets', `Kiểm kê: ${asset.name} (Tốt: ${asset.actualGood}, Hỏng: ${asset.actualBroken}, Mất: ${asset.actualLost})`);
            alert("Đã cập nhật tài sản!");

        } catch (e) { 
            alert("Lỗi: " + e); 
        }
    }
</script>

<div class="max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">Kiểm Kê Kho (Stocktake)</h1>

    <div class="tabs tabs-boxed mb-4">
        <a class="tab {activeTab === 'ingredients' ? 'tab-active' : ''}" on:click={() => activeTab = 'ingredients'}>Nguyên liệu</a>
        <a class="tab {activeTab === 'assets' ? 'tab-active' : ''}" on:click={() => activeTab = 'assets'}>Công cụ & Tài sản</a>
    </div>

    {#if loading}
        <div class="text-center">Đang tải dữ liệu kho...</div>
    {:else}
        {#if activeTab === 'ingredients'}
            <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box p-4">
                <table class="table w-full">
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
                </table>
                <div class="mt-4 text-right">
                    <button class="btn btn-primary" on:click={handleStocktakeIngredients} disabled={processing}>
                        {processing ? 'Đang lưu...' : 'Cân bằng Kho Nguyên liệu'}
                    </button>
                </div>
            </div>
        {/if}

        {#if activeTab === 'assets'}
            <div class="grid grid-cols-1 gap-4">
                {#each assets as item}
                    <div class="card bg-base-100 shadow-sm border border-base-200">
                        <div class="card-body flex-row items-center justify-between p-4">
                            <div class="w-1/4">
                                <div class="font-bold">{item.name}</div>
                                <div class="text-xs text-gray-500">Hệ thống: Tốt {item.quantity.good} / Hỏng {item.quantity.broken}</div>
                            </div>
                            
                            <div class="flex gap-2 w-2/3">
                                <div class="form-control w-1/4">
                                    <label class="label text-xs">Tốt (Mới)</label>
                                    <input type="number" bind:value={item.actualGood} class="input input-bordered input-sm text-success font-bold" />
                                </div>
                                <div class="form-control w-1/4">
                                    <label class="label text-xs">Hỏng (Mới)</label>
                                    <input type="number" bind:value={item.actualBroken} class="input input-bordered input-sm text-warning font-bold" />
                                </div>
                                <div class="form-control w-1/4">
                                    <label class="label text-xs">Đã Mất</label>
                                    <input type="number" bind:value={item.actualLost} class="input input-bordered input-sm text-error font-bold" />
                                </div>
                                <div class="w-1/4 pt-6">
                                    <button class="btn btn-sm btn-ghost" on:click={() => handleStocktakeAssets(item)} disabled={processing}>Lưu</button>
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
        
        <div class="mt-8">
            <h2 class="text-xl font-bold mb-4">Lịch sử Điều chỉnh Kho</h2>
            <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
                <table class="table table-compact w-full">
                    <thead>
                        <tr>
                            <th>Ngày</th>
                            <th>Mục</th>
                            <th>Loại Điều chỉnh</th>
                            <th class="text-right">SL Chênh lệch</th>
                            <th class="text-right">Giá trị Tiền</th>
                            <th>Lý do</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each stocktakeHistory as log}
                            <tr class="text-sm">
                                <td>{log.createdAt.toDate().toLocaleDateString('vi-VN')}</td>
                                <td>{log.itemName}</td>
                                <td>
                                    <span class="badge {log.type.includes('ingredient') ? 'badge-info' : 'badge-warning'}">
                                        {log.type.includes('ingredient') ? 'NVL' : 'Tài sản'}
                                    </span>
                                </td>
                                <td class="text-right {log.differenceQty < 0 ? 'text-error' : 'text-success'}">
                                    {log.differenceQty > 0 ? '+' : ''}{log.differenceQty.toLocaleString()}
                                </td>
                                <td class="text-right font-mono {log.differenceValue < 0 ? 'text-error' : 'text-success'}">
                                    {log.differenceValue.toLocaleString()} đ
                                </td>
                                <td>{log.reason}</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
        
    {/if}
</div>