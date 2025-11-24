<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
    import { authStore } from '$lib/stores/authStore';
    import { partnerStore, type Partner } from '$lib/stores/masterDataStore';
    import { logAction } from '$lib/logger';
    
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import TableWrapper from '$lib/components/ui/TableWrapper.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';

    // State
    let partners: Partner[] = [];
    $: partners = $partnerStore;

    let isModalOpen = false;
    let isEditing = false;
    let processing = false;

    let formData: any = {
        id: '', name: '', type: 'customer', customerType: 'lẻ',
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
        if (!['admin', 'manager', 'sales'].includes($authStore.user?.role || '')) return alert("Không có quyền.");
        isEditing = false;
        formData = { id: '', name: '', type: 'customer', customerType: 'lẻ', phone: '', address: '', customPrices: [] };
        isModalOpen = true;
    }

    function openEditModal(item: Partner) {
        if (!['admin', 'manager', 'sales'].includes($authStore.user?.role || '')) return alert("Không có quyền.");
        isEditing = true;
        formData = { ...item };
        isModalOpen = true;
    }

    async function handleSubmit() {
        if (!formData.name) return alert("Thiếu tên đối tác");
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
            } else {
                await addDoc(collection(db, 'partners'), { ...dataToSave, createdAt: serverTimestamp() });
                await logAction($authStore.user!, 'CREATE', 'partners', `Thêm mới đối tác: ${formData.name}`);
            }
            isModalOpen = false;
        } catch (e) { alert("Lỗi: " + e); }
        finally { processing = false; }
    }

    async function handleDelete(id: string) {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) return alert("Không có quyền.");
        if (!confirm("Xóa đối tác này?")) return;
        await deleteDoc(doc(db, 'partners', id));
    }
</script>

<div class="max-w-7xl mx-auto">
    <PageHeader
        title="Quản lý Đối tác"
        actionLabel="+ Thêm Đối tác"
        onAction={openAddModal}
        showAction={['admin', 'manager', 'sales'].includes($authStore.user?.role || '')}
    />

    <div class="mb-6">
        <input type="text" bind:value={searchTerm} class="input input-bordered w-full max-w-md" placeholder="Tìm kiếm tên, số điện thoại..." />
    </div>

    {#if partners.length === 0}
        <Loading />
    {:else}
        <TableWrapper>
            <thead>
                <tr class="bg-slate-50 text-slate-600">
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
        </TableWrapper>
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