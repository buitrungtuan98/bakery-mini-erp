<script lang="ts">
    import { onMount } from 'svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import { syncService } from '$lib/services/syncService';
    import { googleSheetService } from '$lib/services/googleSheetService';
    import { toast } from 'svelte-sonner';

    let isConnected = false;
    let spreadsheetId = '';
    let logs: any[] = [];
    let isSyncing = false;

    // Load ID from localStorage for convenience
    onMount(() => {
        const storedId = localStorage.getItem('sync_spreadsheet_id');
        if (storedId) {
            spreadsheetId = storedId;
            syncService.setSpreadsheetId(storedId);
        }
        isConnected = googleSheetService.isConnected();
    });

    async function handleConnect() {
        try {
            const success = await googleSheetService.connect();
            if (success) {
                isConnected = true;
                toast.success('Đã kết nối Google Sheets');
            }
        } catch (e: any) {
            toast.error('Lỗi kết nối: ' + e.message);
        }
    }

    function saveId() {
        if (spreadsheetId) {
            localStorage.setItem('sync_spreadsheet_id', spreadsheetId);
            syncService.setSpreadsheetId(spreadsheetId);
            toast.success('Đã lưu Spreadsheet ID');
        }
    }

    async function handleSync(type: 'products' | 'ingredients' | 'partners' | 'sales' | 'categories' | 'assets' | 'finance' | 'imports' | 'production') {
        if (!isConnected) {
            toast.error('Vui lòng kết nối Google Sheets trước');
            return;
        }
        if (!spreadsheetId) {
             toast.error('Vui lòng nhập Spreadsheet ID');
             return;
        }

        isSyncing = true;
        syncService.clearLogs();
        logs = [];

        try {
            if (type === 'sales') {
                await syncService.syncSales();
            } else if (type === 'finance') {
                await syncService.syncFinance();
            } else if (type === 'imports') {
                await syncService.syncImports();
            } else if (type === 'production') {
                await syncService.syncProduction();
            } else {
                await syncService.syncMasterData(type as any);
            }
            toast.success('Đồng bộ hoàn tất');
        } catch (e: any) {
            toast.error('Lỗi: ' + e.message);
        } finally {
            logs = syncService.getLogs();
            isSyncing = false;
        }
    }

    async function createSheet() {
        if (!isConnected) return;
        try {
            const id = await googleSheetService.createSpreadsheet('Bakery Data Sync');
            spreadsheetId = id;
            saveId();
            toast.success('Đã tạo file Sheet mới');
        } catch (e: any) {
             toast.error('Lỗi tạo file: ' + e.message);
        }
    }
</script>

<div class="space-y-6 pb-20">
    <PageHeader title="Đồng bộ Google Sheets" />

    <!-- Connection Section -->
    <div class="card bg-base-100 shadow-sm border border-base-200">
        <div class="card-body">
            <h2 class="card-title text-lg">1. Kết nối</h2>
            <div class="flex flex-col gap-4">
                {#if !isConnected}
                    <div class="alert alert-warning">
                        <span>Bạn cần cấp quyền truy cập Google Sheets.</span>
                    </div>
                    <button class="btn btn-primary" on:click={handleConnect}>
                        Kết nối tài khoản Google
                    </button>
                {:else}
                     <div class="alert alert-success">
                        <span>Đã kết nối với Google.</span>
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Config Section -->
    <div class="card bg-base-100 shadow-sm border border-base-200">
        <div class="card-body">
            <h2 class="card-title text-lg">2. Cấu hình File</h2>
            <div class="form-control w-full">
                <label class="label">
                    <span class="label-text">Google Spreadsheet ID</span>
                </label>
                <div class="flex gap-2">
                    <input type="text" bind:value={spreadsheetId} placeholder="Nhập ID file sheet..." class="input input-bordered w-full" />
                    <button class="btn btn-secondary" on:click={saveId} disabled={!spreadsheetId}>Lưu</button>
                </div>
                <label class="label">
                    <span class="label-text-alt text-gray-500">ID là chuỗi ký tự dài trong URL của file Sheet.</span>
                </label>
            </div>
            <div class="divider">Hoặc</div>
            <button class="btn btn-outline" on:click={createSheet} disabled={!isConnected}>
                Tạo File Sheet Mới
            </button>
        </div>
    </div>

    <!-- Sync Actions -->
    <div class="card bg-base-100 shadow-sm border border-base-200">
        <div class="card-body">
            <h2 class="card-title text-lg">3. Thực hiện Đồng bộ</h2>
            <p class="text-sm text-gray-500 mb-4">
                Hệ thống sẽ so sánh dữ liệu 2 bên và bổ sung các bản ghi còn thiếu.
            </p>

            <div class="grid grid-cols-2 gap-4">
                <button class="btn btn-neutral" disabled={isSyncing || !isConnected} on:click={() => handleSync('products')}>
                    Sync Sản Phẩm
                </button>
                <button class="btn btn-neutral" disabled={isSyncing || !isConnected} on:click={() => handleSync('ingredients')}>
                    Sync Nguyên Liệu
                </button>
                <button class="btn btn-neutral" disabled={isSyncing || !isConnected} on:click={() => handleSync('partners')}>
                    Sync Đối Tác
                </button>
                <button class="btn btn-neutral" disabled={isSyncing || !isConnected} on:click={() => handleSync('categories')}>
                    Sync Danh mục CP
                </button>
                <button class="btn btn-neutral" disabled={isSyncing || !isConnected} on:click={() => handleSync('assets')}>
                    Sync Tài sản
                </button>
                <button class="btn btn-error text-white" disabled={isSyncing || !isConnected} on:click={() => handleSync('sales')}>
                    Sync Đơn Hàng
                </button>
                <button class="btn btn-error text-white" disabled={isSyncing || !isConnected} on:click={() => handleSync('finance')}>
                    Sync Chi Phí
                </button>
                <button class="btn btn-warning text-white" disabled={isSyncing || !isConnected} on:click={() => handleSync('imports')}>
                    Sync Nhập Kho
                </button>
                <button class="btn btn-warning text-white" disabled={isSyncing || !isConnected} on:click={() => handleSync('production')}>
                    Sync Sản Xuất
                </button>
            </div>
        </div>
    </div>

    <!-- Logs -->
    {#if logs.length > 0}
        <div class="card bg-base-100 shadow-sm border border-base-200">
            <div class="card-body">
                <h2 class="card-title text-lg">Logs</h2>
                <div class="max-h-60 overflow-y-auto bg-gray-900 text-green-400 p-4 rounded text-xs font-mono">
                    {#each logs as log}
                        <div class:text-red-400={log.status === 'error'} class:text-yellow-400={log.status === 'info'}>
                            [{log.timestamp.toLocaleTimeString()}] [{log.type.toUpperCase()}] {log.message}
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>
