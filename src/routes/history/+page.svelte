<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
    import { userPermissions } from '$lib/stores/permissionStore';
	import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';

	interface AuditLog {
		id: string;
		userEmail: string;
		action: 'CREATE' | 'UPDATE' | 'DELETE' | 'TRANSACTION';
		collection: string;
		details: string;
		timestamp: { toDate: () => Date };
	}

	let auditLogs: AuditLog[] = [];
	let loading = true;
	let unsubscribe: () => void;
    
	onMount(() => {
        // Access check handled by Firestore rule mostly, but UI check here
		const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
		
		unsubscribe = onSnapshot(q, (snapshot) => {
			auditLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
			loading = false;
		}, (error) => {
            console.error("Error fetching logs:", error);
            loading = false;
        });
	});

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
	});

    function getActionClass(action: string) {
        switch(action) {
            case 'CREATE': return 'badge-success';
            case 'DELETE': return 'badge-error';
            case 'UPDATE': return 'badge-warning';
            default: return 'badge-neutral';
        }
    }
</script>

<div class="max-w-7xl mx-auto pb-20">
    <h1 class="text-2xl font-bold mb-6">Sổ cái Hoạt động Hệ thống</h1>
    
    {#if !$userPermissions.has('view_history')}
        <div role="alert" class="alert alert-error">
            <span>Chỉ Admin mới có quyền xem lịch sử hoạt động này.</span>
        </div>
    {:else}
        {#if loading}
            <div class="text-center py-10">Đang tải 100 hoạt động gần nhất...</div>
        {:else if auditLogs.length === 0}
            <div class="text-center py-10 text-gray-500">Chưa có hoạt động nào được ghi nhận.</div>
        {:else}
            <ResponsiveTable>
                <svelte:fragment slot="mobile">
                    <div class="space-y-3">
                        {#each auditLogs as log}
                            <div class="bg-white p-3 rounded-lg shadow-sm border border-slate-100 text-sm">
                                <div class="flex justify-between items-start mb-2">
                                    <span class="text-xs text-gray-400">{log.timestamp?.toDate().toLocaleString('vi-VN') || 'N/A'}</span>
                                    <span class="badge badge-sm {getActionClass(log.action)} text-white">{log.action}</span>
                                </div>
                                <div class="mb-1">
                                    <span class="font-bold text-slate-700 mr-1">[{log.collection}]</span>
                                    {log.details}
                                </div>
                                <div class="text-xs text-gray-500 italic text-right">
                                    by {log.userEmail}
                                </div>
                            </div>
                        {/each}
                    </div>
                </svelte:fragment>

                <svelte:fragment slot="desktop">
                    <thead>
                        <tr>
                            <th class="w-1/6">Thời gian</th>
                            <th class="w-1/12">Action</th>
                            <th class="w-1/4">Chi tiết</th>
                            <th class="w-1/6">User</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each auditLogs as log}
                            <tr>
                                <td>{log.timestamp?.toDate().toLocaleString('vi-VN') || 'N/A'}</td>
                                <td>
                                    <span class="badge {getActionClass(log.action)} text-white">
                                        {log.action}
                                    </span>
                                </td>
                                <td>
                                    <span class="badge badge-outline badge-sm mr-2">{log.collection}</span>
                                    {log.details}
                                </td>
                                <td>{log.userEmail}</td>
                            </tr>
                        {/each}
                    </tbody>
                </svelte:fragment>
            </ResponsiveTable>
        {/if}
    {/if}
</div>