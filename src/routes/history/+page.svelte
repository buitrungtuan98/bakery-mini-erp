<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
	import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';

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
    
    // Chỉ Admin mới được truy cập trang này (Guard cơ bản)
    $: if ($authStore.user && $authStore.user.role !== 'admin') {
        alert("Bạn không có quyền truy cập trang này.");
        // GOTO / (Chuyển hướng về trang chủ nếu không phải Admin)
        // Cần import { goto } from '$app/navigation'; nếu muốn chuyển hướng
    }

	onMount(() => {
        // Chỉ tải log nếu là Admin
        if ($authStore.user?.role !== 'admin') {
            loading = false;
            return;
        }
        
        // Lấy 100 log gần nhất, sắp xếp theo thời gian mới nhất lên đầu
		const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
		
		unsubscribe = onSnapshot(q, (snapshot) => {
			auditLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
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

<div class="max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">Sổ cái Hoạt động Hệ thống (Audit Log)</h1>
    
    {#if $authStore.user?.role !== 'admin'}
        <div role="alert" class="alert alert-error">
            <span>Chỉ Admin mới có quyền xem lịch sử hoạt động này.</span>
        </div>
    {:else}
        <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
            <table class="table table-zebra w-full">
                <thead>
                    <tr>
                        <th class="w-1/6">Thời gian</th>
                        <th class="w-1/12">Action</th>
                        <th class="w-1/4">Chi tiết</th>
                        <th class="w-1/6">User</th>
                    </tr>
                </thead>
                <tbody>
                    {#if loading}
                        <tr><td colspan="4" class="text-center">Đang tải 100 hoạt động gần nhất...</td></tr>
                    {:else if auditLogs.length === 0}
                        <tr><td colspan="4" class="text-center text-gray-500">Chưa có hoạt động nào được ghi nhận.</td></tr>
                    {:else}
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
                    {/if}
                </tbody>
            </table>
        </div>
    {/if}
</div>