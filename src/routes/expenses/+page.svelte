<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
	import { collection, addDoc, getDocs, query, orderBy, onSnapshot, serverTimestamp, Timestamp, limit, where } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
    import { logAction } from '$lib/logger';

	// --- Types ---
    interface Category {
        id: string;
        name: string;
    }
    interface Partner { // Dùng để fetch Nhà cung cấp
        id: string;
        name: string;
    }
    interface ExpenseLog {
        id: string;
        date: { toDate: () => Date };
        categoryName: string;
        amount: number;
        description: string;
        supplier: string; // Tên snapshot
        supplierId: string; // ID liên kết
        createdAt: { toDate: () => Date };
    }

	// --- State ---
    let categories: Category[] = [];
    let suppliers: Partner[] = []; // Danh sách NCC
    let expensesLog: ExpenseLog[] = [];
	let loading = true;
	let processing = false;
    let errorMsg = '';
    
    // Form Dữ liệu chi phí
    let expenseData = {
        date: new Date().toISOString().split('T')[0],
        categoryId: '',
        amount: 0,
        description: '',
        selectedSupplierId: '' // Dùng ID thay cho tên NCC
    };
    
    // Checkbox và Master Data Form
    let newCategoryName = '';
    let isAssetPurchase = false; // TRẠNG THÁI MỚI: Mua tài sản?
    
    // --- Realtime Subscription ---
    let unsubscribeLog: () => void;
    let unsubscribeCat: () => void;
    let unsubscribeSuppliers: () => void;

    onMount(async () => {
        // 1. Load Categories
        const catQuery = query(collection(db, 'expense_categories'), orderBy('name'));
        unsubscribeCat = onSnapshot(catQuery, (snapshot) => {
            categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        });
        
        // 2. Load Suppliers (Partners type='supplier')
        const supplierQuery = query(collection(db, 'partners'), where('type', '==', 'supplier'), orderBy('name'));
        unsubscribeSuppliers = onSnapshot(supplierQuery, (snapshot) => {
            suppliers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));
        });
        
        // 3. Load Expense Log
        const logQuery = query(collection(db, 'expenses_log'), orderBy('date', 'desc'), limit(50));
        unsubscribeLog = onSnapshot(logQuery, (snapshot) => {
            expensesLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseLog));
            loading = false;
        });
	});

	onDestroy(() => {
		if (unsubscribeCat) unsubscribeCat();
        if (unsubscribeLog) unsubscribeLog();
        if (unsubscribeSuppliers) unsubscribeSuppliers();
	});
    
    // --- Handlers ---
    
    async function handleAddCategory() {
        if ($authStore.user?.role !== 'admin') return alert("Chỉ Admin mới có quyền.");
        if (!newCategoryName.trim()) return;

        try {
            await addDoc(collection(db, 'expense_categories'), {
                name: newCategoryName.trim(),
                createdAt: serverTimestamp()
            });
            await logAction($authStore.user!, 'CREATE', 'expense_categories', `Thêm mới danh mục: ${newCategoryName}`);

            newCategoryName = '';
        } catch (e) {
            alert("Lỗi thêm danh mục.");
        }
    }

    async function handleAddExpense() {
        if ($authStore.user?.role !== 'admin') return alert("Chỉ Admin mới có quyền.");
        if (!expenseData.categoryId) return (errorMsg = "Vui lòng chọn danh mục chi phí.");
        if (!expenseData.selectedSupplierId) return (errorMsg = "Vui lòng chọn Nhà cung cấp/Người bán.");
        if (expenseData.amount <= 0) return (errorMsg = "Số tiền phải lớn hơn 0.");
        
        processing = true;
        errorMsg = '';
        const selectedDate = new Date(expenseData.date);

        try {
            const category = categories.find(c => c.id === expenseData.categoryId);
            const supplier = suppliers.find(s => s.id === expenseData.selectedSupplierId);
            
            // 1. GHI NHẬN CHI PHÍ
            const expenseRef = await addDoc(collection(db, 'expenses_log'), {
                date: Timestamp.fromDate(selectedDate),
                categoryId: expenseData.categoryId,
                categoryName: category?.name || 'N/A',
                amount: Number(expenseData.amount),
                description: expenseData.description || 'Không mô tả',
                supplierId: expenseData.selectedSupplierId,
                supplier: supplier?.name || 'N/A', 
                createdBy: $authStore.user?.email,
                createdAt: serverTimestamp()
            });
            
            // 2. LOGIC MUA TÀI SẢN (NẾU CHECKBOX BẬT)
            if (isAssetPurchase) {
                 await addDoc(collection(db, 'assets'), {
                    name: expenseData.description, 
                    category: category?.name || 'Tài sản chung', // Dùng danh mục chi phí làm danh mục tài sản
                    status: 'Đang dùng',
                    originalPrice: Number(expenseData.amount),
                    quantity: { total: 1, good: 1, broken: 0, lost: 0 }, 
                    purchaseDate: Timestamp.fromDate(selectedDate),
                    createdBy: $authStore.user?.email,
                    createdAt: serverTimestamp()
                });
                await logAction($authStore.user!, 'CREATE', 'assets', `Tự động tạo tài sản từ chi phí: ${expenseData.description}`);
            }


            // 3. LOG AUDIT CUỐI CÙNG
            await logAction($authStore.user!, 'TRANSACTION', 'expenses_log', 
                `Chi tiền: ${category?.name}, ${expenseData.amount.toLocaleString()} đ từ NCC ${supplier?.name || 'N/A'}`
            );

            alert("Ghi nhận chi phí thành công!");
            // Reset form
            expenseData.amount = 0;
            expenseData.description = '';
            isAssetPurchase = false; // Reset checkbox
            
        } catch (e) {
            errorMsg = "Lỗi ghi nhận chi phí. Kiểm tra console.";
        } finally {
            processing = false;
        }
    }

</script>

<div class="max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold text-primary mb-6">Quản lý Chi phí Khác (Overhead/CapEx)</h1>

    <div class="card bg-base-100 shadow-xl p-6 mb-8">
        <h2 class="card-title text-xl border-b pb-2 mb-4">Ghi nhận Chi phí Mua thêm</h2>
        
        {#if errorMsg}
            <div role="alert" class="alert alert-error text-sm mb-4"><span>{errorMsg}</span></div>
        {/if}

        <div class="grid grid-cols-4 gap-4">
            <div class="form-control">
                <label class="label"><span class="label-text">Ngày Chi</span></label>
                <input type="date" bind:value={expenseData.date} class="input input-bordered" />
            </div>
            
            <div class="form-control">
                <label class="label"><span class="label-text">Danh mục Chi phí</span></label>
                <select bind:value={expenseData.categoryId} class="select select-bordered" disabled={categories.length === 0}>
                    <option value="" disabled selected>-- Chọn Loại chi --</option>
                    {#each categories as cat}
                        <option value={cat.id}>{cat.name}</option>
                    {/each}
                </select>
                {#if categories.length === 0}
                    <label class="label"><span class="label-text-alt text-warning">Vui lòng thêm danh mục bên dưới.</span></label>
                {/if}
            </div>

            <div class="form-control">
                <label class="label"><span class="label-text">Số tiền Chi (đ)</span></label>
                <input type="number" bind:value={expenseData.amount} min="0" class="input input-bordered text-right" placeholder="0" />
            </div>
            
            <div class="form-control">
                <label class="label"><span class="label-text">Nhà cung cấp/Người bán</span></label>
                <select bind:value={expenseData.selectedSupplierId} class="select select-bordered" disabled={suppliers.length === 0}>
                    <option value="" disabled selected>-- Chọn NCC --</option>
                    {#each suppliers as supplier}
                        <option value={supplier.id}>{supplier.name}</option>
                    {/each}
                </select>
                {#if suppliers.length === 0}
                    <label class="label"><span class="label-text-alt text-warning">Vui lòng tạo NCC trong Partners.</span></label>
                {/if}
            </div>
        </div>
        
        <div class="form-control mt-4">
            <label class="label"><span class="label-text">Mô tả Chi tiết (VD: Mua 1 cái lò nướng 100 lít)</span></label>
            <input type="text" bind:value={expenseData.description} class="input input-bordered" placeholder="Mô tả" />
        </div>
        
        <div class="form-control mt-2">
            <label class="label cursor-pointer justify-start gap-4">
                <input type="checkbox" bind:checked={isAssetPurchase} class="checkbox checkbox-primary" />
                <span class="label-text text-info">Đây là mua Tài sản/Công cụ (Tự động thêm vào Kho Tài sản)</span>
            </label>
        </div>


        <div class="card-actions justify-end mt-4">
            <button class="btn btn-primary" on:click={handleAddExpense} disabled={processing || expenseData.amount <= 0 || !expenseData.categoryId || !expenseData.selectedSupplierId}>
                {#if processing}
                    <span class="loading loading-spinner"></span>
                {:else}
                    Ghi nhận Chi phí (Trừ tiền)
                {/if}
            </button>
        </div>
    </div>
    
    <div class="grid grid-cols-3 gap-6">
        <div class="col-span-1">
            <h3 class="font-bold mb-3">Danh mục Chi phí</h3>
            <ul class="menu bg-base-200 w-full rounded-box p-2 mb-4">
                {#each categories as cat}
                    <li><a class="p-2">{cat.name}</a></li>
                {/each}
            </ul>
            
            <div class="flex">
                <input type="text" bind:value={newCategoryName} class="input input-bordered input-sm flex-grow mr-2" placeholder="Tên danh mục mới..." />
                <button class="btn btn-sm btn-info" on:click={handleAddCategory}>Thêm</button>
            </div>
        </div>

        <div class="col-span-2">
            <h3 class="font-bold mb-3">Lịch sử Chi phí (50 Giao dịch gần nhất)</h3>
            <div class="overflow-x-auto">
                <table class="table table-compact table-zebra w-full">
                    <thead>
                        <tr>
                            <th class="w-1/6">Ngày</th>
                            <th class="w-1/6">Mục</th>
                            <th class="w-2/5">Mô tả chi tiết</th>
                            <th class="w-1/6">Nhà cung cấp</th>
                            <th class="text-right w-1/6">Số tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#if loading}
                            <tr><td colspan="5" class="text-center">Đang tải...</td></tr>
                        {:else}
                            {#each expensesLog as log}
                                <tr>
                                    <td>{log.date?.toDate().toLocaleDateString('vi-VN') || 'N/A'}</td>
                                    <td><span class="badge badge-warning">{log.categoryName}</span></td>
                                    <td>{log.description}</td> 
                                    <td>{log.supplier}</td>
                                    <td class="text-right font-mono text-error">-{log.amount.toLocaleString()} đ</td>
                                </tr>
                            {/each}
                        {/if}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>