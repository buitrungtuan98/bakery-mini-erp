<script lang="ts">
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { productStore, partnerStore } from '$lib/stores/masterDataStore';
    import type { MasterProduct, MasterPartner, SalesOrder, SalesOrderItem } from '$lib/types/erp';
	import { onMount, onDestroy } from 'svelte';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Plus, User, Clock, CheckCircle, Truck, Package, Trash2, Printer, Calendar, Tag, ChevronRight, History, ShoppingCart } from 'lucide-svelte';
    import Bill from '$lib/components/ui/Bill.svelte';
    import { tick } from 'svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { orderService } from '$lib/services/orderService';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import { fade } from 'svelte/transition';
    import SwipeableTabs from '$lib/components/ui/SwipeableTabs.svelte';
    import FloatingActionButton from '$lib/components/ui/FloatingActionButton.svelte';
    import SyncButton from '$lib/components/ui/SyncButton.svelte';

	// --- State ---
	let products: MasterProduct[] = [];
    let customers: MasterPartner[] = [];
    let ordersHistory: SalesOrder[] = [];
	let loading = true;
	let processing = false;
	let errorMsg = '';
    
    // UI State
    let activeTab: string = 'create';
    const tabs = [
        { id: 'create', label: 'Bán hàng', icon: ShoppingCart },
        { id: 'plan', label: 'Kế hoạch', icon: Clock },
        { id: 'history', label: 'Lịch sử', icon: History }
    ];

    // UI State for Mobile
    let isProductModalOpen = false;
    let isCustomerModalOpen = false;
    let isEditItemModalOpen = false;
    let selectedItemIndex = -1;
    // Note: SalesOrderItem includes total and costPrice, initialized safely
    let editingItem: SalesOrderItem = { productId: '', productName: '', quantity: 0, unitPrice: 0, total: 0, costPrice: 0, originalPrice: 0 };
    let productSearchTerm = '';
    let customerSearchTerm = '';

    // History Pagination
    let historyLimit = 10;
    let unsubscribeOrders: () => void;

    // Daily Plan State
    let planDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // Default Tomorrow
    let dailyPlanItems: { productId: string; name: string; ordered: number; stock: number; missing: number }[] = [];
    let planStatusFilter: string = 'all_active';
    let loadingPlan = false;
    let unsubscribePlan: () => void;

	// Dữ liệu Phiếu bán hàng
	let selectedCustomerId = '';
	let customer: MasterPartner | undefined;
	let orderItems: SalesOrderItem[] = []; // Default empty
	let shippingFee = 0;
	let shippingAddress = '';
    let shippingPhone = '';
    let selectedStatus: 'open' | 'cooking' | 'delivering' | 'delivered' = 'open';

    // Delivery Date Logic
    let deliveryDateInput = new Date().toISOString().slice(0, 16); // Default to now for input

    // --- Data Binding ---
    $: products = $productStore;
    $: customers = $partnerStore.filter(p => p.type === 'customer' || !p.type);
	
	// Reactive Helper: Tìm khách hàng hiện tại
	$: customer = customers.find(c => c.id === selectedCustomerId);

    // Filter Products
    $: filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()));

    // Filter Customers
    $: filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(customerSearchTerm.toLowerCase()));
	
	// Hàm tính giá đơn vị và tổng tiền của item
	function updatePricing(item: SalesOrderItem, products: MasterProduct[], currentCustomer: MasterPartner | undefined, isManualUpdate: boolean): SalesOrderItem {
		const product = products.find(p => p.id === item.productId);
		if (!product) return item;

		const customPriceEntry = currentCustomer?.customPrices?.find(cp => cp.productId === item.productId);
		let basePrice = customPriceEntry?.price || product.sellingPrice; 
		
		let finalUnitPrice;
		if (isManualUpdate || item.unitPrice === 0 || item.unitPrice === item.originalPrice) {
			finalUnitPrice = isManualUpdate ? item.unitPrice : basePrice; 
		} else {
			finalUnitPrice = item.unitPrice; 
		}

		const quantity = item.quantity || 0;
		const lineTotal = finalUnitPrice * quantity;
		const lineCOGS = (product.costPrice || 0) * quantity;

		return { 
            ...item, 
            unitPrice: finalUnitPrice, 
            total: lineTotal,
            costPrice: lineCOGS,
            originalPrice: basePrice
        };
	}
	
	$: totalRevenue = orderItems.reduce((sum, item) => sum + (item.total || 0), 0) + (shippingFee || 0);

	function handleCustomerChangeAndRecalculate(newCustomerId: string) {
        selectedCustomerId = newCustomerId;
		customer = customers.find(c => c.id === selectedCustomerId);

        if (customer) {
            shippingAddress = customer.address || '';
            shippingPhone = customer.phone || '';
        } else {
            shippingAddress = '';
            shippingPhone = '';
        }

		if (customer && products.length > 0) {
			orderItems = orderItems.map(item => updatePricing(item, products, customer, false));
		}
        isCustomerModalOpen = false;
	}

    function fetchHistory(limitCount: number) {
        if (unsubscribeOrders) unsubscribeOrders();
        unsubscribeOrders = orderService.subscribeHistory(limitCount, (orders) => {
             ordersHistory = orders;
             loading = false;
        });
    }

	$: if ($authStore.user) {
		fetchHistory(historyLimit);
	}
    
    // Watch Plan Date or Active Tab to fetch plan
    $: if (activeTab === 'plan' && planDate && planStatusFilter && $authStore.user) {
        fetchDailyPlan(planDate, planStatusFilter);
    }

    function fetchDailyPlan(dateStr: string, statusFilter: string) {
        if (unsubscribePlan) unsubscribePlan();
        loadingPlan = true;
        unsubscribePlan = orderService.subscribeDailyPlan(dateStr, statusFilter, products, (items) => {
            dailyPlanItems = items;
            loadingPlan = false;
        });
    }

    onDestroy(() => {
        if (unsubscribeOrders) unsubscribeOrders();
        if (unsubscribePlan) unsubscribePlan();
    });

	// --- Mobile UI Handlers ---
    
    function openProductSelector() {
        if (!selectedCustomerId) return showErrorToast("Vui lòng chọn Khách hàng trước!");
        productSearchTerm = '';
        isProductModalOpen = true;
    }

    function addProductToCart(product: MasterProduct) {
        const existingIndex = orderItems.findIndex(i => i.productId === product.id);

        if (existingIndex >= 0) {
            const item = orderItems[existingIndex];
            item.quantity += 1;
            orderItems[existingIndex] = updatePricing(item, products, customer, false);
        } else {
            const newItem: SalesOrderItem = {
                productId: product.id,
                productName: product.name,
                quantity: 1,
                unitPrice: product.sellingPrice,
                total: 0,
                costPrice: 0,
                originalPrice: product.sellingPrice
            };
            orderItems = [...orderItems, updatePricing(newItem, products, customer, false)];
        }
        isProductModalOpen = false;
    }

    function openEditItem(index: number) {
        selectedItemIndex = index;
        editingItem = { ...orderItems[index] };
        isEditItemModalOpen = true;
    }

    function saveEditItem() {
        if (selectedItemIndex >= 0) {
            const originalItem = orderItems[selectedItemIndex];
            const isPriceChanged = editingItem.unitPrice !== originalItem.unitPrice;

            orderItems[selectedItemIndex] = updatePricing(editingItem, products, customer, isPriceChanged);
            isEditItemModalOpen = false;
        }
    }

	function removeItem(index: number) {
		orderItems = orderItems.filter((_, i) => i !== index);
        isEditItemModalOpen = false;
	}

	// --- CANCEL/REVERSE LOGIC ---
    async function handleCancelOrder(order: SalesOrder) {
        const canCancel = checkPermission('manage_orders') || checkPermission('create_order');
        if (!canCancel) return showErrorToast("Bạn không có quyền hủy đơn.");

        if (!confirm(`Xác nhận hủy đơn hàng ${order.code || order.id.substring(0, 8)}?`)) return;
        
        processing = true;
        try {
            await orderService.cancelOrder($authStore.user as any, order);
            showSuccessToast("Hủy đơn hàng thành công!");
        } catch (e: any) {
            console.error("Lỗi đảo ngược:", e);
            showErrorToast("LỖI: " + e.message);
        } finally {
            processing = false;
        }
    }

    async function updateStatus(order: SalesOrder, newStatus: string) {
        if (!confirm(`Cập nhật trạng thái đơn hàng ${order.code} thành '${newStatus}'?`)) return;

        try {
            await orderService.updateStatus($authStore.user as any, order, newStatus);
            showSuccessToast("Cập nhật trạng thái thành công!");
        } catch (e: any) {
            console.error(e);
            showErrorToast("Lỗi: " + e.message);
        }
    }

	// --- Submit Logic (BÁN HÀNG) ---
	async function handleSale() {
		errorMsg = '';
		if (!selectedCustomerId) return (errorMsg = 'Vui lòng chọn khách hàng.');
		const validItems = orderItems.filter(i => i.productId && i.quantity > 0);
		if (validItems.length === 0) return (errorMsg = 'Phiếu bán hàng trống.');

		processing = true;

		try {
            const code = await orderService.createOrder(
                $authStore.user as any,
                customer,
                orderItems,
                selectedStatus,
                deliveryDateInput,
                products,
                shippingFee,
                shippingAddress,
                shippingPhone
            );

			showSuccessToast(`Tạo đơn hàng ${code} thành công!`);
			selectedCustomerId = '';
			orderItems = [];
			shippingFee = 0;
			shippingAddress = '';
            shippingPhone = '';
            customer = undefined;
            selectedStatus = 'open'; // Reset default
            deliveryDateInput = new Date().toISOString().slice(0, 16);

		} catch (error: any) {
			console.error(error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			showErrorToast('Lỗi: ' + errorMessage);
		} finally {
			processing = false;
		}
	}

    // --- PDF Printing Logic ---
    let orderToPrint: SalesOrder | null = null;
    let isPrinting = false;

    async function handlePrint(order: SalesOrder) {
        if (isPrinting) return;
        orderToPrint = order;
        isPrinting = true;

        await tick();

        const billElement = document.getElementById('bill-to-print');
        if (!billElement) {
            showErrorToast('Lỗi: Không tìm thấy element hóa đơn để in.');
            isPrinting = false;
            orderToPrint = null;
            return;
        }

        try {
            const [jsPDFModule, html2canvasModule] = await Promise.all([
                import('jspdf'),
                import('html2canvas-pro')
            ]);
            const jsPDF = jsPDFModule.default;
            const html2canvas = html2canvasModule.default;

            const canvas = await html2canvas(billElement, {
                scale: 2,
                useCORS: true
            });

            const imgData = canvas.toDataURL('image/png');
            const pdfWidth = 80;
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [pdfWidth, pdfHeight]
            });

            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`hoadon-${order.code || order.id.slice(0,6)}.pdf`);

        } catch (error: any) {
            console.error("Lỗi khi tạo PDF:", error);
            showErrorToast("Đã có lỗi xảy ra khi tạo file PDF.");
        } finally {
            orderToPrint = null;
            isPrinting = false;
        }
    }
</script>

<div class="h-full flex flex-col pb-safe max-w-7xl mx-auto">
    <PageHeader>
        <div slot="title" class="flex items-center gap-2">
            <span class="text-2xl font-bold tracking-tight text-slate-800">Bán hàng</span>
        </div>
        <div slot="actions">
             {#if activeTab === 'history' && $permissionStore.userPermissions.has('view_sales')}
                 <SyncButton type="sales" label="Sync Đơn" />
            {/if}
        </div>
    </PageHeader>

    <SwipeableTabs
        tabs={tabs}
        bind:activeTab={activeTab}
        on:change={(e) => activeTab = e.detail}
    >
        <div class="p-2 h-full">
            {#if activeTab === 'create'}
                {#if errorMsg}
                    <div role="alert" class="alert alert-error mb-4 text-sm text-white shadow-lg">
                        <span>{errorMsg}</span>
                    </div>
                {/if}

                <!-- 1. Customer Selection (Card) -->
                <button
                    class="w-full text-left card bg-white shadow-sm border border-slate-100 p-4 mb-4 active-press"
                    on:click={() => isCustomerModalOpen = true}
                >
                    <div class="flex justify-between items-center">
                        <div class="flex items-center gap-3">
                            <div class="bg-primary/10 p-3 rounded-full text-primary">
                                <User size={20} />
                            </div>
                            <div>
                                {#if customer}
                                    <h2 class="font-bold text-lg text-slate-800">{customer.name}</h2>
                                    <p class="text-sm text-slate-500">{customer.phone || 'Chưa có SĐT'}</p>
                                {:else}
                                    <h2 class="font-bold text-lg text-slate-400">Chọn Khách hàng...</h2>
                                    <p class="text-xs text-slate-400">Chạm để chọn</p>
                                {/if}
                            </div>
                        </div>
                        {#if customer}
                            <div class="text-xs text-slate-400 max-w-[100px] text-right truncate">{shippingAddress}</div>
                        {/if}
                    </div>
                </button>

                <!-- 2. Delivery Info & Status (Updated UI) -->
                <div class="grid grid-cols-2 gap-3 mb-4">
                    <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-3 flex flex-col gap-1">
                        <label class="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase">
                            <Calendar size={14} /> Ngày giao
                        </label>
                        <input
                            type="datetime-local"
                            bind:value={deliveryDateInput}
                            class="input input-sm input-ghost w-full px-0 font-bold text-slate-800 focus:bg-transparent"
                        />
                    </div>

                    <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-3 flex flex-col gap-1">
                        <label class="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase">
                            <Tag size={14} /> Trạng thái
                        </label>
                        <select
                            bind:value={selectedStatus}
                            class="select select-sm select-ghost w-full px-0 font-bold text-primary focus:bg-transparent"
                        >
                            <option value="open">Mới (Open)</option>
                            <option value="cooking">Đang làm</option>
                            <option value="delivering">Đang giao</option>
                            <option value="delivered">Đã giao</option>
                        </select>
                    </div>
                </div>

                <!-- 3. Cart Items List (Simplified) -->
                <div class="flex flex-col bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden min-h-[200px] mb-24">
                    {#each orderItems as item, i}
                        {@const prodStock = products.find(p => p.id === item.productId)?.currentStock || 0}
                        {@const isMissing = item.quantity > prodStock}
                        <button
                            class="w-full text-left p-4 border-b border-slate-50 flex justify-between items-center active:bg-slate-50 transition-colors"
                            on:click={() => openEditItem(i)}
                        >
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                                    {item.quantity}
                                </div>
                                <div>
                                    <div class="font-bold text-slate-800 text-sm">{item.productName}</div>
                                    <div class="text-xs text-slate-400">
                                        {item.unitPrice.toLocaleString()} đ/cái
                                    </div>
                                    {#if isMissing}
                                        <div class="text-[10px] text-red-500 font-bold mt-1 bg-red-50 px-2 py-0.5 rounded-full inline-block">
                                            ⚠️ Thiếu: {item.quantity - prodStock}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="font-bold text-slate-800 text-base">{item.total.toLocaleString()} đ</div>
                                {#if item.unitPrice !== item.originalPrice}
                                    <div class="text-[9px] text-orange-500 font-bold bg-orange-50 px-1 rounded">CUSTOM</div>
                                {/if}
                            </div>
                        </button>
                    {/each}

                    {#if orderItems.length === 0}
                        <div class="flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
                            <Package size={48} strokeWidth={1} />
                            <span class="text-sm">Giỏ hàng trống</span>
                        </div>
                    {/if}
                </div>

                <!-- 4. Sticky Footer Checkout -->
                <div class="fixed bottom-[var(--btm-nav-height)] left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-100 p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-30">
                    <div class="max-w-7xl mx-auto flex justify-between items-center gap-4">
                        <div class="flex flex-col">
                            <span class="text-xs text-slate-400 font-bold uppercase tracking-wider">Tổng cộng</span>
                            <span class="text-2xl font-bold text-slate-800">{totalRevenue.toLocaleString()} <span class="text-sm font-normal text-slate-500">đ</span></span>
                        </div>
                        <button
                            class="btn btn-primary flex-1 max-w-[200px] shadow-lg shadow-primary/30 rounded-xl text-lg h-12"
                            disabled={processing || orderItems.length === 0}
                            on:click={handleSale}
                        >
                            {processing ? 'Đang xử lý...' : 'THANH TOÁN'}
                        </button>
                    </div>
                </div>
            {/if} <!-- End Create Tab -->

            {#if activeTab === 'plan'}
                <div class="">
                    <div class="flex flex-col gap-2 mb-4 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                        <h3 class="font-bold text-slate-700 flex items-center gap-2"><Clock size={16}/> Kế hoạch sản xuất</h3>
                        <div class="flex gap-2 mt-2">
                            <input type="date" bind:value={planDate} class="input input-sm input-bordered flex-1 bg-slate-50" />
                            <select bind:value={planStatusFilter} class="select select-sm select-bordered flex-1 bg-slate-50">
                                <option value="all_active">Tất cả</option>
                                <option value="open">Mới</option>
                                <option value="cooking">Đang làm</option>
                                <option value="delivering">Đang giao</option>
                                <option value="delivered">Đã giao</option>
                            </select>
                        </div>
                    </div>

                    {#if loadingPlan}
                        <Loading />
                    {:else if dailyPlanItems.length === 0}
                        <EmptyState message="Không có đơn hàng nào cho ngày này." />
                    {:else}
                        <div class="overflow-hidden bg-white rounded-xl shadow-sm border border-slate-100">
                            <table class="table table-sm w-full">
                                <thead class="bg-slate-50 text-slate-500">
                                    <tr>
                                        <th>Sản phẩm</th>
                                        <th class="text-center">Đã đặt</th>
                                        <th class="text-center">Tồn kho</th>
                                        <th class="text-center">Cần làm</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each dailyPlanItems as item}
                                        <tr class="border-b border-slate-50 last:border-0">
                                            <td class="font-medium text-sm text-slate-700 py-3">{item.name}</td>
                                            <td class="text-center font-bold text-primary">{item.ordered}</td>
                                            <td class="text-center {item.stock < 0 ? 'text-red-500 font-bold' : 'text-slate-500'}">
                                                {item.stock}
                                            </td>
                                            <td class="text-center">
                                                {#if item.stock < 0}
                                                    <span class="badge badge-error badge-sm text-white font-bold">{Math.abs(item.stock)}</span>
                                                {:else}
                                                    <span class="text-slate-200">-</span>
                                                {/if}
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    {/if}
                </div>
            {/if}

            {#if activeTab === 'history'}
                <!-- History Section (Bottom with Pagination) -->
                <div class="pb-24">
                    <div class="flex justify-between items-center mb-3 px-1">
                        <h3 class="font-bold text-slate-700">Gần đây</h3>
                        <select bind:value={historyLimit} on:change={() => fetchHistory(historyLimit)} class="select select-xs select-ghost text-slate-400">
                            <option value={10}>10 dòng</option>
                            <option value={20}>20 dòng</option>
                            <option value={30}>30 dòng</option>
                        </select>
                    </div>

                    {#if loading}
                        <Loading />
                    {:else if ordersHistory.length === 0}
                        <EmptyState message="Chưa có đơn hàng nào." />
                    {:else}
                        <ResponsiveTable>
                            <svelte:fragment slot="mobile">
                                <div class="space-y-3">
                                    {#each ordersHistory as order}
                                        <div class="flex flex-col p-4 bg-white rounded-xl border border-slate-100 shadow-sm transition-all active:scale-[0.99] {order.status === 'canceled' ? 'opacity-60 grayscale bg-slate-50' : ''}">
                                            <div class="flex justify-between items-start mb-3">
                                                <div class="flex items-center gap-3">
                                                    <div class="bg-slate-100 p-2 rounded-lg text-slate-500">
                                                        {#if order.status === 'delivered'}<CheckCircle size={16}/>
                                                        {:else if order.status === 'delivering'}<Truck size={16}/>
                                                        {:else if order.status === 'cooking'}<Clock size={16}/>
                                                        {:else}<Package size={16}/>{/if}
                                                    </div>
                                                    <div>
                                                        <div class="font-bold text-sm text-slate-800">{order.customerName}</div>
                                                        <div class="text-xs text-slate-400 font-mono mt-0.5">{order.code || order.id.slice(0,8)}</div>
                                                    </div>
                                                </div>
                                                <div class="text-right">
                                                    <div class="font-bold text-base text-primary">{order.totalAmount.toLocaleString()}</div>
                                                    <span class="badge badge-xs mt-1 font-medium border-0 py-2
                                                        {order.status === 'open' ? 'bg-blue-50 text-blue-600' :
                                                        order.status === 'cooking' ? 'bg-orange-50 text-orange-600' :
                                                        order.status === 'delivering' ? 'bg-indigo-50 text-indigo-600' :
                                                        order.status === 'delivered' || order.status === 'completed' ? 'bg-green-50 text-green-600' : 'bg-slate-200 text-slate-500'}">
                                                        {order.status === 'open' ? 'Mới' :
                                                        order.status === 'cooking' ? 'Đang làm' :
                                                        order.status === 'delivering' ? 'Đang giao' :
                                                        order.status === 'delivered' || order.status === 'completed' ? 'Đã giao' : 'Đã hủy'}
                                                    </span>
                                                </div>
                                            </div>

                                            <div class="flex justify-between items-center border-t border-slate-50 pt-3 mt-1">
                                                <span class="text-[10px] text-slate-400">
                                                    {order.deliveryDate ? (typeof (order.deliveryDate as any).toDate === 'function' ? (order.deliveryDate as any).toDate() : new Date(order.deliveryDate as any)).toLocaleString('vi-VN', { hour: '2-digit', minute:'2-digit', day: 'numeric', month: 'numeric' }) : 'N/A'}
                                                </span>

                                                <div class="flex gap-2">
                                                    <!-- Status Update Actions (Quick) -->
                                                    {#if order.status !== 'canceled' && order.status !== 'delivered' && order.status !== 'completed'}
                                                        {#if order.status === 'open'}
                                                            <button class="btn btn-xs btn-circle btn-ghost text-orange-500 bg-orange-50" on:click={() => updateStatus(order, 'cooking')}><Clock size={14}/></button>
                                                        {:else if order.status === 'cooking'}
                                                            <button class="btn btn-xs btn-circle btn-ghost text-indigo-500 bg-indigo-50" on:click={() => updateStatus(order, 'delivering')}><Truck size={14}/></button>
                                                        {:else if order.status === 'delivering'}
                                                            <button class="btn btn-xs btn-circle btn-ghost text-green-500 bg-green-50" on:click={() => updateStatus(order, 'delivered')}><CheckCircle size={14}/></button>
                                                        {/if}
                                                    {/if}

                                                    <button class="btn btn-xs btn-ghost gap-1" on:click|stopPropagation={() => handlePrint(order)}>
                                                        <Printer size={14} />
                                                    </button>

                                                    {#if order.status !== 'canceled'}
                                                    <button class="btn btn-xs btn-ghost text-red-400 hover:bg-red-50" on:click|stopPropagation={() => handleCancelOrder(order)}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                    {/if}
                                                </div>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </svelte:fragment>

                            <svelte:fragment slot="desktop">
                                <thead>
                                    <tr>
                                        <th>Mã ĐH</th>
                                        <th>Khách hàng</th>
                                        <th>Ngày giao</th>
                                        <th>Trạng thái</th>
                                        <th class="text-right">Tổng tiền</th>
                                        <th class="text-center">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each ordersHistory as order}
                                        <tr class="hover group {order.status === 'canceled' ? 'opacity-50 grayscale' : ''}">
                                            <td class="font-mono text-sm">{order.code || order.id.slice(0,8)}</td>
                                            <td class="font-bold">{order.customerName}</td>
                                            <td class="text-sm">{order.deliveryDate ? (typeof (order.deliveryDate as any).toDate === 'function' ? (order.deliveryDate as any).toDate() : new Date(order.deliveryDate as any)).toLocaleString('vi-VN', { hour: '2-digit', minute:'2-digit', day: 'numeric', month: 'numeric' }) : 'N/A'}</td>
                                            <td>
                                                <span class="badge badge-sm border-0 py-2
                                                    {order.status === 'open' ? 'bg-blue-50 text-blue-600' :
                                                    order.status === 'cooking' ? 'bg-orange-50 text-orange-600' :
                                                    order.status === 'delivering' ? 'bg-indigo-50 text-indigo-600' :
                                                    order.status === 'delivered' || order.status === 'completed' ? 'bg-green-50 text-green-600' : 'bg-slate-200 text-slate-500'}">
                                                    {order.status === 'open' ? 'Mới' :
                                                    order.status === 'cooking' ? 'Đang làm' :
                                                    order.status === 'delivering' ? 'Đang giao' :
                                                    order.status === 'delivered' || order.status === 'completed' ? 'Đã giao' : 'Đã hủy'}
                                                </span>
                                            </td>
                                            <td class="text-right font-bold text-primary">{order.totalAmount.toLocaleString()}</td>
                                            <td class="text-center">
                                                <div class="flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button class="btn btn-xs btn-ghost" on:click={() => handlePrint(order)}><Printer size={14} /></button>
                                                    {#if order.status !== 'canceled'}
                                                        <button class="btn btn-xs btn-ghost text-error" on:click={() => handleCancelOrder(order)}><Trash2 size={14} /></button>
                                                    {/if}
                                                </div>
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </svelte:fragment>
                        </ResponsiveTable>
                    {/if}
                </div>
            {/if} <!-- End History Tab -->
        </div>
    </SwipeableTabs>

    <!-- Floating Action Button for Add Item -->
    <FloatingActionButton
        visible={activeTab === 'create'}
        onClick={openProductSelector}
        label="Thêm món"
        bottomOffset="140px"
    />

</div>

<!-- MODAL: Select Customer -->
<Modal title="Chọn Khách hàng" isOpen={isCustomerModalOpen} onClose={() => isCustomerModalOpen = false} showConfirm={false}>
    {#if isCustomerModalOpen}
        <div class="sticky top-0 bg-base-100 z-10 pb-2">
            <input
                type="text"
                bind:value={customerSearchTerm}
                placeholder="Tìm khách hàng..."
                class="input input-bordered w-full bg-slate-50"
                autofocus
            />
        </div>
        <div class="space-y-1 pb-10">
            {#each filteredCustomers as cust}
                <button
                    class="w-full text-left p-4 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors flex justify-between items-center group border border-transparent hover:border-slate-100"
                    on:click={() => handleCustomerChangeAndRecalculate(cust.id)}
                >
                    <div class="flex items-center gap-3">
                        <div class="bg-primary/5 text-primary p-2 rounded-full"><User size={20}/></div>
                        <div>
                            <div class="font-bold text-sm text-slate-800">{cust.name}</div>
                            <div class="text-xs text-slate-400">{cust.phone || ''}</div>
                        </div>
                    </div>
                    {#if cust.customerType}
                        <span class="badge badge-sm badge-ghost text-slate-400">{cust.customerType}</span>
                    {/if}
                </button>
            {/each}
            {#if filteredCustomers.length === 0}
                <div class="text-center text-slate-400 py-8">Không tìm thấy khách hàng.</div>
            {/if}
        </div>
    {/if}
</Modal>

<!-- MODAL: Select Product -->
<Modal title="Thêm Sản phẩm" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    {#if isProductModalOpen}
         <div class="sticky top-0 bg-base-100 z-10 pb-2">
            <input
                type="text"
                bind:value={productSearchTerm}
                placeholder="Tìm món..."
                class="input input-bordered w-full bg-slate-50"
                autofocus
            />
        </div>
        <div class="space-y-1 pb-20">
            {#each filteredProducts as prod}
                <button
                    class="w-full text-left p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors flex justify-between items-center border-b border-slate-50 last:border-0"
                    on:click={() => addProductToCart(prod)}
                >
                    <div class="flex items-center gap-3">
                         <!-- Placeholder Image or Icon -->
                         <div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                             <Package size={20} />
                         </div>
                        <div>
                            <div class="font-bold text-slate-800 text-sm">{prod.name}</div>
                            <div class="text-xs {prod.currentStock > 0 ? 'text-green-600' : 'text-red-500'} font-medium">
                                {prod.currentStock > 0 ? `Tồn: ${prod.currentStock}` : 'Hết hàng'}
                            </div>
                        </div>
                    </div>
                    <div class="font-bold text-primary">{prod.sellingPrice.toLocaleString()}</div>
                </button>
            {/each}
            {#if filteredProducts.length === 0}
                <div class="text-center text-slate-400 py-8">Không tìm thấy sản phẩm.</div>
            {/if}
        </div>
    {/if}
</Modal>

<!-- MODAL: Edit Item -->
<Modal
    title="Chỉnh sửa món"
    isOpen={isEditItemModalOpen}
    onClose={() => isEditItemModalOpen = false}
    onConfirm={saveEditItem}
>
    {#if selectedItemIndex >= 0}
        <div class="bg-slate-50 p-4 rounded-xl mb-6 flex items-center gap-3">
            <div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center text-primary shadow-sm">
                <Package size={24} />
            </div>
            <div>
                <div class="font-bold text-slate-800">{editingItem.productName}</div>
                <div class="text-xs text-slate-400">Điều chỉnh số lượng & giá</div>
            </div>
        </div>

        <div class="flex gap-4 mb-6">
            <div class="form-control w-1/2">
                <label class="label text-xs font-bold text-slate-400 uppercase">Số lượng</label>
                <div class="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                    <button class="btn btn-ghost btn-sm px-3 rounded-none" on:click={() => editingItem.quantity = Math.max(1, editingItem.quantity - 1)}>-</button>
                    <input type="number" bind:value={editingItem.quantity} min="1" class="input input-sm w-full text-center border-0 focus:outline-none font-bold text-lg" />
                     <button class="btn btn-ghost btn-sm px-3 rounded-none" on:click={() => editingItem.quantity += 1}>+</button>
                </div>
            </div>
            <div class="form-control w-1/2">
                <label class="label text-xs font-bold text-slate-400 uppercase">Đơn giá</label>
                <input type="number" bind:value={editingItem.unitPrice} class="input input-bordered input-md w-full text-right font-medium" />
            </div>
        </div>

        <div class="flex justify-between items-center p-4 bg-primary/5 rounded-xl mb-6 border border-primary/10">
            <span class="text-sm font-medium text-slate-600">Thành tiền</span>
            <span class="text-xl font-bold text-primary">{(editingItem.quantity * editingItem.unitPrice).toLocaleString()} đ</span>
        </div>

        <button class="btn btn-ghost text-red-500 w-full hover:bg-red-50" on:click={() => removeItem(selectedItemIndex)}>
            <Trash2 size={18} class="mr-2" /> Xóa món này
        </button>
    {/if}
</Modal>

<!-- Hidden container for printing the bill -->
{#if orderToPrint}
    <div class="absolute -left-[9999px] top-0">
        <Bill order={orderToPrint} />
    </div>
{/if}