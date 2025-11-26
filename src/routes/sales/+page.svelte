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
    import PageHeader from '$lib/components/ui/PageHeader.svelte';
    import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
    import jsPDF from 'jspdf';
    import html2canvas from 'html2canvas-pro';
    import type { Order } from '$lib/types/order';
    import { tick } from 'svelte';
    import { showSuccessToast, showErrorToast } from '$lib/utils/notifications';
    import { Plus } from 'lucide-svelte';

	// --- Types ---
	interface OrderItem {
		productId: string; productName?: string; quantity: number; unitPrice: number; lineTotal: number;
		lineCOGS: number;  initialPrice: number; 
        originalBasePrice?: number;
	}
    
    // Duplicating from types/order.ts to avoid import issues in this large file for now
    interface Order {
        id: string;
        code?: string;
        createdAt: { toDate: () => Date };
        deliveryDate?: { toDate: () => Date };
        customerId: string;
        customerInfo: { name: string, type?: 'sỉ'|'lẻ', phone?: string };
        totalRevenue: number;
        totalProfit: number;
        status: 'open' | 'cooking' | 'delivering' | 'delivered' | 'completed' | 'canceled';
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

    let isProductModalOpen = false;
    let isCustomerModalOpen = false;
    let isEditItemModalOpen = false;
    let selectedItemIndex = -1;
    let editingItem: OrderItem = { productId: '', quantity: 0, unitPrice: 0, lineTotal: 0, lineCOGS: 0, initialPrice: 0 };
    let productSearchTerm = '';
    let customerSearchTerm = '';

    let historyLimit = 10;
    let unsubscribeOrders: () => void;

    let planDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let dailyPlanItems: { productId: string; name: string; ordered: number; stock: number; missing: number }[] = [];
    let planStatusFilter: string = 'all_active';
    let unsubscribePlan: () => void;

	let selectedCustomerId = '';
	let customer: Partner | undefined;
	let orderItems: OrderItem[] = [];
	let shippingFee = 0;
	let shippingAddress = '';
    let shippingPhone = '';
    let selectedStatus: 'open' | 'cooking' | 'delivering' | 'delivered' = 'open';
    let deliveryDateInput = new Date().toISOString().slice(0, 16);

    // --- Data Binding ---
    $: products = $productStore;
    $: customers = $partnerStore.filter(p => p.type === 'customer' || !p.type);
	$: customer = customers.find(c => c.id === selectedCustomerId);
    $: filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()));
    $: filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(customerSearchTerm.toLowerCase()));
	
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
                if (statusFilter !== 'all_active' && data.status !== statusFilter) return;
                data.items.forEach(item => {
                    const curr = tempMap.get(item.productId) || 0;
                    tempMap.set(item.productId, curr + item.quantity);
                });
            });

            dailyPlanItems = Array.from(tempMap.entries()).map(([pid, qty]) => {
                const prod = products.find(p => p.id === pid);
                const stock = prod?.currentStock || 0;
                return {
                    productId: pid,
                    name: prod?.name || 'Unknown',
                    ordered: qty,
                    stock: stock,
                    missing: stock < 0 ? Math.abs(stock) : 0
                };
            }).sort((a,b) => a.name.localeCompare(b.name));
        });
    }

    onDestroy(() => {
        if (unsubscribeOrders) unsubscribeOrders();
        if (unsubscribePlan) unsubscribePlan();
    });

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
        }
        isEditItemModalOpen = false;
    }

	function removeItem(index: number) {
		orderItems = orderItems.filter((_, i) => i !== index);
        isEditItemModalOpen = false;
	}

    async function handleCancelOrder(order: Order) {
        const canCancel = checkPermission('manage_orders') || checkPermission('create_order');
        if (!canCancel) return showErrorToast("Bạn không có quyền hủy đơn.");
        if (order.createdAt.toDate().toDateString() !== new Date().toDateString()) return showErrorToast("LỖI: Chỉ có thể hủy đơn hàng trong ngày đã tạo.");
        if (order.status === 'canceled') return showErrorToast("Đơn hàng này đã bị hủy.");
        if (!confirm(`Xác nhận hủy đơn hàng ${order.code || order.id}? Kho sẽ được cộng lại.`)) return;
        
        processing = true;
        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, 'orders', order.id);
                for (const item of order.items) {
                    const productRef = doc(db, 'products', item.productId);
                    const productSnap = await transaction.get(productRef);
                    if (!productSnap.exists()) continue;
                    transaction.update(productRef, { currentStock: (productSnap.data()?.currentStock || 0) + item.quantity });
                }
                transaction.update(orderRef, { status: 'canceled', canceledBy: $authStore.user?.email, canceledAt: serverTimestamp() });
            });
            await logAction($authStore.user!, 'UPDATE', 'orders', `Hủy đơn hàng: ${order.code}`);
            showSuccessToast("Hủy đơn hàng thành công!");
        } catch (e: any) {
            showErrorToast("LỖI: " + e.message);
        } finally {
            processing = false;
        }
    }

    async function updateStatus(order: Order, newStatus: 'open'|'cooking'|'delivering'|'delivered') {
        if (!confirm(`Cập nhật trạng thái đơn hàng ${order.code} thành '${newStatus}'?`)) return;
        try {
            await runTransaction(db, async (transaction) => {
                transaction.update(doc(db, 'orders', order.id), { status: newStatus });
            });
            await logAction($authStore.user!, 'UPDATE', 'orders', `Cập nhật trạng thái ${order.code} -> ${newStatus}`);
            showSuccessToast("Cập nhật trạng thái thành công!");
        } catch (e: any) { showErrorToast("Lỗi: " + e.message); }
    }

	async function handleSale() {
		if (!selectedCustomerId) return showErrorToast('Vui lòng chọn khách hàng.');
		const validItems = orderItems.filter(i => i.productId && i.quantity > 0);
		if (validItems.length === 0) return showErrorToast('Phiếu bán hàng trống.');
		processing = true;
		try {
            const code = await generateNextCode('orders', 'DH');
			await runTransaction(db, async (transaction) => {
				for (const item of validItems) {
                    const productRef = doc(db, 'products', item.productId);
                    const snap = await transaction.get(productRef);
                    if (!snap.exists()) throw new Error(`Sản phẩm ID ${item.productId} không tồn tại.`);
                    transaction.update(productRef, { currentStock: (snap.data().currentStock || 0) - item.quantity });
                }
				const orderRef = doc(collection(db, 'orders'));
				const customerSnapshot = customers.find(c => c.id === selectedCustomerId);
                const deliveryTimestamp = deliveryDateInput ? Timestamp.fromDate(new Date(deliveryDateInput)) : serverTimestamp();
				transaction.set(orderRef, {
                    code, customerId: selectedCustomerId,
					customerInfo: { name: customerSnapshot?.name, type: customerSnapshot?.customerType, phone: shippingPhone },
					shippingAddress, status: selectedStatus, deliveryDate: deliveryTimestamp,
					items: validItems.map(i => ({ productId: i.productId, productName: products.find(p => p.id === i.productId)?.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, lineCOGS: i.lineCOGS })),
					totalRevenue, totalCOGS, totalProfit, shippingFee,
					createdBy: $authStore.user?.email, createdAt: serverTimestamp()
				});
				await logAction($authStore.user!, 'TRANSACTION', 'orders', `Tạo đơn hàng ${code}`);
			});
			showSuccessToast(`Tạo đơn hàng ${code} thành công!`);
			selectedCustomerId = ''; orderItems = []; shippingFee = 0; shippingAddress = ''; shippingPhone = ''; customer = undefined; selectedStatus = 'open';
            deliveryDateInput = new Date().toISOString().slice(0, 16);
		} catch (error: any) {
			showErrorToast('Lỗi: ' + error.message);
		} finally {
			processing = false;
		}
	}

    let orderToPrint: Order | null = null;
    let isPrinting = false;
    async function handlePrint(order: Order) {
        if (isPrinting) return;
        orderToPrint = order; isPrinting = true;
        await tick();
        const billElement = document.getElementById('bill-to-print');
        if (!billElement) {
            showErrorToast('Lỗi: Không tìm thấy element hóa đơn để in.');
            isPrinting = false; orderToPrint = null; return;
        }
        try {
            const canvas = await html2canvas(billElement, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const pdfWidth = 80;
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, pdfHeight] });
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`hoadon-${order.code || order.id.slice(0,6)}.pdf`);
        } catch (error) {
            showErrorToast("Đã có lỗi xảy ra khi tạo file PDF.");
        } finally {
            orderToPrint = null; isPrinting = false;
        }
    }
</script>

<div class="pb-32">
    <PageHeader title="Bán hàng (POS)">
        <svelte:fragment slot="action">
            {#if activeTab === 'create'}
                 <button class="btn btn-primary btn-sm" on:click={openProductSelector}>
                    <Plus class="h-4 w-4 mr-1" /> Thêm Sản phẩm
                </button>
            {/if}
        </svelte:fragment>
    </PageHeader>

    <div role="tablist" class="tabs tabs-boxed mx-2 mb-4 bg-base-200">
        <a role="tab" class="tab {activeTab === 'create' ? 'tab-active' : ''}" on:click={() => activeTab = 'create'}>Tạo Đơn</a>
        <a role="tab" class="tab {activeTab === 'plan' ? 'tab-active' : ''}" on:click={() => activeTab = 'plan'}>Kế hoạch</a>
        <a role="tab" class="tab {activeTab === 'history' ? 'tab-active' : ''}" on:click={() => activeTab = 'history'}>Lịch sử</a>
    </div>

    {#if activeTab === 'create'}
        <div class="card bg-base-100 shadow-sm border border-base-200 p-4 mb-4 mx-2" on:click={() => isCustomerModalOpen = true}>
            <div class="flex justify-between items-center">
                <div>
                    {#if customer}
                        <h2 class="font-bold text-lg text-primary">{customer.name}</h2>
                        <p class="text-sm text-base-content/70">{customer.phone || 'Chưa có SĐT'}</p>
                        <p class="text-xs text-base-content/50 mt-1 truncate max-w-[200px]">{shippingAddress || 'Chưa có địa chỉ'}</p>
                    {:else}
                        <h2 class="font-bold text-lg text-base-content/50">Chọn Khách hàng...</h2>
                        <p class="text-xs text-base-content/50">Chạm để chọn</p>
                    {/if}
                </div>
                <button class="btn btn-circle btn-sm btn-ghost">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
            </div>
        </div>

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

        <div class="flex flex-col mx-2 bg-base-100 rounded-xl border border-base-200 overflow-hidden">
            {#each orderItems as item, i}
                {@const prodStock = products.find(p => p.id === item.productId)?.currentStock || 0}
                {@const isMissing = item.quantity > prodStock}
                <div class="p-4 border-b border-base-200 flex justify-between items-center active:bg-base-200" on:click={() => openEditItem(i)}>
                    <div>
                        <div class="font-medium text-base-content text-sm">{item.productName}</div>
                        <div class="text-xs text-base-content/60 mt-1">
                            <span class="font-bold text-base-content">{item.quantity}</span> x {item.unitPrice.toLocaleString()}
                        </div>
                        {#if isMissing}
                            <div class="text-[10px] text-error font-bold mt-1">⚠️ Thiếu: {item.quantity - prodStock} (Kho: {prodStock})</div>
                        {/if}
                    </div>
                    <div class="text-right">
                        <div class="font-bold text-base-content text-sm">{item.lineTotal.toLocaleString()} đ</div>
                        {#if item.unitPrice !== item.originalBasePrice}
                            <div class="badge badge-xs badge-warning">GIÁ RIÊNG</div>
                        {/if}
                    </div>
                </div>
            {:else}
                <div class="text-center py-12 text-base-content/40 italic text-sm">Giỏ hàng trống</div>
            {/if}
        </div>

        <div class="fixed bottom-[60px] left-0 right-0 bg-base-100 border-t border-base-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-20">
            <div class="max-w-7xl mx-auto flex justify-between items-center">
                <div>
                    <span class="text-xs text-base-content/70">Tổng tiền ({orderItems.length} món)</span>
                    <span class="block text-xl font-bold text-primary">{totalRevenue.toLocaleString()} đ</span>
                </div>
                <button class="btn btn-primary px-8" disabled={processing || orderItems.length === 0} on:click={handleSale}>
                    {processing ? 'Đang xử lý...' : 'THANH TOÁN'}
                </button>
            </div>
        </div>
    {/if}

    {#if activeTab === 'plan'}
        <div class="px-2">
            <div class="flex flex-col gap-2 mb-4">
                 <h3 class="font-bold text-base-content">Kế hoạch sản xuất</h3>
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

            <div class="overflow-x-auto bg-base-100 rounded-lg shadow border border-base-200">
                <table class="table table-sm w-full">
                    <thead>
                        <tr class="bg-base-200">
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
                                <td class="text-center {item.stock < 0 ? 'text-red-500 font-bold' : ''}">{item.stock}</td>
                                <td class="text-center">
                                    {#if item.stock < 0}
                                        <span class="badge badge-error badge-sm text-white">{Math.abs(item.stock)}</span>
                                    {:else}
                                        <span class="text-slate-300">-</span>
                                    {/if}
                                </td>
                            </tr>
                        {:else}
                            <tr><td colspan="4" class="text-center text-base-content/50 py-4 italic">Không có đơn hàng cho ngày này</td></tr>
                        {/if}
                    </tbody>
                </table>
            </div>
            <div class="mt-4 text-xs text-base-content/50 italic">* Cột "Cần làm" hiển thị số lượng thiếu hụt trong kho (nếu kho bị âm).</div>
        </div>
    {/if}

    {#if activeTab === 'history'}
        <div class="px-2 pb-10">
            <div class="flex justify-between items-center mb-3">
                <h3 class="font-bold text-base-content">Lịch sử đơn hàng</h3>
                <select bind:value={historyLimit} on:change={() => fetchHistory(historyLimit)} class="select select-xs select-ghost">
                    <option value={10}>10 dòng</option>
                    <option value={20}>20 dòng</option>
                    <option value={30}>30 dòng</option>
                </select>
            </div>
            <ResponsiveTable>
                <svelte:fragment slot="mobile">
                    {#each ordersHistory as order}
                        <div class="flex flex-col p-3 bg-base-100 rounded border border-base-200 shadow-sm {order.status === 'canceled' ? 'opacity-50 grayscale' : ''}">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <span class="font-bold text-sm">{order.customerInfo.name}</span>
                                    {#if order.code}<span class="badge badge-xs badge-ghost font-mono ml-2">{order.code}</span>{/if}
                                </div>
                                <div class="font-bold text-sm text-primary">{order.totalRevenue.toLocaleString()} đ</div>
                            </div>
                            <div class="flex justify-between items-end">
                                <div class="flex flex-col gap-1">
                                    <span class="text-[10px] text-base-content/60">Giao: <span class="font-bold text-base-content">{order.deliveryDate?.toDate ? order.deliveryDate.toDate().toLocaleString('vi-VN', { hour: '2-digit', minute:'2-digit', day: 'numeric', month: 'numeric' }) : 'N/A'}</span></span>
                                    <span class="badge badge-sm {order.status === 'open' ? 'badge-info' : order.status === 'cooking' ? 'badge-warning' : order.status === 'delivering' ? 'badge-primary' : order.status === 'delivered' || order.status === 'completed' ? 'badge-success' : 'badge-ghost'}">
                                        {order.status === 'open' ? 'Mới' : order.status === 'cooking' ? 'Đang làm' : order.status === 'delivering' ? 'Đang giao' : order.status === 'delivered' || order.status === 'completed' ? 'Đã giao' : 'Đã hủy'}
                                    </span>
                                </div>
                                <div class="flex gap-1">
                                    {#if order.status !== 'canceled' && order.status !== 'delivered' && order.status !== 'completed'}
                                        {#if order.status === 'open'}<button class="btn btn-xs btn-outline btn-warning" on:click={() => updateStatus(order, 'cooking')}>Bếp</button>{/if}
                                        {#if order.status === 'cooking'}<button class="btn btn-xs btn-outline btn-primary" on:click={() => updateStatus(order, 'delivering')}>Giao</button>{/if}
                                        {#if order.status === 'delivering'}<button class="btn btn-xs btn-outline btn-success" on:click={() => updateStatus(order, 'delivered')}>Xong</button>{/if}
                                    {/if}
                                    <button class="btn btn-xs btn-ghost" on:click|stopPropagation={() => handlePrint(order)}>In</button>
                                    <button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleCancelOrder(order)} disabled={order.status === 'canceled'}>Hủy</button>
                                </div>
                            </div>
                        </div>
                    {/each}
                </svelte:fragment>
                 <svelte:fragment slot="desktop">
                    <thead>
                        <tr>
                            <th>Khách hàng</th><th>Ngày giao</th><th>Trạng thái</th><th class="text-right">Tổng tiền</th><th class="text-center">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each ordersHistory as order}
                            <tr class:opacity-50={order.status === 'canceled'}>
                                <td>
                                    <div class="font-bold">{order.customerInfo.name}</div>
                                    <div class="text-xs font-mono">{order.code}</div>
                                </td>
                                <td>{order.deliveryDate?.toDate ? order.deliveryDate.toDate().toLocaleString('vi-VN') : 'N/A'}</td>
                                <td>
                                    <span class="badge badge-sm {order.status === 'open' ? 'badge-info' : order.status === 'cooking' ? 'badge-warning' : order.status === 'delivering' ? 'badge-primary' : order.status === 'delivered' || order.status === 'completed' ? 'badge-success' : 'badge-ghost'}">
                                        {order.status === 'open' ? 'Mới' : order.status === 'cooking' ? 'Đang làm' : order.status === 'delivering' ? 'Đang giao' : order.status === 'delivered' || order.status === 'completed' ? 'Đã giao' : 'Đã hủy'}
                                    </span>
                                </td>
                                <td class="text-right font-mono font-bold text-primary">{order.totalRevenue.toLocaleString()} đ</td>
                                <td class="text-center">
                                    {#if order.status !== 'canceled' && order.status !== 'delivered' && order.status !== 'completed'}
                                        {#if order.status === 'open'}<button class="btn btn-xs btn-outline btn-warning" on:click={() => updateStatus(order, 'cooking')}>Bếp</button>{/if}
                                        {#if order.status === 'cooking'}<button class="btn btn-xs btn-outline btn-primary" on:click={() => updateStatus(order, 'delivering')}>Giao</button>{/if}
                                        {#if order.status === 'delivering'}<button class="btn btn-xs btn-outline btn-success" on:click={() => updateStatus(order, 'delivered')}>Xong</button>{/if}
                                    {/if}
                                    <button class="btn btn-xs btn-ghost" on:click|stopPropagation={() => handlePrint(order)}>In</button>
                                    <button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleCancelOrder(order)} disabled={order.status === 'canceled'}>Hủy</button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                 </svelte:fragment>
            </ResponsiveTable>
        </div>
    {/if}
</div>

<Modal title="Chọn Khách hàng" isOpen={isCustomerModalOpen} onClose={() => isCustomerModalOpen = false} showConfirm={false}>
    {#if isCustomerModalOpen}
        <input type="text" bind:value={customerSearchTerm} placeholder="Tìm tên khách hàng..." class="input input-bordered w-full mb-4 sticky top-0" autofocus />
        <div class="space-y-1">
            {#each filteredCustomers as cust}
                <button class="w-full text-left p-3 rounded-lg border-b border-base-200 active:bg-base-200 flex justify-between items-center" on:click={() => handleCustomerChangeAndRecalculate(cust.id)}>
                    <div>
                        <div class="font-bold text-sm">{cust.name}</div>
                        <div class="text-xs text-base-content/60">{cust.phone || ''}</div>
                    </div>
                    {#if cust.customerType}<span class="text-xs font-bold text-base-content/40">{cust.customerType}</span>{/if}
                </button>
            {:else}
                <div class="text-center text-base-content/50 py-4">Không tìm thấy khách hàng.</div>
            {/if}
        </div>
    {/if}
</Modal>

<Modal title="Thêm Sản phẩm" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    {#if isProductModalOpen}
        <input type="text" bind:value={productSearchTerm} placeholder="Tìm tên sản phẩm..." class="input input-bordered w-full mb-4 sticky top-0" autofocus />
        <div class="space-y-1">
            {#each filteredProducts as prod}
                <button class="w-full text-left p-3 rounded-lg border-b border-base-200 active:bg-base-200 flex justify-between items-center" on:click={() => addProductToCart(prod)}>
                    <div>
                        <div class="font-bold">{prod.name}</div>
                        <div class="text-xs {prod.currentStock > 0 ? 'text-success' : 'text-error'}">Tồn: {prod.currentStock.toLocaleString()}</div>
                    </div>
                    <div class="font-bold text-primary">{prod.sellingPrice.toLocaleString()}</div>
                </button>
            {:else}
                <div class="text-center text-base-content/50 py-4">Không tìm thấy sản phẩm.</div>
            {/if}
        </div>
    {/if}
</Modal>

<Modal title="Chỉnh sửa dòng" isOpen={isEditItemModalOpen} onClose={() => isEditItemModalOpen = false} onConfirm={saveEditItem}>
    {#if selectedItemIndex >= 0}
        <div class="form-control mb-4">
            <label class="label">Sản phẩm</label>
            <input type="text" value={editingItem.productName} disabled class="input input-bordered w-full bg-base-200" />
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
        <button class="btn btn-outline btn-error w-full" on:click={() => removeItem(selectedItemIndex)}>Xóa dòng này</button>
    {/if}
</Modal>

{#if orderToPrint}
    <div class="absolute -left-[9999px] top-0"><Bill {orderToPrint} /></div>
{/if}
