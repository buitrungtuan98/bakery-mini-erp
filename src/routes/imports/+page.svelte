<script lang="ts">
	import { db } from '$lib/firebase'; 
	import { authStore } from '$lib/stores/authStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, onSnapshot, where, deleteDoc } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
    import { logAction } from '$lib/logger'; // <--- IMPORT MỚI CHO LOGGING
    import { Timestamp } from 'firebase/firestore';

	// --- Types ---
    interface Partner { id: string; name: string; taxId?: string; }
	interface Ingredient { id: string; name: string; code: string; baseUnit: string; avgCost: number; currentStock: number; }
	interface ImportItem { ingredientId: string; quantity: number; price: number; tempIngredient?: Ingredient; }
    interface ImportReceipt {
        id: string;
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
	let importItems: ImportItem[] = [
        { ingredientId: '', quantity: 0, price: 0 } 
    ];

	// --- Realtime Subscription & Fetch Logic (Lazy Fetching) ---
	let unsubscribe: () => void;
    
    async function fetchImportData() {
        if (isDataFetched) return;
        
        loading = true;
        isDataFetched = true;
        
        try {
            // 1. Tải danh sách Nhà cung cấp
            const supplierQuery = query(collection(db, 'partners'), where('type', '==', 'supplier'), orderBy('name'));
            const supplierSnap = await getDocs(supplierQuery);
            suppliers = supplierSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));
            
            // 2. Tải danh sách ingredients
            const ingSnap = await getDocs(query(collection(db, 'ingredients'), orderBy('code')));
            ingredients = ingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ingredient));
            
            // 3. Tải lịch sử nhập kho (Realtime)
            const q = query(collection(db, 'imports'), orderBy('createdAt', 'desc')); 
            
            unsubscribe = onSnapshot(q, (snapshot) => {
                importHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportReceipt));
                loading = false;
            }, (error) => {
                console.error("Lỗi đọc phiếu nhập:", error);
                alert("Lỗi tải lịch sử nhập kho: Kiểm tra lại Rules.");
                loading = false;
            });
            
        } catch (e) {
            loading = false;
        }
    }
    
    // Kích hoạt Fetch khi $authStore.user có giá trị
    $: if ($authStore.user && !isDataFetched) {
        fetchImportData();
    }

	onMount(() => {});
    onDestroy(() => { if (unsubscribe) unsubscribe(); });

	// --- Helpers ---
	function addItem() {
		importItems = [...importItems, { ingredientId: '', quantity: 0, price: 0 }];
	}

	function removeItem(index: number) {
        if(importItems.length === 1) return;
		importItems = importItems.filter((_, i) => i !== index);
	}

    function handleIngredientChange(index: number) {
        const selectedId = importItems[index].ingredientId;
        const ing = ingredients.find(i => i.id === selectedId);
        importItems[index].tempIngredient = ing; 
    }

    // Tính tổng tiền phiếu (Reactive)
    $: totalAmount = importItems.reduce((sum, item) => sum + (item.price || 0), 0);

	// --- Submit Logic (TRANSACTION - WAC Calculation) ---
	async function handleImport() {
		if (!selectedSupplierId) return alert('Chưa chọn Nhà cung cấp');
        const validItems = importItems.filter(i => i.ingredientId && i.quantity > 0);
		if (validItems.length === 0) return alert('Chưa có dòng hàng nào hợp lệ');
        if (!confirm(`Xác nhận nhập kho với tổng tiền: ${totalAmount.toLocaleString()} đ?`)) return;

        const selectedDate = new Date(importDate);
        if (isNaN(selectedDate.getTime())) return alert('Ngày nhập không hợp lệ!');

		processing = true;

		try {
			await runTransaction(db, async (transaction) => {
                
                const supplierSnapshot = suppliers.find(s => s.id === selectedSupplierId);

                const ingRefs = validItems.map(item => ({
                    ref: doc(db, 'ingredients', item.ingredientId),
                    itemData: item
                }));

                const ingSnaps = await Promise.all(ingRefs.map(ir => transaction.get(ir.ref)));

                // B. Tính toán & Update từng nguyên liệu
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

                // C. Tạo phiếu nhập kho (History)
                const importRef = doc(collection(db, 'imports'));
                transaction.set(importRef, {
                    supplierId: selectedSupplierId,
                    supplierName: supplierSnapshot?.name || 'N/A',
                    importDate: Timestamp.fromDate(selectedDate), // LƯU DATE
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
                
                // LOG ACTION (Sau khi Transaction thành công)
                await logAction($authStore.user!, 'TRANSACTION', 'imports', `Tạo phiếu nhập ${importRef.id.substring(0, 8).toUpperCase()}, Tổng tiền: ${totalAmount.toLocaleString()}`);


            });

            alert('Nhập kho thành công!');
            // Reset form
            selectedSupplierId = '';
            importItems = [{ ingredientId: '', quantity: 0, price: 0 }];

		} catch (error: any) {
			console.error(error);
			alert('Lỗi khi nhập kho: ' + error.message || error);
		} finally {
			processing = false;
		}
	}
    
    // --- Delete Logic (Admin Only) ---
    async function deleteReceipt(id: string) {
        // Chỉ admin hoặc manager mới được xóa
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) {
            return alert("Bạn không có quyền xóa phiếu nhập.");
        }
        if(!confirm("Xóa phiếu nhập có thể làm sai lệch tồn kho và giá vốn trung bình. Bạn có chắc chắn?")) return;
        
        try {
            await deleteDoc(doc(db, 'imports', id));
            
            // LOG ACTION DELETE (Sau khi xóa thành công)
            await logAction($authStore.user!, 'DELETE', 'imports', `Xóa phiếu nhập ID: ${id}`);
            
            alert("Phiếu nhập đã được xóa. Vui lòng kiểm tra lại tồn kho.");
        } catch (error) {
            alert("Lỗi xóa: " + error);
        }
    }
</script>

<div class="max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold text-primary mb-6">Phân hệ Nhập Kho (Inbound)</h1>
    
    <div class="card bg-base-100 shadow-xl mb-8 p-4">
        <h2 class="card-title text-lg border-b pb-2 mb-4">Tạo Phiếu Nhập Mới</h2>
        
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="form-control w-full">
                <label class="label"><span class="label-text font-bold">Ngày Nhập hàng</span></label>
                <input type="date" bind:value={importDate} class="input input-bordered w-full" />
            </div>

            <div class="form-control w-full">
                <label class="label"><span class="label-text font-bold">Nhà cung cấp</span></label>
                <select 
                    bind:value={selectedSupplierId} 
                    class="select select-bordered w-full"
                    disabled={loading}
                >
                    <option value="" disabled selected>{loading ? 'Đang tải...' : '-- Chọn Nhà cung cấp --'}</option>
                    {#each suppliers as partner}
                        <option value={partner.id}>{partner.name} ({partner.taxId || 'N/A'})</option>
                    {/each}
                </select>
            </div>
        </div>

        <div class="overflow-x-auto">
            <table class="table table-xs md:table-sm w-full">
                <thead>
                    <tr>
                        <th class="w-1/3">Nguyên liệu</th>
                        <th class="w-24 text-right">Số lượng</th>
                        <th class="w-16">Đơn vị</th>
                        <th class="w-32 text-right">Tổng tiền</th>
                        <th class="w-10"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each importItems as item, i}
                        <tr class="align-top">
                            <td>
                                <select 
                                    bind:value={item.ingredientId} 
                                    on:change={() => handleIngredientChange(i)}
                                    class="select select-bordered select-sm w-full"
                                >
                                    <option value="" disabled selected>-- Chọn NVL --</option>
                                    {#each ingredients as ing}
                                        <option value={ing.id}>{ing.code} - {ing.name}</option>
                                    {/each}
                                </select>
                            </td>
                            <td>
                                <input type="number" bind:value={item.quantity} min="0" class="input input-bordered input-sm w-full text-right" placeholder="0" />
                            </td>
                            <td class="pt-3 text-gray-500">
                                {item.tempIngredient?.baseUnit || '-'}
                            </td>
                            <td>
                                <input type="number" bind:value={item.price} min="0" class="input input-bordered input-sm w-full text-right" placeholder="0" />
                                {#if item.quantity > 0 && item.price > 0 && item.quantity !== 0}
                                    <div class="text-[10px] text-right text-gray-400 mt-1">
                                        ~ {Math.round(item.price / item.quantity).toLocaleString()}/{item.tempIngredient?.baseUnit}
                                    </div>
                                {/if}
                            </td>
                            <td class="text-center">
                                <button class="btn btn-ghost btn-xs text-error" on:click={() => removeItem(i)}>X</button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <div class="flex justify-between items-center mt-4">
            <button class="btn btn-sm btn-ghost gap-2" on:click={addItem}>
                + Thêm dòng
            </button>
            <div class="text-xl font-bold text-success">
                Tổng tiền: {totalAmount.toLocaleString()} đ
            </div>
        </div>

        <div class="card-actions justify-end mt-6">
            <button class="btn btn-primary px-8" on:click={handleImport} disabled={processing}>
                {#if processing}
                    <span class="loading loading-spinner"></span>
                {:else}
                    Lưu Phiếu & Cộng Kho
                {/if}
            </button>
        </div>
    </div>


    <h2 class="text-xl font-bold mb-4">Lịch sử Phiếu nhập</h2>
    <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
        <table class="table table-zebra w-full">
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
                {#if loading}
                    <tr><td colspan="5" class="text-center">Đang tải lịch sử...</td></tr>
                {:else if importHistory.length === 0}
                    <tr><td colspan="5" class="text-center text-gray-500">Chưa có phiếu nhập nào.</td></tr>
                {:else}
                    {#each importHistory as receipt}
                        <tr>
                            <td>{receipt.importDate?.toDate().toLocaleDateString('vi-VN') || 'N/A'}</td>
                            <td>{receipt.supplierName}</td>
                            <td>
                                <div class="text-xs space-x-2">
                                    {#each receipt.items as item}
                                        <span class="badge badge-info badge-outline">{item.quantity} {item.ingredientCode}</span>
                                    {/each}
                                </div>
                            </td>
                            <td class="text-right font-mono text-success">{receipt.totalAmount.toLocaleString()} đ</td>
                            <td>
                                {#if $authStore.user?.role === 'admin'}
                                    <button 
                                        class="btn btn-xs btn-error text-white" 
                                        on:click={() => deleteReceipt(receipt.id)}
                                    >
                                        Xóa (Admin)
                                    </button>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                {/if}
            </tbody>
        </table>
    </div>
</div>