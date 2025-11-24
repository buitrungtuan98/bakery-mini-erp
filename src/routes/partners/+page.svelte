<script lang="ts">
	import { db } from '$lib/firebase';
	import { collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, deleteDoc, where, getDocs } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
	import { authStore } from '$lib/stores/authStore';
    import { logAction } from '$lib/logger';

	// --- Types ---
    interface CustomPrice { productId: string; price: number; }
    interface Product { id: string; name: string; sellingPrice: number; }
    
	interface Partner {
		id: string;
		code: string;       
		name: string;       
        type: 'supplier' | 'customer' | 'manufacturer'; // CẬP NHẬT TYPE
        phone: string;
        address?: string; 
        taxId?: string;     
        customerType?: 'sỉ' | 'lẻ';
        customPrices?: CustomPrice[];
	}

	// --- State ---
	let partners: Partner[] = [];
    let allProducts: Product[] = [];
	let loading = true;
	let isModalOpen = false;
	let isEditing = false;
    let filterType: 'all' | 'supplier' | 'customer' | 'manufacturer' = 'all'; // CẬP NHẬT STATE FILTER

	// Form Data
	let formData = {
		id: '',
		code: '',
		name: '',
		type: 'customer' as 'supplier' | 'customer' | 'manufacturer', // CẬP NHẬT TYPE
		phone: '',
        address: '',
		taxId: '',
        customerType: 'lẻ' as 'sỉ' | 'lẻ',
        customPrices: [] as CustomPrice[] 
	};

	// --- Realtime Subscription ---
	let unsubscribe: () => void;
    let partnerQuery = query(collection(db, 'partners'), orderBy('code'));

    // Reactive statement để thay đổi query khi filterType thay đổi
    $: {
        let q = collection(db, 'partners');
        let conditions = [];
        if (filterType !== 'all') {
            conditions.push(where('type', '==', filterType));
        }
        partnerQuery = query(q, ...conditions, orderBy('code'));
    }

	onMount(async () => {
        const prodSnap = await getDocs(collection(db, 'products'));
        allProducts = prodSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
        
		unsubscribe = onSnapshot(partnerQuery, (snapshot) => {
			partners = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));
			loading = false;
		});
	});

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
	});

	// --- Handlers ---
	function openAddModal() {
		isEditing = false;
		formData = { id: '', code: '', name: '', type: 'manufacturer', phone: '', address: '', taxId: '', customerType: 'lẻ', customPrices: [] }; // Mặc định là Manufacturer
		isModalOpen = true;
	}

	function openEditModal(item: Partner) {
		isEditing = true;
		formData = { 
            id: item.id,
            code: item.code,
            name: item.name,
            type: item.type,
            phone: item.phone,
            address: item.address ?? '', 
            taxId: item.taxId ?? '', 
            customerType: item.customerType ?? 'lẻ',
            customPrices: item.customPrices || [] 
        };
		isModalOpen = true;
	}
    
    function addCustomPrice() {
        if (allProducts.length > 0) {
            formData.customPrices = [...formData.customPrices, { productId: allProducts[0].id, price: 0 }];
        }
    }

    function removeCustomPrice(index: number) {
        formData.customPrices.splice(index, 1);
        formData.customPrices = formData.customPrices; 
    }

	async function handleSubmit() {
        if (!['admin', 'sales', 'manager'].includes($authStore.user?.role || '')) return alert("Bạn không có quyền thực hiện thao tác này.");
        
		try {
            const cleanCustomPrices = formData.customPrices
                .filter(cp => cp.productId && cp.price > 0)
                .reduce((acc, current) => {
                    if (!acc.find((item: CustomPrice) => item.productId === current.productId)) {
                        acc.push(current);
                    }
                    return acc;
                }, [] as CustomPrice[]);

			const dataToSave = {
                code: formData.code.toUpperCase(),
                name: formData.name,
                type: formData.type, // LƯU TYPE MỚI
                phone: formData.phone,
                address: formData.address, 
                taxId: formData.taxId,
                customerType: formData.customerType,
                customPrices: cleanCustomPrices 
            };
            
			if (isEditing) {
				const ref = doc(db, 'partners', formData.id);
				await updateDoc(ref, dataToSave);
                await logAction($authStore.user!, 'UPDATE', 'partners', `Cập nhật đối tác: ${formData.name}`);
			} else {
				await addDoc(collection(db, 'partners'), dataToSave);
                await logAction($authStore.user!, 'CREATE', 'partners', `Thêm mới đối tác: ${formData.name} (${formData.type})`);
			}
			isModalOpen = false;
		} catch (error) {
			alert("Lỗi lưu dữ liệu: " + error);
		}
	}

    async function handleDelete(id: string) {
        if (!['admin', 'sales', 'manager'].includes($authStore.user?.role || '')) return alert("Bạn không có quyền thực hiện thao tác này.");
        if(!confirm("Bạn có chắc muốn xóa đối tượng này?")) return;
        
        try {
            await deleteDoc(doc(db, 'partners', id));
            await logAction($authStore.user!, 'DELETE', 'partners', `Xóa đối tác ID: ${id}`);
        } catch (error) {
            alert("Lỗi xóa: " + error);
        }
    }
</script>

<div class="flex justify-between items-center mb-6">
	<h1 class="text-2xl font-bold">Quản lý Đối tượng (Partners)</h1>
		{#if ['admin', 'sales', 'manager'].includes($authStore.user?.role || '')}
		<button class="btn btn-primary" on:click={openAddModal}>
			+ Thêm Đối tượng
		</button>
	{/if}
</div>

<div class="flex gap-4 mb-4">
    <div class="join">
        <button class="join-item btn {filterType === 'all' ? 'btn-active btn-neutral' : 'btn-ghost'}" on:click={() => filterType = 'all'}>Tất cả</button>
        <button class="join-item btn {filterType === 'supplier' ? 'btn-active btn-neutral' : 'btn-ghost'}" on:click={() => filterType = 'supplier'}>NCC</button>
        <button class="join-item btn {filterType === 'customer' ? 'btn-active btn-neutral' : 'btn-ghost'}" on:click={() => filterType = 'customer'}>Khách hàng</button>
        <button class="join-item btn {filterType === 'manufacturer' ? 'btn-active btn-neutral' : 'btn-ghost'}" on:click={() => filterType = 'manufacturer'}>Nhà SX</button>
    </div>
</div>

<div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
	<table class="table table-zebra w-full">
		<thead>
			<tr>
				<th>Mã/Loại</th>
				<th>Tên Đối tượng</th>
				<th>Liên hệ</th>
                <th>Thông tin Chi tiết</th>
				<th class="text-center">Thao tác</th>
			</tr>
		</thead>
		<tbody>
			{#if loading}
				<tr><td colspan="5" class="text-center">Đang tải...</td></tr>
			{:else if partners.length === 0}
                <tr><td colspan="5" class="text-center text-gray-500">Chưa có dữ liệu</td></tr>
            {:else}
				{#each partners as item}
					<tr class="hover">
						<td>
                            <div class="font-bold">{item.code}</div>
                            <span class="badge badge-sm 
                                {item.type === 'supplier' ? 'badge-info' : ''} 
                                {item.type === 'customer' ? 'badge-success' : ''}
                                {item.type === 'manufacturer' ? 'badge-primary' : ''}
                                text-white">
                                {item.type === 'supplier' ? 'NCC' : item.type === 'customer' ? 'KH' : 'Nhà SX'}
                            </span>
                        </td>
						<td>{item.name}</td>
						<td>
                            <div class="text-sm font-bold">{item.phone}</div>
                            <div class="text-xs text-gray-500 truncate max-w-xs">{item.address || ''}</div>
                        </td>
                        <td>
                            {#if item.type === 'supplier' && item.taxId}
                                MST: {item.taxId}
                            {:else if item.type === 'customer'}
                                Khách: <span class="badge badge-sm badge-outline">{item.customerType}</span>
                                {#if item.customPrices && item.customPrices.length > 0}
                                    <span class="badge badge-sm badge-success ml-1">Có {item.customPrices.length} giá riêng</span>
                                {/if}
                            {:else if item.type === 'manufacturer'}
                                <span class="text-gray-500">Nguồn gốc sản xuất</span>
                            {/if}
                        </td>
                        <td class="text-center">
                            <button class="btn btn-xs btn-ghost text-info" on:click={() => openEditModal(item)}>Sửa</button>
                            <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDelete(item.id)}>Xóa</button>
                        </td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<input type="checkbox" id="partner_modal" class="modal-toggle" bind:checked={isModalOpen} />
<div class="modal" role="dialog">
	<div class="modal-box max-w-2xl">
		<h3 class="font-bold text-lg mb-4">{isEditing ? 'Cập nhật' : 'Thêm mới'} Đối tượng</h3>
		
        <div class="grid grid-cols-2 gap-4">
            <div class="form-control w-full mb-3">
                <label class="label" for="partner-type"><span class="label-text">Loại Đối tượng</span></label>
                <select id="partner-type" bind:value={formData.type} class="select select-bordered w-full">
                    <option value="customer">Khách hàng</option>
                    <option value="supplier">Nhà cung cấp</option>
                    <option value="manufacturer">Nhà Sản xuất</option> </select>
            </div>

            <div class="form-control w-full mb-3">
                <label class="label" for="partner-code"><span class="label-text">Mã hiển thị (VD: KH-001)</span></label>
                <input id="partner-code" type="text" bind:value={formData.code} class="input input-bordered w-full" placeholder="Mã gợi nhớ..." />
            </div>

            <div class="form-control w-full mb-3">
                <label class="label" for="partner-name"><span class="label-text">Tên Đối tượng</span></label>
                <input id="partner-name" type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="Tên công ty/cá nhân" />
            </div>

            <div class="form-control w-full mb-3">
                <label class="label" for="partner-phone"><span class="label-text">Số điện thoại</span></label>
                <input id="partner-phone" type="text" bind:value={formData.phone} class="input input-bordered w-full" />
            </div>
        </div>
        
        <div class="form-control w-full mb-3">
            <label class="label" for="partner-address"><span class="label-text">Địa chỉ</span></label>
            <input id="partner-address" type="text" bind:value={formData.address} class="input input-bordered w-full" placeholder="Địa chỉ chi tiết..." />
        </div>

        {#if formData.type === 'supplier'}
            <div class="form-control w-full mb-3">
                <label class="label" for="partner-tax"><span class="label-text">Mã số thuế (nếu có)</span></label>
                <input id="partner-tax" type="text" bind:value={formData.taxId} class="input input-bordered w-full" />
            </div>
        {:else if formData.type === 'manufacturer'}
             <div class="text-center text-gray-500 my-4">Thông tin bổ sung không cần thiết cho Nhà Sản Xuất.</div>
        {:else}
            <div class="divider mt-4">Giá ưu đãi riêng cho Khách hàng</div>
            
            <div class="form-control w-full mb-3">
                <label class="label" for="partner-cust-type"><span class="label-text">Phân loại Khách</span></label>
                <select id="partner-cust-type" bind:value={formData.customerType} class="select select-bordered w-full">
                    <option value="lẻ">Khách lẻ</option>
                    <option value="sỉ">Khách sỉ</option>
                </select>
            </div>

            <div class="overflow-x-auto border rounded-box p-3">
                <table class="table table-compact w-full">
                    <thead>
                        <tr>
                            <th class="w-1/2">Sản phẩm</th>
                            <th class="w-1/3 text-right">Giá riêng (đ)</th>
                            <th class="w-10"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each formData.customPrices as priceItem, i}
                            <tr>
                                <td>
                                    <select bind:value={priceItem.productId} class="select select-bordered select-sm w-full">
                                        <option value="" disabled selected>-- Chọn SP --</option>
                                        {#each allProducts as prod}
                                            <option value={prod.id}>{prod.name} (Giá mặc định: {prod.sellingPrice?.toLocaleString() || 'N/A'})</option>
                                        {/each}
                                    </select>
                                </td>
                                <td>
                                    <input type="number" bind:value={priceItem.price} min="0" class="input input-bordered input-sm w-full text-right" />
                                </td>
                                <td>
                                    <button class="btn btn-ghost btn-xs text-error" on:click={() => removeCustomPrice(i)}>X</button>
                                </td>
                            </tr>
                        {/each}
                        {#if allProducts.length === 0}
                            <tr><td colspan="3" class="text-center text-gray-500">Vui lòng tạo sản phẩm trước.</td></tr>
                        {/if}
                    </tbody>
                </table>
                <div class="mt-2 text-right">
                    <button class="btn btn-sm btn-ghost" on:click={addCustomPrice} disabled={allProducts.length === 0}>+ Thêm giá ưu đãi</button>
                </div>
            </div>
        {/if}

		<div class="modal-action">
			<button class="btn" on:click={() => isModalOpen = false}>Hủy</button>
			<button class="btn btn-primary" on:click={handleSubmit}>Lưu lại</button>
		</div>
	</div>
</div>