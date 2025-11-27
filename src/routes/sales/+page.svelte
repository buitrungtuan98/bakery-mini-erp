<script lang="ts">
	import { db } from '$lib/firebase'; 
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { productStore, partnerStore, type Product, type Partner } from '$lib/stores/masterDataStore';
	import { collection, query, orderBy, doc, runTransaction, serverTimestamp, onSnapshot, limit, Timestamp, where } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
	import { logAction } from '$lib/logger';
    import { generateNextCode } from '$lib/utils';
    import Modal from '$lib/components/ui/Modal.svelte';
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import Loading from '$lib/components/ui/Loading.svelte';
    import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Plus, User, Clock, CheckCircle, Truck, Package, Trash2, Printer } from 'lucide-svelte';
    import Bill from '$lib/components/ui/Bill.svelte';
    import type { Order, OrderItem } from '$lib/types/order';
    import { tick } from 'svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';

	// --- State ---
	let products: Product[] = [];
    let customers: Partner[] = [];
    let ordersHistory: Order[] = [];
	let loading = true;
	let processing = false;
	let errorMsg = '';
    
    // UI State
    let activeTab: 'create' | 'history' | 'plan' = 'create';

    // UI State for Mobile
    let isProductModalOpen = false;
    let isCustomerModalOpen = false;
    let isEditItemModalOpen = false;
    let selectedItemIndex = -1;
    let editingItem: OrderItem = { productId: '', quantity: 0, unitPrice: 0, lineTotal: 0, lineCOGS: 0, initialPrice: 0 };
    let productSearchTerm = '';
    let customerSearchTerm = '';

    // History Pagination (Client side sort/filter if needed, but here we just use store/limit)
    let historyLimit = 10;
    let unsubscribeOrders: () => void;

    // Daily Plan State
    let planDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // Default Tomorrow
    let dailyPlanItems: { productId: string; name: string; ordered: number; stock: number; missing: number }[] = [];
    let planStatusFilter: string = 'all_active'; // 'all_active', 'open', 'cooking', 'delivering'
    let loadingPlan = false;
    let unsubscribePlan: () => void;

	// Dữ liệu Phiếu bán hàng
	let selectedCustomerId = '';
	let customer: Partner | undefined;
	let orderItems: OrderItem[] = []; // Default empty
	let shippingFee = 0;
	let shippingAddress = '';
    let shippingPhone = '';
    let selectedStatus: 'open' | 'cooking' | 'delivering' | 'delivered' = 'open';

    // Delivery Date Logic
    let deliveryDateInput = new Date().toISOString().slice(0, 16); // Default to now for input

    // --- Data Binding ---
    $: products = $productStore;
    $: customers = $partnerStore.filter(p => p.type === 'customer' || !p.type); // Default to customer if type undefined? Usually strict.
	
	// Reactive Helper: Tìm khách hàng hiện tại
	$: customer = customers.find(c => c.id === selectedCustomerId);

    // Filter Products
    $: filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()));

    // Filter Customers
    $: filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(customerSearchTerm.toLowerCase()));
	
	// Hàm tính giá đơn vị và tổng tiền của item
	function updatePricing(item: OrderItem, products: Product[], currentCustomer: Partner | undefined, isManualUpdate: boolean): OrderItem {
		const product = products.find(p => p.id === item.productId);
		if (!product) return item;

		const customPriceEntry = currentCustomer?.customPrices?.find(cp => cp.productId === item.productId);
		let basePrice = customPriceEntry?.price || product.sellingPrice; 
		
		let finalUnitPrice;
		if (isManualUpdate || item.unitPrice === 0 || item.unitPrice === item.initialPrice) {
			finalUnitPrice = isManualUpdate ? item.unitPrice : basePrice; 
		} else {
			finalUnitPrice = item.unitPrice; 
		}

		const quantity = item.quantity || 0;
		const lineTotal = finalUnitPrice * quantity;
		const lineCOGS = product.theoreticalCost * quantity;

		return { 
            ...item, 
            unitPrice: finalUnitPrice, 
            lineTotal: lineTotal, 
            lineCOGS: lineCOGS, 
            initialPrice: basePrice,
            originalBasePrice: product.sellingPrice
        };
	}
	
	$: totalRevenue = orderItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0) + (shippingFee || 0);
	$: totalCOGS = orderItems.reduce((sum, item) => sum + (item.lineCOGS || 0), 0);
	$: totalProfit = totalRevenue - totalCOGS;

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
        const orderQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(limitCount));
        unsubscribeOrders = onSnapshot(orderQuery, (snapshot) => {
            ordersHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
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
        const start = new Date(dateStr);
        start.setHours(0,0,0,0);
        const end = new Date(dateStr);
        end.setHours(23,59,59,999);

        const q = query(
            collection(db, 'orders'),
            where('deliveryDate', '>=', Timestamp.fromDate(start)),
            where('deliveryDate', '<=', Timestamp.fromDate(end))
        );

        unsubscribePlan = onSnapshot(q, (snapshot) => {
            loadingPlan = false;
            const tempMap = new Map<string, number>();

            snapshot.docs.forEach(doc => {
                const data = doc.data() as Order;
                if (data.status === 'canceled') return;

                if (statusFilter === 'all_active') {
                } else if (data.status !== statusFilter) {
                    return;
                }

                data.items.forEach(item => {
                    const curr = tempMap.get(item.productId) || 0;
                    tempMap.set(item.productId, curr + item.quantity);
                });
            });

            const result = [];
            for (const [pid, qty] of tempMap.entries()) {
                const prod = products.find(p => p.id === pid);
                const stock = prod?.currentStock || 0;
                result.push({
                    productId: pid,
                    name: prod?.name || 'Unknown',
                    ordered: qty,
                    stock: stock,
                    missing: stock < 0 ? Math.abs(stock) : 0
                });
            }

            dailyPlanItems = result.sort((a,b) => a.name.localeCompare(b.name));
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

    function addProductToCart(product: Product) {
        const existingIndex = orderItems.findIndex(i => i.productId === product.id);

        if (existingIndex >= 0) {
            const item = orderItems[existingIndex];
            item.quantity += 1;
            orderItems[existingIndex] = updatePricing(item, products, customer, false);
        } else {
            const newItem: OrderItem = {
                productId: product.id,
                productName: product.name,
                quantity: 1,
                unitPrice: product.sellingPrice,
                lineTotal: 0,
                lineCOGS: 0,
                initialPrice: product.sellingPrice,
                originalBasePrice: product.sellingPrice
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
    async function handleCancelOrder(order: Order) {
        const canCancel = checkPermission('manage_orders') || checkPermission('create_order');
        if (!canCancel) return showErrorToast("Bạn không có quyền hủy đơn.");

        const orderDate = order.createdAt.toDate().toDateString();
        const todayDate = new Date().toDateString();
        if (orderDate !== todayDate) return showErrorToast("LỖI: Chỉ có thể hủy đơn hàng trong ngày đã tạo.");
        if (order.status === 'canceled') return showErrorToast("Đơn hàng này đã bị hủy.");
        const displayId = order.code || order.id.substring(0, 8);
        if (!confirm(`Xác nhận hủy đơn hàng ${displayId}? Kho sẽ được cộng lại.`)) return;
        
        processing = true;
        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, 'orders', order.id);
                for (const item of order.items) {
                    const productRef = doc(db, 'products', item.productId);
                    const productSnap = await transaction.get(productRef);
                    if (!productSnap.exists()) continue;
                    const currentStock = Number(productSnap.data()?.currentStock || 0);
                    const newStock = currentStock + item.quantity;
                    transaction.update(productRef, { currentStock: newStock });
                }
                transaction.update(orderRef, {
                    status: 'canceled',
                    canceledBy: $authStore.user?.email,
                    canceledAt: serverTimestamp()
                });
            });
            await logAction($authStore.user!, 'UPDATE', 'orders', `Hủy đơn hàng: ${displayId}`);
            showSuccessToast("Hủy đơn hàng thành công!");
        } catch (e: any) {
            console.error("Lỗi đảo ngược:", e);
            showErrorToast("LỖI: " + e.message);
        } finally {
            processing = false;
        }
    }

    async function updateStatus(order: Order, newStatus: 'open'|'cooking'|'delivering'|'delivered') {
        if (!confirm(`Cập nhật trạng thái đơn hàng ${order.code} thành '${newStatus}'?`)) return;

        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, 'orders', order.id);
                transaction.update(orderRef, { status: newStatus });
            });
            await logAction($authStore.user!, 'UPDATE', 'orders', `Cập nhật trạng thái ${order.code} -> ${newStatus}`);
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
            const code = await generateNextCode('orders', 'DH');

			await runTransaction(db, async (transaction) => {
				const productRefs = validItems.map(item => doc(db, 'products', item.productId));
				const productSnaps = await Promise.all(productRefs.map(ref => transaction.get(ref)));

				productSnaps.forEach((snap, index) => {
					const item = validItems[index];
                    const productRef = productRefs[index];
					if (!snap.exists()) throw new Error(`Lỗi: Sản phẩm ID ${item.productId} không tồn tại.`);
					
					const currentStock = Number(snap.data()?.currentStock || 0);
					const newStock = currentStock - item.quantity;

					transaction.update(productRef, { currentStock: newStock });
				});

				const orderRef = doc(collection(db, 'orders'));
				const customerSnapshot = customers.find(c => c.id === selectedCustomerId);
				
                const deliveryTimestamp = deliveryDateInput ? Timestamp.fromDate(new Date(deliveryDateInput)) : serverTimestamp();

				transaction.set(orderRef, {
                    code: code,
					customerId: selectedCustomerId,
					customerInfo: {
						name: customerSnapshot?.name,
						type: customerSnapshot?.customerType,
						phone: shippingPhone
					},
					shippingAddress: shippingAddress,
					status: selectedStatus,
                    deliveryDate: deliveryTimestamp,
					items: validItems.map(i => ({
						productId: i.productId,
						productName: products.find(p => p.id === i.productId)?.name,
						quantity: i.quantity,
						unitPrice: i.unitPrice,
						lineTotal: i.lineTotal,
						lineCOGS: i.lineCOGS
					})),
					totalRevenue: totalRevenue, 
                    totalCOGS: totalCOGS, 
                    totalProfit: totalProfit,
					shippingFee: shippingFee,
					createdBy: $authStore.user?.email,
					createdAt: serverTimestamp()
				});
				
				await logAction($authStore.user!, 'TRANSACTION', 'orders', `Tạo đơn hàng ${code}`);
			});

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
    let orderToPrint: Order | null = null;
    let isPrinting = false;

    function resetOrderForm() {
        selectedCustomerId = '';
        orderItems = [];
        shippingFee = 0;
        shippingAddress = '';
        shippingPhone = '';
        customer = undefined;
        selectedStatus = 'open';
        deliveryDateInput = new Date().toISOString().slice(0, 16);
        activeTab = 'create';
    }

    async function handlePrint(order: Order) {
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

<div class="pb-safe">
    <PageHeader>
        <div slot="title" class="flex items-center gap-2">
            <span class="text-2xl font-bold tracking-tight text-slate-800">Bán hàng</span>
        </div>
        <div slot="actions">
             {#if activeTab === 'create'}
                <button class="btn btn-primary btn-sm shadow-lg shadow-primary/20" on:click={openProductSelector}>
                    <Plus class="h-4 w-4 mr-1" />
                    Thêm món
                </button>
             {/if}
        </div>
    </PageHeader>

    <!-- TABS -->
    <div role="tablist" class="tabs tabs-boxed mx-2 mb-4 bg-slate-100 p-1 rounded-xl">
        <a role="tab" class="tab {activeTab === 'create' ? 'bg-white shadow-sm text-primary font-bold' : 'text-slate-500'}" on:click={() => activeTab = 'create'}>Tạo Đơn</a>
        <a role="tab" class="tab {activeTab === 'plan' ? 'bg-white shadow-sm text-primary font-bold' : 'text-slate-500'}" on:click={() => activeTab = 'plan'}>Kế hoạch</a>
        <a role="tab" class="tab {activeTab === 'history' ? 'bg-white shadow-sm text-primary font-bold' : 'text-slate-500'}" on:click={() => activeTab = 'history'}>Lịch sử</a>
    </div>

    {#if activeTab === 'create'}
        {#if errorMsg}
            <div role="alert" class="alert alert-error mb-4 mx-2 text-sm text-white shadow-lg">
                <span>{errorMsg}</span>
            </div>
        {/if}

        <!-- 1. Customer Selection (Card) -->
        <div class="card bg-white shadow-sm border border-slate-100 p-4 mb-4 mx-2 active-press" on:click={() => isCustomerModalOpen = true}>
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
        </div>

        <!-- Delivery Info & Status -->
        <div class="grid grid-cols-2 gap-3 mx-2 mb-4">
             <div class="form-control">
                <label class="label py-1"><span class="label-text text-xs font-bold text-slate-400 uppercase">Ngày giao</span></label>
                <input type="datetime-local" bind:value={deliveryDateInput} class="input input-sm input-bordered w-full bg-white" />
            </div>
            <div class="form-control">
                <label class="label py-1"><span class="label-text text-xs font-bold text-slate-400 uppercase">Trạng thái</span></label>
                <select bind:value={selectedStatus} class="select select-sm select-bordered w-full bg-white">
                    <option value="open">Mới (Open)</option>
                    <option value="cooking">Đang làm</option>
                    <option value="delivering">Đang giao</option>
                    <option value="delivered">Đã giao</option>
                </select>
            </div>
        </div>

        <!-- 2. Cart Items List (Simplified) -->
        <div class="flex flex-col mx-2 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden min-h-[200px]">
            {#each orderItems as item, i}
                {@const prodStock = products.find(p => p.id === item.productId)?.currentStock || 0}
                {@const isMissing = item.quantity > prodStock}
                <div
                    class="p-4 border-b border-slate-50 flex justify-between items-center active:bg-slate-50 transition-colors"
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
                        <div class="font-bold text-slate-800 text-base">{item.lineTotal.toLocaleString()} đ</div>
                        {#if item.unitPrice !== item.originalBasePrice}
                            <div class="text-[9px] text-orange-500 font-bold bg-orange-50 px-1 rounded">CUSTOM</div>
                        {/if}
                    </div>
                </div>
            {/each}

            {#if orderItems.length === 0}
                <div class="flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
                    <Package size={48} strokeWidth={1} />
                    <span class="text-sm">Giỏ hàng trống</span>
                </div>
            {/if}
        </div>

        <!-- 4. Sticky Footer Checkout -->
        <!-- REFACTOR: Changed bottom-[60px] to bottom-[var(--btm-nav-height)] to respect BottomNav -->
        <div class="fixed bottom-[80px] lg:bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-100 p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-30">
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

        <div class="h-24"></div> <!-- Spacer for footer -->
    {/if} <!-- End Create Tab -->

    {#if activeTab === 'plan'}
        <div class="px-2">
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
        <div class="mt-4 px-2 pb-24">
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
                                        <div class="font-bold text-sm text-slate-800">{order.customerInfo.name}</div>
                                        <div class="text-xs text-slate-400 font-mono mt-0.5">{order.code || order.id.slice(0,8)}</div>
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="font-bold text-base text-primary">{order.totalRevenue.toLocaleString()}</div>
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
                                    {order.deliveryDate?.toDate ? order.deliveryDate.toDate().toLocaleString('vi-VN', { hour: '2-digit', minute:'2-digit', day: 'numeric', month: 'numeric' }) : 'N/A'}
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
            {/if}
        </div>
    {/if} <!-- End History Tab -->

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