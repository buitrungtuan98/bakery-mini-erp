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
    import Bill from '$lib/components/ui/Bill.svelte';
    import jsPDF from 'jspdf';
    import html2canvas from 'html2canvas-pro';
    import type { Order } from '$lib/types/order';
    import { tick } from 'svelte';

	// --- Types ---
	interface OrderItem {
		productId: string; productName?: string; quantity: number; unitPrice: number; lineTotal: number;
		lineCOGS: number;  initialPrice: number; 
        originalBasePrice?: number;
	}
    
    interface Order {
        id: string;
        code?: string;
        createdAt: { toDate: () => Date };
        deliveryDate?: { toDate: () => Date };
        customerId: string;
        customerInfo: { name: string, type?: 'sỉ'|'lẻ', phone?: string };
        totalRevenue: number;
        totalProfit: number;
        status: 'open' | 'cooking' | 'delivering' | 'delivered' | 'completed' | 'canceled'; // 'completed' is legacy
        shippingAddress: string;
        items: OrderItem[];
    }

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
            const tempMap = new Map<string, number>();

            snapshot.docs.forEach(doc => {
                const data = doc.data() as Order;
                if (data.status === 'canceled') return;

                // Filter Logic
                if (statusFilter === 'all_active') {
                    // Include everything except canceled (and maybe completed/delivered if we want only pending?)
                    // Usually plan includes everything scheduled for that day.
                } else if (data.status !== statusFilter) {
                    return;
                }

                data.items.forEach(item => {
                    const curr = tempMap.get(item.productId) || 0;
                    tempMap.set(item.productId, curr + item.quantity);
                });
            });

            // Convert to array and join with current stock
            const result = [];
            for (const [pid, qty] of tempMap.entries()) {
                const prod = products.find(p => p.id === pid);
                const stock = prod?.currentStock || 0;
                // Definition of Missing: If we have negative stock, that debt is already there.
                // But the user asked: "Show how many missing stock of each product have to production".
                // If Stock is 10, Needed 5 -> Missing 0.
                // If Stock is -5, Needed 5 -> Missing 5 (for this order) + 5 (old debt)?
                // Let's stick to "Net Missing" = Max(0, Ordered - Stock) ?
                // No, "Stock" is a live variable.
                // If I have 10 orders for tomorrow. And Current Stock is 100. I need to make 0.
                // If I have 10 orders for tomorrow. And Current Stock is -10. I need to make 20? (10 for tomorrow + 10 backfill).
                // Or just show the raw numbers?
                // I will show: Ordered (Demand) | Stock (Available) | Diff (Stock - Ordered).
                // If Diff < 0, that is the shortage.

                // However, "Stock" in Firestore *already includes* the deduction from these orders if they were created!
                // Wait. When I create an order for tomorrow, `handleSale` immediately deducts stock.
                // So `currentStock` ALREADY reflects the demand.
                // Example: Start Stock = 100.
                // Create Order for Tomorrow: Qty 10.
                // New Stock = 90.
                // Plan View: Ordered = 10. Stock = 90.
                // Do I need to produce? No. Stock is positive.

                // Example 2: Start Stock = 5.
                // Create Order for Tomorrow: Qty 10.
                // New Stock = -5.
                // Plan View: Ordered = 10. Stock = -5.
                // Missing = 5? No, missing is 5.
                // Actually, if stock is -5, it means I am short 5 total.
                // Is it just for tomorrow?
                // If I have another order for *Today* that caused -5. And tomorrow needs 0.
                // Plan View Tomorrow: Ordered = 0. Stock = -5.
                // Do I need to produce for *Tomorrow*? No.

                // So the "Production Plan" is usually: "How much do I need to bake to fulfill these orders?"
                // It's `Ordered Qty`.
                // The "Stock Warning" is separate.

                // Let's display: Name | Ordered (Qty) | Stock (Live)
                // And highlight if Stock is negative.

                result.push({
                    productId: pid,
                    name: prod?.name || 'Unknown',
                    ordered: qty,
                    stock: stock,
                    missing: stock < 0 ? Math.abs(stock) : 0 // Just purely stock status
                });
            }
            // Add items that have negative stock but NO orders for tomorrow?
            // The user asked "Show how many missing stock... due to stock missing and filtered calculation by date".
            // If I filter by date, I probably only care about items involved in that date.

            dailyPlanItems = result.sort((a,b) => a.name.localeCompare(b.name));
        });
    }

    onDestroy(() => {
        if (unsubscribeOrders) unsubscribeOrders();
        if (unsubscribePlan) unsubscribePlan();
    });

	// --- Mobile UI Handlers ---
    
    function openProductSelector() {
        if (!selectedCustomerId) return alert("Vui lòng chọn Khách hàng trước!");
        productSearchTerm = '';
        isProductModalOpen = true;
    }

    function addProductToCart(product: Product) {
        // Check if exists
        const existingIndex = orderItems.findIndex(i => i.productId === product.id);

        if (existingIndex >= 0) {
            // Increment
            const item = orderItems[existingIndex];
            item.quantity += 1;
            orderItems[existingIndex] = updatePricing(item, products, customer, false);
        } else {
            // Add new
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
            // Check manual price change
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
        // Permission check
        const canCancel = checkPermission('manage_orders') || checkPermission('create_order');
        if (!canCancel) return alert("Bạn không có quyền hủy đơn.");

        const orderDate = order.createdAt.toDate().toDateString();
        const todayDate = new Date().toDateString();
        if (orderDate !== todayDate) return alert("LỖI: Chỉ có thể hủy đơn hàng trong ngày đã tạo.");
        if (order.status === 'canceled') return alert("Đơn hàng này đã bị hủy.");
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
            alert("Hủy đơn hàng thành công!");
        } catch (e: any) {
            console.error("Lỗi đảo ngược:", e);
            alert("LỖI: " + e.message);
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
        } catch (e: any) {
            console.error(e);
            alert("Lỗi: " + e.message);
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
            // Generate Code first
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

                    // NEGATIVE STOCK ALLOWED: Removed check < 0
					transaction.update(productRef, { currentStock: newStock });
				});

				const orderRef = doc(collection(db, 'orders'));
				const customerSnapshot = customers.find(c => c.id === selectedCustomerId);
				
                // Parse delivery date
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
					status: selectedStatus, // Dynamic Status
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

			alert(`Tạo đơn hàng ${code} thành công!`);
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
			alert('Lỗi: ' + errorMessage);
		} finally {
			processing = false;
		}
	}

    // --- PDF Printing Logic ---
    let orderToPrint: Order | null = null;
    let isPrinting = false;

    async function handlePrint(order: Order) {
        if (isPrinting) return;
        orderToPrint = order;
        isPrinting = true;

        // Wait for Svelte to render the component in the DOM
        await tick();

        const billElement = document.getElementById('bill-to-print');
        if (!billElement) {
            alert('Lỗi: Không tìm thấy element hóa đơn để in.');
            isPrinting = false;
            orderToPrint = null;
            return;
        }

        try {
            const canvas = await html2canvas(billElement, {
                scale: 2, // Higher scale for better quality
                useCORS: true
            });

            const imgData = canvas.toDataURL('image/png');

            // Using a standard 80mm thermal receipt width.
            const pdfWidth = 80;
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [pdfWidth, pdfHeight]
            });

            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`hoadon-${order.code || order.id.slice(0,6)}.pdf`);

        } catch (error) {
            console.error("Lỗi khi tạo PDF:", error);
            alert("Đã có lỗi xảy ra khi tạo file PDF.");
        } finally {
            // Clean up
            orderToPrint = null;
            isPrinting = false;
        }
    }
</script>

<div class="pb-32"> <!-- Padding for Footer -->
    <h1 class="text-xl font-bold text-primary mb-2 px-2">Bán hàng (POS)</h1>

    <!-- TABS -->
    <div role="tablist" class="tabs tabs-boxed mx-2 mb-4 bg-base-200">
        <a role="tab" class="tab {activeTab === 'create' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'create'}>Tạo Đơn</a>
        <a role="tab" class="tab {activeTab === 'plan' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'plan'}>Kế hoạch</a>
        <a role="tab" class="tab {activeTab === 'history' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'history'}>Lịch sử</a>
    </div>

    {#if activeTab === 'create'}
        {#if errorMsg}
            <div role="alert" class="alert alert-error mb-4 mx-2">
                <span>{errorMsg}</span>
            </div>
        {/if}

        <!-- 1. Customer Selection (Card) -->
        <div class="card bg-white shadow-sm border border-slate-200 p-4 mb-4 mx-2" on:click={() => isCustomerModalOpen = true}>
            <div class="flex justify-between items-center">
                <div>
                    {#if customer}
                        <h2 class="font-bold text-lg text-primary">{customer.name}</h2>
                        <p class="text-sm text-slate-500">{customer.phone || 'Chưa có SĐT'}</p>
                        <p class="text-xs text-slate-400 mt-1 truncate max-w-[200px]">{shippingAddress || 'Chưa có địa chỉ'}</p>
                    {:else}
                        <h2 class="font-bold text-lg text-slate-400">Chọn Khách hàng...</h2>
                        <p class="text-xs text-slate-400">Chạm để chọn</p>
                    {/if}
                </div>
                <button class="btn btn-circle btn-sm btn-ghost">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
            </div>
        </div>

        <!-- Delivery Info & Status -->
        <div class="grid grid-cols-2 gap-2 mx-2 mb-4">
             <div class="form-control">
                <label class="label py-0"><span class="label-text text-xs">Ngày giao</span></label>
                <input type="datetime-local" bind:value={deliveryDateInput} class="input input-sm input-bordered w-full" />
            </div>
            <div class="form-control">
                <label class="label py-0"><span class="label-text text-xs">Trạng thái</span></label>
                <select bind:value={selectedStatus} class="select select-sm select-bordered w-full">
                    <option value="open">Mới (Open)</option>
                    <option value="cooking">Đang làm</option>
                    <option value="delivering">Đang giao</option>
                    <option value="delivered">Đã giao</option>
                </select>
            </div>
        </div>

        <!-- 2. Cart Items List (Simplified) -->
        <div class="flex flex-col mx-2 bg-white rounded-xl border border-slate-100 overflow-hidden">
            {#each orderItems as item, i}
                {@const prodStock = products.find(p => p.id === item.productId)?.currentStock || 0}
                {@const isMissing = item.quantity > prodStock}
                <div
                    class="p-4 border-b border-slate-50 flex justify-between items-center active:bg-slate-50"
                    on:click={() => openEditItem(i)}
                >
                    <div>
                        <div class="font-medium text-slate-800 text-sm">{item.productName}</div>
                        <div class="text-xs text-slate-400 mt-1">
                            <span class="font-bold text-slate-600">{item.quantity}</span> x {item.unitPrice.toLocaleString()}
                        </div>
                        {#if isMissing}
                            <div class="text-[10px] text-red-500 font-bold mt-1">
                                ⚠️ Thiếu: {item.quantity - prodStock} (Kho: {prodStock})
                            </div>
                        {/if}
                    </div>
                    <div class="text-right">
                        <div class="font-bold text-slate-800 text-sm">{item.lineTotal.toLocaleString()} đ</div>
                        {#if item.unitPrice !== item.originalBasePrice}
                            <div class="text-[9px] text-orange-500 font-bold">GIÁ RIÊNG</div>
                        {/if}
                    </div>
                </div>
            {/each}

            {#if orderItems.length === 0}
                <div class="text-center py-12 text-slate-300 italic text-sm">
                    Giỏ hàng trống
                </div>
            {/if}
        </div>

        <!-- 3. Add Item Button (FAB) -->
        <button
        class="btn btn-circle btn-primary btn-lg fixed bottom-44 right-4 shadow-xl z-30"
            on:click={openProductSelector}
        >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
        </button>

        <!-- 4. Sticky Footer Checkout -->
        <div class="fixed bottom-[60px] left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-20">
            <div class="max-w-7xl mx-auto flex justify-between items-center">
                <div class="flex flex-col">
                    <span class="text-xs text-slate-500">Tổng tiền ({orderItems.length} món)</span>
                    <span class="text-xl font-bold text-primary">{totalRevenue.toLocaleString()} đ</span>
                </div>
                <button
                    class="btn btn-primary px-8"
                    disabled={processing || orderItems.length === 0}
                    on:click={handleSale}
                >
                    {processing ? 'Đang xử lý...' : 'THANH TOÁN'}
                </button>
            </div>
        </div>
    {/if} <!-- End Create Tab -->

    {#if activeTab === 'plan'}
        <div class="px-2">
            <div class="flex flex-col gap-2 mb-4">
                 <h3 class="font-bold text-slate-700">Kế hoạch sản xuất</h3>
                 <div class="flex gap-2">
                     <input type="date" bind:value={planDate} class="input input-sm input-bordered flex-1" />
                     <select bind:value={planStatusFilter} class="select select-sm select-bordered flex-1">
                         <option value="all_active">Tất cả (Trừ hủy)</option>
                         <option value="open">Mới (Open)</option>
                         <option value="cooking">Đang làm</option>
                         <option value="delivering">Đang giao</option>
                         <option value="delivered">Đã giao</option>
                     </select>
                 </div>
            </div>

            <div class="overflow-x-auto bg-white rounded-lg shadow border border-slate-100">
                <table class="table table-sm w-full">
                    <thead>
                        <tr class="bg-slate-50">
                            <th>Sản phẩm</th>
                            <th class="text-center">Đã đặt</th>
                            <th class="text-center">Tồn kho</th>
                            <th class="text-center">Cần làm</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each dailyPlanItems as item}
                            <tr>
                                <td class="font-medium text-xs">{item.name}</td>
                                <td class="text-center font-bold text-primary">{item.ordered}</td>
                                <td class="text-center {item.stock < 0 ? 'text-red-500 font-bold' : 'text-slate-500'}">
                                    {item.stock}
                                </td>
                                <td class="text-center">
                                    {#if item.stock < 0}
                                        <span class="badge badge-error badge-sm text-white">{Math.abs(item.stock)}</span>
                                    {:else}
                                        <span class="text-slate-300">-</span>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                        {#if dailyPlanItems.length === 0}
                            <tr>
                                <td colspan="4" class="text-center text-slate-400 py-4 italic">Không có đơn hàng cho ngày này</td>
                            </tr>
                        {/if}
                    </tbody>
                </table>
            </div>
            <div class="mt-4 text-xs text-slate-400 italic">
                * Cột "Cần làm" hiển thị số lượng thiếu hụt trong kho (nếu kho bị âm).
            </div>
        </div>
    {/if}

    {#if activeTab === 'history'}
        <!-- History Section (Bottom with Pagination) -->
        <div class="mt-4 px-2 pb-10">
            <div class="flex justify-between items-center mb-3">
                <h3 class="font-bold text-slate-700">Lịch sử đơn hàng</h3>
                <select bind:value={historyLimit} on:change={() => fetchHistory(historyLimit)} class="select select-xs select-ghost">
                    <option value={10}>10 dòng</option>
                    <option value={20}>20 dòng</option>
                    <option value={30}>30 dòng</option>
                </select>
            </div>

            <div class="space-y-2">
                {#each ordersHistory as order}
                    <div class="flex flex-col p-3 bg-white rounded border border-slate-100 shadow-sm {order.status === 'canceled' ? 'opacity-50 grayscale' : ''}">
                        <div class="flex justify-between items-start mb-2">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-xs text-slate-800">{order.customerInfo.name}</span>
                                {#if order.code}
                                    <span class="badge badge-xs badge-ghost font-mono">{order.code}</span>
                                {/if}
                            </div>
                            <div class="text-right">
                                <div class="font-bold text-sm text-primary">{order.totalRevenue.toLocaleString()}</div>
                            </div>
                        </div>

                        <div class="flex justify-between items-end">
                            <div class="flex flex-col gap-1">
                                <span class="text-[10px] text-slate-400 flex items-center gap-1">
                                    📅 Giao:
                                    <span class="font-bold text-slate-600">
                                        {order.deliveryDate?.toDate ? order.deliveryDate.toDate().toLocaleString('vi-VN', { hour: '2-digit', minute:'2-digit', day: 'numeric', month: 'numeric' }) : 'N/A'}
                                    </span>
                                </span>

                                <!-- Status Badge -->
                                <span class="badge badge-sm
                                    {order.status === 'open' ? 'badge-info' :
                                     order.status === 'cooking' ? 'badge-warning' :
                                     order.status === 'delivering' ? 'badge-primary' :
                                     order.status === 'delivered' || order.status === 'completed' ? 'badge-success' : 'badge-ghost'}">
                                    {order.status === 'open' ? 'Mới' :
                                     order.status === 'cooking' ? 'Đang làm' :
                                     order.status === 'delivering' ? 'Đang giao' :
                                     order.status === 'delivered' || order.status === 'completed' ? 'Đã giao' : 'Đã hủy'}
                                </span>
                            </div>

                            <div class="flex gap-2">
                                <!-- Status Update Actions (Quick) -->
                                {#if order.status !== 'canceled' && order.status !== 'delivered' && order.status !== 'completed'}
                                    {#if order.status === 'open'}
                                        <button class="btn btn-xs btn-outline btn-warning" on:click={() => updateStatus(order, 'cooking')}>Bếp</button>
                                    {:else if order.status === 'cooking'}
                                        <button class="btn btn-xs btn-outline btn-primary" on:click={() => updateStatus(order, 'delivering')}>Giao</button>
                                    {:else if order.status === 'delivering'}
                                        <button class="btn btn-xs btn-outline btn-success" on:click={() => updateStatus(order, 'delivered')}>Xong</button>
                                    {/if}
                                {/if}

                                <button class="btn btn-xs btn-ghost" on:click|stopPropagation={() => handlePrint(order)}>In Hóa Đơn</button>
                                <button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleCancelOrder(order)}>
                                    {#if order.status === 'canceled'}
                                        Đã hủy
                                    {:else}
                                        Hủy
                                    {/if}
                                </button>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if} <!-- End History Tab -->

</div>

<!-- MODAL: Select Customer -->
<Modal title="Chọn Khách hàng" isOpen={isCustomerModalOpen} onClose={() => isCustomerModalOpen = false} showConfirm={false}>
    {#if isCustomerModalOpen}
        <input
            type="text"
            bind:value={customerSearchTerm}
            placeholder="Tìm tên khách hàng..."
            class="input input-bordered w-full mb-4 sticky top-0"
            autofocus
        />
        <div class="space-y-1 max-h-[60vh] overflow-y-auto">
            {#each filteredCustomers as cust}
                <button
                    class="w-full text-left p-3 rounded-lg border-b border-slate-50 active:bg-slate-50 flex justify-between items-center"
                    on:click={() => handleCustomerChangeAndRecalculate(cust.id)}
                >
                    <div>
                        <div class="font-bold text-sm text-slate-800">{cust.name}</div>
                        <div class="text-xs text-slate-400">{cust.phone || ''}</div>
                    </div>
                    {#if cust.customerType}
                        <span class="text-xs font-bold text-slate-300">{cust.customerType}</span>
                    {/if}
                </button>
            {/each}
            {#if filteredCustomers.length === 0}
                <div class="text-center text-slate-400 py-4">Không tìm thấy khách hàng.</div>
            {/if}
        </div>
    {/if}
</Modal>

<!-- MODAL: Select Product -->
<Modal title="Thêm Sản phẩm" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    {#if isProductModalOpen}
        <input
            type="text"
            bind:value={productSearchTerm}
            placeholder="Tìm tên sản phẩm..."
            class="input input-bordered w-full mb-4 sticky top-0"
            autofocus
        />
        <div class="space-y-1 max-h-[60vh] overflow-y-auto pb-10">
            {#each filteredProducts as prod}
                <button
                    class="w-full text-left p-3 rounded-lg border-b border-slate-50 active:bg-slate-50 flex justify-between items-center"
                    on:click={() => addProductToCart(prod)}
                >
                    <div>
                        <div class="font-bold text-slate-800">{prod.name}</div>
                        <div class="text-xs {prod.currentStock > 0 ? 'text-green-600' : 'text-red-500'}">
                            Tồn: {prod.currentStock.toLocaleString()}
                        </div>
                    </div>
                    <div class="font-bold text-primary">{prod.sellingPrice.toLocaleString()}</div>
                </button>
            {/each}
            {#if filteredProducts.length === 0}
                <div class="text-center text-slate-400 py-4">Không tìm thấy sản phẩm.</div>
            {/if}
        </div>
    {/if}
</Modal>

<!-- MODAL: Edit Item -->
<Modal
    title="Chỉnh sửa dòng"
    isOpen={isEditItemModalOpen}
    onClose={() => isEditItemModalOpen = false}
    onConfirm={saveEditItem}
>
    {#if selectedItemIndex >= 0}
        <div class="form-control mb-4">
            <label class="label">Sản phẩm</label>
            <input type="text" value={editingItem.productName} disabled class="input input-bordered w-full bg-slate-100" />
        </div>
        <div class="flex gap-4 mb-4">
            <div class="form-control w-1/2">
                <label class="label">Số lượng</label>
                <input type="number" bind:value={editingItem.quantity} min="1" class="input input-bordered w-full font-bold text-lg text-center" />
            </div>
            <div class="form-control w-1/2">
                <label class="label">Đơn giá</label>
                <input type="number" bind:value={editingItem.unitPrice} class="input input-bordered w-full text-right" />
            </div>
        </div>
        <div class="text-right font-bold text-xl text-primary mb-6">
            = {(editingItem.quantity * editingItem.unitPrice).toLocaleString()} đ
        </div>
        <button class="btn btn-outline btn-error w-full" on:click={() => removeItem(selectedItemIndex)}>
            Xóa dòng này
        </button>
    {/if}
</Modal>

<!-- Hidden container for printing the bill -->
{#if orderToPrint}
    <div class="absolute -left-[9999px] top-0">
        <Bill order={orderToPrint} />
    </div>
{/if}