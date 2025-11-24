<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, doc, setDoc, getDocs, query, orderBy } from 'firebase/firestore';
    import { permissionStore, type RoleDef, type Permission } from '$lib/stores/permissionStore';
    import { onMount } from 'svelte';
    import { authStore } from '$lib/stores/authStore';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';

    let roles: RoleDef[] = [];
    let loading = true;
    let processing = false;

    // List of all available system permissions
    const ALL_PERMISSIONS: { id: Permission, label: string, group: string }[] = [
        { id: 'view_dashboard', label: 'Xem Dashboard', group: 'General' },
        { id: 'view_reports', label: 'Xem Báo cáo', group: 'General' },
        { id: 'view_finance', label: 'Xem Doanh thu/Lợi nhuận', group: 'General' },
        { id: 'view_history', label: 'Xem Lịch sử Hệ thống', group: 'General' },

        { id: 'view_sales', label: 'Truy cập Bán hàng', group: 'Sales' },
        { id: 'create_order', label: 'Tạo Đơn hàng', group: 'Sales' },
        { id: 'manage_partners', label: 'Quản lý Đối tác', group: 'Sales' },

        { id: 'view_inventory', label: 'Xem Tồn kho', group: 'Inventory' },
        { id: 'edit_inventory', label: 'Sửa/Xóa NVL & Sản phẩm', group: 'Inventory' },
        { id: 'manage_imports', label: 'Nhập hàng', group: 'Inventory' },
        { id: 'manage_assets', label: 'Quản lý Tài sản', group: 'Inventory' },

        { id: 'view_production', label: 'Xem Sản xuất', group: 'Production' },
        { id: 'create_production', label: 'Tạo Lệnh Sản xuất', group: 'Production' },

        { id: 'manage_expenses', label: 'Quản lý Chi phí', group: 'Finance' },

        { id: 'view_users', label: 'Xem Users', group: 'Admin' },
        { id: 'manage_users', label: 'Mời/Xóa User', group: 'Admin' },
        { id: 'manage_roles', label: 'Cấu hình Phân quyền', group: 'Admin' },
    ];

    // Grouping for UI
    const GROUPS = ['General', 'Sales', 'Inventory', 'Production', 'Finance', 'Admin'];

    onMount(async () => {
        await loadRoles();
    });

    async function loadRoles() {
        loading = true;
        // Fetch fresh from DB or use Store (Store might be cached defaults)
        // Better to fetch from DB to edit
        const snapshot = await getDocs(collection(db, 'roles'));
        if (!snapshot.empty) {
            roles = snapshot.docs.map(d => d.data() as RoleDef);
        } else {
            // If empty, init with store defaults (which has defaults)
            roles = $permissionStore.roles;
        }
        loading = false;
    }

    async function saveRoles() {
        if (!confirm("Lưu cấu hình phân quyền? Thay đổi sẽ áp dụng cho user sau khi họ refresh.")) return;
        processing = true;
        try {
            // Save each role
            for (const role of roles) {
                await setDoc(doc(db, 'roles', role.id), role);
            }
            alert("Đã lưu cấu hình thành công!");
            // Reload store to reflect changes immediately for Admin
            permissionStore.initRoles();
            // Also re-apply for current user
            if ($authStore.user?.role) permissionStore.setUserRole($authStore.user.role);

        } catch (e) {
            alert("Lỗi lưu: " + e);
        } finally {
            processing = false;
        }
    }

    function togglePermission(roleIndex: number, perm: Permission) {
        const role = roles[roleIndex];
        if (role.permissions.includes(perm)) {
            role.permissions = role.permissions.filter(p => p !== perm);
        } else {
            role.permissions = [...role.permissions, perm];
        }
        roles[roleIndex] = role;
    }

    // Helper to check if role has permission
    function has(role: RoleDef, perm: Permission) {
        return role.permissions.includes(perm);
    }
</script>

<div class="max-w-7xl mx-auto pb-20">
    <PageHeader
        title="Cấu hình Phân quyền (Roles)"
        showAction={true}
        actionLabel={processing ? 'Đang lưu...' : 'Lưu Thay Đổi'}
        onAction={saveRoles}
    />

    {#if loading}
        <div class="p-8 text-center">Đang tải cấu hình...</div>
    {:else}
        <div class="overflow-x-auto">
            <table class="table w-full border border-slate-200">
                <thead>
                    <tr class="bg-base-200">
                        <th class="w-1/4">Quyền hạn (Permissions)</th>
                        {#each roles as role}
                            <th class="text-center min-w-[100px]">{role.name}</th>
                        {/each}
                    </tr>
                </thead>
                <tbody>
                    {#each GROUPS as group}
                        <tr class="bg-slate-50 font-bold text-xs uppercase tracking-wide text-slate-500">
                            <td colspan={roles.length + 1} class="py-2">{group}</td>
                        </tr>
                        {#each ALL_PERMISSIONS.filter(p => p.group === group) as perm}
                            <tr class="hover">
                                <td class="pl-6 text-sm">{perm.label}</td>
                                {#each roles as role, idx}
                                    <td class="text-center">
                                        <input
                                            type="checkbox"
                                            class="checkbox checkbox-sm checkbox-primary"
                                            checked={has(role, perm.id)}
                                            on:change={() => togglePermission(idx, perm.id)}
                                            disabled={role.id === 'admin' && perm.group === 'Admin'}
                                        />
                                        <!-- Prevent disabling Admin access for Admin role -->
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    {/each}
                </tbody>
            </table>
        </div>

        <div class="alert alert-info shadow-sm mt-6 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span>Lưu ý: Vai trò 'Admin' nên luôn có toàn quyền quản trị để tránh bị khóa khỏi hệ thống.</span>
        </div>
    {/if}
</div>