import { writable, get, derived } from 'svelte/store';
import { db } from '$lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

// Define Permissions
export type Permission =
    | 'view_dashboard'
    | 'view_inventory'
    | 'edit_inventory'
    | 'view_sales'
    | 'create_order'
    | 'manage_orders'
    | 'view_production'
    | 'create_production'
    | 'view_reports'
    | 'view_users'
    | 'manage_users'
    | 'manage_roles'
    | 'view_finance'
    | 'manage_imports'
    | 'manage_partners'
    | 'manage_assets'
    | 'manage_expenses'
    | 'view_history';

export interface RoleDef {
    id: string;
    name: string;
    permissions: Permission[];
    description?: string;
}

const DEFAULT_ROLES: RoleDef[] = [
    {
        id: 'admin',
        name: 'Admin',
        permissions: [
            'view_dashboard', 'view_inventory', 'edit_inventory', 'view_sales', 'create_order', 'manage_orders',
            'view_production', 'create_production', 'view_reports', 'view_users', 'manage_users',
            'manage_roles', 'view_finance', 'manage_imports', 'manage_partners', 'manage_assets',
            'manage_expenses', 'view_history'
        ]
    },
    {
        id: 'manager',
        name: 'Manager',
        permissions: [
            'view_dashboard', 'view_inventory', 'edit_inventory', 'view_production', 'create_production',
            'view_reports', 'manage_imports', 'manage_assets', 'manage_expenses', 'manage_partners'
        ]
    },
    {
        id: 'sales',
        name: 'Sales',
        permissions: [
            'view_dashboard', 'view_sales', 'create_order', 'manage_partners', 'view_inventory'
        ]
    },
    {
        id: 'staff',
        name: 'Staff',
        permissions: ['view_dashboard', 'view_inventory']
    }
];

function createPermissionStore() {
    const { subscribe, set, update } = writable<{
        roles: RoleDef[];
        userPermissions: Set<Permission>;
        loading: boolean;
    }>({
        roles: [],
        userPermissions: new Set(),
        loading: true
    });

    return {
        subscribe,

        initRoles: async () => {
            try {
                const snapshot = await getDocs(collection(db, 'roles'));
                if (snapshot.empty) {
                    set({ roles: DEFAULT_ROLES, userPermissions: new Set(), loading: false });
                    return;
                }
                const roles = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RoleDef));
                set({ roles: roles, userPermissions: new Set(), loading: false });
            } catch (e) {
                console.error("Failed to load roles:", e);
                set({ roles: DEFAULT_ROLES, userPermissions: new Set(), loading: false });
            }
        },

        setUserRole: (roleId: string) => {
            update(store => {
                const roleDef = store.roles.find(r => r.id === roleId) || DEFAULT_ROLES.find(r => r.id === roleId);
                const perms = new Set<Permission>(roleDef?.permissions || []);
                return { ...store, userPermissions: perms };
            });
        },
    };
}

export const permissionStore = createPermissionStore();

// Export derived store for reactive use in templates
// Usage: $userPermissions.has('view_sales')
export const userPermissions = derived(permissionStore, $store => $store.userPermissions);

// Synchronous Helper for JS Logic (e.g. Handlers)
export const checkPermission = (perm: Permission) => {
    return get(permissionStore).userPermissions.has(perm);
};