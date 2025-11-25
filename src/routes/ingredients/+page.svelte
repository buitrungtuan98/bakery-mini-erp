<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
    import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { ingredientStore, partnerStore, type Ingredient, type Partner } from '$lib/stores/masterDataStore';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import { showToast } from '$lib/utils/toast';
    import { Plus, Pencil, Trash2 } from 'lucide-svelte';

    // Components
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';

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
        if (!checkPermission('edit_inventory')) return showToast("Bạn không có quyền.", 'error');
        isEditing = false;
        formData = { id: '', code: '', name: '', baseUnit: 'g', minStock: 100, manufacturerId: '', manufacturerName: '' };
        isModalOpen = true;
    }

    function openEditModal(item: Ingredient) {
        if (!checkPermission('edit_inventory')) return showToast("Bạn không có quyền.", 'error');
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
            } else {
                await addDoc(collection(db, 'ingredients'), {
                    ...baseData,
                    currentStock: 0,
                    avgCost: 0,
                    createdAt: serverTimestamp() 
                });
                await logAction($authStore.user!, 'CREATE', 'ingredients', `Thêm mới NVL: ${formData.name} (${code})`);
                showToast("Thêm nguyên liệu thành công!", 'success');
            }
            isModalOpen = false;
        } catch (error) { showToast("Lỗi lưu: " + error, 'error'); }
        finally { processing = false; }
    }

    async function handleDelete(id: string) {
        if (!checkPermission('edit_inventory')) return showToast("Bạn không có quyền.", 'error');
        if(!confirm("Xóa nguyên liệu này?")) return;
        
        try {
            await deleteDoc(doc(db, 'ingredients', id));
            await logAction($authStore.user!, 'DELETE', 'ingredients', `Xóa NVL ID: ${id}`);
            showToast("Đã xóa nguyên liệu.", 'success');
        } catch (error) { showToast("Lỗi xóa: " + error, 'error'); }
    }
</script>

<div class="max-w-7xl mx-auto">
    <PageHeader
        title="Danh sách Nguyên liệu"
        actionLabel="Thêm Nguyên liệu"
        onAction={openAddModal}
        showAction={$permissionStore.userPermissions.has('edit_inventory')}
    >
        <Plus class="h-4 w-4" />
    </PageHeader>
    
    <div class="bg-white rounded-lg p-4 mb-6 shadow-sm border border-slate-200">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div class="form-control md:col-span-2">
                <label class="label"><span class="label-text font-medium">Tìm kiếm</span></label>
                <input type="text" bind:value={searchTerm} class="input input-bordered w-full input-sm" placeholder="Mã, tên, nhà SX..." />
            </div>
            <div class="form-control">
                <label class="label"><span class="label-text font-medium">Ngày tạo (Từ)</span></label>
                <input type="date" bind:value={startDate} class="input input-bordered w-full input-sm" />
            </div>
            <div class="form-control">
                <label class="label"><span class="label-text font-medium">Ngày tạo (Đến)</span></label>
                <input type="date" bind:value={endDate} class="input input-bordered w-full input-sm" />
            </div>
        </div>
    </div>

    {#if ingredients.length === 0}
        <Loading />
    {:else}
        <ResponsiveTable>
             <svelte:fragment slot="mobile">
                 {#each paginatedIngredients as item}
                    <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-100 flex flex-col gap-2">
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="font-bold text-slate-800">{item.name}</h3>
                                <p class="text-xs text-slate-500">Mã: {item.code}</p>
                            </div>
                            <span class="badge badge-sm badge-ghost">{item.baseUnit}</span>
                        </div>
                        <div class="text-sm text-slate-600">
                            NSX: {item.manufacturerName || 'N/A'}
                        </div>
                        <div class="flex justify-between items-end mt-2">
                             <div class="flex flex-col">
                                 <span class="text-xs text-slate-400">Tồn kho</span>
                                 <span class="font-mono font-bold {item.currentStock < item.minStock ? 'text-red-500' : 'text-slate-700'}">
                                     {item.currentStock?.toLocaleString() || 0}
                                 </span>
                             </div>
                             {#if $permissionStore.userPermissions.has('view_finance')}
                                <div class="flex flex-col text-right">
                                    <span class="text-xs text-slate-400">Giá vốn</span>
                                    <span class="font-mono text-emerald-600">{item.avgCost?.toLocaleString() || 0} đ</span>
                                </div>
                             {/if}
                        </div>
                        <div class="divider my-1"></div>
                        <div class="flex justify-end gap-2">
                            <button class="btn btn-xs btn-ghost" on:click={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                            <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                        </div>
                    </div>
                 {/each}
             </svelte:fragment>

             <svelte:fragment slot="desktop">
                <thead>
                    <tr class="bg-slate-50 text-slate-600">
                        <th>Mã NVL</th>
                        <th>Tên Nguyên liệu</th>
                        <th>Nhà Sản xuất</th>
                        <th>Đơn vị</th>
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
                        <tr><td colspan="8" class="text-center text-gray-500 py-4">Không tìm thấy dữ liệu.</td></tr>
                    {:else}
                        {#each paginatedIngredients as item}
                            <tr class="hover">
                                <td class="font-bold text-slate-700">{item.code}</td>
                                <td>
                                    <div class="font-medium">{item.name}</div>
                                    {#if item.currentStock < item.minStock}
                                        <span class="badge badge-error badge-xs text-white mt-1">Sắp hết</span>
                                    {/if}
                                </td>
                                <td class="text-sm">{item.manufacturerName}</td>
                                <td><span class="badge badge-ghost badge-sm">{item.baseUnit}</span></td>

                                <td class="text-right font-mono {item.currentStock < item.minStock ? 'text-red-600 font-bold' : ''}">
                                    {item.currentStock?.toLocaleString() || '0'}
                                </td>

                                {#if $permissionStore.userPermissions.has('view_finance')}
                                    <td class="text-right font-mono text-emerald-600">
                                        {item.avgCost?.toLocaleString() || '0'} đ
                                    </td>
                                {/if}
                                <td class="text-xs text-gray-500">{item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'}</td>
                                <td class="text-center">
                                    <button class="btn btn-xs btn-ghost text-sky-600" on:click={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                                    <button class="btn btn-xs btn-ghost text-red-500" on:click={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
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