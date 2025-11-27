<script lang="ts">
	import { db } from '$lib/firebase';
	import { authStore } from '$lib/stores/authStore';
    import { permissionStore } from '$lib/stores/permissionStore';
	import { collection, getDocs, query, orderBy } from 'firebase/firestore';
	import { onMount } from 'svelte';

    // --- Types ---
    interface Ingredient { name: string; currentStock: number; minStock: number; }
    interface Order { totalRevenue: number; totalProfit: number; createdAt: { toDate: () => Date }; }
    interface Expense { amount: number; date: { toDate: () => Date }; }

	// --- State ---
    let lowStockIngredients: Ingredient[] = [];
    let totalRevenue = 0; 
    let totalProfit = 0;
    let totalExpenses = 0;
    let netProfit = 0;     
    
    let loading = true;
    let isDataFetched = false;
    
    // TRẠNG THÁI MỚI: Bộ lọc thời gian
    let selectedPeriod: 'month' | 'quarter' | 'year' | 'all' | 'custom' = 'month'; // THÊM 'custom'
    let customStartDate: string = new Date(new Date().setDate(1)).toISOString().split('T')[0]; // Mặc định đầu tháng
    let customEndDate: string = new Date().toISOString().split('T')[0]; // Mặc định hôm nay
    
    // Trạng thái hiển thị ngữ cảnh
    let contextPeriodStart = '';
    let contextPeriodEnd = '';


    // --- Helpers cho Bộ lọc Thời gian (Xử lý Start/End Date) ---
    function getStartEndDate(period: typeof selectedPeriod, startStr?: string, endStr?: string): { startDate: Date, endDate: Date } {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        let startDate: Date;
        let endDate: Date;

        switch (period) {
            case 'month':
                startDate = new Date(year, month, 1);
                endDate = new Date(new Date().setHours(23, 59, 59));
                break;
            case 'quarter':
                const startMonth = Math.floor(month / 3) * 3;
                startDate = new Date(year, startMonth, 1);
                endDate = new Date(new Date().setHours(23, 59, 59));
                break;
            case 'year':
                startDate = new Date(year, 0, 1);
                endDate = new Date(new Date().setHours(23, 59, 59));
                break;
            case 'custom':
                // Chuyển đổi chuỗi thành Date, set giờ kết thúc là cuối ngày
                startDate = startStr ? new Date(startStr) : new Date(0);
                endDate = endStr ? new Date(new Date(endStr).setHours(23, 59, 59)) : new Date(new Date().setHours(23, 59, 59));
                break;
            case 'all':
            default:
                startDate = new Date(0); // Epoch
                endDate = new Date(new Date().setHours(23, 59, 59));
        }

        return { startDate, endDate };
    }

    // --- LOGIC FETCH VÀ TÍNH TOÁN ---
    async function fetchDashboardData() {
        if (!isDataFetched) { 
            isDataFetched = true;
        } else {
            loading = true;
        }

        try {
            // Lấy Master Data (Không đổi)
            const ingSnap = await getDocs(query(collection(db, 'ingredients')));
            const ingredientsData = ingSnap.docs.map(doc => doc.data() as Ingredient);
            lowStockIngredients = ingredientsData.filter(ing => ing.currentStock < ing.minStock);

            // Lấy Transactions (Orders & Expenses)
            const [orderSnap, expenseSnap] = await Promise.all([
                getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
                getDocs(query(collection(db, 'expenses_log'), orderBy('date', 'desc')))
            ]);

            const ordersData = orderSnap.docs.map(doc => doc.data() as Order);
            const expensesData = expenseSnap.docs.map(doc => doc.data() as Expense);

            
            // === 3. TÍNH TOÁN DỮ LIỆU THEO THỜI GIAN ===
            
            const { startDate, endDate } = getStartEndDate(selectedPeriod, customStartDate, customEndDate);
            
            let revenuePeriod = 0;
            let profitPeriod = 0;
            let expensesPeriod = 0;
            
            // Khởi tạo tổng tiền
            totalRevenue = 0;
            totalProfit = 0;
            totalExpenses = 0;
            
            // Lọc và tính Orders
            ordersData.forEach(order => {
                const orderDate = order.createdAt.toDate();
                if (orderDate >= startDate && orderDate <= endDate) {
                    revenuePeriod += order.totalRevenue;
                    profitPeriod += order.totalProfit;
                }
            });

            // Lọc và tính Expenses
            expensesData.forEach(expense => {
                const expenseDate = expense.date.toDate();
                if (expenseDate >= startDate && expenseDate <= endDate) {
                    expensesPeriod += expense.amount;
                }
            });

            // Gán kết quả
            totalRevenue = revenuePeriod;
            totalProfit = profitPeriod;
            totalExpenses = expensesPeriod;
            netProfit = totalProfit - totalExpenses; 

            // Cập nhật Context hiển thị
            contextPeriodStart = startDate.toLocaleDateString('vi-VN');
            contextPeriodEnd = endDate.toLocaleDateString('vi-VN');


        } catch (error: any) {
            console.error("Lỗi tải Dashboard Data:", error);
        } finally {
            loading = false;
        }
    }

    // Kích hoạt Fetch khi Auth có giá trị HOẶC khi Period thay đổi
    $: if ($authStore.user && !isDataFetched) {
        fetchDashboardData();
    }
    // Kích hoạt Fetch khi bộ lọc thay đổi
    $: if (selectedPeriod || customStartDate || customEndDate) {
        fetchDashboardData();
    }
</script>

<div class="max-w-7xl mx-auto p-4">
    <div class="hero min-h-32 bg-base-200 rounded-box shadow-lg mb-8">
        <div class="hero-content text-center py-6">
            <div class="max-w-md">
                <h1 class="text-3xl font-bold text-primary">Tổng quan Dòng tiền & Tồn kho</h1>
                {#if $permissionStore.userPermissions.has('view_finance')}
                    <p class="text-sm text-gray-600">Dữ liệu từ: **{contextPeriodStart}** đến **{contextPeriodEnd}**</p>
                {:else}
                    <p class="text-sm text-gray-600">Xin chào, {$authStore.user?.email}</p>
                {/if}
            </div>
        </div>
    </div>
    
    {#if $permissionStore.userPermissions.has('view_finance')}
        <div class="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <h2 class="text-xl font-bold">Thống kê Tài chính</h2>
            <div class="flex flex-col md:flex-row gap-4 items-center">
                <div class="join">
                    <button class="join-item btn btn-sm {selectedPeriod === 'month' ? 'btn-neutral' : ''}" on:click={() => selectedPeriod = 'month'}>Tháng</button>
                    <button class="join-item btn btn-sm {selectedPeriod === 'quarter' ? 'btn-neutral' : ''}" on:click={() => selectedPeriod = 'quarter'}>Quý</button>
                    <button class="join-item btn btn-sm {selectedPeriod === 'year' ? 'btn-neutral' : ''}" on:click={() => selectedPeriod = 'year'}>Năm</button>
                    <button class="join-item btn btn-sm {selectedPeriod === 'all' ? 'btn-neutral' : ''}" on:click={() => selectedPeriod = 'all'}>Tổng</button>
                    <button class="join-item btn btn-sm {selectedPeriod === 'custom' ? 'btn-neutral' : ''}" on:click={() => selectedPeriod = 'custom'}>Tùy chỉnh</button>
                </div>

                {#if selectedPeriod === 'custom'}
                    <div class="flex gap-2">
                        <input type="date" bind:value={customStartDate} class="input input-bordered input-sm" />
                        <input type="date" bind:value={customEndDate} class="input input-bordered input-sm" />
                    </div>
                {/if}
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">

            <div class="stats shadow bg-base-100">
                <div class="stat">
                    <div class="stat-figure text-primary">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <div class="stat-title">Doanh thu Thuần</div>
                    <div class="stat-value text-primary">
                        {loading ? '...' : totalRevenue.toLocaleString() + ' đ'}
                    </div>
                    <div class="stat-desc">Tổng tiền hàng đã bán</div>
                </div>
            </div>

            <div class="stats shadow bg-base-100">
                <div class="stat">
                    <div class="stat-figure text-error">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v2a2 2 0 01-2 2h-5m-5 0H5a2 2 0 01-2-2v-2a2 2 0 012-2h5m-5 0v-2a2 2 0 012-2h10a2 2 0 012 2v2"></path></svg>
                    </div>
                    <div class="stat-title">Chi phí Khác (Overhead)</div>
                    <div class="stat-value text-error">
                        {loading ? '...' : totalExpenses.toLocaleString() + ' đ'}
                    </div>
                    <div class="stat-desc">Chi phí mua thêm/vận hành</div>
                </div>
            </div>

            <div class="stats shadow bg-base-100">
                <div class="stat">
                    <div class="stat-figure text-accent">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h-2m-2 0H8m6 0a2 2 0 100-4 2 2 0 000 4zM7 13h10M7 17h10M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z"></path></svg>
                    </div>
                    <div class="stat-title">Lợi nhuận Thuần (Net)</div>
                    <div class="stat-value text-accent">
                        {loading ? '...' : netProfit.toLocaleString() + ' đ'}
                    </div>
                    <div class="stat-desc">{netProfit > 0 ? 'Dòng tiền dương' : 'Cần kiểm soát'}</div>
                </div>
            </div>

            <div class="stats shadow bg-base-100">
                <div class="stat">
                    <div class="stat-figure text-warning">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M18.83 17.83A9 9 0 0012 21a9 9 0 006.83-3.17L12 12V9"></path></svg>
                    </div>
                    <div class="stat-title">Cảnh báo Tồn kho</div>
                    <div class="stat-value text-error">
                        {loading ? '...' : lowStockIngredients.length.toLocaleString()}
                    </div>
                    <div class="stat-desc text-error">Nguyên liệu dưới mức Min-stock</div>
                </div>
            </div>
        </div>
    {:else}
         <!-- Giao diện cho Non-Admin -->
         <div class="stats shadow bg-base-100 w-full mb-8">
            <div class="stat">
                <div class="stat-figure text-warning">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-8 h-8 stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M18.83 17.83A9 9 0 0012 21a9 9 0 006.83-3.17L12 12V9"></path></svg>
                </div>
                <div class="stat-title">Cảnh báo Tồn kho</div>
                <div class="stat-value text-error">
                    {loading ? '...' : lowStockIngredients.length.toLocaleString()}
                </div>
                <div class="stat-desc text-error">Nguyên liệu sắp hết</div>
            </div>
             <div class="stat">
                 <div class="stat-title">Vai trò của bạn</div>
                 <div class="stat-value text-secondary text-2xl uppercase">
                     {$authStore.user?.role || 'Staff'}
                 </div>
                 <div class="stat-desc">Liên hệ Admin để cấp thêm quyền</div>
             </div>
        </div>
    {/if}

    {#if lowStockIngredients.length > 0}
        <div role="alert" class="alert alert-warning mb-8 shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.663 1.742-3.04l-6.928-12.871c-.759-1.409-2.809-1.409-3.568 0L5.12 17.96c-.76 1.376.192 3.04 1.741 3.04z" /></svg>
            <span>**CẢNH BÁO:** {lowStockIngredients.length} nguyên liệu sắp hết! Cần nhập: {lowStockIngredients.map(i => i.name).join(', ')}</span>
        </div>
    {/if}

    <h2 class="text-xl font-bold mb-4">Biểu đồ Doanh thu/Chi phí (Visualization)</h2>
    <div class="h-64 bg-base-100 rounded-box shadow-xl flex flex-col items-center justify-center text-gray-500 p-4">
        

[Image of simple monthly revenue chart placeholder]

        <p>Để tối ưu chi phí và hiệu năng, tính năng biểu đồ phức tạp được thay thế bằng các chỉ số thống kê chính xác phía trên.</p>
    </div>
</div>