<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
    import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { partnerStore, type Partner } from '$lib/stores/masterDataStore';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Pencil, Trash2 } from 'lucide-svelte';
    
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';

    // State
    let partners: Partner[] = [];
    $: partners = $partnerStore;

    let isModalOpen = false;
    let isEditing = false;
    let processing = false;

    let formData: any = {
        id: '', code: '', name: '', type: 'customer', customerType: 'lẻ',
        phone: '', address: '', defaultAddress: '', customPrices: []
    };

    // Filter
    let searchTerm = '';
    $: filteredPartners = partners.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.phone?.includes(searchTerm)
    );

    // Handlers
    function openAddModal() {
        if (!checkPermission('manage_partners')) return showErrorToast("Không có quyền.");
        isEditing = false;
        formData = { id: '', code: '', name: '', type: 'customer', customerType: 'lẻ', phone: '', address: '', customPrices: [] };
        isModalOpen = true;
    }

    function openEditModal(item: Partner) {
        if (!checkPermission('manage_partners')) return showErrorToast("Không có quyền.");
        isEditing = true;
        formData = { ...item };
        isModalOpen = true;
    }

    async function handleSubmit() {
        if (!formData.name) return showErrorToast("Thiếu tên đối tác");
        processing = true;
        
        try {
            const dataToSave = {
                name: formData.name,
                type: formData.type,
                customerType: formData.type === 'customer' ? formData.customerType : null,
                phone: formData.phone || '',
                address: formData.address || '',
                updatedAt: new Date()
            };

            if (isEditing) {
                await updateDoc(doc(db, 'partners', formData.id), dataToSave);
                await logAction($authStore.user!, 'UPDATE', 'partners', `Cập nhật đối tác: ${formData.name}`);
                showSuccessToast("Cập nhật đối tác thành công!");
            } else {
                // Generate Code
                let prefix = 'KH';
                if (formData.type === 'supplier') prefix = 'NCC';
                if (formData.type === 'manufacturer') prefix = 'NSX';

                const code = await generateNextCode('partners', prefix);
                dataToSave.code = code;

                await addDoc(collection(db, 'partners'), { ...dataToSave, createdAt: serverTimestamp() });
                await logAction($authStore.user!, 'CREATE', 'partners', `Thêm mới đối tác: ${formData.name} (${code})`);
                showSuccessToast("Thêm đối tác thành công!");
            }
            isModalOpen = false;
        } catch (e) { showErrorToast("Lỗi: " + e.message); }
        finally { processing = false; }
    }

    async function handleDelete(id: string) {
        if (!checkPermission('manage_partners')) return showErrorToast("Không có quyền.");
        if (!confirm("Xóa đối tác này?")) return;
        try {
            await deleteDoc(doc(db, 'partners', id));
            showSuccessToast("Đã xóa đối tác.");
        } catch (error) {
            showErrorToast("Lỗi xóa đối tác: " + error.message);
        }
    }
</script>

<div class="max-w-7xl mx-auto">
    <PageHeader title="Quản lý Đối tác">
        <svelte:fragment slot="action">
            {#if $permissionStore.userPermissions.has('manage_partners')}
                <button class="btn btn-primary btn-sm" on:click={openAddModal}>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Thêm Đối tác
                </button>
            {/if}
        </svelte:fragment>
    </PageHeader>

    <div class="mb-6">
        <input type="text" bind:value={searchTerm} class="input input-bordered w-full max-w-md" placeholder="Tìm kiếm tên, số điện thoại..." />
    </div>

    {#if partners.length === 0}
        <Loading />
    {:else}
        <ResponsiveTable>
             <svelte:fragment slot="mobile">
                 {#each filteredPartners as item}
                    <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-100 flex flex-col gap-2 relative">
                         <div class="flex justify-between items-start pr-8">
                            <h3 class="font-bold text-slate-800">{item.name}</h3>
                         </div>
                         <div class="absolute top-4 right-4">
                             {#if item.type === 'supplier'}
                                <span class="badge badge-warning text-xs">NCC</span>
                            {:else if item.type === 'manufacturer'}
                                <span class="badge badge-neutral text-xs">Nhà SX</span>
                            {:else}
                                <span class="badge badge-info text-xs">Khách {item.customerType || 'lẻ'}</span>
                            {/if}
                         </div>

                         <div class="text-sm text-slate-600 flex flex-col gap-1 mt-1">
                             <div class="flex gap-2">
                                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                                 <span>{item.phone || 'Chưa có SĐT'}</span>
                             </div>
                             <div class="flex gap-2">
                                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" /></svg>
                                 <span class="truncate">{item.address || 'Chưa có địa chỉ'}</span>
                             </div>
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
                        <th>Mã</th>
                        <th>Tên Đối tác</th>
                        <th>Loại</th>
                        <th>SĐT</th>
                        <th>Địa chỉ</th>
                        <th class="text-center">Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    {#each filteredPartners as item}
                        <tr class="hover">
                            <td class="font-mono text-sm font-bold text-slate-500">{item.code || '-'}</td>
                            <td class="font-bold text-slate-700">{item.name}</td>
                            <td>
                                {#if item.type === 'supplier'}
                                    <span class="badge badge-warning text-xs">NCC</span>
                                {:else if item.type === 'manufacturer'}
                                    <span class="badge badge-neutral text-xs">Nhà SX</span>
                                {:else}
                                    <span class="badge badge-info text-xs">Khách {item.customerType || 'lẻ'}</span>
                                {/if}
                            </td>
                            <td class="font-mono text-sm">{item.phone || '-'}</td>
                            <td class="text-sm truncate max-w-xs">{item.address || '-'}</td>
                            <td class="text-center">
                                <button class="btn btn-xs btn-ghost text-sky-600" on:click={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                                <button class="btn btn-xs btn-ghost text-red-500" on:click={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
             </svelte:fragment>
        </ResponsiveTable>
    {/if}
</div>

<Modal
    title={isEditing ? 'Cập nhật Đối tác' : 'Thêm mới Đối tác'}
    isOpen={isModalOpen}
    onClose={() => isModalOpen = false}
    onConfirm={handleSubmit}
    loading={processing}
>
    {#if !isEditing}
        <div class="form-control mb-3">
            <label for="code-display" class="label"><span class="label-text">Mã Đối tác</span></label>
            <input id="code-display" type="text" value="Tự động tạo khi lưu" readonly class="input input-bordered w-full bg-slate-100 text-slate-500 italic" />
        </div>
    {:else if formData.code}
        <div class="form-control mb-3">
            <label for="code-display-edit" class="label"><span class="label-text">Mã Đối tác</span></label>
            <input id="code-display-edit" type="text" value={formData.code} readonly class="input input-bordered w-full bg-slate-100 font-bold" />
        </div>
    {/if}

    <div class="form-control mb-3">
        <label for="partner-name" class="label"><span class="label-text">Tên Đối tác</span></label>
        <input id="partner-name" type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Cửa hàng A" />
    </div>

    <div class="flex gap-4 mb-3">
        <div class="form-control w-1/2">
            <label for="partner-type" class="label"><span class="label-text">Loại hình</span></label>
            <select id="partner-type" bind:value={formData.type} class="select select-bordered w-full">
                <option value="customer">Khách hàng</option>
                <option value="supplier">Nhà cung cấp (Bán hàng cho mình)</option>
                <option value="manufacturer">Nhà sản xuất (Chỉ làm thương hiệu)</option>
            </select>
        </div>
        {#if formData.type === 'customer'}
            <div class="form-control w-1/2">
                <label for="customer-type" class="label"><span class="label-text">Phân loại Khách</span></label>
                <select id="customer-type" bind:value={formData.customerType} class="select select-bordered w-full">
                    <option value="lẻ">Khách lẻ</option>
                    <option value="sỉ">Khách sỉ</option>
                </select>
            </div>
        {/if}
    </div>

    <div class="form-control mb-3">
        <label for="phone" class="label"><span class="label-text">Số điện thoại</span></label>
        <input id="phone" type="text" bind:value={formData.phone} class="input input-bordered w-full" />
    </div>

    <div class="form-control mb-3">
        <label for="address" class="label"><span class="label-text">Địa chỉ</span></label>
        <input id="address" type="text" bind:value={formData.address} class="input input-bordered w-full" />
    </div>
</Modal>
