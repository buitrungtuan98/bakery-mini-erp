<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
    import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { partnerStore, type Partner } from '$lib/stores/masterDataStore';
    import { logAction } from '$lib/logger';
    
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
        p.phone?.includes(searchTerm) ||
        p.code?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Helpers
    function generatePartnerCode(type: string): string {
        let prefix = 'KH';
        if (type === 'supplier') prefix = 'NCC';
        if (type === 'manufacturer') prefix = 'NSX';

        // Filter partners with the same prefix
        const relevantPartners = partners.filter(p => p.code?.startsWith(prefix));

        let maxNum = 0;
        relevantPartners.forEach(p => {
            const parts = p.code?.split('-');
            if (parts && parts.length === 2) {
                const num = parseInt(parts[1], 10);
                if (!isNaN(num) && num > maxNum) {
                    maxNum = num;
                }
            }
        });

        const nextNum = maxNum + 1;
        return `${prefix}-${String(nextNum).padStart(5, '0')}`;
    }

    function onTypeChange() {
        if (!isEditing) {
            formData.code = generatePartnerCode(formData.type);
        }
    }

    // Handlers
    function openAddModal() {
        if (!checkPermission('manage_partners')) return alert("Không có quyền.");
        isEditing = false;
        const initialType = 'customer';
        formData = {
            id: '',
            code: generatePartnerCode(initialType),
            name: '',
            type: initialType,
            customerType: 'lẻ',
            phone: '',
            address: '',
            customPrices: []
        };
        isModalOpen = true;
    }

    function openEditModal(item: Partner) {
        if (!checkPermission('manage_partners')) return alert("Không có quyền.");
        isEditing = true;
        formData = { ...item };
        isModalOpen = true;
    }

    async function handleSubmit() {
        if (!formData.name) return alert("Thiếu tên đối tác");
        processing = true;
        
        try {
            const dataToSave = {
                code: formData.code,
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
            } else {
                await addDoc(collection(db, 'partners'), { ...dataToSave, createdAt: serverTimestamp() });
                await logAction($authStore.user!, 'CREATE', 'partners', `Thêm mới đối tác: ${formData.name}`);
            }
            isModalOpen = false;
        } catch (e) { alert("Lỗi: " + e); }
        finally { processing = false; }
    }

    async function handleDelete(id: string) {
        if (!checkPermission('manage_partners')) return alert("Không có quyền.");
        if (!confirm("Xóa đối tác này?")) return;
        await deleteDoc(doc(db, 'partners', id));
    }
</script>

<div class="max-w-7xl mx-auto">
    <PageHeader
        title="Quản lý Đối tác"
        actionLabel="+ Thêm Đối tác"
        onAction={openAddModal}
        showAction={$permissionStore.userPermissions.has('manage_partners')}
    />

    <div class="mb-6">
        <input type="text" bind:value={searchTerm} class="input input-bordered w-full max-w-md" placeholder="Tìm kiếm tên, mã, số điện thoại..." />
    </div>

    {#if partners.length === 0}
        <Loading />
    {:else}
        <ResponsiveTable>
             <svelte:fragment slot="mobile">
                 {#each filteredPartners as item}
                    <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-100 flex flex-col gap-2 relative">
                         <div class="flex justify-between items-start pr-8">
                            <h3 class="font-bold text-slate-800">
                                <span class="text-primary mr-1">[{item.code || '---'}]</span>
                                {item.name}
                            </h3>
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
                            <button class="btn btn-xs btn-outline" on:click={() => openEditModal(item)}>Sửa</button>
                            <button class="btn btn-xs btn-outline btn-error" on:click={() => handleDelete(item.id)}>Xóa</button>
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
                            <td class="font-mono text-sm text-primary font-bold">{item.code || '-'}</td>
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
                                <button class="btn btn-xs btn-ghost text-sky-600" on:click={() => openEditModal(item)}>Sửa</button>
                                <button class="btn btn-xs btn-ghost text-red-500" on:click={() => handleDelete(item.id)}>Xóa</button>
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
    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Mã Đối tác</span></label>
        <input type="text" bind:value={formData.code} class="input input-bordered w-full bg-slate-100" readonly />
    </div>

    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Tên Đối tác</span></label>
        <input type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Cửa hàng A" />
    </div>

    <div class="flex gap-4 mb-3">
        <div class="form-control w-1/2">
            <label class="label"><span class="label-text">Loại hình</span></label>
            <select bind:value={formData.type} on:change={onTypeChange} class="select select-bordered w-full">
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