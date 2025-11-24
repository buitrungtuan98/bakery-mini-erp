<script lang="ts">
    import { db } from '$lib/firebase';
    import { authStore } from '$lib/stores/authStore';
    import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { logAction } from '$lib/logger';

    interface UserProfile {
        id: string;
        email: string;
        displayName?: string;
        role: 'admin' | 'manager' | 'sales' | 'staff';
        createdAt?: any;
    }

    let users: UserProfile[] = [];
    let loading = true;
    let currentUserRole = '';

    // Subscribe store để lấy role hiện tại của người đang login
    $: currentUserRole = $authStore.user?.role || '';

    onMount(async () => {
        if (currentUserRole !== 'admin') {
            // Nếu load trang mà chưa kịp có role admin (hoặc không phải admin), sẽ chặn ở UI
            loading = false;
            return;
        }
        await fetchUsers();
    });

    // Fetch lại khi authStore update (trường hợp F5)
    $: if ($authStore.user?.role === 'admin' && users.length === 0) {
         fetchUsers();
    }

    async function fetchUsers() {
        loading = true;
        try {
            const q = query(collection(db, 'users'), orderBy('email'));
            const snapshot = await getDocs(q);
            users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
        } catch (e) {
            console.error(e);
            alert("Lỗi tải danh sách users.");
        } finally {
            loading = false;
        }
    }

    async function updateUserRole(user: UserProfile, newRole: string) {
        if (user.role === newRole) return;
        if (!confirm(`Bạn có chắc muốn đổi quyền của ${user.email} sang "${newRole}"?`)) {
            // Reset lại UI select nếu cancel
            user.role = user.role;
            users = users;
            return;
        }

        try {
            const userRef = doc(db, 'users', user.id);
            await updateDoc(userRef, { role: newRole });

            // Log hành động
            await logAction($authStore.user!, 'UPDATE', 'users', `Phân quyền ${user.email} -> ${newRole}`);

            alert(`Đã cập nhật quyền thành công!`);
            user.role = newRole as any; // Update local state
        } catch (e) {
            alert("Lỗi cập nhật quyền: " + e);
            console.error(e);
        }
    }
</script>

<div class="max-w-6xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">Quản trị Người dùng (User Management)</h1>

    {#if currentUserRole !== 'admin'}
        <div class="alert alert-error shadow-lg">
            <div>
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>Bạn không có quyền truy cập trang này. Chỉ Admin mới được phép.</span>
            </div>
        </div>
    {:else}
        <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
            <table class="table w-full">
                <!-- head -->
                <thead>
                    <tr>
                        <th>Email / Tên hiển thị</th>
                        <th>Ngày tham gia</th>
                        <th>Vai trò (Role)</th>
                        <th>Mô tả quyền hạn</th>
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
                                    <div class="text-xs text-gray-400">UID: {user.id}</div>
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
                                </td>
                                <td class="text-sm text-gray-500">
                                    {#if user.role === 'staff'}
                                        Chỉ xem dữ liệu, không được chỉnh sửa.
                                    {:else if user.role === 'sales'}
                                        Tạo đơn bán hàng, quản lý khách hàng.
                                    {:else if user.role === 'manager'}
                                        Quản lý kho, nhập hàng, sản xuất, công thức.
                                    {:else if user.role === 'admin'}
                                        Quản trị hệ thống, user, xem báo cáo lãi lỗ.
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