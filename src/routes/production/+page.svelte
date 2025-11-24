<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, Timestamp, onSnapshot, limit, deleteDoc } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';

	// --- Types ---
	interface Ingredient {
		id: string; code: string; name: string; baseUnit: string;
		avgCost: number; currentStock: number;
	}
	interface RecipeItem {
		ingredientId: string; quantity: number; unit: string;
	}
	interface Product {
		id: string; name: string; theoreticalCost: number; 
		items: RecipeItem[]; currentStock: number; estimatedYieldQty: number;
	}
	interface ProductionInput {
		ingredientId: string; theoreticalQuantity: number;
		actualQuantityUsed: number; 
        snapshotCost: number; 
	}
    interface ProductionRun {
        id: string;
        productId: string;
        productName: string;
        productionDate: { toDate: () => Date };
        actualYield: number;
        actualCostPerUnit: number;
        theoreticalCostSnapshot: number;
        totalActualCost: number;
        createdBy: string;
        createdAt: { toDate: () => Date };
        consumedInputs: any[];
    }

	// --- State ---
	let products: Product[] = [];
    let ingredients: Ingredient[] = [];
	let loading = true;
	let processing = false;
    let errorMsg = '';

    let productionHistory: ProductionRun[] = []; 
    let productionDate: string = new Date().toISOString().split('T')[0];
    
	let selectedProductId = '';
    let actualYield = 0;
    let productionInputs: ProductionInput[] = [];
    
    // TRẠNG THÁI MỚI: Tỉ lệ mẻ (Batch Scale)
    let batchScale = 1; 
    
    let unsubscribe: () => void;

    // --- Reactive Calculation ---
    $: totalActualCost = productionInputs.reduce((sum, input) => {
        return sum + (input.actualQuantityUsed * input.snapshotCost);
    }, 0);

    $: actualCostPerUnit = (actualYield > 0 && totalActualCost > 0) 
        ? totalActualCost / actualYield 
        : 0;

	// --- Load Data ---
	onMount(async () => {
		const [ingSnap, prodSnap] = await Promise.all([
            getDocs(collection(db, 'ingredients')),
            getDocs(query(collection(db, 'products'), orderBy('name')))
        ]);
        
		ingredients = ingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ingredient));
		products = prodSnap.docs.map(doc => ({ 
            id: doc.id, ...doc.data(), currentStock: doc.data().currentStock || 0 
        } as Product)); 
        
        const historyQuery = query(collection(db, 'production_runs'), orderBy('createdAt', 'desc'), limit(15));
        unsubscribe = onSnapshot(historyQuery, (snapshot) => {
            productionHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionRun));
            loading = false;
        });
	});

    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });

    // --- Handlers ---

    function handleProductSelect() {
        errorMsg = '';
        const selectedProduct = products.find(p => p.id === selectedProductId);
        if (!selectedProduct) {
            productionInputs = [];
            actualYield = 0;
            return;
        }

        // Reset Scale về 1 khi chọn sản phẩm mới
        batchScale = 1;

        // Tính toán Yield ước tính ban đầu
        actualYield = selectedProduct.estimatedYieldQty || 0;

        productionInputs = selectedProduct.items.map(recipeItem => {
            const ing = ingredients.find(i => i.id === recipeItem.ingredientId);
            return {
                ingredientId: recipeItem.ingredientId,
                theoreticalQuantity: recipeItem.quantity,
                actualQuantityUsed: recipeItem.quantity, // Mặc định = Lý thuyết
                snapshotCost: ing?.avgCost || 0,
            };
        });
    }
    
    // LOGIC MỚI: Xử lý thay đổi Tỉ lệ (Scale)
    function handleScaleChange() {
        if (batchScale <= 0) return; // Không cho phép scale âm hoặc 0
        
        const selectedProduct = products.find(p => p.id === selectedProductId);
        if (!selectedProduct) return;

        // 1. Scale số lượng thành phẩm (Yield)
        // Nếu Yield gốc là 30, Scale x2 -> Tự điền 60
        if (selectedProduct.estimatedYieldQty) {
            actualYield = Math.round(selectedProduct.estimatedYieldQty * batchScale);
        }

        // 2. Scale toàn bộ nguyên liệu tiêu hao
        productionInputs = productionInputs.map(input => {
            // Tính lại dựa trên lý thuyết gốc * scale
            const newQty = input.theoreticalQuantity * batchScale;
            return {
                ...input,
                actualQuantityUsed: Number(newQty.toFixed(2)) // Làm tròn 2 số thập phân cho đẹp
            };
        });
    }
    
    // --- Delete/Reverse Logic (Giữ nguyên) ---
    async function handleDeleteRun(run: ProductionRun) {
        if ($authStore.user?.role !== 'admin') {
            return alert("Chỉ Admin mới được xóa lịch sử sản xuất.");
        }
        if (!confirm(`Xác nhận xóa lệnh sản xuất "${run.productName}" ngày ${run.productionDate.toDate().toLocaleDateString()}? Hành động này sẽ đảo ngược tồn kho.`)) return;

        try {
            await runTransaction(db, async (transaction) => {
                const productRef = doc(db, 'products', run.productId);
                const productSnap = await transaction.get(productRef);
                const ingRefs = run.consumedInputs.map((input: any) => doc(db, 'ingredients', input.ingredientId));
                const ingSnaps = await Promise.all(ingRefs.map(ref => transaction.get(ref)));

                ingSnaps.forEach((snap, index) => {
                    if (!snap.exists()) return; 
                    const input = run.consumedInputs[index];
                    const currentStock = Number(snap.data()!.currentStock || 0);
                    const newStock = currentStock + input.actualQuantityUsed; 
                    transaction.update(ingRefs[index], { currentStock: newStock });
                });

                if (!productSnap.exists()) throw new Error("Lỗi: Sản phẩm thành phẩm không tồn tại.");
                const currentProductStock = Number(productSnap.data()!.currentStock || 0);
                const newProductStock = currentProductStock - run.actualYield; 

                transaction.update(productRef, { currentStock: newProductStock });
                transaction.delete(doc(db, 'production_runs', run.id)); 
            });

            await logAction($authStore.user!, 'DELETE', 'production_runs', `Đảo ngược và xóa lệnh SX ID: ${run.id.substring(0, 8).toUpperCase()}, Yield: ${run.actualYield}`);
            alert("Đảo ngược lệnh sản xuất thành công!");
        } catch (e: any) {
            console.error("Lỗi đảo ngược:", e);
            alert("LỖI KHÔNG THỂ ĐẢO NGƯỢC: " + e.message);
        }
    }
    
    // --- Submit Production Logic (Giữ nguyên) ---
	async function handleProduction() {
		errorMsg = '';
        const selectedProduct = products.find(p => p.id === selectedProductId);

        if (!selectedProductId || actualYield <= 0 || productionInputs.length === 0) {
            return (errorMsg = "Vui lòng chọn sản phẩm và nhập số lượng thành phẩm đạt chuẩn.");
        }
        
        const selectedDate = new Date(productionDate);
        if (isNaN(selectedDate.getTime())) return (errorMsg = 'Ngày sản xuất không hợp lệ!');

        for (const input of productionInputs) {
            const currentStock = ingredients.find(i => i.id === input.ingredientId)?.currentStock || 0;
            if (input.actualQuantityUsed > currentStock) {
                const ingName = ingredients.find(i => i.id === input.ingredientId)?.name;
                return (errorMsg = `Lỗi: ${ingName} không đủ tồn kho! Tồn: ${currentStock}, Cần: ${input.actualQuantityUsed}`);
            }
        }
        
        if (!confirm(`Xác nhận chạy lệnh sản xuất ${actualYield.toLocaleString()} ${selectedProduct?.name}?`)) return;

		processing = true;

		try {
			await runTransaction(db, async (transaction) => {
                if (!selectedProduct) throw new Error("Sản phẩm không hợp lệ.");

                const ingRefs = productionInputs.map(input => doc(db, 'ingredients', input.ingredientId));
                const ingSnaps = await Promise.all(ingRefs.map(ref => transaction.get(ref)));
                const productRef = doc(db, 'products', selectedProductId);
                const productSnap = await transaction.get(productRef);

                ingSnaps.forEach((snap, index) => {
                    if (!snap.exists()) throw new Error(`Lỗi: Nguyên liệu ID ${ingRefs[index].id} không tồn tại.`);
                    const input = productionInputs[index];
                    const currentStock = Number(snap.data()!.currentStock || 0);
                    const newStock = currentStock - input.actualQuantityUsed;
                    transaction.update(ingRefs[index], { currentStock: newStock });
                });

                if (!productSnap.exists()) throw new Error("Lỗi: Không tìm thấy sản phẩm trong CSDL.");
                const currentProductStock = Number(productSnap.data()!.currentStock || 0);
                const newProductStock = currentProductStock + actualYield;
                
                transaction.update(productRef, { currentStock: newProductStock });

                const productionLogRef = doc(collection(db, 'production_runs'));
                transaction.set(productionLogRef, {
                    productId: selectedProductId,
                    productName: selectedProduct.name,
                    theoreticalCostSnapshot: selectedProduct.theoreticalCost,
                    productionDate: Timestamp.fromDate(selectedDate), 
                    
                    actualYield: actualYield,
                    totalActualCost: totalActualCost,
                    actualCostPerUnit: actualCostPerUnit,
                    
                    consumedInputs: productionInputs.map(input => ({
                        ingredientId: input.ingredientId,
                        actualQuantityUsed: input.actualQuantityUsed,
                        snapshotCost: input.snapshotCost
                    })),

                    createdBy: $authStore.user?.email,
                    createdAt: serverTimestamp()
                });
                
                await logAction($authStore.user!, 'TRANSACTION', 'production_runs', `SX ${selectedProduct.name}, Yield: ${actualYield}, COGS: ${totalActualCost.toLocaleString()} đ`);
            });

            alert(`Sản xuất thành công ${actualYield.toLocaleString()} thành phẩm!`);
            selectedProductId = '';
            actualYield = 0;
            productionInputs = [];
            batchScale = 1; // Reset scale

		} catch (error) {
			console.error(error);
			alert('Lỗi khi chạy lệnh sản xuất: ' + error);
		} finally {
			processing = false;
		}
	}
</script>

<div class="max-w-4xl mx-auto">
    <h1 class="text-2xl font-bold text-primary mb-6">Phân hệ Sản xuất (Production)</h1>

    <div class="card bg-base-100 shadow-xl p-6">
        {#if errorMsg}
            <div role="alert" class="alert alert-error mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>{errorMsg}</span>
            </div>
        {/if}

        <div class="grid grid-cols-3 gap-4 mb-6">
            <div class="form-control col-span-2">
                <label class="label" for="prod-select"><span class="label-text">Chọn Sản phẩm (Công thức)</span></label>
                <select 
                    id="prod-select"
                    bind:value={selectedProductId} 
                    on:change={handleProductSelect}
                    class="select select-bordered w-full"
                    disabled={loading}
                >
                    <option value="" disabled selected>{loading ? 'Đang tải...' : '-- Chọn Công thức --'}</option>
                    {#each products as prod}
                        <option value={prod.id}>{prod.name} ({prod.theoreticalCost.toLocaleString()} đ/sp)</option>
                    {/each}
                </select>
            </div>

            <div class="form-control">
                <label class="label" for="prod-date"><span class="label-text">Ngày Sản xuất</span></label>
                <input 
                    id="prod-date"
                    type="date" 
                    bind:value={productionDate} 
                    class="input input-bordered w-full" 
                />
            </div>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-6">
            <div class="form-control">
                <label class="label" for="batch-scale">
                    <span class="label-text">Quy mô mẻ (Scale)</span>
                    <span class="badge badge-sm badge-ghost">x{batchScale}</span>
                </label>
                <div class="join w-full">
                    <button class="btn join-item btn-sm" on:click={() => { batchScale = 0.5; handleScaleChange(); }}>½</button>
                    <button class="btn join-item btn-sm" on:click={() => { batchScale = 1; handleScaleChange(); }}>x1</button>
                    <button class="btn join-item btn-sm" on:click={() => { batchScale = 2; handleScaleChange(); }}>x2</button>
                    <button class="btn join-item btn-sm" on:click={() => { batchScale = 3; handleScaleChange(); }}>x3</button>
                    <input 
                        id="batch-scale"
                        type="number" 
                        bind:value={batchScale} 
                        on:input={handleScaleChange}
                        min="0.1" 
                        step="0.1" 
                        class="input input-bordered input-sm join-item w-full text-center" 
                        placeholder="Nhập tỉ lệ..."
                    />
                </div>
                <label class="label"><span class="label-text-alt text-info">Nhập số (VD: 1.5) hoặc chọn nhanh.</span></label>
            </div>

            <div class="form-control">
                <label class="label" for="actual-yield"><span class="label-text">Số lượng thành phẩm (Yield)</span></label>
                <input 
                    id="actual-yield"
                    type="number" 
                    bind:value={actualYield} 
                    min="0" 
                    class="input input-bordered w-full" 
                    placeholder="Tự động tính hoặc nhập tay" 
                />
                <label class="label"><span class="label-text-alt text-success font-bold">Ước tính gốc: {products.find(p => p.id === selectedProductId)?.estimatedYieldQty?.toLocaleString() || 'N/A'}</span></label>
            </div>
        </div>
        
        {#if productionInputs.length > 0}
        <div class="divider">Nguyên liệu tiêu hao Thực tế</div>
        <div class="overflow-x-auto">
            <table class="table table-compact w-full">
                <thead>
                    <tr>
                        <th class="w-1/3">Nguyên liệu</th>
                        <th class="text-right">Lý thuyết (x1)</th>
                        <th class="text-right">Thực tế tiêu hao</th>
                        <th class="text-right">Giá vốn (Snapshot)</th>
                        <th class="text-right">Tổng chi phí</th>
                    </tr>
                </thead>
                <tbody>
                    {#each productionInputs as input}
                        {@const ing = ingredients.find(i => i.id === input.ingredientId)}
                        <tr class="hover">
                            <td>{ing?.code} - {ing?.name}</td>
                            <td class="text-right text-gray-500">
                                {input.theoreticalQuantity.toLocaleString()} {ing?.baseUnit}
                            </td>
                            <td class="text-right">
                                <input 
                                    type="number" 
                                    bind:value={input.actualQuantityUsed} 
                                    min="0" 
                                    class="input input-bordered input-xs w-20 text-right"
                                /> {ing?.baseUnit}
                            </td>
                            <td class="text-right text-warning font-mono">
                                {input.snapshotCost.toLocaleString()} đ/{ing?.baseUnit}
                            </td>
                            <td class="text-right font-bold text-error">
                                {(input.actualQuantityUsed * input.snapshotCost).toLocaleString()} đ
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        <div class="divider">Tóm tắt Chi phí</div>
        
        <div class="flex justify-between items-center mt-4">
            <div class="text-lg font-semibold">Tổng chi phí Nguyên liệu Thực tế:</div>
            <div class="text-2xl font-bold text-error">{totalActualCost.toLocaleString()} đ</div>
        </div>

        <div class="flex justify-between items-center my-2">
            <div class="text-lg font-semibold">Giá vốn Thực tế / 1 đơn vị thành phẩm:</div>
            <div class="text-2xl font-bold text-accent">
                {Math.round(actualCostPerUnit).toLocaleString()} đ
            </div>
        </div>

        <div class="card-actions justify-end mt-6">
            <button class="btn btn-primary px-8" on:click={handleProduction} disabled={processing || actualYield <= 0 || totalActualCost === 0}>
                {#if processing}
                    <span class="loading loading-spinner"></span>
                {:else}
                    Chạy Lệnh Sản Xuất & Trừ Kho
                {/if}
            </button>
        </div>
        {/if}
    </div>
    
    <div class="mt-10">
        <h2 class="text-xl font-bold mb-4">Lịch sử Sản xuất Gần nhất</h2>
        <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
            <table class="table table-zebra w-full table-compact">
                <thead>
                    <tr>
                        <th class="w-1/12">Ngày SX</th>
                        <th class="w-1/4">Sản phẩm</th>
                        <th class="text-right">Yield (SL)</th>
                        <th class="text-right text-warning">Giá vốn Thực tế</th>
                        <th class="text-right text-success">Giá vốn Lý thuyết</th>
                        <th>Hiệu suất</th>
                        <th class="w-1/6">User</th>
                        <th>Thao tác</th> 
                    </tr>
                </thead>
                <tbody>
                    {#if loading}
                        <tr><td colspan="8" class="text-center">Đang tải lịch sử...</td></tr>
                    {:else if productionHistory.length === 0}
                        <tr><td colspan="8" class="text-center text-gray-500">Chưa có lệnh sản xuất nào được ghi nhận.</td></tr>
                    {:else}
                        {#each productionHistory as run}
                            {@const theoreticalTotalCost = run.actualYield * run.theoreticalCostSnapshot}
                            {@const actualTotalCost = run.totalActualCost}
                            {@const variance = actualTotalCost - theoreticalTotalCost}
                            {@const variancePercent = theoreticalTotalCost > 0 ? (variance / theoreticalTotalCost) * 100 : 0}
                            
                            <tr>
                                <td>{run.productionDate?.toDate().toLocaleDateString('vi-VN') || 'N/A'}</td>
                                <td>{run.productName}</td>
                                <td class="text-right font-mono">{run.actualYield.toLocaleString()}</td>
                                <td class="text-right font-mono text-warning">{Math.round(run.actualCostPerUnit).toLocaleString()} đ</td>
                                <td class="text-right font-mono text-success">{run.theoreticalCostSnapshot.toLocaleString()} đ</td>
                                
                                <td>
                                    <span class="badge badge-sm {variance > 0 ? 'badge-error' : 'badge-success'} text-white">
                                        {variancePercent.toFixed(1)}%
                                    </span>
                                </td>
                                <td>{run.createdBy}</td>
                                <td>
                                    <button 
                                        class="btn btn-xs btn-error text-white" 
                                        on:click={() => handleDeleteRun(run)}
                                        disabled={$authStore.user?.role !== 'admin'}
                                    >
                                        Xóa/Đảo kho
                                    </button>
                                </td>
                            </tr>
                        {/each}
                    {/if}
                </tbody>
            </table>
        </div>
    </div>
</div>