<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
	import { collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, getDocs, deleteDoc, serverTimestamp } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
    import { logAction } from '$lib/logger';

	// --- Types ---
	interface Ingredient {
		id: string; code: string; name: string; baseUnit: string; avgCost: number; 
	}

	interface RecipeItem {
		ingredientId: string; quantity: number; unit?: string; 
	}

	interface Product {
		id: string; name: string; sellingPrice: number; items: RecipeItem[]; 
		theoreticalCost: number; estimatedYieldQty: number; 
	}

	// --- State ---
	let products: Product[] = [];
	let ingredients: Ingredient[] = [];
	let loading = true;
	let isModalOpen = false;
	let isEditing = false;
    let errorMsg = '';

    // TRẠNG THÁI CHO PAGINATION VÀ COLLAPSE
    let itemsPerPage = 10;
    let currentPage = 1;
    let openRecipeId: string | null = null; 
    
    let filteredProducts: Product[] = []; 
    
    // Logic Phân trang (Reactive)
    $: paginatedProducts = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
    $: totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    
    $: filteredProducts = products; 
    
	// Form Data
	let formData: Omit<Product, 'id' | 'theoreticalCost'> & { id: string } = {
		id: '', name: '', sellingPrice: 0, estimatedYieldQty: 1, items: [{ ingredientId: '', quantity: 0 }]
	};

	// --- Reactive Calculation (COGS) ---
	$: theoreticalCost = calculateTheoreticalCost(formData.items, ingredients, formData.estimatedYieldQty);

	function calculateTheoreticalCost(items: RecipeItem[], currentIngredients: Ingredient[], estimatedYieldQty: number): number {
		let totalInputCost = 0; 
		if (currentIngredients.length === 0) return 0;

		for (const item of items) {
			const ing = currentIngredients.find(i => i.id === item.ingredientId);
			if (ing && item.quantity > 0) {
				totalInputCost += (ing.avgCost * item.quantity);
			}
		}
        
        if (estimatedYieldQty === 0 || estimatedYieldQty === null) return 0;
        const perUnitCost = totalInputCost / estimatedYieldQty;
        
		return Math.round(perUnitCost); 
	}

	// --- Realtime Subscription ---
	let unsubscribe: () => void;

	onMount(async () => {
		const ingSnap = await getDocs(collection(db, 'ingredients'));
		ingredients = ingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ingredient));

		const q = query(collection(db, 'products'), orderBy('name'));
		unsubscribe = onSnapshot(q, (snapshot) => {
			products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
			loading = false;
		});
	});

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
	});
    
    // --- Toggle Handler cho Recipe Detail ---
    function toggleRecipeDetail(id: string) {
        openRecipeId = openRecipeId === id ? null : id;
    }


	// --- Handlers (CRUD) ---
	function openAddModal() {
		isEditing = false;
		formData = { id: '', name: '', sellingPrice: 0, items: [{ ingredientId: '', quantity: 0 }], estimatedYieldQty: 1 };
		isModalOpen = true;
	}

	function openEditModal(item: Product) {
		isEditing = true;
		formData = { 
            id: item.id, 
            name: item.name, 
            sellingPrice: item.sellingPrice, 
            items: item.items,
            estimatedYieldQty: item.estimatedYieldQty
        };
		isModalOpen = true;
	}
    
    function addRecipeItem() {
        formData.items = [...formData.items, { ingredientId: '', quantity: 0 }];
    }

    function removeRecipeItem(index: number) {
        if(formData.items.length === 1) return;
        formData.items = formData.items.filter((_, i) => i !== index);
    }

	async function handleSubmit() {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) {
            return alert("Bạn không có quyền thực hiện thao tác này.");
        }
        
        errorMsg = '';
        if (!formData.name) return (errorMsg = "Chưa nhập tên sản phẩm.");
        if (formData.items.filter(i => i.ingredientId && i.quantity > 0).length === 0) {
            return (errorMsg = "Công thức phải có ít nhất một nguyên liệu.");
        }

		try {
			const dataToSave = {
                name: formData.name,
                sellingPrice: Number(formData.sellingPrice),
                estimatedYieldQty: Number(formData.estimatedYieldQty),
                items: formData.items.map(i => {
                    const ing = ingredients.find(x => x.id === i.ingredientId);
                    return {
                        ingredientId: i.ingredientId,
                        quantity: Number(i.quantity),
                        unit: ing?.baseUnit 
                    }
                }),
                theoreticalCost: theoreticalCost,
                updatedAt: new Date()
            };

			if (isEditing) {
				await updateDoc(doc(db, 'products', formData.id), dataToSave);
                await logAction($authStore.user!, 'UPDATE', 'products', `Cập nhật công thức: ${formData.name}`);
			} else {
				await addDoc(collection(db, 'products'), {
                    ...dataToSave,
                    createdAt: serverTimestamp()
                });
                await logAction($authStore.user!, 'CREATE', 'products', `Thêm mới công thức: ${formData.name}`);
			}
			isModalOpen = false;
		} catch (error) {
			alert("Lỗi lưu dữ liệu: " + error);
		}
	}

    async function handleDelete(id: string) {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) return alert("Bạn không có quyền thực hiện thao tác này.");
        if(!confirm("Bạn có chắc muốn xóa công thức này?")) return;
        
        try {
            await deleteDoc(doc(db, 'products', id));
            await logAction($authStore.user!, 'DELETE', 'products', `Xóa công thức ID: ${id}`);
        } catch (error) {
            alert("Lỗi xóa: " + error);
        }
    }
</script>

<div class="max-w-7xl mx-auto">
	<div class="flex justify-between items-center mb-6">
		<h1 class="text-2xl font-bold">Quản lý Sản phẩm & Công thức</h1>
		{#if ['admin', 'manager'].includes($authStore.user?.role || '')}
			<button class="btn btn-primary" on:click={openAddModal}>
				+ Thêm Sản phẩm/Công thức
			</button>
		{/if}
	</div>

	<div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
		<table class="table table-zebra w-full table-lg">
			<thead>
				<tr>
                    <th class="w-10"></th> 
					<th>Tên Sản phẩm</th>
                    <th>SL Ước tính</th>
					<th>Giá bán niêm yết</th>
					{#if $authStore.user?.role === 'admin'}
						<th class="hidden sm:table-cell">Giá vốn lý thuyết</th> <th class="hidden sm:table-cell">Tỉ suất lợi nhuận</th> {/if}
					<th class="text-center">Thao tác</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="7" class="text-center">Đang tải...</td></tr>
				{:else if products.length === 0}
                    <tr><td colspan="7" class="text-center text-gray-500">Chưa có công thức nào.</td></tr>
                {:else if paginatedProducts.length === 0}
                    <tr><td colspan="7" class="text-center text-gray-500">Không tìm thấy sản phẩm nào khớp với từ khóa.</td></tr>
                {:else}
					{#each paginatedProducts as item}
                        
                        <tr class="hover cursor-pointer" on:click={() => toggleRecipeDetail(item.id)}>
                            <td>
                                <button class="btn btn-xs btn-ghost btn-circle">
                                    {#if openRecipeId === item.id}
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
                                    {:else}
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                                    {/if}
                                </button>
                            </td>
							<td class="font-bold">{item.name}</td>
                            <td>{item.estimatedYieldQty?.toLocaleString() || 'N/A'}</td>
							<td class="font-mono text-info">{item.sellingPrice?.toLocaleString() || '0'} đ</td>
							
							{#if $authStore.user?.role === 'admin'}
								<td class="font-mono text-warning hidden sm:table-cell">{item.theoreticalCost?.toLocaleString() || '0'} đ</td>
								<td class="hidden sm:table-cell">
									{#if item.sellingPrice > 0}
										{((((item.sellingPrice || 0) - (item.theoreticalCost || 0)) / item.sellingPrice) * 100)?.toFixed(1) || '0'}%
									{:else}
										N/A
									{/if}
								</td>
							{/if}
							
							<td class="text-center">
								<button class="btn btn-xs btn-ghost text-info" on:click|stopPropagation={() => openEditModal(item)}>Sửa</button>
								<button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleDelete(item.id)}>Xóa</button>
							</td>
						</tr>

                        {#if openRecipeId === item.id}
                            <tr class="bg-base-100 border-b-2 border-primary/30">
                                <td colspan="7" class="p-0">
                                    <div class="p-4">
                                        <h4 class="font-semibold text-sm mb-3">Chi tiết Nguyên liệu (BOM):</h4>
                                        <div class="overflow-x-auto">
                                            <table class="table table-xs w-full bg-base-100">
                                                <thead>
                                                    <tr>
                                                        <th class="w-1/2">Tên Nguyên liệu</th>
                                                        <th class="text-right w-1/4">Định lượng</th>
                                                        <th class="text-right w-1/4">Giá vốn TB (Đơn vị)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {#each item.items as recipeItem}
                                                        {@const ingredient = ingredients.find(i => i.id === recipeItem.ingredientId)}
                                                        {#if ingredient}
                                                            <tr>
                                                                <td>{ingredient.name}</td>
                                                                <td class="text-right font-bold">{recipeItem.quantity} {recipeItem.unit}</td>
                                                                <td class="text-right font-mono text-warning">
                                                                    {ingredient.avgCost?.toLocaleString() || '0'} đ/{recipeItem.unit}
                                                                </td>
                                                            </tr>
                                                        {/if}
                                                    {/each}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        {/if}

					{/each}
				{/if}
			</tbody>
		</table>
	</div>
    
    {#if totalPages > 1}
        <div class="flex justify-between items-center mt-4">
            <span class="text-sm text-gray-500">Hiển thị {paginatedProducts.length} trên tổng số {filteredProducts.length} công thức.</span>
            <div class="btn-group">
                <button class="btn btn-sm" on:click={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1}>«</button>
                <button class="btn btn-sm">Trang {currentPage} / {totalPages}</button>
                <button class="btn btn-sm" on:click={() => currentPage = Math.min(totalPages, currentPage + 1)} disabled={currentPage === totalPages}>»</button>
            </div>
        </div>
    {/if}
</div>

<input type="checkbox" id="product_modal" class="modal-toggle" bind:checked={isModalOpen} />
<div class="modal" role="dialog">
	<div class="modal-box max-w-2xl">
		<h3 class="font-bold text-lg mb-4">{isEditing ? 'Cập nhật' : 'Thêm mới'} Công thức</h3>
		
        {#if errorMsg}
            <div class="alert alert-error text-sm mb-4">
                <span>{errorMsg}</span>
            </div>
        {/if}

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4"> <div class="form-control col-span-1">
                <label class="label" for="prod-name"><span class="label-text">Tên Sản phẩm</span></label>
                <input id="prod-name" type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Bánh Mì Đặc Biệt" />
            </div>
            <div class="form-control col-span-1">
                <label class="label" for="prod-price"><span class="label-text">Giá bán niêm yết (đ)</span></label>
                <input id="prod-price" type="number" bind:value={formData.sellingPrice} min="0" class="input input-bordered w-full" />
            </div>
            <div class="form-control col-span-1">
                <label class="label" for="prod-yield"><span class="label-text font-bold">SL ước tính (1 mẻ)</span></label>
                <input id="prod-yield" type="number" bind:value={formData.estimatedYieldQty} min="1" class="input input-bordered w-full" placeholder="VD: 100 cái" />
                <label class="label"><span class="label-text-alt text-warning">Dùng cho báo cáo hiệu suất</span></label>
            </div>
        </div>

        <div class="divider">Công thức (BOM)</div>
        <p class="text-sm text-gray-500 mb-4">Giá vốn lý thuyết được tính bằng cách: Tổng chi phí nguyên liệu / SL ước tính.</p>


        <div class="overflow-x-auto">
            <table class="table table-xs md:table-sm w-full">
                <thead>
                    <tr>
                        <th class="w-1/2">Nguyên liệu</th>
                        <th class="w-1/4 text-right">Định lượng</th>
                        <th class="w-1/4 text-right">Giá vốn thành phần</th>
                        <th class="w-10"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each formData.items as item, i}
                        <tr>
                            <td>
                                <select 
                                    bind:value={item.ingredientId} 
                                    class="select select-bordered select-sm w-full"
                                    id="recipe-item-{i}"
                                >
                                    <option value="" disabled selected>-- Chọn NVL --</option>
                                    {#each ingredients as ing}
                                        <option value={ing.id}>{ing.code} - {ing.name} ({ing.baseUnit})</option>
                                    {/each}
                                </select>
                            </td>
                            <td>
                                <input 
                                    type="number" 
                                    bind:value={item.quantity} 
                                    min="0" 
                                    class="input input-bordered input-sm w-full text-right" 
                                    placeholder="0"
                                    id="qty-item-{i}"
                                />
                                <span class="text-xs text-gray-500">
                                    {ingredients.find(i => i.id === item.ingredientId)?.baseUnit || '-'}
                                </span>
                            </td>
                            <td class="text-right font-mono text-gray-700 pt-3">
                                {#if item.ingredientId}
                                    {@const ing = ingredients.find(i => i.id === item.ingredientId)}
                                    {@const cost = ing ? Math.round(ing.avgCost * item.quantity).toLocaleString() : 0}
                                    {cost} đ
                                {/if}
                            </td>
                            <td class="text-center">
                                <button class="btn btn-ghost btn-xs text-error" on:click={() => removeRecipeItem(i)}>X</button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <div class="flex justify-between items-center mt-4">
            <button class="btn btn-sm btn-ghost gap-2" on:click={addRecipeItem}>
                + Thêm Nguyên liệu vào Công thức
            </button>
            <div class="font-bold text-xl text-warning">
                Giá vốn lý thuyết: {theoreticalCost.toLocaleString()} đ/sp
            </div>
        </div>


		<div class="modal-action">
			<button class="btn" on:click={() => isModalOpen = false}>Hủy</button>
			<button class="btn btn-primary" on:click={handleSubmit}>Lưu Công thức</button>
		</div>
	</div>
</div>