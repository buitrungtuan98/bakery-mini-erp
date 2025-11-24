<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
    import { authStore } from '$lib/stores/authStore';
    import { productStore, ingredientStore, type Product, type Ingredient } from '$lib/stores/masterDataStore';
    import { logAction } from '$lib/logger';

    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import TableWrapper from '$lib/components/ui/TableWrapper.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';

    // State
    let products: Product[] = [];
    let ingredients: Ingredient[] = [];

    $: products = $productStore;
    $: ingredients = $ingredientStore;

    let isModalOpen = false;
    let isEditing = false;
    let processing = false;
    let openRecipeId: string | null = null;

    // Pagination
    let itemsPerPage = 10;
    let currentPage = 1;
    $: totalPages = Math.ceil(products.length / itemsPerPage);
    $: paginatedProducts = products.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // Form
    let formData: any = {
        id: '', name: '', sellingPrice: 0, estimatedYieldQty: 1, items: [{ ingredientId: '', quantity: 0 }]
    };

    $: theoreticalCost = calculateCost(formData.items);

    function calculateCost(items: any[]) {
        let total = 0;
        if (!ingredients.length) return 0;
        items.forEach(i => {
            const ing = ingredients.find(x => x.id === i.ingredientId);
            if (ing) total += (ing.avgCost * i.quantity);
        });
        if (!formData.estimatedYieldQty) return 0;
        return Math.round(total / formData.estimatedYieldQty);
    }

    function toggleRecipeDetail(id: string) {
        openRecipeId = openRecipeId === id ? null : id;
    }

    // Handlers
    function openAddModal() {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) return alert("Không có quyền.");
        isEditing = false;
        formData = { id: '', name: '', sellingPrice: 0, estimatedYieldQty: 1, items: [{ ingredientId: '', quantity: 0 }] };
        isModalOpen = true;
    }

    function openEditModal(item: Product) {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) return alert("Không có quyền.");
        isEditing = true;
        formData = { ...item };
        isModalOpen = true;
    }
    
    function addRecipeItem() {
        formData.items = [...formData.items, { ingredientId: '', quantity: 0 }];
    }

    function removeRecipeItem(index: number) {
        if (formData.items.length > 1) {
            formData.items = formData.items.filter((_: any, i: number) => i !== index);
        }
    }

    async function handleSubmit() {
        if (!formData.name) return alert("Thiếu tên sản phẩm");
        processing = true;
        try {
            const dataToSave = {
                name: formData.name,
                sellingPrice: Number(formData.sellingPrice),
                estimatedYieldQty: Number(formData.estimatedYieldQty),
                items: formData.items.map((i: any) => {
                    const ing = ingredients.find(x => x.id === i.ingredientId);
                    return { ingredientId: i.ingredientId, quantity: Number(i.quantity), unit: ing?.baseUnit };
                }),
                theoreticalCost: theoreticalCost,
                updatedAt: new Date()
            };

            if (isEditing) {
                await updateDoc(doc(db, 'products', formData.id), dataToSave);
                await logAction($authStore.user!, 'UPDATE', 'products', `Cập nhật SP: ${formData.name}`);
            } else {
                await addDoc(collection(db, 'products'), { ...dataToSave, createdAt: serverTimestamp() });
                await logAction($authStore.user!, 'CREATE', 'products', `Thêm mới SP: ${formData.name}`);
            }
            isModalOpen = false;
        } catch (e) { alert("Lỗi: " + e); }
        finally { processing = false; }
    }

    async function handleDelete(id: string) {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) return alert("Không có quyền.");
        if (!confirm("Xóa sản phẩm này?")) return;
        await deleteDoc(doc(db, 'products', id));
    }
</script>

<div class="max-w-7xl mx-auto">
    <PageHeader
        title="Quản lý Sản phẩm & Công thức"
        actionLabel="+ Thêm Sản phẩm"
        onAction={openAddModal}
        showAction={['admin', 'manager'].includes($authStore.user?.role || '')}
    />

    {#if products.length === 0}
        <Loading />
    {:else}
        <TableWrapper>
            <thead>
                <tr class="bg-slate-50 text-slate-600">
                    <th class="w-10"></th> 
                    <th>Tên Sản phẩm</th>
                    <th>Yield (Ước tính)</th>
                    <th>Giá bán</th>
                    {#if $authStore.user?.role === 'admin'}
                        <th class="hidden sm:table-cell">Giá vốn (LT)</th>
                        <th class="hidden sm:table-cell">Lợi nhuận %</th>
                    {/if}
                    <th class="text-center">Thao tác</th>
                </tr>
            </thead>
            <tbody>
                {#each paginatedProducts as item}
                    <tr class="hover cursor-pointer" on:click={() => toggleRecipeDetail(item.id)}>
                        <td>
                            <button class="btn btn-xs btn-ghost btn-circle text-slate-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transform transition-transform {openRecipeId === item.id ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                            </button>
                        </td>
                        <td class="font-bold text-slate-700">{item.name}</td>
                        <td>{item.estimatedYieldQty?.toLocaleString() || 1}</td>
                        <td class="font-mono text-sky-600">{item.sellingPrice?.toLocaleString()} đ</td>
                        
                        {#if $authStore.user?.role === 'admin'}
                            <td class="font-mono text-slate-500 hidden sm:table-cell">{item.theoreticalCost?.toLocaleString()} đ</td>
                            <td class="hidden sm:table-cell">
                                {#if item.sellingPrice > 0}
                                    <span class="badge badge-sm badge-success text-white">
                                        {((((item.sellingPrice || 0) - (item.theoreticalCost || 0)) / item.sellingPrice) * 100)?.toFixed(0)}%
                                    </span>
                                {/if}
                            </td>
                        {/if}

                        <td class="text-center">
                            <button class="btn btn-xs btn-ghost text-sky-600" on:click|stopPropagation={() => openEditModal(item)}>Sửa</button>
                            <button class="btn btn-xs btn-ghost text-red-500" on:click|stopPropagation={() => handleDelete(item.id)}>Xóa</button>
                        </td>
                    </tr>

                    {#if openRecipeId === item.id}
                        <tr class="bg-slate-50">
                            <td colspan="7" class="p-0 border-b border-slate-200">
                                <div class="p-4 pl-12">
                                    <h4 class="text-xs font-bold text-slate-500 uppercase mb-2">Chi tiết Công thức (BOM)</h4>
                                    <table class="table table-xs w-full bg-white rounded border border-slate-200">
                                        <thead>
                                            <tr>
                                                <th>Nguyên liệu</th>
                                                <th class="text-right">Định lượng</th>
                                                <th class="text-right">Giá trị</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each item.items as recipeItem}
                                                {@const ingredient = ingredients.find(i => i.id === recipeItem.ingredientId)}
                                                {#if ingredient}
                                                    <tr>
                                                        <td>{ingredient.name}</td>
                                                        <td class="text-right font-medium">{recipeItem.quantity} {recipeItem.unit}</td>
                                                        <td class="text-right font-mono text-slate-500">
                                                            {Math.round(ingredient.avgCost * recipeItem.quantity).toLocaleString()} đ
                                                        </td>
                                                    </tr>
                                                {/if}
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            </td>
                        </tr>
                    {/if}
                {/each}
            </tbody>
        </TableWrapper>

        {#if totalPages > 1}
            <div class="flex justify-end mt-4">
                <div class="join">
                    <button class="join-item btn btn-sm" on:click={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1}>«</button>
                    <button class="join-item btn btn-sm bg-base-100">Trang {currentPage} / {totalPages}</button>
                    <button class="join-item btn btn-sm" on:click={() => currentPage = Math.min(totalPages, currentPage + 1)} disabled={currentPage === totalPages}>»</button>
                </div>
            </div>
        {/if}
    {/if}
</div>

<Modal
    title={isEditing ? 'Cập nhật Sản phẩm' : 'Thêm mới Sản phẩm'}
    isOpen={isModalOpen}
    onClose={() => isModalOpen = false}
    onConfirm={handleSubmit}
    loading={processing}
>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div class="form-control">
            <label class="label"><span class="label-text">Tên Sản phẩm</span></label>
            <input type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Bánh Mì" />
        </div>
        <div class="form-control">
            <label class="label"><span class="label-text">Giá bán (đ)</span></label>
            <input type="number" bind:value={formData.sellingPrice} min="0" class="input input-bordered w-full" />
        </div>
        <div class="form-control">
            <label class="label"><span class="label-text">Yield (SL/mẻ)</span></label>
            <input type="number" bind:value={formData.estimatedYieldQty} min="1" class="input input-bordered w-full" />
        </div>
    </div>

    <div class="divider text-xs text-slate-400">CÔNG THỨC</div>

    <div class="space-y-2 mb-4">
        {#each formData.items as item, i}
            <div class="flex gap-2 items-end">
                <div class="form-control flex-grow">
                    <label class="label py-0"><span class="label-text text-xs">Nguyên liệu</span></label>
                    <select bind:value={item.ingredientId} class="select select-bordered select-sm w-full">
                        <option value="" disabled selected>-- Chọn NVL --</option>
                        {#each ingredients as ing}
                            <option value={ing.id}>{ing.code} - {ing.name} ({ing.baseUnit})</option>
                        {/each}
                    </select>
                </div>
                <div class="form-control w-24">
                    <label class="label py-0"><span class="label-text text-xs">Lượng</span></label>
                    <input type="number" bind:value={item.quantity} class="input input-bordered input-sm w-full text-right" />
                </div>
                <button class="btn btn-sm btn-ghost text-red-500" on:click={() => removeRecipeItem(i)}>X</button>
            </div>
        {/each}
    </div>

    <div class="flex justify-between items-center">
        <button class="btn btn-xs btn-outline btn-primary" on:click={addRecipeItem}>+ Thêm dòng</button>
        <div class="text-sm font-bold text-slate-600">
            Giá vốn LT: {theoreticalCost.toLocaleString()} đ/sp
        </div>
    </div>
</Modal>