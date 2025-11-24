<script lang="ts">
    import { db } from '$lib/firebase';
    import { authStore } from '$lib/stores/authStore';
    import { collection, getDocs, doc, updateDoc, query, orderBy, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { logAction } from '$lib/logger';

    interface UserProfile {
        id: string;
        email: string;
        displayName?: string;
        role: 'admin' | 'manager' | 'sales' | 'staff';
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
    let currentUserRole = '';

    // Invite Form
    let inviteEmail = '';
    let inviteRole = 'staff';
    let inviteLoading = false;

    // Subscribe store để lấy role hiện tại của người đang login
    $: currentUserRole = $authStore.user?.role || '';

    onMount(async () => {
        if (currentUserRole !== 'admin') {
            loading = false;
            return;
        }
        await loadAllData();
    });

    // Fetch lại khi authStore update (trường hợp F5)
    $: if ($authStore.user?.role === 'admin' && users.length === 0) {
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
        if (!confirm(`Bạn có chắc muốn đổi quyền của ${user.email} sang "${newRole}"?`)) {
            // Reset lại UI select nếu cancel
            // Trick: Force reactivity update
            users = [...users];
            return;
        }

        try {
            const userRef = doc(db, 'users', user.id);
            await updateDoc(userRef, { role: newRole });
            await logAction($authStore.user!, 'UPDATE', 'users', `Phân quyền ${user.email} -> ${newRole}`);

            // Update local state
            const index = users.findIndex(u => u.id === user.id);
            if(index !== -1) users[index].role = newRole as any;

            alert(`Đã cập nhật quyền thành công!`);
        } catch (e) {
            alert("Lỗi cập nhật quyền: " + e);
            users = [...users]; // Reset UI on error
        }
    }

    async function handleDeleteUser(id: string, email: string) {
        if (!confirm(`Xóa người dùng ${email}? Họ sẽ mất quyền truy cập ngay lập tức.`)) return;
        try {
            await deleteDoc(doc(db, 'users', id));
            await logAction($authStore.user!, 'DELETE', 'users', `Xóa user: ${email}`);
            users = users.filter(u => u.id !== id);
        } catch (e) { alert("Lỗi xóa user: " + e); }
    }

    // --- Invite Logic ---
    async function handleInvite() {
        if(!inviteEmail) return alert("Vui lòng nhập Email.");
        if (users.find(u => u.email === inviteEmail)) return alert("Email này đã là thành viên hệ thống.");
        if (invites.find(i => i.email === inviteEmail)) return alert("Email này đã được mời trước đó.");

        inviteLoading = true;
        try {
            await addDoc(collection(db, 'invited_emails'), {
                email: inviteEmail,
                role: inviteRole,
                createdAt: serverTimestamp(),
                createdBy: $authStore.user?.email
            });
            await logAction($authStore.user!, 'CREATE', 'invited_emails', `Mời ${inviteEmail} làm ${inviteRole}`);

            alert(`Đã gửi lời mời cho ${inviteEmail}`);
            inviteEmail = ''; // Reset form
            await fetchInvites();
        } catch (e) {
            alert("Lỗi gửi lời mời: " + e);
        } finally {
            inviteLoading = false;
        }
    }

    async function handleDeleteInvite(id: string) {
        if(!confirm("Hủy lời mời này?")) return;
        try {
            await deleteDoc(doc(db, 'invited_emails', id));
            invites = invites.filter(i => i.id !== id);
        } catch (e) { alert("Lỗi: " + e); }
    }
</script>

<div class="max-w-6xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">Quản trị Người dùng & Phân quyền</h1>

    {#if currentUserRole !== 'admin'}
        <div class="alert alert-error shadow-lg">
            <span>Bạn không có quyền truy cập trang này. Chỉ Admin mới được phép.</span>
        </div>
    {:else}

        <!-- SECTION 1: INVITE USER -->
        <div class="card bg-base-100 shadow-xl mb-8">
            <div class="card-body">
                <h2 class="card-title text-lg">Mời thành viên mới</h2>
                <div class="flex flex-col md:flex-row gap-4 items-end">
                    <div class="form-control w-full md:w-1/3">
                        <label class="label"><span class="label-text">Email Google</span></label>
                        <input type="email" bind:value={inviteEmail} placeholder="user@gmail.com" class="input input-bordered w-full" />
                    </div>
                    <div class="form-control w-full md:w-1/4">
                        <label class="label"><span class="label-text">Vai trò dự kiến</span></label>
                        <select bind:value={inviteRole} class="select select-bordered w-full">
                            <option value="staff">Staff (Xem)</option>
                            <option value="sales">Sales (Bán hàng)</option>
                            <option value="manager">Manager (Kho/SX)</option>
                            <option value="admin">Admin (Toàn quyền)</option>
                        </select>
                    </div>
                    <button class="btn btn-primary" on:click={handleInvite} disabled={inviteLoading}>
                        {#if inviteLoading}<span class="loading loading-spinner"></span>{/if}
                        Gửi lời mời
                    </button>
                </div>

                {#if invites.length > 0}
                    <div class="mt-4">
                        <h3 class="font-bold text-sm text-gray-500 mb-2">Lời mời đang chờ (Pending)</h3>
                        <div class="overflow-x-auto">
                            <table class="table table-xs table-compact w-full bg-base-200 rounded-lg">
                                <thead>
                                    <tr>
                                        <th>Email được mời</th>
                                        <th>Vai trò</th>
                                        <th>Ngày mời</th>
                                        <th>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each invites as inv}
                                        <tr>
                                            <td>{inv.email}</td>
                                            <td><span class="badge badge-outline">{inv.role}</span></td>
                                            <td>{inv.createdAt?.toDate().toLocaleDateString('vi-VN')}</td>
                                            <td>
                                                <button class="btn btn-ghost btn-xs text-error" on:click={() => handleDeleteInvite(inv.id)}>Hủy</button>
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
        <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
            <table class="table w-full">
                <!-- head -->
                <thead>
                    <tr>
                        <th>Email / Tên hiển thị</th>
                        <th>Ngày tham gia</th>
                        <th>Vai trò (Role)</th>
                        <th class="text-center">Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    {#if loading}
                        <tr><td colspan="4" class="text-center">Đang tải...</td></tr>
                    {:else}
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
                                        <option value="staff">Staff (Xem)</option>
                                        <option value="sales">Sales (Bán hàng)</option>
                                        <option value="manager">Manager (Kho/SX)</option>
                                        <option value="admin">Admin (Toàn quyền)</option>
                                    </select>
                                    <div class="text-[10px] text-gray-400 mt-1">
                                        {#if user.role === 'staff'}Chỉ xem dữ liệu{:else if user.role === 'sales'}Bán hàng, khách hàng{:else if user.role === 'manager'}Kho, SX, nhập hàng{:else}Toàn quyền hệ thống{/if}
                                    </div>
                                </td>
                                <td class="text-center">
                                    {#if user.id !== $authStore.user?.uid}
                                        <button class="btn btn-sm btn-ghost text-error" on:click={() => handleDeleteUser(user.id, user.email)}>Xóa User</button>
                                    {:else}
                                        <span class="text-xs text-gray-400">(Bạn)</span>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    {/if}
                </tbody>
            </table>
        </div>
    {/if}
</div>