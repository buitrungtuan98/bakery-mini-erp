<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, doc, setDoc, getDocs, query, orderBy } from 'firebase/firestore';
    import { permissionStore, userPermissions, type RoleDef, type Permission } from '$lib/stores/permissionStore';
    import { onMount } from 'svelte';
    import { authStore } from '$lib/stores/authStore';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Save } from 'lucide-svelte';

    let roles: RoleDef[] = [];
    let loading = true;
    let processing = false;

    // Mobile Tab State
    let activeRoleTab = 'manager'; // Default tab for mobile

    // List of all available system permissions
    const ALL_PERMISSIONS: { id: Permission, label: string, group: string }[] = [
        { id: 'view_dashboard', label: 'Xem Dashboard', group: 'General' },
        { id: 'view_reports', label: 'Xem Báo cáo', group: 'General' },
        { id: 'view_finance', label: 'Xem Doanh thu/Lợi nhuận', group: 'General' },
        { id: 'view_history', label: 'Xem Lịch sử Hệ thống', group: 'General' },

        { id: 'view_sales', label: 'Truy cập Bán hàng', group: 'Sales' },
        { id: 'create_order', label: 'Tạo Đơn hàng', group: 'Sales' },
        { id: 'manage_orders', label: 'Quản lý Đơn hàng (Hủy)', group: 'Sales' },
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

    const GROUPS = ['General', 'Sales', 'Inventory', 'Production', 'Finance', 'Admin'];

    onMount(async () => {
        await loadRoles();
    });

    async function loadRoles() {
        loading = true;
        const snapshot = await getDocs(collection(db, 'roles'));
        if (!snapshot.empty) {
            roles = snapshot.docs.map(d => d.data() as RoleDef);
        } else {
            roles = $permissionStore.roles;
        }
        loading = false;
    }

    async function saveRoles() {
        if (!confirm("Lưu cấu hình phân quyền?")) return;
        processing = true;
        try {
            for (const role of roles) {
                await setDoc(doc(db, 'roles', role.id), role);
            }
            showSuccessToast("Đã lưu cấu hình thành công!");
            permissionStore.initRoles();
            if ($authStore.user?.role) permissionStore.setUserRole($authStore.user.role);
        } catch (e) {
            showErrorToast("Lỗi lưu: " + e.message);
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

    function has(role: RoleDef, perm: Permission) {
        return role.permissions.includes(perm);
    }
</script>

<div class="max-w-7xl mx-auto pb-20">
    <PageHeader
        title="Cấu hình Phân quyền (Roles)"
        showAction={true}
        actionLabel={processing ? 'Đang lưu...' : 'Lưu'}
        onAction={saveRoles}
    >
        <Save class="h-4 w-4" />
    </PageHeader>

    {#if loading}
        <div class="p-8 text-center">Đang tải cấu hình...</div>
    {:else}

        <!-- DESKTOP VIEW (Matrix Table) -->
        <div class="hidden md:block overflow-x-auto">
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
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    {/each}
                </tbody>
            </table>
        </div>

        <!-- MOBILE VIEW (Tabs & Toggles) -->
        <div class="md:hidden">
            <div class="tabs tabs-boxed bg-base-200 mb-4 overflow-x-auto flex-nowrap">
                {#each roles as role}
                    <a
                        href="#{role.id}"
                        role="button"
                        class="tab flex-shrink-0 {activeRoleTab === role.id ? 'tab-active' : ''}"
                        on:click={() => activeRoleTab = role.id}
                    >
                        {role.name}
                    </a>
                {/each}
            </div>

            {#each roles as role, roleIdx}
                {#if activeRoleTab === role.id}
                    <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                        <h3 class="font-bold text-lg mb-4 text-primary">Quyền hạn cho {role.name}</h3>

                        {#each GROUPS as group}
                            <div class="collapse collapse-arrow bg-base-50 mb-2 border border-slate-100">
                                <input type="checkbox" />
                                <div class="collapse-title text-sm font-bold uppercase text-slate-500">
                                    {group}
                                </div>
                                <div class="collapse-content">
                                    {#each ALL_PERMISSIONS.filter(p => p.group === group) as perm}
                                        <div class="form-control">
                                            <label class="label cursor-pointer">
                                                <span class="label-text">{perm.label}</span>
                                                <input
                                                    type="checkbox"
                                                    class="checkbox checkbox-primary"
                                                    checked={has(role, perm.id)}
                                                    on:change={() => togglePermission(roleIdx, perm.id)}
                                                    disabled={role.id === 'admin' && perm.group === 'Admin'}
                                                />
                                            </label>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            {/each}
        </div>

        <div class="alert alert-info shadow-sm mt-6 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span>Lưu ý: Vai trò 'Admin' nên luôn có toàn quyền quản trị.</span>
        </div>
    {/if}
</div>
