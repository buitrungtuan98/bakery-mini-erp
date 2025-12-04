<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission, userPermissions } from '$lib/stores/permissionStore';
	import { collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, deleteDoc, serverTimestamp } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
    import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus, Pencil, Trash2, Save } from 'lucide-svelte';
    import FloatingActionButton from '$lib/components/ui/FloatingActionButton.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import SyncButton from '$lib/components/ui/SyncButton.svelte';

	interface Asset {
		id: string;
        code?: string;
        name: string;
        category: string; // VD: Thiết bị điện, Dụng cụ cầm tay
        status: 'Đang dùng' | 'Thanh lý';
        quantity: { total: number; good: number; broken: number; lost: number; };
        originalPrice: number; // Giá mua tham khảo
	}

	let assets: Asset[] = [];
	let loading = true;
	let isModalOpen = false;
	let isEditing = false;
    let processing = false;

	let formData = {
		id: '', code: '', name: '', category: 'Dụng cụ', status: 'Đang dùng', originalPrice: 0,
        quantity: { total: 1, good: 1, broken: 0, lost: 0 }
	};

	let unsubscribe: () => void;

	onMount(() => {
        loading = true;
		const q = query(collection(db, 'master_assets'), orderBy('name'));
		unsubscribe = onSnapshot(q, (snapshot) => {
			assets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Asset));
			loading = false;
		});
	});

	onDestroy(() => { if (unsubscribe) unsubscribe(); });

	function openAddModal() {
		isEditing = false;
		formData = { id: '', code: '', name: '', category: 'Dụng cụ', status: 'Đang dùng', originalPrice: 0, quantity: { total: 1, good: 1, broken: 0, lost: 0 } };
		isModalOpen = true;
	}

    function openEditModal(item: Asset) {
        isEditing = true;
        formData = { ...item };
        isModalOpen = true;
    }

	async function handleSubmit() {
        if (!checkPermission('manage_assets')) return showErrorToast("Bạn không có quyền thêm/sửa tài sản.");
        processing = true;

        // Tự động tính tổng
        formData.quantity.total = formData.quantity.good + formData.quantity.broken; 

		try {
            const dataToSave: any = {
                name: formData.name,
                category: formData.category,
                status: formData.status,
                originalPrice: formData.originalPrice,
                quantity: formData.quantity
            };

			if (isEditing) {
				await updateDoc(doc(db, 'master_assets', formData.id), dataToSave);
                await logAction($authStore.user!, 'UPDATE', 'master_assets', `Cập nhật tài sản: ${formData.name}`);
                showSuccessToast("Cập nhật tài sản thành công!");
			} else {
                const code = await generateNextCode('master_assets', 'TS');
                dataToSave.code = code;

				await addDoc(collection(db, 'master_assets'), { ...dataToSave, createdAt: serverTimestamp() });
                await logAction($authStore.user!, 'CREATE', 'master_assets', `Thêm tài sản mới: ${formData.name} (${code})`);
                showSuccessToast("Thêm tài sản mới thành công!");
			}
			isModalOpen = false;
		} catch (error: any) { showErrorToast("Lỗi: " + error.message); }
        finally { processing = false; }
	}

    async function handleDelete(id: string) {
        if (!checkPermission('manage_assets')) return showErrorToast("Bạn không có quyền xóa tài sản.");
        if(!confirm("Xóa tài sản này?")) return;
        try {
            await deleteDoc(doc(db, 'master_assets', id));
            showSuccessToast("Đã xóa tài sản.");
        } catch (error: any) {
            showErrorToast("Lỗi xóa tài sản: " + error.message);
        }
    }
</script>

<div class="max-w-7xl mx-auto pb-20">
	<PageHeader>
        <div slot="title">Kho Công cụ & Tài sản</div>
        <div slot="actions">
            {#if checkPermission('manage_assets')}
                 <SyncButton type="assets" label="Sync Tài Sản" />
            {/if}
        </div>
    </PageHeader>

	{#if loading}
		<Loading />
	{:else if assets.length === 0}
        <EmptyState message="Chưa có tài sản nào." />
    {:else}
        <ResponsiveTable>
            <svelte:fragment slot="mobile">
                {#each assets as item}
                    <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-100 mb-3">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <h3 class="font-bold text-slate-800">{item.name}</h3>
                                <div class="flex items-center gap-2">
                                    <span class="badge badge-sm badge-ghost">{item.category}</span>
                                    {#if item.code}
                                        <span class="text-xs font-mono text-slate-400">{item.code}</span>
                                    {/if}
                                </div>
                            </div>
                            <span class="font-bold text-primary">{item.originalPrice.toLocaleString()} đ</span>
                        </div>

                        <div class="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                            <div class="bg-green-50 p-1 rounded border border-green-100">
                                <div class="text-success font-bold">{item.quantity.good}</div>
                                <div class="text-gray-500">Tốt</div>
                            </div>
                            <div class="bg-yellow-50 p-1 rounded border border-yellow-100">
                                <div class="text-warning font-bold">{item.quantity.broken}</div>
                                <div class="text-gray-500">Hỏng</div>
                            </div>
                            <div class="bg-red-50 p-1 rounded border border-red-100">
                                <div class="text-error font-bold">{item.quantity.lost}</div>
                                <div class="text-gray-500">Mất</div>
                            </div>
                        </div>

                        <div class="flex justify-end gap-2 border-t pt-2">
                            <button class="btn btn-xs btn-ghost" on:click={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                            <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                        </div>
                    </div>
                {/each}
            </svelte:fragment>

            <svelte:fragment slot="desktop">
                <thead>
                    <tr>
                        <th>Mã</th>
                        <th>Tên Tài sản</th>
                        <th>Loại</th>
                        <th>Tổng SL</th>
                        <th class="text-success">Tốt</th>
                        <th class="text-warning">Hỏng</th>
                        <th class="text-error">Mất</th>
                        <th>Giá trị gốc</th>
                        <th class="text-center">Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    {#each assets as item}
                        <tr>
                            <td class="font-mono text-sm text-slate-500">{item.code || '-'}</td>
                            <td class="font-bold">{item.name}</td>
                            <td>{item.category}</td>
                            <td class="font-bold">{item.quantity.total}</td>
                            <td class="text-success">{item.quantity.good}</td>
                            <td class="text-warning">{item.quantity.broken}</td>
                            <td class="text-error">{item.quantity.lost}</td>
                            <td>{item.originalPrice.toLocaleString()} đ</td>
                            <td class="text-center">
                                <button class="btn btn-xs btn-ghost text-info" on:click={() => openEditModal(item)}><Pencil class="h-4 w-4" /></button>
                                <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDelete(item.id)}><Trash2 class="h-4 w-4" /></button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </svelte:fragment>
        </ResponsiveTable>
	{/if}

    <FloatingActionButton
        visible={$userPermissions.has('manage_assets')}
        onClick={openAddModal}
        label="Thêm Tài sản"
    />
</div>

<Modal
    title={isEditing ? 'Cập nhật Tài sản' : 'Thêm mới Tài sản'}
    isOpen={isModalOpen}
    onClose={() => isModalOpen = false}
    onConfirm={handleSubmit}
    loading={processing}
>
    {#if !isEditing}
        <div class="form-control mb-3">
            <label class="label"><span class="label-text">Mã Tài sản</span></label>
            <input type="text" value="Tự động tạo khi lưu" readonly class="input input-bordered w-full bg-slate-100 text-slate-500 italic" />
        </div>
    {:else if formData.code}
        <div class="form-control mb-3">
            <label class="label"><span class="label-text">Mã Tài sản</span></label>
            <input type="text" value={formData.code} readonly class="input input-bordered w-full bg-slate-100 font-bold" />
        </div>
    {/if}

    <div class="form-control w-full mb-3">
        <label class="label">Tên Tài sản</label>
        <input type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Lò nướng Sanaky" />
    </div>
    <div class="grid grid-cols-2 gap-4 mb-3">
        <div class="form-control">
            <label class="label">Loại</label>
            <select bind:value={formData.category} class="select select-bordered">
                <option>Dụng cụ</option>
                <option>Thiết bị điện</option>
                <option>Nội thất</option>
            </select>
        </div>
        <div class="form-control">
            <label class="label">Giá mua (đ)</label>
            <input type="number" bind:value={formData.originalPrice} class="input input-bordered" />
        </div>
    </div>
    <div class="grid grid-cols-3 gap-4 mb-3 bg-base-200 p-4 rounded-box">
        <div class="form-control">
            <label class="label text-success">Tốt</label>
            <input type="number" bind:value={formData.quantity.good} class="input input-bordered input-sm" />
        </div>
        <div class="form-control">
            <label class="label text-warning">Hỏng</label>
            <input type="number" bind:value={formData.quantity.broken} class="input input-bordered input-sm" />
        </div>
        <div class="form-control">
            <label class="label text-error">Mất</label>
            <input type="number" bind:value={formData.quantity.lost} class="input input-bordered input-sm" />
        </div>
    </div>
</Modal>
