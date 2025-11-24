<script lang="ts">
	import { db } from '$lib/firebase'; 
	import { authStore } from '$lib/stores/authStore';
    import { permissionStore, checkPermission } from '$lib/stores/permissionStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, where, onSnapshot, limit } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
	import { logAction } from '$lib/logger'; 
    import Modal from '$lib/components/ui/Modal.svelte';

	// --- Types ---
	interface Partner {
		id: string; name: string; type: 'supplier' | 'customer'; customerType?: 'sỉ' | 'lẻ';
		phone?: string; defaultAddress?: string; 
        address?: string; 
		customPrices?: { productId: string; price: number; }[];
	}

	interface Product {
		id: string; name: string; sellingPrice: number; theoreticalCost: number;
		currentStock: number;
	}

	interface OrderItem {
		productId: string; productName?: string; quantity: number; unitPrice: number; lineTotal: number;
		lineCOGS: number;  initialPrice: number; 
        originalBasePrice?: number;
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
    }

	// --- State ---
	let customers: Partner[] = [];
	let products: Product[] = [];
    let ordersHistory: Order[] = [];
	let loading = true;
	let processing = false;
	let errorMsg = '';
	let isDataFetched = false;
    
    // UI State for Mobile
    let isProductModalOpen = false;
    let isCustomerModalOpen = false;
    let isEditItemModalOpen = false;
    let selectedItemIndex = -1;
    let editingItem: OrderItem = { productId: '', quantity: 0, unitPrice: 0, lineTotal: 0, lineCOGS: 0, initialPrice: 0 };
    let productSearchTerm = '';

    // Quản lý Subscription
    let unsubscribeProducts: () => void;
    let unsubscribeOrders: () => void;

	// Dữ liệu Phiếu bán hàng
	let selectedCustomerId = '';
	let customer: Partner | undefined;
	let orderItems: OrderItem[] = []; // Default empty
	let shippingFee = 0;
	let shippingAddress = '';
    let shippingPhone = '';
	
	// Reactive Helper: Tìm khách hàng hiện tại
	$: customer = customers.find(c => c.id === selectedCustomerId);

    // Filter Products
    $: filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()));
	
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
            shippingAddress = customer.address || customer.defaultAddress || '';
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

	async function fetchData() {
		if (isDataFetched) return;
		loading = true;
		isDataFetched = true;
		
		try {
			const custSnap = await getDocs(query(collection(db, 'partners'), where('type', '==', 'customer')));
			customers = custSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));

			const q = query(collection(db, 'products'), orderBy('name'));
			unsubscribeProducts = onSnapshot(q, (snapshot) => {
                products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
                if (products.length > 0 && customer) {
                     products = products; 
                }
            });
            
            const orderQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(20));
            unsubscribeOrders = onSnapshot(orderQuery, (snapshot) => {
                ordersHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
            });

		} catch (error) {
			console.error("Lỗi Fetch Master Data:", error);
			errorMsg = "Lỗi tải dữ liệu.";
		} finally {
			loading = false;
		}
	}

	$: if ($authStore.user && !isDataFetched) {
		fetchData();
	}
    
    onDestroy(() => {
        if (unsubscribeProducts) unsubscribeProducts();
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
						lineCOGS: i.lineCOGS
					})),
					totalRevenue: totalRevenue, 
                    totalCOGS: totalCOGS, 
                    totalProfit: totalProfit,
					shippingFee: shippingFee,
					createdBy: $authStore.user?.email,
					createdAt: serverTimestamp()
				});
				
				await logAction($authStore.user!, 'TRANSACTION', 'orders', `Tạo đơn hàng ${orderRef.id.substring(0, 8).toUpperCase()}`);
			});

			alert(`Tạo đơn hàng thành công!`);
			selectedCustomerId = '';
			orderItems = [];
			shippingFee = 0;
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
    <h1 class="text-xl font-bold text-primary mb-4 px-2">Bán hàng (POS)</h1>

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

    <!-- 2. Cart Items List -->
    <div class="flex flex-col gap-3 mx-2">
        {#each orderItems as item, i}
            <div
                class="bg-white p-3 rounded-lg shadow-sm border border-slate-100 flex justify-between items-center relative"
                on:click={() => openEditItem(i)}
            >
                <div class="flex-1">
                    <div class="font-bold text-slate-700">{item.productName || 'Sản phẩm ' + i}</div>
                    <div class="text-xs text-slate-500 mt-1">
                        {item.quantity} x {item.unitPrice.toLocaleString()} đ
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-bold text-primary">{item.lineTotal.toLocaleString()} đ</div>
                    {#if item.unitPrice !== item.originalBasePrice}
                        <div class="badge badge-xs badge-warning text-[9px] mt-1">Giá riêng</div>
                    {/if}
                    <div class="text-[10px] text-slate-400 mt-1">Chạm để sửa</div>
                </div>
            </div>
        {/each}
        
        {#if orderItems.length === 0}
            <div class="text-center py-10 text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-300 mx-2">
                Chưa có sản phẩm nào.
            </div>
        {/if}
    </div>

    <!-- 3. Add Item Button (FAB) -->
    <button
        class="btn btn-circle btn-primary btn-lg fixed bottom-28 right-4 shadow-xl z-30"
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

    <!-- History Section (Bottom) -->
    <div class="mt-8 px-2 opacity-50">
        <h3 class="font-bold text-lg mb-2">Lịch sử gần đây</h3>
        <div class="overflow-x-auto">
             <table class="table table-xs">
                 <thead><tr><th>Ngày</th><th>Khách</th><th>Tiền</th><th>TT</th></tr></thead>
                 <tbody>
                     {#each ordersHistory as order}
                        <tr>
                            <td>{order.createdAt?.toDate().getDate()}/{order.createdAt?.toDate().getMonth()+1}</td>
                            <td class="max-w-[100px] truncate">{order.customerInfo.name}</td>
                            <td>{order.totalRevenue.toLocaleString()}</td>
                            <td>{order.status === 'canceled' ? 'Hủy' : 'OK'}</td>
                        </tr>
                     {/each}
                 </tbody>
             </table>
        </div>
    </div>

</div>

<!-- MODAL: Select Customer -->
<Modal title="Chọn Khách hàng" isOpen={isCustomerModalOpen} onClose={() => isCustomerModalOpen = false} showConfirm={false}>
    <div class="space-y-2 max-h-[60vh] overflow-y-auto">
        {#each customers as cust}
            <button
                class="w-full text-left p-3 rounded hover:bg-slate-100 border border-slate-100 flex justify-between items-center"
                on:click={() => handleCustomerChangeAndRecalculate(cust.id)}
            >
                <div>
                    <div class="font-bold">{cust.name}</div>
                    <div class="text-xs text-slate-500">{cust.phone || 'No Phone'}</div>
                </div>
                {#if cust.customerType}
                    <span class="badge badge-sm">{cust.customerType}</span>
                {/if}
            </button>
        {/each}
    </div>
</Modal>

<!-- MODAL: Select Product -->
<Modal title="Thêm Sản phẩm" isOpen={isProductModalOpen} onClose={() => isProductModalOpen = false} showConfirm={false}>
    <input
        type="text"
        bind:value={productSearchTerm}
        placeholder="Tìm tên sản phẩm..."
        class="input input-bordered w-full mb-4 sticky top-0"
        autofocus
    />
    <div class="space-y-2 max-h-[60vh] overflow-y-auto pb-10">
        {#each filteredProducts as prod}
            <button
                class="w-full text-left p-3 rounded hover:bg-slate-100 border border-slate-100 flex justify-between items-center"
                on:click={() => addProductToCart(prod)}
            >
                <div>
                    <div class="font-bold">{prod.name}</div>
                    <div class="text-xs {prod.currentStock > 0 ? 'text-green-600' : 'text-red-500'}">
                        Tồn: {prod.currentStock.toLocaleString()}
                    </div>
                </div>
                <div class="font-bold text-primary">{prod.sellingPrice.toLocaleString()} đ</div>
            </button>
        {/each}
        {#if filteredProducts.length === 0}
            <div class="text-center text-slate-400 py-4">Không tìm thấy sản phẩm.</div>
        {/if}
    </div>
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