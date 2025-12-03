<script lang="ts">
    import { RefreshCw } from 'lucide-svelte';
    import { syncService } from '$lib/services/syncService';
    import { googleSheetService } from '$lib/services/googleSheetService';
    import { toast } from 'svelte-sonner';
    import { onMount } from 'svelte';

    export let type: 'products' | 'ingredients' | 'partners' | 'sales';
    export let label: string = 'Sync';

    let isSyncing = false;
    let isConnected = false;

    // Check connection status periodically or on mount
    onMount(() => {
        const storedId = localStorage.getItem('sync_spreadsheet_id');
        if (storedId) {
            syncService.setSpreadsheetId(storedId);
        }
        // Ideally we subscribe to a store, but for now simple check
        isConnected = googleSheetService.isConnected();
    });

    async function handleSync() {
        // Quick check
        if (!googleSheetService.isConnected()) {
             // Try auto-connect if we can, or prompt
             try {
                const success = await googleSheetService.connect();
                if (!success) return;
             } catch(e) {
                 toast.error('Kết nối Google thất bại');
                 return;
             }
        }

        // Check ID
        if (!localStorage.getItem('sync_spreadsheet_id')) {
            toast.error('Chưa cấu hình Google Sheet ID. Vui lòng vào Admin > Sync.');
            return;
        }

        isSyncing = true;
        try {
            if (type === 'sales') {
                await syncService.syncSales();
            } else {
                await syncService.syncMasterData(type);
            }
            toast.success(`Đồng bộ ${label} hoàn tất`);
        } catch (e: any) {
            toast.error('Lỗi: ' + e.message);
        } finally {
            isSyncing = false;
        }
    }
</script>

<button
    class="btn btn-sm btn-ghost gap-2 text-slate-500 hover:text-primary"
    on:click={handleSync}
    disabled={isSyncing}
    title="Đồng bộ với Google Sheet"
>
    <RefreshCw size={16} class={isSyncing ? 'animate-spin' : ''} />
    <span class="hidden md:inline">{label}</span>
</button>
