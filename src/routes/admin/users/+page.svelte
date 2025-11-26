<script lang="ts">
    import { db } from '$lib/firebase';
    import { authStore } from '$lib/stores/authStore';
    import { permissionStore, userPermissions } from '$lib/stores/permissionStore';
    import { collection, getDocs, doc, updateDoc, query, orderBy, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { logAction } from '$lib/logger';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Settings, Send, Trash2, Plus } from 'lucide-svelte';

    // Types
    interface UserProfile { id: string; email: string; displayName?: string; role: string; createdAt?: any; }
    interface Invite { id: string; email: string; role: string; createdAt?: any; }

    let users: UserProfile[] = [];
    let invites: Invite[] = [];
    let loading = true;

    // UI State
    let isInviteModalOpen = false;
    let inviteLoading = false;

    // Invite Form
    let inviteEmail = '';
    let inviteRole = 'staff';

    $: availableRoles = $permissionStore.roles;

    onMount(async () => {
        await permissionStore.initRoles();
        if ($userPermissions.has('view_users')) await loadAllData();
        else loading = false;
    });

    $: if ($userPermissions.has('view_users') && users.length === 0) {
         loadAllData();
    }

    async function loadAllData() {
        loading = true;
        await Promise.all([fetchUsers(), fetchInvites()]);
        loading = false;
    }

    async function fetchUsers() {
        try {
            const snapshot = await getDocs(query(collection(db, 'users'), orderBy('email')));
            users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
        } catch (e) { console.error(e); }
    }

    async function fetchInvites() {
        try {
            const snapshot = await getDocs(query(collection(db, 'invited_emails'), orderBy('createdAt', 'desc')));
            invites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invite));
        } catch (e) { console.error(e); }
    }

    function openInviteModal() {
        inviteEmail = '';
        inviteRole = 'staff';
        isInviteModalOpen = true;
    }

    async function updateUserRole(user: UserProfile, newRole: string) {
        if (user.role === newRole) return;
        const roleName = availableRoles.find(r => r.id === newRole)?.name || newRole;
        if (!confirm(`Đổi quyền của ${user.email} sang "${roleName}"?`)) {
            users = [...users]; // Revert UI change
            return;
        }
        try {
            await updateDoc(doc(db, 'users', user.id), { role: newRole });
            await logAction($authStore.user!, 'UPDATE', 'users', `Phân quyền ${user.email} -> ${roleName}`);
            users.find(u => u.id === user.id)!.role = newRole;
            showSuccessToast(`Cập nhật quyền thành công!`);
        } catch (e: any) {
            showErrorToast("Lỗi: " + e.message);
            users = [...users]; // Revert on error
        }
    }

    async function handleDeleteUser(id: string, email: string) {
        if (!confirm(`Xóa người dùng ${email}?`)) return;
        try {
            await deleteDoc(doc(db, 'users', id));
            await logAction($authStore.user!, 'DELETE', 'users', `Xóa user: ${email}`);
            users = users.filter(u => u.id !== id);
            showSuccessToast(`Đã xóa người dùng ${email}`);
        } catch (e: any) { showErrorToast("Lỗi: " + e.message); }
    }

    async function handleInvite() {
        if(!inviteEmail) return showErrorToast("Vui lòng nhập Email.");
        if (users.some(u => u.email === inviteEmail) || invites.some(i => i.email === inviteEmail)) {
            return showErrorToast("Email này đã tồn tại hoặc đã được mời.");
        }
        inviteLoading = true;
        try {
            await addDoc(collection(db, 'invited_emails'), {
                email: inviteEmail, role: inviteRole,
                createdAt: serverTimestamp(), createdBy: $authStore.user?.email
            });
            await logAction($authStore.user!, 'CREATE', 'invited_emails', `Mời ${inviteEmail} làm ${inviteRole}`);
            showSuccessToast(`Đã gửi lời mời cho ${inviteEmail}`);
            isInviteModalOpen = false;
            await fetchInvites();
        } catch (e: any) {
            showErrorToast("Lỗi: " + e.message);
        } finally {
            inviteLoading = false;
        }
    }

    async function handleDeleteInvite(id: string) {
        if(!confirm("Hủy lời mời này?")) return;
        try {
            await deleteDoc(doc(db, 'invited_emails', id));
            invites = invites.filter(i => i.id !== id);
            showSuccessToast("Đã hủy lời mời.");
        } catch (e: any) { showErrorToast("Lỗi: " + e.message); }
    }
</script>

<div class="max-w-6xl mx-auto pb-20">
    <PageHeader title="Quản trị Người dùng">
        <svelte:fragment slot="action">
            <div class="flex gap-2">
                <a href="/admin/roles" class="btn btn-ghost btn-sm"><Settings class="h-4 w-4" /></a>
                <button class="btn btn-primary btn-sm" on:click={openInviteModal}><Plus class="h-4 w-4 mr-1" /> Mời</button>
            </div>
        </svelte:fragment>
    </PageHeader>

    {#if !$userPermissions.has('view_users')}
        <div class="alert alert-error"><span>Bạn không có quyền truy cập trang này.</span></div>
    {:else}
        {#if invites.length > 0}
            <div class="mb-8">
                <h3 class="font-bold text-sm text-base-content/70 mb-2 uppercase">Lời mời đang chờ</h3>
                <div class="overflow-x-auto">
                    <table class="table table-xs w-full bg-base-100 border border-base-200">
                        <thead><tr><th>Email</th><th>Vai trò</th><th>Ngày mời</th><th class="text-right">Thao tác</th></tr></thead>
                        <tbody>
                            {#each invites as inv}
                                {@const roleName = availableRoles.find(r => r.id === inv.role)?.name || inv.role}
                                <tr>
                                    <td>{inv.email}</td>
                                    <td><span class="badge badge-ghost badge-sm">{roleName}</span></td>
                                    <td>{inv.createdAt?.toDate().toLocaleDateString('vi-VN')}</td>
                                    <td class="text-right"><button class="btn btn-ghost btn-xs text-error" on:click={() => handleDeleteInvite(inv.id)}><Trash2 class="h-4 w-4" /></button></td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        {/if}

        {#if loading}
            <div class="text-center py-8">Đang tải...</div>
        {:else}
             <h3 class="font-bold text-sm text-base-content/70 mb-2 uppercase">Thành viên hiện tại</h3>
            <ResponsiveTable>
                <svelte:fragment slot="mobile">
                    {#each users as user}
                        <div class="bg-base-100 p-4 rounded-lg shadow-sm border border-base-200">
                            <div class="flex justify-between items-start mb-2">
                                <div class="font-bold">{user.email}</div>
                                {#if user.id !== $authStore.user?.uid}<button class="btn btn-xs btn-ghost text-error" on:click={() => handleDeleteUser(user.id, user.email)}><Trash2 class="h-4 w-4" /></button>{/if}
                            </div>
                            <div class="text-sm text-base-content/60 mb-3">Tham gia: {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'}</div>
                            <div class="form-control">
                                <label for="role-{user.id}" class="label pt-0"><span class="label-text text-xs uppercase font-bold">Vai trò</span></label>
                                <select id="role-{user.id}" class="select select-bordered select-sm w-full" bind:value={user.role} on:change={(e) => updateUserRole(user, e.currentTarget.value)} disabled={user.id === $authStore.user?.uid}>
                                    {#each availableRoles as r}<option value={r.id}>{r.name}</option>{/each}
                                </select>
                            </div>
                        </div>
                    {/each}
                </svelte:fragment>
                <svelte:fragment slot="desktop">
                    <thead><tr><th>Email</th><th>Ngày tham gia</th><th>Vai trò</th><th class="text-center">Thao tác</th></tr></thead>
                    <tbody>
                        {#each users as user}
                            <tr class="hover">
                                <td><div class="font-bold">{user.email}</div><div class="text-sm opacity-50">{user.displayName || ''}</div></td>
                                <td>{user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'}</td>
                                <td>
                                    <select class="select select-bordered select-sm w-full max-w-xs" bind:value={user.role} on:change={(e) => updateUserRole(user, e.currentTarget.value)} disabled={user.id === $authStore.user?.uid}>
                                        {#each availableRoles as r}<option value={r.id}>{r.name}</option>{/each}
                                    </select>
                                </td>
                                <td class="text-center">
                                    {#if user.id !== $authStore.user?.uid}
                                        <button class="btn btn-sm btn-ghost text-error" on:click={() => handleDeleteUser(user.id, user.email)}><Trash2 class="h-4 w-4" /></button>
                                    {:else}<span class="text-xs text-base-content/50">(Bạn)</span>{/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </svelte:fragment>
            </ResponsiveTable>
        {/if}
    {/if}
</div>

<Modal title="Mời thành viên mới" isOpen={isInviteModalOpen} onConfirm={handleInvite} onCancel={() => isInviteModalOpen = false} loading={inviteLoading} confirmText="Gửi lời mời">
     <div class="form-control w-full mb-4">
        <label for="invite-email" class="label"><span class="label-text">Email Google</span></label>
        <input id="invite-email" type="email" bind:value={inviteEmail} placeholder="user@gmail.com" class="input input-bordered w-full" />
    </div>
    <div class="form-control w-full">
        <label for="invite-role" class="label"><span class="label-text">Vai trò</span></label>
        <select id="invite-role" bind:value={inviteRole} class="select select-bordered w-full">
            {#each availableRoles as r}<option value={r.id}>{r.name}</option>{/each}
        </select>
    </div>
</Modal>
