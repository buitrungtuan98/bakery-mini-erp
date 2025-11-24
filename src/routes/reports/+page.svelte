<script lang="ts">
    import { db } from '$lib/firebase';
    import { authStore } from '$lib/stores/authStore';
    import { collection, getDocs, query, orderBy } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import * as XLSX from 'xlsx/xlsx.mjs'; // Import SheetJS

    let loading = true;
    let transactions: any[] = []; 

    onMount(async () => {
        // Fetch dữ liệu từ 4 collection
        const [importSnap, prodSnap, orderSnap, expenseSnap] = await Promise.all([
            getDocs(query(collection(db, 'imports'), orderBy('createdAt'))),
            getDocs(query(collection(db, 'production_runs'), orderBy('createdAt'))),
            getDocs(query(collection(db, 'orders'), orderBy('createdAt'))),
            getDocs(query(collection(db, 'expenses_log'), orderBy('createdAt'))) // THÊM FETCH EXPENSES
        ]);
        
        // Lưu trữ dữ liệu thô và gán type
        transactions = [
            ...importSnap.docs.map(doc => ({ id: doc.id, type: 'IMPORT', data: doc.data() })),
            ...prodSnap.docs.map(doc => ({ id: doc.id, type: 'PRODUCTION', data: doc.data() })),
            ...orderSnap.docs.map(doc => ({ id: doc.id, type: 'SALE', data: doc.data() })),
            ...expenseSnap.docs.map(doc => ({ id: doc.id, type: 'EXPENSE', data: doc.data() })), // THÊM EXPENSE
        ];

        // Sắp xếp lại theo thời gian
        transactions.sort((a, b) => {
            const dateA = a.data.createdAt?.toDate() || new Date(0);
            const dateB = b.data.createdAt?.toDate() || new Date(0);
            return dateA.getTime() - dateB.getTime();
        });

        loading = false;
    });

    // --- Logic chính: Tạo Ledger phẳng (MỞ RỘNG PHIẾU THÀNH NHIỀU DÒNG) ---
    function createFlatLedger(txs: any[]) {
        const ledger: any[] = [];
        
        txs.forEach((tx) => {
            const date = tx.data.importDate?.toDate().toLocaleDateString('vi-VN') || tx.data.productionDate?.toDate().toLocaleDateString('vi-VN') || tx.data.date?.toDate().toLocaleDateString('vi-VN') || tx.data.createdAt?.toDate()?.toLocaleDateString('vi-VN') || 'N/A';
            const docId = tx.id.substring(0, 8).toUpperCase();
            
            if (tx.type === 'IMPORT') {
                // Nhập hàng: Tách mỗi item thành 1 dòng (Tăng kho NVL)
                tx.data.items.forEach((item: any) => {
                    ledger.push({
                        "Ngày": date,
                        "Số chứng từ": `NH-${docId}`,
                        "Loại": "Nhập NVL",
                        "Diễn giải": `Nhập ${item.quantity} ${item.ingredientName}`,
                        "Mục chi tiết": item.ingredientName,
                        "Thành tiền (Thu/Chi)": -item.totalPrice, // Chi tiền
                        "Doanh thu": 0,
                        "Giá vốn (COGS)": 0,
                        "Ghi chú": `NCC: ${tx.data.supplierName}`
                    });
                });

            } else if (tx.type === 'PRODUCTION') {
                // Sản xuất: Chỉ 1 dòng tổng quan (Ghi nhận chi phí)
                ledger.push({
                    "Ngày": date,
                    "Số chứng từ": `SX-${docId}`,
                    "Loại": "Sản xuất TP",
                    "Diễn giải": `SX ${tx.data.productName} - Yield: ${tx.data.actualYield?.toLocaleString() || 0}`,
                    "Mục chi tiết": tx.data.productName,
                    "Thành tiền (Thu/Chi)": 0,
                    "Doanh thu": 0,
                    "Giá vốn (COGS)": tx.data.totalActualCost,
                    "Ghi chú": `Giá vốn thực tế: ${Math.round(tx.data.actualCostPerUnit || 0).toLocaleString()} đ/sp`
                });
            } else if (tx.type === 'SALE') {
                 // Bán hàng: Tách mỗi item bán ra thành 1 dòng (Ghi nhận Doanh thu)
                 tx.data.items.forEach((item: any, index: number) => {
                     ledger.push({
                        "Ngày": date,
                        "Số chứng từ": `BH-${docId}`,
                        "Loại": "Bán hàng",
                        "Diễn giải": `Bán ${item.quantity} ${item.productName} cho ${tx.data.customerInfo.name}`,
                        "Mục chi tiết": item.productName,
                        "Thành tiền (Thu/Chi)": item.lineTotal,
                        "Doanh thu": item.lineTotal,
                        "Giá vốn (COGS)": -item.lineCOGS, // Ghi nhận giá vốn âm (trừ vào lợi nhuận)
                        "Ghi chú": index === 0 ? `Shipping: ${tx.data.shippingFee.toLocaleString()}` : ""
                    });
                });
            } else if (tx.type === 'EXPENSE') {
                // Chi phí Khác (Mua thớt, bàn, v.v.)
                ledger.push({
                    "Ngày": date,
                    "Số chứng từ": `CP-${docId}`,
                    "Loại": "Chi phí khác",
                    "Diễn giải": `Chi ${tx.data.categoryName}: ${tx.data.description}`,
                    "Mục chi tiết": tx.data.categoryName,
                    "Thành tiền (Thu/Chi)": -tx.data.amount, // Chi tiền
                    "Doanh thu": 0,
                    "Giá vốn (COGS)": 0,
                    "Ghi chú": `NCC: ${tx.data.supplier}`
                });
            }
        });

        return ledger;
    }

    // --- Logic Export ---
    function exportToExcel() {
        if (!createFlatLedger(transactions).length) return alert("Không có dữ liệu để xuất!");
        
        const ledgerData = createFlatLedger(transactions);
        
        const worksheet = XLSX.utils.json_to_sheet(ledgerData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Bảng kê Chi tiết");

        const dateString = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
        XLSX.writeFile(workbook, `BaoCao_ChiTiet_${dateString}.xlsx`);
    }

</script>

<div class="max-w-7xl mx-auto">
    <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">Bảng kê Chi tiết Giao dịch</h1>
        <button class="btn btn-success text-white" on:click={exportToExcel} disabled={loading || transactions.length === 0}>
            {#if loading}
                <span class="loading loading-spinner"></span> Đang tải...
            {:else}
                Xuất Excel Báo cáo ({createFlatLedger(transactions).length} Dòng chi tiết)
            {/if}
        </button>
    </div>

    <div class="card bg-base-100 shadow-xl overflow-x-auto">
        <div class="card-body p-4">
            {#if loading}
                <p class="text-center">Đang tải lịch sử giao dịch...</p>
            {:else if transactions.length === 0}
                <p class="text-center text-gray-500">Chưa có giao dịch nào được ghi nhận.</p>
            {:else}
                <table class="table table-xs md:table-sm w-full">
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
                        {#each createFlatLedger(transactions) as entry}
                            <tr class="text-xs">
                                <td>{entry["Ngày"]}</td>
                                <td>{entry["Số chứng từ"]}</td>
                                <td>{entry["Diễn giải"]}</td>
                                <td>{entry["Loại"]}</td>
                                <td class="text-right font-mono {entry["Thành tiền (Thu/Chi)"] > 0 ? 'text-success' : 'text-error'}">
                                    {entry["Thành tiền (Thu/Chi)"]?.toLocaleString() || '0'}
                                </td>
                                <td class="text-right font-mono text-primary">
                                    {entry["Doanh thu"]?.toLocaleString() || '0'}
                                </td>
                                <td class="text-right font-mono text-warning">
                                    {entry["Giá vốn (COGS)"]?.toLocaleString() || '0'}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            {/if}
        </div>
    </div>
</div>