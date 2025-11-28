<script lang="ts">
    import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { productStore, ingredientStore, type Product, type Ingredient } from '$lib/stores/masterDataStore';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-svelte';
    import { slide, fade } from 'svelte/transition';
    import { catalogService } from '$lib/services/catalogService';

    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import SkeletonCard from '$lib/components/ui/SkeletonCard.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import FloatingActionButton from '$lib/components/ui/FloatingActionButton.svelte';

    // State
    let products: Product[] = [];
    let ingredients: Ingredient[] = [];

    $: products = $productStore;
    const { loading: productLoading } = productStore;
    $: ingredients = $ingredientStore;

    let isModalOpen = false;
    let isRecipeViewOpen = false; // Separate modal for Recipe View
    let isEditing = false;
    let processing = false;
    let openRecipeId: string | null = null;
    let selectedProductForRecipe: Product | null = null;

    // Pagination
    let itemsPerPage = 10;
    let currentPage = 1;
    $: totalPages = Math.ceil(products.length / itemsPerPage);
    $: paginatedProducts = products.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // Form
    let formData: any = {
        id: '', code: '', name: '', sellingPrice: 0, estimatedYieldQty: 1, items: [{ ingredientId: '', quantity: 0, _searchTerm: '', _isOpen: false }]
    };

    $: costPrice = calculateCost(formData.items);

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

    function openRecipeViewMobile(product: Product) {
        selectedProductForRecipe = product;
        isRecipeViewOpen = true;
    }

    // Handlers
    function openAddModal() {
        if (!checkPermission('edit_inventory')) return showErrorToast("Không có quyền.");
        isEditing = false;
        formData = { id: '', code: '', name: '', sellingPrice: 0, estimatedYieldQty: 1, items: [{ ingredientId: '', quantity: 0 }] };
        isModalOpen = true;
    }

    function openEditModal(item: Product) {
        if (!checkPermission('edit_inventory')) return showErrorToast("Không có quyền.");
        isEditing = true;
        // Populate _searchTerm for existing items
        const itemsWithUI = (item.items || []).map((i: any) => {
             const ing = ingredients.find(x => x.id === i.ingredientId);
             return { ...i, _searchTerm: ing ? ing.name : '', _isOpen: false };
        });
        if (itemsWithUI.length === 0) itemsWithUI.push({ ingredientId: '', quantity: 0, _searchTerm: '', _isOpen: false });

        formData = { ...item, items: itemsWithUI };
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

    function selectIngredient(index: number, ing: Ingredient) {
        formData.items[index].ingredientId = ing.id;
        formData.items[index]._searchTerm = ing.name;
        formData.items[index]._isOpen = false;
        // Trigger reactivity
        formData.items = [...formData.items];
    }

    function handleInputFocus(index: number) {
        formData.items[index]._isOpen = true;
        formData.items = [...formData.items];
    }

    function handleInputBlur(index: number) {
        // Small delay to allow click event to fire
        setTimeout(() => {
            formData.items[index]._isOpen = false;
            formData.items = [...formData.items];
        }, 200);
    }

    function handleSearchInput(index: number) {
        formData.items[index].ingredientId = ''; // Clear selection on type
        formData.items[index]._isOpen = true;
    }

    async function handleSubmit() {
        if (!formData.name) return showErrorToast("Thiếu tên sản phẩm");
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
                costPrice: costPrice
            };

            if (isEditing) {
                await catalogService.updateProduct($authStore.user!, formData.id, dataToSave);
                showSuccessToast("Cập nhật sản phẩm thành công!");
            } else {
                await catalogService.createProduct($authStore.user!, dataToSave);
                showSuccessToast("Thêm sản phẩm thành công!");
            }
            isModalOpen = false;
        } catch (e: any) {
            showErrorToast("Lỗi: " + e.message);
        }
        finally { processing = false; }
    }

    async function handleDelete(id: string) {
        if (!checkPermission('edit_inventory')) return showErrorToast("Không có quyền.");
        if (!confirm("Xóa sản phẩm này?")) return;
        try {
            await catalogService.deleteProduct($authStore.user!, id);
            showSuccessToast("Đã xóa sản phẩm.");
        } catch (error) {
            showErrorToast("Lỗi xóa sản phẩm: " + error.message);
        }
    }
</script>

<div class="max-w-7xl mx-auto pb-20">
    <PageHeader>
        <div slot="title">Sản phẩm & Công thức</div>
        <!-- Actions moved to FAB -->
    </PageHeader>

    {#if $productLoading}
        <div class="space-y-4 md:hidden">
            {#each { length: 3 } as _}
                <SkeletonCard />
            {/each}
        </div>
        <div class="hidden md:block">
             <Loading />
        </div>
    {:else if products.length === 0}
        <EmptyState message="Không có sản phẩm nào." />
    {:else}
        <div class="flex justify-end mb-2">
            <select bind:value={itemsPerPage} class="select select-bordered select-xs">
                <option value={10}>10 dòng / trang</option>
                <option value={20}>20 dòng / trang</option>
                <option value={30}>30 dòng / trang</option>
            </select>
        </div>

        <ResponsiveTable>
             <svelte:fragment slot="mobile">
                {#if paginatedProducts.length > 0}
                    {#each paginatedProducts as item (item.id)}
                        <div in:fade={{ duration: 200 }} class="card bg-base-100 shadow-sm border border-base-200">
                            <div class="card-body p-4">
                                <!-- Header -->
                                <div class="flex justify-between items-start">
                                    <div>
                                        <h2 class="card-title text-base">{item.name}</h2>
                                        <p class="text-xs text-base-content/60 font-mono">{item.code || '-'}</p>
                                    </div>
                                    <div class="badge badge-primary badge-outline font-mono">
                                        {item.sellingPrice?.toLocaleString()} đ
                                    </div>
                                </div>

                                <div class="divider my-1"></div>

                                <!-- Body -->
                                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                    <div class="text-base-content/60">Sản lượng (Yield)</div>
                                    <div class="font-medium text-right">{item.estimatedYieldQty}</div>

                                    <div class="text-base-content/60">Số NVL</div>
                                    <div class="font-medium text-right">{item.items?.length || 0}</div>

                                    {#if $permissionStore.userPermissions.has('view_finance')}
                                        <div class="text-base-content/60">Giá vốn (LT)</div>
                                        <div class="font-mono text-right">{item.costPrice?.toLocaleString()} đ</div>
                                    {/if}
                                </div>

                                <div class="divider my-1"></div>

                                <!-- Footer Actions -->
                                <div class="card-actions justify-between items-center">
                                    <div class="text-xs text-info cursor-pointer" on:click={() => openRecipeViewMobile(item)}>
                                        Xem công thức
                                    </div>
                                    <div class="flex gap-2">
                                        <button class="btn btn-xs btn-ghost" on:click|stopPropagation={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                                        <button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/each}
                {:else}
                    <EmptyState message="Không có sản phẩm nào." />
                {/if}
             </svelte:fragment>

             <svelte:fragment slot="desktop">
                <thead>
                    <tr>
                        <th class="w-10"></th>
                        <th>Mã</th>
                        <th>Tên Sản phẩm</th>
                        <th class="text-right">Yield</th>
                        <th class="text-right">Giá bán</th>
                        {#if $permissionStore.userPermissions.has('view_finance')}
                            <th class="text-right">Giá vốn (LT)</th>
                            <th class="text-center">Lợi nhuận %</th>
                        {/if}
                        <th class="text-center">Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    {#if paginatedProducts.length === 0}
                        <tr><td colspan="8"><EmptyState /></td></tr>
                    {:else}
                        {#each paginatedProducts as item}
                            <tr class="hover cursor-pointer group" on:click={() => toggleRecipeDetail(item.id)}>
                                <td>
                                <button class="btn btn-xs btn-ghost btn-circle">
                                    <ChevronRight class="h-4 w-4 transform transition-transform {openRecipeId === item.id ? 'rotate-90' : ''}" />
                                </button>
                            </td>
                            <td class="font-mono text-sm">{item.code || '-'}</td>
                            <td class="font-medium">{item.name}</td>
                            <td class="text-right">{item.estimatedYieldQty?.toLocaleString() || 1}</td>
                            <td class="font-mono text-primary text-right">{item.sellingPrice?.toLocaleString()} đ</td>

                            {#if $permissionStore.userPermissions.has('view_finance')}
                                <td class="font-mono text-base-content/60 text-right">{item.costPrice?.toLocaleString()} đ</td>
                                <td class="text-center">
                                    {#if item.sellingPrice > 0}
                                        {@const profitMargin = (((item.sellingPrice || 0) - (item.costPrice || 0)) / item.sellingPrice) * 100}
                                        <span class="badge badge-sm {profitMargin > 20 ? 'badge-success' : 'badge-warning'} text-white">
                                            {profitMargin?.toFixed(0)}%
                                        </span>
                                    {/if}
                                </td>
                            {/if}

                            <td class="text-center">
                                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button class="btn btn-xs btn-ghost" on:click|stopPropagation={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                                    <button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                                </div>
                            </td>
                        </tr>

                        {#if openRecipeId === item.id}
                            <tr transition:slide class="bg-base-200">
                                <td colspan={8} class="p-0">
                                    <div class="p-4 pl-12">
                                        <h4 class="text-xs font-bold uppercase mb-2">Chi tiết Công thức (BOM)</h4>
                                        <table class="table table-xs w-full bg-base-100 rounded border">
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
                                                            <td class="text-right font-mono text-base-content/60">
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
                    {/if}
                </tbody>
             </svelte:fragment>
        </ResponsiveTable>

        {#if totalPages > 1}
            <div class="flex justify-center md:justify-end mt-4">
                <div class="join">
                    <button class="join-item btn btn-sm" on:click={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1}>«</button>
                    <button class="join-item btn btn-sm bg-base-100">Trang {currentPage} / {totalPages}</button>
                    <button class="join-item btn btn-sm" on:click={() => currentPage = Math.min(totalPages, currentPage + 1)} disabled={currentPage === totalPages}>»</button>
                </div>
            </div>
        {/if}
    {/if}

    <FloatingActionButton
        visible={$permissionStore.userPermissions.has('edit_inventory')}
        onClick={openAddModal}
        label="Thêm SP"
    />
</div>

<!-- Modal: View Recipe (Mobile Friendly) -->
<Modal
    title={selectedProductForRecipe?.name || 'Chi tiết Công thức'}
    isOpen={isRecipeViewOpen}
    onClose={() => isRecipeViewOpen = false}
    showConfirm={false}
>
    {#if selectedProductForRecipe}
        <div class="mb-4">
             <div class="flex justify-between text-sm mb-2">
                 <span class="text-slate-500">Sản lượng (Yield):</span>
                 <span class="font-bold">{selectedProductForRecipe.estimatedYieldQty}</span>
             </div>
             <div class="flex justify-between text-sm mb-2">
                 <span class="text-slate-500">Giá bán:</span>
                 <span class="font-bold text-primary">{selectedProductForRecipe.sellingPrice.toLocaleString()} đ</span>
             </div>
        </div>

        <div class="divider text-xs text-slate-400 font-bold uppercase">Nguyên liệu cần thiết</div>

        <div class="space-y-2">
            {#each selectedProductForRecipe.items as item}
                {@const ing = ingredients.find(i => i.id === item.ingredientId)}
                {#if ing}
                    <div class="flex justify-between items-center p-2 bg-slate-50 rounded border border-slate-100">
                        <div class="font-medium text-slate-700">{ing.name}</div>
                        <div class="font-bold text-slate-900 bg-white px-2 py-1 rounded shadow-sm border">
                            {item.quantity} <span class="text-xs font-normal text-slate-500">{item.unit}</span>
                        </div>
                    </div>
                {/if}
            {/each}
        </div>

        <div class="mt-6 text-center text-xs text-slate-400">
            ID: {selectedProductForRecipe.id} | Mã: {selectedProductForRecipe.code || 'N/A'}
        </div>
    {/if}
</Modal>


<!-- Modal: Add/Edit Product -->
<Modal
    title={isEditing ? 'Cập nhật Sản phẩm' : 'Thêm mới Sản phẩm'}
    isOpen={isModalOpen}
    onClose={() => isModalOpen = false}
    onConfirm={handleSubmit}
    loading={processing}
>
    {#if !isEditing}
        <div class="form-control mb-3">
            <label class="label"><span class="label-text">Mã Sản phẩm</span></label>
            <input type="text" value="Tự động tạo khi lưu" readonly class="input input-bordered w-full bg-slate-100 text-slate-500 italic" />
        </div>
    {:else if formData.code}
        <div class="form-control mb-3">
            <label class="label"><span class="label-text">Mã Sản phẩm</span></label>
            <input type="text" value={formData.code} readonly class="input input-bordered w-full bg-slate-100 font-bold" />
        </div>
    {/if}

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

    <div class="space-y-4 mb-4">
        {#each formData.items as item, i}
            {@const selectedIng = ingredients.find(x => x.id === item.ingredientId)}
            <div class="flex gap-2 items-start">
                <div class="form-control flex-grow relative">
                    <label class="label py-0"><span class="label-text text-xs">Nguyên liệu</span></label>
                    <input
                        type="text"
                        class="input input-bordered input-sm w-full"
                        placeholder="Tìm NVL..."
                        bind:value={item._searchTerm}
                        on:focus={() => handleInputFocus(i)}
                        on:blur={() => handleInputBlur(i)}
                        on:input={() => handleSearchInput(i)}
                    />

                    <!-- Dropdown List -->
                    {#if item._isOpen}
                        {@const filtered = ingredients.filter(ing =>
                            !item._searchTerm ||
                            ing.name.toLowerCase().includes(item._searchTerm.toLowerCase()) ||
                            ing.code.toLowerCase().includes(item._searchTerm.toLowerCase())
                        )}
                        <ul class="absolute top-full left-0 right-0 bg-white border border-slate-200 shadow-lg rounded-b-lg max-h-48 overflow-y-auto z-50 mt-1">
                            {#each filtered as ing}
                                <li>
                                    <button
                                        class="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 border-b border-slate-50 last:border-none"
                                        on:mousedown|preventDefault={() => selectIngredient(i, ing)}
                                    >
                                        {ing.name}
                                    </button>
                                </li>
                            {/each}

                            {#if filtered.length === 0}
                                <li class="px-3 py-2 text-xs text-slate-400 italic">Không tìm thấy</li>
                            {/if}
                        </ul>
                    {/if}
                </div>

                <div class="form-control w-24">
                    <label class="label py-0">
                        <span class="label-text text-xs truncate">
                            {selectedIng ? selectedIng.baseUnit : 'Lượng'}
                        </span>
                    </label>
                    <input type="number" bind:value={item.quantity} class="input input-bordered input-sm w-full text-right" />
                </div>

                <button class="btn btn-sm btn-ghost text-red-500 mt-5" on:click={() => removeRecipeItem(i)}>
                    <Trash2 class="h-4 w-4" />
                </button>
            </div>
        {/each}
    </div>

    <div class="flex justify-between items-center">
        <button class="btn btn-xs btn-outline btn-primary" on:click={addRecipeItem}>
            <Plus class="h-4 w-4 mr-2" /> Thêm dòng
        </button>
        <div class="text-sm font-bold text-slate-600">
            Giá vốn LT: {costPrice.toLocaleString()} đ/sp
        </div>
    </div>
</Modal>
