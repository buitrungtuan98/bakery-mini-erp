<script lang="ts">
    import { db } from '$lib/firebase';
    import { authStore } from '$lib/stores/authStore';
    import { collection, getDocs, query, orderBy, where, Timestamp } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import * as XLSX from 'xlsx/xlsx.mjs';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Search, FileDown } from 'lucide-svelte';

    let loading = true;
    let transactions: any[] = []; 

    // --- Date Filter State ---
    let startDate: string;
    let endDate: string;

    function setDefaultDates() {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        startDate = formatDate(firstDay);
        endDate = formatDate(lastDay);
    }

    function formatDate(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    onMount(async () => {
        setDefaultDates();
        await fetchReportData();
    });

    async function fetchReportData() {
        loading = true;
        transactions = [];

        try {
            const start = new Date(startDate);
            const startTs = Timestamp.fromDate(start);

            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            const endTs = Timestamp.fromDate(end);

            const [importSnap, prodSnap, orderSnap, expenseSnap] = await Promise.all([
                getDocs(query(collection(db, 'imports'), where('createdAt', '>=', startTs), where('createdAt', '<=', endTs), orderBy('createdAt', 'desc'))),
                getDocs(query(collection(db, 'production_runs'), where('createdAt', '>=', startTs), where('createdAt', '<=', endTs), orderBy('createdAt', 'desc'))),
                getDocs(query(collection(db, 'orders'), where('createdAt', '>=', startTs), where('createdAt', '<=', endTs), orderBy('createdAt', 'desc'))),
                getDocs(query(collection(db, 'expenses_log'), where('createdAt', '>=', startTs), where('createdAt', '<=', endTs), orderBy('createdAt', 'desc')))
            ]);

            transactions = [
                ...importSnap.docs.map(doc => ({ id: doc.id, type: 'IMPORT', data: doc.data() })),
                ...prodSnap.docs.map(doc => ({ id: doc.id, type: 'PRODUCTION', data: doc.data() })),
                ...orderSnap.docs.map(doc => ({ id: doc.id, type: 'SALE', data: doc.data() })),
                ...expenseSnap.docs.map(doc => ({ id: doc.id, type: 'EXPENSE', data: doc.data() })),
            ];

            transactions.sort((a, b) => {
                const dateA = a.data.createdAt?.toDate() || new Date(0);
                const dateB = b.data.createdAt?.toDate() || new Date(0);
                return dateB.getTime() - dateA.getTime();
            });
            showSuccessToast("Tải báo cáo thành công!");
        } catch (error) {
            console.error("Lỗi tải báo cáo:", error);
            showErrorToast("Lỗi tải dữ liệu báo cáo (có thể do thiếu Index).");
        } finally {
            loading = false;
        }
    }

    function createFlatLedger(txs: any[]) {
        const ledger: any[] = [];
        
        txs.forEach((tx) => {
            const date = tx.data.importDate?.toDate().toLocaleDateString('vi-VN') || tx.data.productionDate?.toDate().toLocaleDateString('vi-VN') || tx.data.date?.toDate().toLocaleDateString('vi-VN') || tx.data.createdAt?.toDate()?.toLocaleDateString('vi-VN') || 'N/A';
            const docId = tx.id.substring(0, 8).toUpperCase();
            
            if (tx.type === 'IMPORT') {
                tx.data.items.forEach((item: any) => {
                    ledger.push({
                        date, docId: `NH-${docId}`, type: "Nhập NVL",
                        desc: `Nhập ${item.quantity} ${item.ingredientName}`,
                        detail: item.ingredientName,
                        amount: -item.totalPrice,
                        revenue: 0, cogs: 0, note: `NCC: ${tx.data.supplierName}`
                    });
                });

            } else if (tx.type === 'PRODUCTION') {
                ledger.push({
                    date, docId: `SX-${docId}`, type: "Sản xuất TP",
                    desc: `SX ${tx.data.productName} - Yield: ${tx.data.actualYield?.toLocaleString() || 0}`,
                    detail: tx.data.productName,
                    amount: 0, revenue: 0, cogs: tx.data.totalActualCost,
                    note: `Giá vốn: ${Math.round(tx.data.actualCostPerUnit || 0).toLocaleString()}`
                });
            } else if (tx.type === 'SALE') {
                 tx.data.items.forEach((item: any, index: number) => {
                     ledger.push({
                        date, docId: `BH-${docId}`, type: "Bán hàng",
                        desc: `Bán ${item.quantity} ${item.productName}`,
                        detail: item.productName,
                        amount: item.lineTotal, revenue: item.lineTotal, cogs: -item.lineCOGS,
                        note: index === 0 ? `Khách: ${tx.data.customerInfo.name}` : ""
                    });
                });
            } else if (tx.type === 'EXPENSE') {
                ledger.push({
                    date, docId: `CP-${docId}`, type: "Chi phí khác",
                    desc: `Chi: ${tx.data.description}`,
                    detail: tx.data.categoryName,
                    amount: -tx.data.amount, revenue: 0, cogs: 0, note: `NCC: ${tx.data.supplier}`
                });
            }
        });

        return ledger;
    }

    function exportToExcel() {
        const ledgerData = createFlatLedger(transactions);
        if (!ledgerData.length) return showErrorToast("Không có dữ liệu!");
        
        const worksheet = XLSX.utils.json_to_sheet(ledgerData.map(i => ({
            "Ngày": i.date, "Số CT": i.docId, "Loại": i.type,
            "Diễn giải": i.desc, "Thu/Chi": i.amount, "Ghi chú": i.note
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
        XLSX.writeFile(workbook, `Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    }

    $: flatLedger = createFlatLedger(transactions);
</script>

<div class="max-w-7xl mx-auto pb-24">
    <h1 class="text-2xl font-bold mb-4">Báo cáo Giao dịch</h1>

    <div class="card bg-base-100 shadow-sm p-4 mb-6 border border-slate-200">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div class="form-control">
                <label class="label py-0"><span class="label-text text-xs">Từ ngày</span></label>
                <input type="date" bind:value={startDate} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
                <label class="label py-0"><span class="label-text text-xs">Đến ngày</span></label>
                <input type="date" bind:value={endDate} class="input input-bordered w-full" />
            </div>
            <button class="btn btn-primary w-full" on:click={fetchReportData} disabled={loading}>
                <Search class="h-4 w-4 mr-2" />
                {#if loading} <span class="loading loading-spinner loading-xs"></span> {/if}
                Xem Báo cáo
            </button>
        </div>
        <div class="mt-4 flex justify-end">
             <button class="btn btn-sm btn-success text-white" on:click={exportToExcel} disabled={loading || transactions.length === 0}>
                <FileDown class="h-4 w-4 mr-2" />
                Xuất Excel
            </button>
        </div>
    </div>

    {#if loading}
        <div class="text-center py-10">Đang tải...</div>
    {:else if transactions.length === 0}
        <div class="text-center py-10 text-gray-500">Không có dữ liệu.</div>
    {:else}
        <ResponsiveTable>
            <svelte:fragment slot="mobile">
                <div class="space-y-3">
                    {#each flatLedger as entry}
                        <div class="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
                            <div class="flex justify-between items-start mb-1">
                                <span class="text-xs text-gray-400">{entry.date}</span>
                                <span class="badge badge-xs
                                    {entry.type === 'Bán hàng' ? 'badge-primary' : ''}
                                    {entry.type === 'Nhập NVL' ? 'badge-error' : ''}
                                    {entry.type === 'Sản xuất TP' ? 'badge-warning' : ''}
                                ">
                                    {entry.type}
                                </span>
                            </div>
                            <div class="font-medium text-sm mb-1">{entry.desc}</div>
                            <div class="flex justify-between items-center">
                                <span class="text-xs text-gray-500 truncate max-w-[150px]">{entry.note}</span>
                                {#if entry.amount !== 0}
                                    <span class="font-mono font-bold {entry.amount > 0 ? 'text-success' : 'text-error'}">
                                        {entry.amount > 0 ? '+' : ''}{entry.amount.toLocaleString()}
                                    </span>
                                {:else}
                                    <span class="text-xs text-gray-400">--</span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            </svelte:fragment>

            <svelte:fragment slot="desktop">
                <thead>
                    <tr>
                        <th>Ngày</th>
                        <th>Chứng từ</th>
                        <th>Diễn giải</th>
                        <th>Loại</th>
                        <th class="text-right">Thu/Chi</th>
                        <th class="text-right">Doanh thu</th>
                        <th class="text-right">Giá vốn</th>
                    </tr>
                </thead>
                <tbody>
                    {#each flatLedger as entry}
                        <tr class="text-xs hover">
                            <td>{entry.date}</td>
                            <td>{entry.docId}</td>
                            <td>{entry.desc}</td>
                            <td><span class="badge badge-xs badge-ghost">{entry.type}</span></td>
                            <td class="text-right font-mono {entry.amount > 0 ? 'text-success' : 'text-error'}">
                                {entry.amount?.toLocaleString() || '0'}
                            </td>
                            <td class="text-right font-mono text-primary">
                                {entry.revenue?.toLocaleString() || '0'}
                            </td>
                            <td class="text-right font-mono text-warning">
                                {entry.cogs?.toLocaleString() || '0'}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </svelte:fragment>
        </ResponsiveTable>
    {/if}
</div>