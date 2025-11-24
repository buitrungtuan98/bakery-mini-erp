<script lang="ts">
	import { db } from '$lib/firebase'; 
	import { authStore } from '$lib/stores/authStore';
	import { collection, getDocs, query, orderBy, doc, runTransaction, serverTimestamp, where, onSnapshot, limit } from 'firebase/firestore';
	import { onMount, onDestroy } from 'svelte';
	import { logAction } from '$lib/logger'; 

	// --- Types ---
	interface Partner {
		id: string; name: string; type: 'supplier' | 'customer'; customerType?: 'sỉ' | 'lẻ';
		phone?: string; defaultAddress?: string; // Địa chỉ mặc định từ Partner
        address?: string; // Fallback nếu tên trường cũ là address
		customPrices?: { productId: string; price: number; }[];
	}

	interface Product {
		id: string; name: string; sellingPrice: number; theoreticalCost: number;
		currentStock: number;
	}

	interface OrderItem {
		productId: string; quantity: number; unitPrice: number; lineTotal: number;
		lineCOGS: number;  initialPrice: number; 
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
    
    // Quản lý Subscription để tránh memory leak
    let unsubscribeProducts: () => void;
    let unsubscribeOrders: () => void;

	// Dữ liệu Phiếu bán hàng
	let selectedCustomerId = '';
	let customer: Partner | undefined;
	let orderItems: OrderItem[] = [{ productId: '', quantity: 0, unitPrice: 0, lineTotal: 0, lineCOGS: 0, initialPrice: 0 }];
	let shippingFee = 0;
	let shippingAddress = '';
    let shippingPhone = '';
	
	// Reactive Helper: Tìm khách hàng hiện tại
	$: customer = customers.find(c => c.id === selectedCustomerId);
	
	// Hàm tính giá đơn vị và tổng tiền của item (Ưu tiên: Manual > Custom > Default)
	function updatePricing(item: OrderItem, products: Product[], currentCustomer: Partner | undefined, isManualUpdate: boolean): OrderItem {
		const product = products.find(p => p.id === item.productId);
		if (!product) return item;

		// 1. Tìm giá ưu tiên (Custom Price)
		const customPriceEntry = currentCustomer?.customPrices?.find(cp => cp.productId === item.productId);
		let basePrice = customPriceEntry?.price || product.sellingPrice; 
		
		// 2. Quyết định giá cuối cùng
		let finalUnitPrice;
		// Nếu người dùng tự sửa giá, hoặc item mới tạo, hoặc giá đang bằng giá gốc -> Cập nhật theo logic ưu tiên
        // Nếu người dùng đã sửa giá khác giá gốc -> Giữ nguyên giá người dùng nhập
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
            initialPrice: basePrice // Lưu mốc để so sánh
        };
	}
	
	// Tính tổng (Sử dụng || 0 để tránh lỗi undefined)
	$: totalRevenue = orderItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0) + (shippingFee || 0);
	$: totalCOGS = orderItems.reduce((sum, item) => sum + (item.lineCOGS || 0), 0);
	$: totalProfit = totalRevenue - totalCOGS;


    // --- LOGIC XỬ LÝ KHI CHỌN KHÁCH HÀNG (QUAN TRỌNG: NGĂN LOOP) ---
	function handleCustomerChangeAndRecalculate() {
		// 1. Cập nhật biến customer
		customer = customers.find(c => c.id === selectedCustomerId);

        // 2. Auto-fill thông tin (Cho phép sửa sau đó)
        if (customer) {
            shippingAddress = customer.address || customer.defaultAddress || '';
            shippingPhone = customer.phone || '';
        } else {
            shippingAddress = '';
            shippingPhone = '';
        }

		// 3. Chạy logic tính lại giá cho toàn bộ item trong giỏ
		if (customer && products.length > 0) {
			orderItems = orderItems.map(item => updatePricing(item, products, customer, false));
		}
	}


	// --- LOGIC LAZY FETCHING VÀ REALTIME LISTENER ---
	async function fetchData() {
		if (isDataFetched) return;
		loading = true;
		isDataFetched = true;
		
		try {
			// 1. Load Khách hàng (Dùng getDocs lần đầu vì ít thay đổi)
			const custSnap = await getDocs(query(collection(db, 'partners'), where('type', '==', 'customer')));
			customers = custSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));

			// 2. Load Sản phẩm (DÙNG ON SNAPSHOT CHO REALTIME STOCK)
            // Quan trọng: Để khi bán xong, tồn kho update ngay lập tức
			const q = query(collection(db, 'products'), orderBy('name'));
			unsubscribeProducts = onSnapshot(q, (snapshot) => {
                products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
                
                // Nếu đang có item trong giỏ, update lại thông tin (ví dụ tồn kho hiển thị)
                if (products.length > 0 && customer) {
                     // Không cần map lại giá để tránh mất giá manual, chỉ cần re-render
                     products = products; 
                }
            });
            
            // 3. Load Lịch sử Đơn hàng (Realtime)
            const orderQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(20));
            unsubscribeOrders = onSnapshot(orderQuery, (snapshot) => {
                ordersHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
            });

		} catch (error) {
			console.error("Lỗi Fetch Master Data:", error);
			errorMsg = "Lỗi tải dữ liệu. Vui lòng kiểm tra quyền truy cập.";
		} finally {
			loading = false;
		}
	}

	// Kích hoạt fetchData khi người dùng đã xác thực
	$: if ($authStore.user && !isDataFetched) {
		fetchData();
	}
    
    // Dọn dẹp khi thoát trang
    onDestroy(() => {
        if (unsubscribeProducts) unsubscribeProducts();
        if (unsubscribeOrders) unsubscribeOrders();
    });

	// --- UI Handlers ---
    // Khi sửa giá/số lượng thủ công
    function handleLineUpdate(index: number, isPriceChange: boolean = false) {
		orderItems[index] = updatePricing(orderItems[index], products, customer, isPriceChange);
		orderItems = orderItems;
	}
    
    function addItem() {
		const newEntry = { productId: '', quantity: 0, unitPrice: 0, lineTotal: 0, lineCOGS: 0, initialPrice: 0 };
		orderItems = [...orderItems, newEntry];
	}

	function removeItem(index: number) {
		if(orderItems.length === 1) return;
		orderItems = orderItems.filter((_, i) => i !== index);
	}

	// --- CANCEL/REVERSE LOGIC (HỦY ĐƠN) ---
    async function handleCancelOrder(order: Order) {
        if ($authStore.user?.role !== 'admin') return alert("Chỉ Admin mới được hủy đơn.");
        
        const orderDate = order.createdAt.toDate().toDateString();
        const todayDate = new Date().toDateString();
        
        if (orderDate !== todayDate) return alert("LỖI: Chỉ có thể hủy đơn hàng trong ngày đã tạo.");
        if (order.status === 'canceled') return alert("Đơn hàng này đã bị hủy.");
        
        if (!confirm(`Xác nhận hủy đơn hàng ${order.id.substring(0, 8)}? Kho sẽ được cộng lại.`)) return;
        
        processing = true;

        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, 'orders', order.id);
                
                // 1. ĐẢO NGƯỢC KHO (Cộng lại sản phẩm)
                for (const item of order.items) {
                    const productRef = doc(db, 'products', item.productId);
                    const productSnap = await transaction.get(productRef);
                    if (!productSnap.exists()) continue; // Bỏ qua nếu SP đã bị xóa
                    
                    const currentStock = Number(productSnap.data()?.currentStock || 0);
                    const newStock = currentStock + item.quantity;
                    
                    transaction.update(productRef, {
                        currentStock: newStock,
                    });
                }
                
                // 2. CẬP NHẬT TRẠNG THÁI
                transaction.update(orderRef, {
                    status: 'canceled',
                    canceledBy: $authStore.user?.email,
                    canceledAt: serverTimestamp()
                });
            });
            
            await logAction($authStore.user!, 'UPDATE', 'orders', `Hủy đơn hàng ID: ${order.id.substring(0, 8)}, DT: ${order.totalRevenue.toLocaleString()} đ`);

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
				
				// PHASE 1: ALL READS (Đọc dữ liệu trước)
				const productRefs = validItems.map(item => doc(db, 'products', item.productId));
				const productSnaps = await Promise.all(productRefs.map(ref => transaction.get(ref)));

				// PHASE 2: ALL WRITES (Ghi dữ liệu sau)
				productSnaps.forEach((snap, index) => {
					const item = validItems[index];
                    const productRef = productRefs[index];
                    
					if (!snap.exists()) {
						throw new Error(`Lỗi: Sản phẩm ID ${item.productId} không tồn tại.`);
					}
					
					const currentStock = Number(snap.data()?.currentStock || 0);
					const newStock = currentStock - item.quantity;

					if (newStock < 0) {
						const prodName = products.find(p => p.id === item.productId)?.name;
						throw new Error(`Lỗi: Tồn kho thành phẩm (${prodName}) không đủ!`);
					}

					// Trừ kho
					transaction.update(productRef, {
						currentStock: newStock,
					});
				});

				// Tạo đơn hàng
				const orderRef = doc(collection(db, 'orders'));
				const customerSnapshot = customers.find(c => c.id === selectedCustomerId);
				
				transaction.set(orderRef, {
					customerId: selectedCustomerId,
					customerInfo: {
						name: customerSnapshot?.name,
						type: customerSnapshot?.customerType,
						phone: shippingPhone // Lưu SĐT đã chỉnh sửa
					},
					shippingAddress: shippingAddress, // Lưu địa chỉ đã chỉnh sửa
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
				
				// Audit Log
				await logAction($authStore.user!, 'TRANSACTION', 'orders', `Tạo đơn hàng ${orderRef.id.substring(0, 8).toUpperCase()}, Khách: ${customerSnapshot?.name}, DT: ${totalRevenue.toLocaleString()} đ`);

			});

			alert(`Tạo đơn hàng thành công!`);
			
			// Reset Form
			selectedCustomerId = '';
			orderItems = [{ productId: '', quantity: 0, unitPrice: 0, lineTotal: 0, lineCOGS: 0, initialPrice: 0 }];
			shippingFee = 0;
			shippingAddress = '';
            shippingPhone = '';

		} catch (error: any) {
			console.error(error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			alert('Lỗi khi tạo đơn hàng: ' + errorMessage);
		} finally {
			processing = false;
		}
	}
</script>

<div class="max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold text-primary mb-6">Phân hệ Bán Hàng (Outbound)</h1>

    <div class="card bg-base-100 shadow-xl p-6 mb-8">
        <h2 class="card-title text-xl border-b pb-2 mb-4">Tạo Phiếu Bán Hàng Mới</h2>
        
        {#if errorMsg}
            <div role="alert" class="alert alert-error mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>{errorMsg}</span>
            </div>
        {/if}

        <div class="grid grid-cols-2 gap-4 mb-3">
            <div class="form-control">
                <label class="label" for="customer-select"><span class="label-text">Chọn Khách hàng</span></label>
                <select 
                    bind:value={selectedCustomerId} 
                    on:change={handleCustomerChangeAndRecalculate}
                    id="customer-select"
                    class="select select-bordered w-full"
                    disabled={loading}
                >
                    <option value="" disabled selected>{loading ? 'Đang tải...' : '-- Chọn Khách hàng --'}</option>
                    {#each customers as cust}
                        <option value={cust.id}>{cust.name} ({cust.customerType})</option>
                    {/each}
                </select>
                {#if customer && customer.customPrices?.length}
                    <label class="label"><span class="label-text-alt text-success">Khách này có {customer.customPrices.length} giá ưu đãi riêng.</span></label>
                {/if}
            </div>

            <div class="form-control">
                <label class="label" for="shipping-fee"><span class="label-text">Phí Giao hàng (Shipping Fee)</span></label>
                <input 
                    type="number" 
                    bind:value={shippingFee} 
                    min="0" 
                    id="shipping-fee"
                    class="input input-bordered w-full text-right" 
                    placeholder="0" 
                />
            </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4 mb-6">
            <div class="form-control">
                <label class="label" for="shipping-phone"><span class="label-text">Số điện thoại (Liên hệ)</span></label>
                <input type="text" bind:value={shippingPhone} id="shipping-phone" class="input input-bordered w-full" placeholder="SĐT người nhận" />
            </div>
            <div class="form-control">
                <label class="label" for="shipping-address"><span class="label-text">Địa chỉ Giao hàng</span></label>
                <input type="text" bind:value={shippingAddress} id="shipping-address" class="input input-bordered w-full" placeholder="Địa chỉ cụ thể" />
            </div>
        </div>

        <div class="divider">Chi tiết Sản phẩm bán ra</div>

        <div class="overflow-x-auto">
            <table class="table table-compact w-full">
                <thead>
                    <tr>
                        <th class="w-1/3">Sản phẩm</th>
                        <th class="w-1/6 text-right">Giá bán</th>
                        <th class="w-1/6 text-right">Số lượng</th>
                        <th class="w-1/4 text-right">Tổng tiền</th>
                        <th class="w-10"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each orderItems as item, i}
                        <tr class="hover">
                            <td>
                                <select 
                                    bind:value={item.productId} 
                                    on:change={() => handleLineUpdate(i)}
                                    class="select select-bordered select-sm w-full"
                                >
                                    <option value="" disabled selected>-- Chọn SP --</option>
                                    {#each products as prod}
                                        <option value={prod.id}>
                                            {prod.name} (Tồn: {prod.currentStock?.toLocaleString() || '0'})
                                        </option>
                                    {/each}
                                </select>
                            </td>
                            <td class="text-right">
                                <input 
                                    type="number" 
                                    bind:value={item.unitPrice} 
                                    on:input={() => handleLineUpdate(i, true)}
                                    class="input input-bordered input-sm w-20 text-right"
                                    placeholder={item.initialPrice?.toLocaleString()}
                                />
                            </td>
                            <td class="text-right">
                                <input 
                                    type="number" 
                                    bind:value={item.quantity} 
                                    min="0" 
                                    on:input={() => handleLineUpdate(i)}
                                    class="input input-bordered input-sm w-20 text-right"
                                />
                            </td>
                            <td class="text-right font-bold text-success">
                                {item.lineTotal?.toLocaleString() || '0'} đ
                            </td>
                            <td class="text-center">
                                <button class="btn btn-ghost btn-xs text-error" on:click={() => removeItem(i)}>X</button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        
        <div class="flex justify-between items-center mt-4">
            <button class="btn btn-sm btn-ghost gap-2" on:click={addItem}>
                + Thêm dòng sản phẩm
            </button>
        </div>

        <div class="divider">Tóm tắt Đơn hàng</div>
        
        <div class="text-right">
            <div class="mb-1">Tổng tiền hàng: <span class="font-semibold text-success">{(totalRevenue - (shippingFee || 0))?.toLocaleString() || '0'} đ</span></div>
            <div class="mb-1">Phí giao hàng: <span class="font-semibold text-gray-500">{shippingFee?.toLocaleString() || '0'} đ</span></div>
            <div class="text-2xl font-bold text-primary border-t pt-2 mt-2">
                Doanh thu: {totalRevenue?.toLocaleString() || '0'} đ
            </div>
            <div class="text-sm text-warning">Giá vốn (COGS): {totalCOGS?.toLocaleString() || '0'} đ</div>
            <div class="text-lg font-bold text-accent">Lợi nhuận Gộp: {totalProfit?.toLocaleString() || '0'} đ</div>
        </div>

        <div class="card-actions justify-end mt-6">
            <button class="btn btn-primary px-8" on:click={handleSale} disabled={processing || totalRevenue === 0}>
                {#if processing}
                    <span class="loading loading-spinner"></span>
                {:else}
                    Tạo Đơn Hàng & Trừ Kho
                {/if}
            </button>
        </div>
    </div>
    
    <div class="mt-10">
        <h2 class="text-xl font-bold mb-4">Lịch sử Đơn hàng Gần nhất</h2>
        <div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
            <table class="table table-compact table-zebra w-full">
                <thead>
                    <tr>
                        <th class="w-1/12">Ngày Đơn</th>
                        <th class="w-1/6">Khách hàng</th>
                        <th class="w-1/4">Địa chỉ / Chi tiết</th>
                        <th class="text-right">Doanh thu</th>
                        <th>Trạng thái</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    {#if loading}
                        <tr><td colspan="6" class="text-center">Đang tải lịch sử...</td></tr>
                    {:else if ordersHistory.length === 0}
                        <tr><td colspan="6" class="text-center text-gray-500">Chưa có đơn hàng nào được ghi nhận.</td></tr>
                    {:else}
                        {#each ordersHistory as order}
                            <tr class="{order.status === 'canceled' ? 'opacity-50 line-through' : ''}">
                                <td>{order.createdAt?.toDate().toLocaleDateString('vi-VN')}</td>
                                <td>{order.customerInfo.name}</td>
                                <td>
                                    <div class="text-xs truncate">{order.shippingAddress || 'N/A'}</div>
                                    <div class="text-[10px] text-gray-500">
                                        Tel: {order.customerInfo.phone || 'N/A'} | ({order.items.length} SP)
                                    </div>
                                </td>
                                <td class="text-right font-mono text-primary">{order.totalRevenue.toLocaleString()} đ</td>
                                <td>
                                    <span class="badge badge-sm {order.status === 'canceled' ? 'badge-error' : 'badge-success'}">
                                        {order.status === 'canceled' ? 'Đã hủy' : 'Hoàn thành'}
                                    </span>
                                </td>
                                <td>
                                    {#if order.status === 'completed' && order.createdAt.toDate().toDateString() === new Date().toDateString()}
                                        <button 
                                            class="btn btn-xs btn-warning text-white" 
                                            on:click={() => handleCancelOrder(order)}
                                        >
                                            Hủy đơn (Trong ngày)
                                        </button>
                                    {:else}
                                        <span class="text-xs text-gray-400">--</span>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    {/if}
                </tbody>
            </table>
        </div>
    </div>
</div>