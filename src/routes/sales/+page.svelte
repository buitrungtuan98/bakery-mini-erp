<script lang="ts">
	import { db } from '$lib/firebase'; 
	import { authStore } from '$lib/stores/authStore';
    import { checkPermission } from '$lib/stores/permissionStore';
    import { productStore, partnerStore, type Product, type Partner } from '$lib/stores/masterDataStore';
	import { collection, query, orderBy, doc, runTransaction, serverTimestamp, onSnapshot, limit } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
	import { logAction } from '$lib/logger'; 
    import Modal from '$lib/components/ui/Modal.svelte';

	// --- Types ---
	interface OrderItem {
		productId: string;
        productName?: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
		lineCOGS: number;
        initialPrice: number;
        originalBasePrice?: number;
        discountAmount?: number; // Added
        discountReason?: string; // Added
	}
    
    interface Order {
        id: string;
        createdAt: { toDate: () => Date };
        customerId: string;
        customerInfo: { name: string, type?: 'sỉ'|'lẻ', phone?: string };
        totalRevenue: number;
        totalProfit: number;
        status: 'completed' | 'canceled';
        shippingAddress: string;
        items: OrderItem[];
        orderDiscount?: number; // Added
        orderDiscountReason?: string; // Added
    }

	// --- State ---
	let products: Product[] = [];
    let customers: Partner[] = [];
    let ordersHistory: Order[] = [];
	let loading = true;
	let processing = false;
	let errorMsg = '';
    
    // UI State
    let activeTab: 'create' | 'history' = 'create';

    // UI State for Mobile
    let isProductModalOpen = false;
    let isCustomerModalOpen = false;
    let isEditItemModalOpen = false;
    let isOrderSettingsModalOpen = false; // Added

    let selectedItemIndex = -1;
    let editingItem: OrderItem = { productId: '', quantity: 0, unitPrice: 0, lineTotal: 0, lineCOGS: 0, initialPrice: 0, discountAmount: 0, discountReason: '' };
    let productSearchTerm = '';
    let customerSearchTerm = '';

    // History Pagination (Client side sort/filter if needed, but here we just use store/limit)
    let historyLimit = 10;
    let unsubscribeOrders: () => void;

	// Dữ liệu Phiếu bán hàng
	let selectedCustomerId = '';
	let customer: Partner | undefined;
	let orderItems: OrderItem[] = []; // Default empty
	let shippingFee = 0;
	let shippingAddress = '';
    let shippingPhone = '';

    // Global Order Discount
    let orderDiscount = 0; // Added
    let orderDiscountReason = ''; // Added

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
        const discountAmount = item.discountAmount || 0;
		const lineTotal = (finalUnitPrice * quantity) - discountAmount;
		const lineCOGS = product.theoreticalCost * quantity;

		return { 
            ...item, 
            unitPrice: finalUnitPrice, 
            lineTotal: lineTotal, 
            lineCOGS: lineCOGS, 
            initialPrice: basePrice,
            originalBasePrice: product.sellingPrice,
            discountAmount: discountAmount
        };
	}
	
	$: totalRevenue = orderItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0) + (shippingFee || 0) - (orderDiscount || 0);
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
    
    onDestroy(() => {
        if (unsubscribeOrders) unsubscribeOrders();
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
                originalBasePrice: product.sellingPrice,
                discountAmount: 0,
                discountReason: ''
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

    // --- ORDER SETTINGS ---
    function openOrderSettings() {
        isOrderSettingsModalOpen = true;
    }

    function saveOrderSettings() {
        // Just close, data is bound
        isOrderSettingsModalOpen = false;
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
        if (!confirm(`Xác nhận hủy đơn hàng ${order.id.substring(0, 8)}? Kho sẽ được cộng lại.`)) return;
        
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
            await logAction($authStore.user!, 'UPDATE', 'orders', `Hủy đơn hàng ID: ${order.id.substring(0, 8)}`);
            alert("Hủy đơn hàng thành công!");
        } catch (e: any) {
            console.error("Lỗi đảo ngược:", e);
            alert("LỖI: " + e.message);
        } finally {
            processing = false;
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
			await runTransaction(db, async (transaction) => {
				const productRefs = validItems.map(item => doc(db, 'products', item.productId));
				const productSnaps = await Promise.all(productRefs.map(ref => transaction.get(ref)));

				productSnaps.forEach((snap, index) => {
					const item = validItems[index];
                    const productRef = productRefs[index];
					if (!snap.exists()) throw new Error(`Lỗi: Sản phẩm ID ${item.productId} không tồn tại.`);
					
					const currentStock = Number(snap.data()?.currentStock || 0);
					const newStock = currentStock - item.quantity;

					if (newStock < 0) {
						const prodName = products.find(p => p.id === item.productId)?.name;
						throw new Error(`Lỗi: Tồn kho (${prodName}) không đủ!`);
					}
					transaction.update(productRef, { currentStock: newStock });
				});

				const orderRef = doc(collection(db, 'orders'));
				const customerSnapshot = customers.find(c => c.id === selectedCustomerId);
				
				transaction.set(orderRef, {
					customerId: selectedCustomerId,
					customerInfo: {
						name: customerSnapshot?.name,
						type: customerSnapshot?.customerType,
						phone: shippingPhone
					},
					shippingAddress: shippingAddress,
					status: 'completed',
					items: validItems.map(i => ({
						productId: i.productId,
						productName: products.find(p => p.id === i.productId)?.name,
						quantity: i.quantity,
						unitPrice: i.unitPrice,
						lineTotal: i.lineTotal,
						lineCOGS: i.lineCOGS,
                        discountAmount: i.discountAmount || 0,
                        discountReason: i.discountReason || ''
					})),
					totalRevenue: totalRevenue, 
                    totalCOGS: totalCOGS, 
                    totalProfit: totalProfit,
					shippingFee: shippingFee,
                    orderDiscount: orderDiscount, // Added
                    orderDiscountReason: orderDiscountReason, // Added
					createdBy: $authStore.user?.email,
					createdAt: serverTimestamp()
				});
				
				await logAction($authStore.user!, 'TRANSACTION', 'orders', `Tạo đơn hàng ${orderRef.id.substring(0, 8).toUpperCase()}`);
			});

			alert(`Tạo đơn hàng thành công!`);
			selectedCustomerId = '';
			orderItems = [];
			shippingFee = 0;
            orderDiscount = 0;
            orderDiscountReason = '';
			shippingAddress = '';
            shippingPhone = '';
            customer = undefined;

		} catch (error: any) {
			console.error(error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			alert('Lỗi: ' + errorMessage);
		} finally {
			processing = false;
		}
	}
</script>

<div class="pb-32"> <!-- Padding for Footer -->
    <h1 class="text-xl font-bold text-primary mb-2 px-2">Bán hàng (POS)</h1>

    <!-- TABS -->
    <div role="tablist" class="tabs tabs-boxed mx-2 mb-4 bg-base-200">
        <a role="tab" class="tab {activeTab === 'create' ? 'tab-active bg-primary text-primary-content' : ''}" on:click={() => activeTab = 'create'}>Tạo Đơn</a>
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

        <!-- 2. Cart Items List (Simplified) -->
        <div class="flex flex-col mx-2 bg-white rounded-xl border border-slate-100 overflow-hidden">
            {#each orderItems as item, i}
                <div
                    class="p-4 border-b border-slate-50 flex justify-between items-center active:bg-slate-50"
                    on:click={() => openEditItem(i)}
                >
                    <div>
                        <div class="font-medium text-slate-800 text-sm">{item.productName}</div>
                        <div class="text-xs text-slate-400 mt-1">
                            <span class="font-bold text-slate-600">{item.quantity}</span> x {item.unitPrice.toLocaleString()}
                        </div>
                    </div>
                    <div class="text-right">
                        {#if item.discountAmount && item.discountAmount > 0}
                             <div class="text-xs text-slate-400 line-through">{(item.unitPrice * item.quantity).toLocaleString()} đ</div>
                        {/if}
                        <div class="font-bold text-slate-800 text-sm">{item.lineTotal.toLocaleString()} đ</div>

                        {#if item.discountAmount && item.discountAmount > 0}
                             <div class="text-[9px] text-red-500 font-bold">GIẢM: -{item.discountAmount.toLocaleString()}</div>
                        {:else if item.unitPrice !== item.originalBasePrice}
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
            <div class="max-w-7xl mx-auto flex justify-between items-center gap-2">
                 <!-- Discount/Settings Button -->
                <button class="btn btn-sm btn-circle btn-ghost border border-slate-200" on:click={openOrderSettings}>
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                </button>

                <div class="flex flex-col flex-1">
                    <span class="text-xs text-slate-500 flex items-center gap-1">
                        Tổng tiền
                         {#if orderDiscount > 0}
                            <span class="text-[9px] text-red-500 font-bold bg-red-50 px-1 rounded">- {orderDiscount.toLocaleString()}</span>
                         {/if}
                    </span>
                    <span class="text-xl font-bold text-primary">{totalRevenue.toLocaleString()} đ</span>
                </div>
                <button
                    class="btn btn-primary px-6"
                    disabled={processing || orderItems.length === 0}
                    on:click={handleSale}
                >
                    {processing ? '...' : 'THANH TOÁN'}
                </button>
            </div>
        </div>
    {/if} <!-- End Create Tab -->

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
                    <div class="flex justify-between items-center p-3 bg-white rounded border border-slate-100 shadow-sm {order.status === 'canceled' ? 'opacity-50 grayscale' : ''}">
                        <div class="flex flex-col">
                            <span class="font-bold text-xs text-slate-800">{order.customerInfo.name}</span>
                            <span class="text-[10px] text-slate-400">
                                {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString('vi-VN') : ''}
                            </span>
                        </div>
                        <div class="text-right">
                            <div class="font-bold text-sm text-primary">{order.totalRevenue.toLocaleString()}</div>
                            <div class="text-[10px] uppercase font-bold {order.status === 'canceled' ? 'text-red-500' : 'text-emerald-500'}">
                                {order.status === 'canceled' ? 'Đã Hủy' : 'Thành công'}
                            </div>
                        </div>
                         <button class="btn btn-xs btn-ghost text-error" on:click={() => handleCancelOrder(order)}>
                            {#if order.status === 'canceled'}
                                Đã hủy
                            {:else}
                                Hủy
                            {/if}
                        </button>
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

        <div class="collapse collapse-arrow border border-slate-200 bg-base-100 rounded-box mb-4">
            <input type="checkbox" />
            <div class="collapse-title text-sm font-medium">
                 Giảm giá / Chiết khấu
            </div>
            <div class="collapse-content">
                <div class="form-control mb-2">
                    <label class="label"><span class="label-text-alt">Số tiền giảm (VND)</span></label>
                    <input type="number" bind:value={editingItem.discountAmount} class="input input-sm input-bordered w-full" placeholder="0" />
                </div>
                 <div class="form-control">
                    <label class="label"><span class="label-text-alt">Lý do giảm</span></label>
                    <input type="text" bind:value={editingItem.discountReason} class="input input-sm input-bordered w-full" placeholder="VD: Hàng trưng bày..." />
                </div>
            </div>
        </div>

        <div class="text-right mb-6">
             <div class="text-sm text-slate-500">{(editingItem.quantity * editingItem.unitPrice).toLocaleString()} - {(editingItem.discountAmount || 0).toLocaleString()}</div>
             <div class="font-bold text-xl text-primary">
                = {((editingItem.quantity * editingItem.unitPrice) - (editingItem.discountAmount || 0)).toLocaleString()} đ
            </div>
        </div>

        <button class="btn btn-outline btn-error w-full" on:click={() => removeItem(selectedItemIndex)}>
            Xóa dòng này
        </button>
    {/if}
</Modal>

<!-- MODAL: Order Settings -->
<Modal
    title="Cài đặt đơn hàng"
    isOpen={isOrderSettingsModalOpen}
    onClose={() => isOrderSettingsModalOpen = false}
    onConfirm={saveOrderSettings}
>
    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Phí vận chuyển (Ship)</span></label>
        <input type="number" bind:value={shippingFee} class="input input-bordered w-full" placeholder="0" />
    </div>

    <div class="divider my-1"></div>

     <div class="form-control mb-3">
        <label class="label"><span class="label-text">Giảm giá Tổng đơn (VND)</span></label>
        <input type="number" bind:value={orderDiscount} class="input input-bordered w-full font-bold text-red-500" placeholder="0" />
    </div>

    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Lý do giảm</span></label>
        <input type="text" bind:value={orderDiscountReason} class="input input-bordered w-full" placeholder="VD: Khách quen, Voucher..." />
    </div>

    <div class="form-control mb-3">
        <label class="label"><span class="label-text">Địa chỉ giao hàng</span></label>
        <input type="text" bind:value={shippingAddress} class="input input-bordered w-full" />
    </div>
</Modal>