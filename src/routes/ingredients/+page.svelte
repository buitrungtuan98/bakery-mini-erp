<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
    import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { ingredientStore, partnerStore, type Ingredient, type Partner } from '$lib/stores/masterDataStore';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus, Pencil, Trash2 } from 'lucide-svelte';
    import { fade } from 'svelte/transition';

    // Components
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import SkeletonCard from '$lib/components/ui/SkeletonCard.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';

    // --- State ---
    let ingredients: Ingredient[] = [];
    let manufacturers: Partner[] = [];

    // Subscribe to Stores
    $: ingredients = $ingredientStore;
    $: manufacturers = $partnerStore.filter(p => p.type === 'manufacturer');

    let loading = false;
    let isModalOpen = false;
    let isEditing = false;
    let processing = false;
    
    // Filter State
    let searchTerm = '';
    let itemsPerPage = 10;
    let currentPage = 1;
    let startDate: string = '';
    let endDate: string = '';
    
    // Derived State
    $: filteredAndSorted = processIngredients(ingredients, searchTerm, startDate, endDate);
    $: totalPages = Math.ceil(filteredAndSorted.length / itemsPerPage);
    $: paginatedIngredients = filteredAndSorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // Form Data
    let formData = {
        id: '', code: '', name: '', baseUnit: 'g', minStock: 0,
        manufacturerId: '', manufacturerName: ''
    };

    // --- Helpers ---
    function processIngredients(data: Ingredient[], term: string, start: string, end: string): Ingredient[] {
        let filtered = data;
        
        if (term) {
            const lowerTerm = term.toLowerCase();
            filtered = filtered.filter(item => 
                item.name.toLowerCase().includes(lowerTerm) || 
                item.code.toLowerCase().includes(lowerTerm) ||
                item.manufacturerName?.toLowerCase().includes(lowerTerm)
            );
        }

        if (start || end) {
            const startTimestamp = start ? new Date(start).getTime() : 0;
            const endTimestamp = end ? new Date(end).setHours(23, 59, 59, 999) : Infinity;
            
            filtered = filtered.filter(item => {
                const itemDate = item.createdAt?.toDate ? item.createdAt.toDate().getTime() : 0;
                return itemDate >= startTimestamp && itemDate <= endTimestamp;
            });
        }
        
        return filtered.sort((a, b) => b.code.localeCompare(a.code));
    }

    // --- Handlers ---
    function openAddModal() {
        if (!checkPermission('edit_inventory')) return showErrorToast("Bạn không có quyền.");
        isEditing = false;
        formData = { id: '', code: '', name: '', baseUnit: 'g', minStock: 100, manufacturerId: '', manufacturerName: '' };
        isModalOpen = true;
    }

    function openEditModal(item: Ingredient) {
        if (!checkPermission('edit_inventory')) return showErrorToast("Bạn không có quyền.");
        isEditing = true;
        formData = {
            id: item.id, code: item.code, name: item.name, baseUnit: item.baseUnit, minStock: item.minStock, 
            manufacturerId: item.manufacturerId, manufacturerName: item.manufacturerName
        };
        isModalOpen = true;
    }

    async function handleSubmit() {
        processing = true;
        const manufacturerSnapshot = manufacturers.find(m => m.id === formData.manufacturerId);
        
        try {
            let code = formData.code;
            if (!isEditing) {
                code = await generateNextCode('ingredients', 'NVL');
            }

            const baseData = {
                code: code,
                name: formData.name,
                baseUnit: formData.baseUnit,
                minStock: Number(formData.minStock),
                manufacturerId: formData.manufacturerId,
                manufacturerName: manufacturerSnapshot?.name || 'Chưa rõ'
            };

            if (isEditing) {
                await updateDoc(doc(db, 'ingredients', formData.id), baseData);
                await logAction($authStore.user!, 'UPDATE', 'ingredients', `Cập nhật NVL: ${formData.name}`);
                showSuccessToast("Cập nhật nguyên liệu thành công!");
            } else {
                await addDoc(collection(db, 'ingredients'), {
                    ...baseData,
                    currentStock: 0,
                    avgCost: 0,
                    createdAt: serverTimestamp() 
                });
                await logAction($authStore.user!, 'CREATE', 'ingredients', `Thêm mới NVL: ${formData.name} (${code})`);
                showSuccessToast("Thêm nguyên liệu thành công!");
            }
            isModalOpen = false;
        } catch (error) { showErrorToast("Lỗi lưu: " + error.message); }
        finally { processing = false; }
    }

    async function handleDelete(id: string) {
        if (!checkPermission('edit_inventory')) return showErrorToast("Bạn không có quyền.");
        if(!confirm("Xóa nguyên liệu này?")) return;
        
        try {
            await deleteDoc(doc(db, 'ingredients', id));
            await logAction($authStore.user!, 'DELETE', 'ingredients', `Xóa NVL ID: ${id}`);
            showSuccessToast("Đã xóa nguyên liệu.");
        } catch (error) { showErrorToast("Lỗi xóa: " + error.message); }
    }
</script>

<div class="max-w-7xl mx-auto">
    <PageHeader>
        <div slot="title">Nguyên liệu</div>
        <div slot="actions">
            {#if $permissionStore.userPermissions.has('edit_inventory')}
                <button class="btn btn-primary btn-sm" on:click={openAddModal}>
                    <Plus class="h-4 w-4 mr-1" />
                    Thêm mới
                </button>
            {/if}
        </div>
    </PageHeader>
    
    <div class="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <div class="form-control md:col-span-2">
            <label class="label py-1"><span class="label-text text-xs">Tìm kiếm</span></label>
            <input type="text" bind:value={searchTerm} class="input input-bordered w-full input-sm" placeholder="Mã, tên, nhà SX..." />
        </div>
        <div class="form-control">
            <label class="label py-1"><span class="label-text text-xs">Ngày tạo</span></label>
            <input type="date" bind:value={startDate} class="input input-bordered w-full input-sm" />
        </div>
    </div>

    {#if ingredients.length === 0}
        <div class="space-y-4 md:hidden">
            {#each { length: 3 } as _}
                <SkeletonCard />
            {/each}
        </div>
        <div class="hidden md:block">
            <Loading />
        </div>
    {:else}
        <ResponsiveTable>
             <svelte:fragment slot="mobile">
                {#if paginatedIngredients.length > 0}
                    {#each paginatedIngredients as item (item.id)}
                        <div in:fade={{ duration: 200 }} class="card bg-base-100 shadow-sm border border-base-200">
                            <div class="card-body p-4">
                                <!-- Header -->
                                <div class="flex justify-between items-start">
                                    <div>
                                        <h2 class="card-title text-base">{item.name}</h2>
                                        <p class="text-xs text-base-content/60 font-mono">{item.code}</p>
                                    </div>
                                    <div class="badge badge-ghost badge-sm">{item.baseUnit}</div>
                                </div>

                                <div class="divider my-1"></div>

                                <!-- Body -->
                                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                    <div class="text-base-content/60">Tồn kho</div>
                                    <div class="font-mono font-medium text-right {item.currentStock < item.minStock ? 'text-error' : ''}">
                                        {item.currentStock?.toLocaleString() || 0}
                                    </div>

                                    {#if $permissionStore.userPermissions.has('view_finance')}
                                        <div class="text-base-content/60">Giá vốn</div>
                                        <div class="font-mono text-right">{item.avgCost?.toLocaleString() || 0} đ</div>
                                    {/if}

                                    <div class="text-base-content/60">Nhà SX</div>
                                    <div class="text-right truncate">{item.manufacturerName || 'N/A'}</div>
                                </div>

                                <div class="divider my-1"></div>

                                <!-- Footer Actions -->
                                <div class="card-actions justify-end">
                                    <button class="btn btn-xs btn-ghost" on:click|stopPropagation={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                                    <button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                                </div>
                            </div>
                        </div>
                    {/each}
                {:else}
                    <EmptyState message="Không tìm thấy nguyên liệu nào." />
                {/if}
             </svelte:fragment>

             <svelte:fragment slot="desktop">
                <thead>
                    <tr>
                        <th>Mã NVL</th>
                        <th>Tên Nguyên liệu</th>
                        <th>Nhà Sản xuất</th>
                        <th class="text-center">Đơn vị</th>
                        <th class="text-right">Tồn kho</th>
                        {#if $permissionStore.userPermissions.has('view_finance')}
                            <th class="text-right">Giá vốn TB</th>
                        {/if}
                        <th>Ngày tạo</th>
                        <th class="text-center">Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    {#if paginatedIngredients.length === 0}
                        <tr><td colspan="8"><EmptyState /></td></tr>
                    {:else}
                        {#each paginatedIngredients as item}
                            <tr class="hover group">
                                <td class="font-mono text-sm">{item.code}</td>
                                <td>
                                    <div class="font-medium">{item.name}</div>
                                    {#if item.currentStock < item.minStock}
                                        <span class="badge badge-error badge-xs text-white mt-1">Sắp hết</span>
                                    {/if}
                                </td>
                                <td>{item.manufacturerName}</td>
                                <td class="text-center"><span class="badge badge-ghost badge-sm">{item.baseUnit}</span></td>

                                <td class="text-right font-mono {item.currentStock < item.minStock ? 'text-error font-bold' : ''}">
                                    {item.currentStock?.toLocaleString() || '0'}
                                </td>

                                {#if $permissionStore.userPermissions.has('view_finance')}
                                    <td class="text-right font-mono text-primary">
                                        {item.avgCost?.toLocaleString() || '0'} đ
                                    </td>
                                {/if}
                                <td class="text-xs text-base-content/60">{item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'}</td>
                                <td class="text-center">
                                    <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button class="btn btn-xs btn-ghost" on:click={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                                        <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                                    </div>
                                </td>
                            </tr>
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
</div>

<Modal
    title={isEditing ? 'Cập nhật Nguyên liệu' : 'Thêm mới Nguyên liệu'}
    isOpen={isModalOpen}
    onClose={() => isModalOpen = false}
    onConfirm={handleSubmit}
    loading={processing}
>
    {#if !isEditing}
        <div class="form-control w-full mb-3">
            <label class="label"><span class="label-text">Mã hiển thị</span></label>
            <input type="text" value="Tự động tạo khi lưu" readonly class="input input-bordered w-full bg-slate-100 text-slate-500 italic" />
        </div>
    {:else}
        <div class="form-control w-full mb-3">
            <label class="label"><span class="label-text">Mã hiển thị</span></label>
            <input type="text" bind:value={formData.code} readonly class="input input-bordered w-full bg-slate-100 font-bold" />
        </div>
    {/if}

    <div class="form-control w-full mb-3">
        <label class="label"><span class="label-text">Tên Nguyên liệu</span></label>
        <input type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Trứng gà" />
    </div>

    <div class="form-control w-full mb-3">
        <label class="label"><span class="label-text">Nhà Sản xuất</span></label>
        <select bind:value={formData.manufacturerId} class="select select-bordered w-full">
            <option value="" disabled selected>-- Chọn Nhà sản xuất --</option>
            {#each manufacturers as mfg}
                <option value={mfg.id}>{mfg.name}</option>
            {/each}
        </select>
    </div>

    <div class="flex gap-4">
        <div class="form-control w-1/2">
            <label class="label"><span class="label-text">Đơn vị gốc</span></label>
            <select bind:value={formData.baseUnit} class="select select-bordered w-full" disabled={isEditing}>
                <option value="g">Gram (g)</option>
                <option value="ml">Mililit (ml)</option>
                <option value="cai">Cái / Quả</option>
            </select>
        </div>
        <div class="form-control w-1/2">
            <label class="label"><span class="label-text">Min-stock</span></label>
            <input type="number" bind:value={formData.minStock} class="input input-bordered w-full" />
        </div>
    </div>
</Modal>
