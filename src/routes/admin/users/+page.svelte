<script lang="ts">
    import { db } from '$lib/firebase';
    import { authStore } from '$lib/stores/authStore';
    import { permissionStore, userPermissions } from '$lib/stores/permissionStore';
    import { collection, getDocs, doc, updateDoc, query, orderBy, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { logAction } from '$lib/logger';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Settings, Send, Trash2 } from 'lucide-svelte';

    interface UserProfile {
        id: string;
        email: string;
        displayName?: string;
        role: string;
        createdAt?: any;
    }

    interface Invite {
        id: string;
        email: string;
        role: string;
        createdAt?: any;
    }

    let users: UserProfile[] = [];
    let invites: Invite[] = [];
    let loading = true;

    // Invite Form
    let inviteEmail = '';
    let inviteRole = 'staff';
    let inviteLoading = false;

    // Dynamic Roles from Store
    $: availableRoles = $permissionStore.roles;

    onMount(async () => {
        await permissionStore.initRoles();

        if (!$userPermissions.has('view_users')) {
            loading = false;
            return;
        }
        await loadAllData();
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
            const q = query(collection(db, 'users'), orderBy('email'));
            const snapshot = await getDocs(q);
            users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
        } catch (e) { console.error(e); }
    }

    async function fetchInvites() {
        try {
            const q = query(collection(db, 'invited_emails'), orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);
            invites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invite));
        } catch (e) { console.error(e); }
    }

    async function updateUserRole(user: UserProfile, newRole: string) {
        if (user.role === newRole) return;
        const roleName = availableRoles.find(r => r.id === newRole)?.name || newRole;

        if (!confirm(`Bạn có chắc muốn đổi quyền của ${user.email} sang "${roleName}"?`)) {
            users = [...users];
            return;
        }

        try {
            const userRef = doc(db, 'users', user.id);
            await updateDoc(userRef, { role: newRole });
            await logAction($authStore.user!, 'UPDATE', 'users', `Phân quyền ${user.email} -> ${roleName}`);

            const index = users.findIndex(u => u.id === user.id);
            if(index !== -1) users[index].role = newRole;

            showSuccessToast(`Đã cập nhật quyền thành công!`);
        } catch (e) {
            showErrorToast("Lỗi cập nhật quyền: " + e.message);
            users = [...users];
        }
    }

    async function handleDeleteUser(id: string, email: string) {
        if (!confirm(`Xóa người dùng ${email}? Họ sẽ mất quyền truy cập ngay lập tức.`)) return;
        try {
            await deleteDoc(doc(db, 'users', id));
            await logAction($authStore.user!, 'DELETE', 'users', `Xóa user: ${email}`);
            users = users.filter(u => u.id !== id);
            showSuccessToast(`Đã xóa người dùng ${email}`);
        } catch (e) { showErrorToast("Lỗi xóa user: " + e.message); }
    }

    async function handleInvite() {
        if(!inviteEmail) return showErrorToast("Vui lòng nhập Email.");
        if (users.find(u => u.email === inviteEmail)) return showErrorToast("Email này đã là thành viên hệ thống.");
        if (invites.find(i => i.email === inviteEmail)) return showErrorToast("Email này đã được mời trước đó.");

        inviteLoading = true;
        try {
            await addDoc(collection(db, 'invited_emails'), {
                email: inviteEmail,
                role: inviteRole,
                createdAt: serverTimestamp(),
                createdBy: $authStore.user?.email
            });
            await logAction($authStore.user!, 'CREATE', 'invited_emails', `Mời ${inviteEmail} làm ${inviteRole}`);

            showSuccessToast(`Đã gửi lời mời cho ${inviteEmail}`);
            inviteEmail = '';
            await fetchInvites();
        } catch (e) {
            showErrorToast("Lỗi gửi lời mời: " + e.message);
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
        } catch (e) { showErrorToast("Lỗi: " + e.message); }
    }
</script>

<div class="max-w-6xl mx-auto">
    <PageHeader>
        <div slot="title">Quản trị Người dùng</div>
        <div slot="actions">
            <a href="/admin/roles" class="btn btn-outline btn-sm gap-2">
                <Settings class="h-4 w-4" />
                Phân quyền
            </a>
        </div>
    </PageHeader>

    {#if !$userPermissions.has('view_users')}
        <div class="alert alert-error shadow-lg">
            <span>Bạn không có quyền truy cập trang này. Chỉ Admin mới được phép.</span>
        </div>
    {:else}

        <!-- SECTION 1: INVITE USER -->
        <div class="card bg-base-100 shadow-sm border border-slate-200 mb-8">
            <div class="card-body p-4">
                <h2 class="card-title text-lg mb-4">Mời thành viên mới</h2>
                <div class="flex flex-col md:flex-row gap-4 items-end">
                    <div class="form-control w-full md:w-1/3">
                        <label class="label pt-0"><span class="label-text">Email Google</span></label>
                        <input type="email" bind:value={inviteEmail} placeholder="user@gmail.com" class="input input-bordered w-full" />
                    </div>
                    <div class="form-control w-full md:w-1/4">
                        <label class="label pt-0"><span class="label-text">Vai trò dự kiến</span></label>
                        <select bind:value={inviteRole} class="select select-bordered w-full">
                            {#each availableRoles as r}
                                <option value={r.id}>{r.name}</option>
                            {/each}
                        </select>
                    </div>
                    <button class="btn btn-primary w-full md:w-auto" on:click={handleInvite} disabled={inviteLoading}>
                        <Send class="h-4 w-4 mr-2" />
                        {#if inviteLoading}<span class="loading loading-spinner"></span>{/if}
                        Gửi lời mời
                    </button>
                </div>

                {#if invites.length > 0}
                    <div class="mt-4 pt-4 border-t border-slate-100">
                        <h3 class="font-bold text-sm text-gray-500 mb-2 uppercase">Lời mời đang chờ</h3>
                        <div class="overflow-x-auto">
                            <table class="table table-xs w-full bg-base-50 rounded-lg border border-slate-200">
                                <thead>
                                    <tr>
                                        <th>Email được mời</th>
                                        <th>Vai trò</th>
                                        <th>Ngày mời</th>
                                        <th class="text-right">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each invites as inv}
                                        {@const roleName = availableRoles.find(r => r.id === inv.role)?.name || inv.role}
                                        <tr>
                                            <td>{inv.email}</td>
                                            <td><span class="badge badge-ghost badge-sm">{roleName}</span></td>
                                            <td>{inv.createdAt?.toDate().toLocaleDateString('vi-VN')}</td>
                                            <td class="text-right">
                                                <button class="btn btn-ghost btn-xs text-error" on:click={() => handleDeleteInvite(inv.id)}>
                                                    <Trash2 class="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- SECTION 2: USER LIST -->
        {#if loading}
            <div class="text-center py-8">Đang tải...</div>
        {:else}
            <ResponsiveTable>
                <svelte:fragment slot="mobile">
                    <div class="space-y-4">
                        {#each users as user}
                            <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                                <div class="flex justify-between items-start mb-2">
                                    <div class="font-bold text-lg">{user.email}</div>
                                    {#if user.id !== $authStore.user?.uid}
                                        <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDeleteUser(user.id, user.email)}>
                                            <Trash2 class="h-4 w-4" />
                                        </button>
                                    {/if}
                                </div>
                                <div class="text-sm text-slate-500 mb-3">
                                    Tham gia: {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'}
                                </div>

                                <div class="form-control">
                                    <label class="label pt-0"><span class="label-text text-xs uppercase font-bold text-slate-400">Vai trò</span></label>
                                    <select
                                        class="select select-bordered select-sm w-full"
                                        bind:value={user.role}
                                        on:change={(e) => updateUserRole(user, e.currentTarget.value)}
                                        disabled={user.id === $authStore.user?.uid}
                                    >
                                        {#each availableRoles as r}
                                            <option value={r.id}>{r.name}</option>
                                        {/each}
                                    </select>
                                </div>
                            </div>
                        {/each}
                    </div>
                </svelte:fragment>

                <svelte:fragment slot="desktop">
                    <thead>
                        <tr>
                            <th>Email / Tên hiển thị</th>
                            <th>Ngày tham gia</th>
                            <th>Vai trò (Role)</th>
                            <th class="text-center">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each users as user}
                            <tr class="hover">
                                <td>
                                    <div class="font-bold">{user.email}</div>
                                    <div class="text-sm opacity-50">{user.displayName || 'Chưa đặt tên'}</div>
                                </td>
                                <td>
                                    {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A'}
                                </td>
                                <td>
                                    <select
                                        class="select select-bordered select-sm w-full max-w-xs
                                            {user.role === 'admin' ? 'select-secondary font-bold' : ''}
                                            {user.role === 'manager' ? 'select-primary' : ''}
                                            {user.role === 'sales' ? 'select-info' : ''}
                                        "
                                        bind:value={user.role}
                                        on:change={(e) => updateUserRole(user, e.currentTarget.value)}
                                        disabled={user.id === $authStore.user?.uid}
                                    >
                                        {#each availableRoles as r}
                                            <option value={r.id}>{r.name}</option>
                                        {/each}
                                    </select>
                                </td>
                                <td class="text-center">
                                    {#if user.id !== $authStore.user?.uid}
                                        <button class="btn btn-sm btn-ghost text-error" on:click={() => handleDeleteUser(user.id, user.email)}>
                                            <Trash2 class="h-4 w-4" />
                                        </button>
                                    {:else}
                                        <span class="text-xs text-gray-400">(Bạn)</span>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </svelte:fragment>
            </ResponsiveTable>
        {/if}
    {/if}
</div>