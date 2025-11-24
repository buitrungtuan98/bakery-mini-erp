<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, Timestamp, onSnapshot, limit, deleteDoc } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';
    import Modal from '$lib/components/ui/Modal.svelte';

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
    let selectedProduct: Product | undefined; // Reactive helper
    let actualYield = 0;
    let productionInputs: ProductionInput[] = [];
    
    // Scale
    let batchScale = 1; 
    
    // UI State
    let isProductModalOpen = false;

    let unsubscribe: () => void;

    // --- Reactive Calculation ---
    $: selectedProduct = products.find(p => p.id === selectedProductId);

    $: totalActualCost = productionInputs.reduce((sum, input) => {
        return sum + (input.actualQuantityUsed * input.snapshotCost);
    }, 0);

    $: actualCostPerUnit = (actualYield > 0 && totalActualCost > 0) 
        ? totalActualCost / actualYield 
        : 0;

    // Filter Products for Modal
    let productSearchTerm = '';
    $: filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()));

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
    function selectProduct(id: string) {
        selectedProductId = id;
        isProductModalOpen = false;
        errorMsg = '';

        const prod = products.find(p => p.id === selectedProductId);
        if (!prod) {
            productionInputs = [];
            actualYield = 0;
            return;
        }

        // Reset Scale
        batchScale = 1;
        actualYield = prod.estimatedYieldQty || 0;

        productionInputs = prod.items.map(recipeItem => {
            const ing = ingredients.find(i => i.id === recipeItem.ingredientId);
            return {
                ingredientId: recipeItem.ingredientId,
                theoreticalQuantity: recipeItem.quantity,
                actualQuantityUsed: recipeItem.quantity,
                snapshotCost: ing?.avgCost || 0,
            };
        });
    }

    
    function handleScaleChange() {
        if (batchScale <= 0) return;
        
        const prod = products.find(p => p.id === selectedProductId);
        if (!prod) return;

        if (prod.estimatedYieldQty) {
            actualYield = Math.round(prod.estimatedYieldQty * batchScale);
        }

        productionInputs = productionInputs.map(input => {
            const newQty = input.theoreticalQuantity * batchScale;
            return {
                ...input,
                actualQuantityUsed: Number(newQty.toFixed(2))
            };
        });
    }
    
    // --- Delete/Reverse Logic ---
    async function handleDeleteRun(run: ProductionRun) {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) {
            return alert("Bạn không có quyền xóa lịch sử sản xuất.");
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
    
    // --- Submit Logic ---
	async function handleProduction() {
		errorMsg = '';
        const prod = products.find(p => p.id === selectedProductId);

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
        
        if (!confirm(`Xác nhận chạy lệnh sản xuất ${actualYield.toLocaleString()} ${prod?.name}?`)) return;

		processing = true;

		try {
			await runTransaction(db, async (transaction) => {
                if (!prod) throw new Error("Sản phẩm không hợp lệ.");

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
                    productName: prod.name,
                    theoreticalCostSnapshot: prod.theoreticalCost,
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
                
                await logAction($authStore.user!, 'TRANSACTION', 'production_runs', `SX ${prod.name}, Yield: ${actualYield}, COGS: ${totalActualCost.toLocaleString()} đ`);
            });

            alert(`Sản xuất thành công ${actualYield.toLocaleString()} thành phẩm!`);
            // selectedProductId = '';
            // actualYield = 0;
            // productionInputs = [];
            // batchScale = 1;

		} catch (error) {
			console.error(error);
			alert('Lỗi khi chạy lệnh sản xuất: ' + error);
		} finally {
			processing = false;
		}
	}
</script>

<div class="max-w-4xl mx-auto pb-24">
    <h1 class="text-2xl font-bold text-primary mb-4 px-2">Sản xuất (Production)</h1>

    {#if errorMsg}
        <div role="alert" class="alert alert-error mb-4 mx-2">
            <span>{errorMsg}</span>
        </div>
    {/if}

    <!-- 1. Select Product & Date -->
    <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-4 mx-2">
        <div class="form-control mb-4" on:click={() => isProductModalOpen = true}>
            <label class="label"><span class="label-text">Sản phẩm (Công thức)</span></label>
            <div class="flex items-center justify-between border rounded-lg p-3 bg-slate-50">
                {#if selectedProduct}
                    <span class="font-bold">{selectedProduct.name}</span>
                {:else}
                    <span class="text-slate-400">Chọn công thức...</span>
                {/if}
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
            </div>
        </div>

        <div class="form-control">
            <label class="label"><span class="label-text">Ngày SX</span></label>
            <input type="date" bind:value={productionDate} class="input input-bordered w-full" />
        </div>
    </div>

    {#if selectedProductId}
        <!-- 2. Scale & Yield -->
        <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-4 mx-2">
            <div class="grid grid-cols-2 gap-4">
                 <div class="form-control">
                    <label class="label"><span class="label-text text-xs">Tỉ lệ (Scale)</span></label>
                    <select bind:value={batchScale} on:change={handleScaleChange} class="select select-bordered select-sm w-full font-bold text-primary">
                        <option value={0.5}>0.5x (1/2 mẻ)</option>
                        <option value={1}>1x (Chuẩn)</option>
                        <option value={1.5}>1.5x</option>
                        <option value={2}>2x (Nhân đôi)</option>
                        <option value={3}>3x</option>
                        <option value={4}>4x</option>
                        <option value={5}>5x</option>
                    </select>
                </div>
                <div class="form-control">
                    <label class="label"><span class="label-text text-xs">Thành phẩm (Yield)</span></label>
                    <input type="number" bind:value={actualYield} class="input input-bordered input-sm w-full font-bold text-center" />
                </div>
            </div>
        </div>

        <!-- 3. Inputs List -->
        <div class="mx-2 mb-4">
            <h3 class="font-bold text-sm text-slate-500 mb-2 uppercase">Nguyên liệu tiêu hao</h3>
            <div class="space-y-2">
                {#each productionInputs as input}
                    {@const ing = ingredients.find(i => i.id === input.ingredientId)}
                    <div class="bg-white p-3 rounded-lg border border-slate-200 flex justify-between items-center">
                        <div class="flex-1">
                            <div class="font-bold text-slate-700">{ing?.name}</div>
                            <div class="text-xs text-slate-400">{ing?.code} (Kho: {ing?.currentStock})</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <input
                                type="number"
                                bind:value={input.actualQuantityUsed}
                                class="input input-bordered input-sm w-20 text-right"
                            />
                            <span class="text-xs font-bold text-slate-500 w-8">{ing?.baseUnit}</span>
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        <!-- 4. Summary & Action -->
        <div class="bg-white p-4 mx-2 rounded-lg border border-slate-200 shadow-sm mb-6">
             <div class="flex justify-between items-center mb-2">
                <span class="text-sm text-slate-500">Tổng chi phí NVL:</span>
                <span class="font-bold text-error">{totalActualCost.toLocaleString()} đ</span>
            </div>
            <div class="flex justify-between items-center mb-4">
                <span class="text-sm text-slate-500">Giá vốn / SP:</span>
                <span class="font-bold text-accent">{Math.round(actualCostPerUnit).toLocaleString()} đ</span>
            </div>

            <button
                class="btn btn-primary w-full shadow-lg"
                on:click={handleProduction}
                disabled={processing || actualYield <= 0}
            >
                {processing ? 'Đang xử lý...' : 'HOÀN TẤT & TRỪ KHO'}
            </button>
        </div>
    {/if}

    <!-- History (Simplified for Mobile) -->
    <div class="mx-2 mt-8 opacity-60">
        <h3 class="font-bold text-sm mb-2">Lịch sử gần đây</h3>
        {#each productionHistory as run}
             <div class="bg-white p-3 rounded border border-slate-200 mb-2 text-xs flex justify-between items-center">
                 <div>
                     <div class="font-bold">{run.productName}</div>
                     <div class="text-slate-400">{run.productionDate?.toDate().toLocaleDateString('vi-VN')} - Yield: {run.actualYield}</div>
                 </div>
                 <button
                    class="btn btn-xs btn-ghost text-red-400"
                    on:click={() => handleDeleteRun(run)}
                >Xóa</button>
             </div>
        {/each}
    </div>

</div>

<!-- Modal: Select Product -->
<Modal title="Chọn Công thức" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    <input
        type="text"
        bind:value={productSearchTerm}
        placeholder="Tìm tên sản phẩm..."
        class="input input-bordered w-full mb-4 sticky top-0"
        autofocus
    />
    <div class="space-y-2 max-h-[60vh] overflow-y-auto pb-10">
        {#each filteredProducts as prod}
            <button
                class="w-full text-left p-3 rounded hover:bg-slate-100 border border-slate-100 flex justify-between items-center"
                on:click={() => selectProduct(prod.id)}
            >
                <span class="font-bold">{prod.name}</span>
                <span class="text-xs text-slate-400">Giá vốn: {prod.theoreticalCost.toLocaleString()} đ</span>
            </button>
        {/each}
    </div>
</Modal>