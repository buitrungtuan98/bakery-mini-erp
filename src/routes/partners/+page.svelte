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
    import { Plus, Pencil, Trash2 } from 'lucide-svelte';
    import { fade } from 'svelte/transition';
    
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import SkeletonCard from '$lib/components/ui/SkeletonCard.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';

    // State
    let partners: Partner[] = [];
    $: partners = $partnerStore;
    const { loading: partnerLoading } = partnerStore;

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
    <PageHeader>
        <div slot="title">Đối tác</div>
        <div slot="actions">
            {#if $permissionStore.userPermissions.has('manage_partners')}
                <button class="btn btn-primary btn-sm" on:click={openAddModal}>
                    <Plus class="h-4 w-4 mr-1" />
                    Thêm mới
                </button>
            {/if}
        </div>
    </PageHeader>

    <div class="mb-4">
        <div class="form-control w-full max-w-sm">
            <label class="label py-1"><span class="label-text text-xs">Tìm kiếm</span></label>
            <input type="text" bind:value={searchTerm} class="input input-bordered w-full input-sm" placeholder="Tên, số điện thoại..." />
        </div>
    </div>

    {#if $partnerLoading}
        <div class="space-y-4 md:hidden">
            {#each { length: 3 } as _}
                <SkeletonCard />
            {/each}
        </div>
        <div class="hidden md:block">
            <Loading />
        </div>
    {:else if partners.length === 0}
         <EmptyState message="Không tìm thấy đối tác nào." />
    {:else}
        <ResponsiveTable>
             <svelte:fragment slot="mobile">
                {#if filteredPartners.length > 0}
                    {#each filteredPartners as item (item.id)}
                        <div in:fade={{ duration: 200 }} class="card bg-base-100 shadow-sm border border-base-200">
                            <div class="card-body p-4">
                                <!-- Header -->
                                <div class="flex justify-between items-start">
                                    <div>
                                        <h2 class="card-title text-base">{item.name}</h2>
                                        <p class="text-xs text-base-content/60 font-mono">{item.code || '-'}</p>
                                    </div>
                                    {#if item.type === 'supplier'}
                                        <div class="badge badge-warning">NCC</div>
                                    {:else if item.type === 'manufacturer'}
                                        <div class="badge badge-neutral">Nhà SX</div>
                                    {:else}
                                        <div class="badge badge-info">Khách {item.customerType || 'lẻ'}</div>
                                    {/if}
                                </div>

                                <div class="divider my-1"></div>

                                <!-- Body -->
                                <div class="text-sm text-base-content/80 flex flex-col gap-1">
                                    <div class="flex gap-2 items-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                                        <span class="font-mono">{item.phone || 'Chưa có SĐT'}</span>
                                    </div>
                                    <div class="flex gap-2 items-start">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" /></svg>
                                        <span>{item.address || 'Chưa có địa chỉ'}</span>
                                    </div>
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
                    <EmptyState message="Không tìm thấy đối tác nào." />
                {/if}
             </svelte:fragment>

             <svelte:fragment slot="desktop">
                <thead>
                    <tr>
                        <th>Mã</th>
                        <th>Tên Đối tác</th>
                        <th class="text-center">Loại</th>
                        <th>SĐT</th>
                        <th>Địa chỉ</th>
                        <th class="text-center">Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    {#if filteredPartners.length === 0}
                        <tr><td colspan="6"><EmptyState /></td></tr>
                    {:else}
                        {#each filteredPartners as item}
                            <tr class="hover group">
                                <td class="font-mono text-sm">{item.code || '-'}</td>
                                <td class="font-medium">{item.name}</td>
                                <td class="text-center">
                                    {#if item.type === 'supplier'}
                                        <span class="badge badge-warning badge-sm">NCC</span>
                                    {:else if item.type === 'manufacturer'}
                                        <span class="badge badge-neutral badge-sm">Nhà SX</span>
                                    {:else}
                                        <span class="badge badge-info badge-sm">Khách {item.customerType || 'lẻ'}</span>
                                    {/if}
                                </td>
                                <td class="font-mono text-sm">{item.phone || '-'}</td>
                                <td class="text-sm truncate max-w-xs">{item.address || '-'}</td>
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
            <label class="label"><span class="label-text">Mã Đối tác</span></label>
            <input type="text" value="Tự động tạo khi lưu" readonly class="input input-bordered w-full bg-slate-100 text-slate-500 italic" />
        </div>
    {:else if formData.code}
        <div class="form-control mb-3">
            <label class="label"><span class="label-text">Mã Đối tác</span></label>
            <input type="text" value={formData.code} readonly class="input input-bordered w-full bg-slate-100 font-bold" />
        </div>
    {/if}

    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Tên Đối tác</span></label>
        <input type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Cửa hàng A" />
    </div>

    <div class="flex gap-4 mb-3">
        <div class="form-control w-1/2">
            <label class="label"><span class="label-text">Loại hình</span></label>
            <select bind:value={formData.type} class="select select-bordered w-full">
                <option value="customer">Khách hàng</option>
                <option value="supplier">Nhà cung cấp (Bán hàng cho mình)</option>
                <option value="manufacturer">Nhà sản xuất (Chỉ làm thương hiệu)</option>
            </select>
        </div>
        {#if formData.type === 'customer'}
            <div class="form-control w-1/2">
                <label class="label"><span class="label-text">Phân loại Khách</span></label>
                <select bind:value={formData.customerType} class="select select-bordered w-full">
                    <option value="lẻ">Khách lẻ</option>
                    <option value="sỉ">Khách sỉ</option>
                </select>
            </div>
        {/if}
    </div>

    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Số điện thoại</span></label>
        <input type="text" bind:value={formData.phone} class="input input-bordered w-full" />
    </div>

    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Địa chỉ</span></label>
        <input type="text" bind:value={formData.address} class="input input-bordered w-full" />
    </div>
</Modal>
