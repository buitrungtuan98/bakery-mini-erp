<script lang="ts">
	import { db } from '$lib/firebase';
	import { collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, deleteDoc, serverTimestamp, getDocs, where } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';
	import { authStore } from '$lib/stores/authStore';
    import { logAction } from '$lib/logger';

	// --- NEW TYPE ---
    interface Partner { 
        id: string; 
        name: string; 
    }

	// --- Types ---
	interface Ingredient {
		id: string;
		code: string;       
		name: string;       
		baseUnit: string;   
		currentStock: number; 
		minStock: number;   
		avgCost: number;    
        createdAt: { toDate: () => Date };
        manufacturerId: string; // LƯU ID
        manufacturerName: string; // LƯU SNAPSHOT TÊN
	}

	// --- State ---
	let ingredients: Ingredient[] = [];
    let manufacturers: Partner[] = []; // TRẠNG THÁI MỚI
	let loading = true;
	let isModalOpen = false;
	let isEditing = false;
    
    // TRẠNG THÁI CHO FILTER VÀ PAGINATION
    let searchTerm = '';
    let itemsPerPage = 10;
    let currentPage = 1;
    let startDate: string = '';
    let endDate: string = '';
    
    let filteredAndSorted: Ingredient[] = [];
    let paginatedIngredients: Ingredient[] = [];
    let totalPages = 0;


	// Form Data
	let formData = {
		id: '', code: '', name: '', baseUnit: 'g', minStock: 0,
        manufacturerId: '', // LƯU ID
        manufacturerName: ''
	};

	// --- Realtime Subscription ---
	let unsubscribeIngredients: () => void;
    let unsubscribeManufacturers: () => void; // UN-SUBSCRIBE MỚI

	onMount(async () => {
        
        // 1. Load Manufacturers
        const manufacturerQuery = query(collection(db, 'partners'), where('type', '==', 'manufacturer'), orderBy('name'));
        unsubscribeManufacturers = onSnapshot(manufacturerQuery, (snapshot) => {
            manufacturers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));
        });
        
        // 2. Load Ingredients (Real-time)
		const q = query(collection(db, 'ingredients'), orderBy('code'));
		unsubscribeIngredients = onSnapshot(q, (snapshot) => {
			ingredients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ingredient));
			loading = false;
		});
	});

	onDestroy(() => { 
        if (unsubscribeIngredients) unsubscribeIngredients();
        if (unsubscribeManufacturers) unsubscribeManufacturers();
    });
    
    // --- LOGIC REACTIVE FILTERING, SORTING, PAGINATION (Giữ nguyên) ---
    
    function processIngredients(data: Ingredient[], term: string, start: string, end: string): Ingredient[] {
        let filtered = data;
        
        // --- 1. Lọc theo TÌM KIẾM ---
        if (term) {
            const lowerTerm = term.toLowerCase();
            filtered = filtered.filter(item => 
                item.name.toLowerCase().includes(lowerTerm) || 
                item.code.toLowerCase().includes(lowerTerm) ||
                item.manufacturerName.toLowerCase().includes(lowerTerm) // Tìm kiếm theo tên NSX
            );
        }

        // --- 2. Lọc theo NGÀY (Date Range) ---
        if (start || end) {
            const startTimestamp = start ? new Date(start).getTime() : 0;
            const endTimestamp = end ? new Date(end).setHours(23, 59, 59, 999) : Infinity;
            
            filtered = filtered.filter(item => {
                const itemDate = item.createdAt?.toDate().getTime();
                return itemDate >= startTimestamp && itemDate <= endTimestamp;
            });
        }
        
        // --- 3. Sắp xếp ---
        filtered.sort((a, b) => b.code.localeCompare(a.code));

        return filtered;
    }

    $: {
        currentPage = 1; 
        filteredAndSorted = processIngredients(ingredients, searchTerm, startDate, endDate);
    }
    
    $: {
        totalPages = Math.ceil(filteredAndSorted.length / itemsPerPage);
        const start = (currentPage - 1) * itemsPerPage;
        paginatedIngredients = filteredAndSorted.slice(start, start + itemsPerPage);
    }


	// --- Handlers ---
	function openAddModal() {
		isEditing = false;
		formData = { id: '', code: '', name: '', baseUnit: 'g', minStock: 100, manufacturerId: '', manufacturerName: '' };
		isModalOpen = true;
	}

	function openEditModal(item: Ingredient) {
		isEditing = true;
		formData = { 
            id: item.id, code: item.code, name: item.name, baseUnit: item.baseUnit, minStock: item.minStock, 
            manufacturerId: item.manufacturerId,
            manufacturerName: item.manufacturerName
        };
		isModalOpen = true;
	}

	async function handleSubmit() {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) return alert("Bạn không có quyền thực hiện thao tác này.");
        
        // Tìm thông tin Nhà sản xuất
        const manufacturerSnapshot = manufacturers.find(m => m.id === formData.manufacturerId);
        
		try {
            const baseData = {
                code: formData.code.toUpperCase(),
                name: formData.name,
                baseUnit: formData.baseUnit,
                minStock: Number(formData.minStock),
                manufacturerId: formData.manufacturerId, // LƯU ID
                manufacturerName: manufacturerSnapshot?.name || 'Chưa rõ' // LƯU SNAPSHOT TÊN
            };

			if (isEditing) {
				const ref = doc(db, 'ingredients', formData.id);
				await updateDoc(ref, baseData);
                await logAction($authStore.user!, 'UPDATE', 'ingredients', `Cập nhật NVL: ${formData.name}`);
			} else {
				await addDoc(collection(db, 'ingredients'), {
                    ...baseData,
					currentStock: 0, 
					avgCost: 0,
                    createdAt: serverTimestamp() 
				});
                await logAction($authStore.user!, 'CREATE', 'ingredients', `Thêm mới NVL: ${formData.name}`);
			}
			isModalOpen = false;
		} catch (error) { alert("Lỗi lưu dữ liệu: " + error); }
	}

    async function handleDelete(id: string) {
        if (!['admin', 'manager'].includes($authStore.user?.role || '')) return alert("Bạn không có quyền xóa.");
        if(!confirm("Bạn có chắc muốn xóa?")) return;
        
        try {
            await deleteDoc(doc(db, 'ingredients', id));
            await logAction($authStore.user!, 'DELETE', 'ingredients', `Xóa NVL ID: ${id}`);
        } catch (error) { alert("Lỗi xóa: " + error); }
    }
</script>

<div class="max-w-7xl mx-auto">
	<div class="flex justify-between items-center mb-6">
		<h1 class="text-2xl font-bold">Danh sách Nguyên liệu</h1>
		{#if ['admin', 'manager'].includes($authStore.user?.role || '')}
			<button class="btn btn-primary" on:click={openAddModal}>
				+ Thêm Nguyên liệu
			</button>
		{/if}
	</div>
    
    <div class="card bg-base-100 shadow-sm p-4 mb-6">
        <div class="grid grid-cols-4 gap-4 items-end">
            <div class="form-control col-span-2">
                <label class="label"><span class="label-text">Tìm kiếm (Mã/Tên/Nhà SX)</span></label>
                <input type="text" bind:value={searchTerm} class="input input-bordered w-full" placeholder="Nhập từ khóa..." />
            </div>
            
            <div class="form-control">
                <label class="label"><span class="label-text">Ngày tạo (Từ)</span></label>
                <input type="date" bind:value={startDate} class="input input-bordered w-full" />
            </div>

            <div class="form-control">
                <label class="label"><span class="label-text">Ngày tạo (Đến)</span></label>
                <input type="date" bind:value={endDate} class="input input-bordered w-full" />
            </div>
        </div>
    </div>


	<div class="overflow-x-auto bg-base-100 shadow-xl rounded-box">
		<table class="table table-zebra w-full">
			<thead>
				<tr>
					<th>Mã NVL</th>
					<th>Tên Nguyên liệu</th>
                    <th>Nhà Sản xuất</th>
					<th>Đơn vị (Gốc)</th>
					<th class="text-right">Tồn kho</th>
					{#if $authStore.user?.role === 'admin'}
						<th class="text-right">Giá vốn TB</th>
					{/if}
                    <th>Ngày tạo</th>
					<th class="text-center">Thao tác</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="7" class="text-center">Đang tải...</td></tr>
				{:else if paginatedIngredients.length === 0}
                    <tr><td colspan="7" class="text-center text-gray-500">Không tìm thấy dữ liệu. ({ingredients.length} mục)</td></tr>
                {:else}
					{#each paginatedIngredients as item}
						<tr class="hover">
							<td class="font-bold">{item.code}</td>
							<td>
                                {item.name}
                                {#if item.currentStock < item.minStock}
                                    <span class="badge badge-error gap-2 ml-2 text-xs text-white">Sắp hết</span>
                                {/if}
                            </td>
                            <td>{item.manufacturerName}</td> <td><span class="badge badge-ghost">{item.baseUnit}</span></td>
							
							<td class="text-right font-mono {item.currentStock < item.minStock ? 'text-error font-bold' : ''}">
								{item.currentStock?.toLocaleString() || '0'} {item.baseUnit}
							</td>
							
							{#if $authStore.user?.role === 'admin'}
								<td class="text-right font-mono text-success">
									{item.avgCost?.toLocaleString() || '0'} đ
								</td>
							{/if}
                            <td>{item.createdAt?.toDate().toLocaleDateString('vi-VN') || 'N/A'}</td>
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
    
    {#if totalPages > 1}
        <div class="flex justify-end mt-4">
            <div class="btn-group">
                <button class="btn btn-sm" on:click={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1}>«</button>
                <button class="btn btn-sm">Trang {currentPage} / {totalPages}</button>
                <button class="btn btn-sm" on:click={() => currentPage = Math.min(totalPages, currentPage + 1)} disabled={currentPage === totalPages}>»</button>
            </div>
        </div>
    {/if}
</div>

<input type="checkbox" id="my_modal_6" class="modal-toggle" bind:checked={isModalOpen} />
<div class="modal" role="dialog">
	<div class="modal-box">
		<h3 class="font-bold text-lg mb-4">{isEditing ? 'Cập nhật' : 'Thêm mới'} Nguyên liệu</h3>
		
        <div class="form-control w-full mb-3">
			<label class="label" for="ing-code"><span class="label-text">Mã hiển thị (VD: TRUNG-GA)</span></label>
			<input id="ing-code" type="text" bind:value={formData.code} class="input input-bordered w-full" placeholder="Mã gợi nhớ..." />
		</div>

		<div class="form-control w-full mb-3">
			<label class="label" for="ing-name"><span class="label-text">Tên Nguyên liệu</span></label>
			<input id="ing-name" type="text" bind:value={formData.name} class="input input-bordered w-full" placeholder="VD: Trứng gà công nghiệp" />
		</div>
        
        <div class="form-control w-full mb-3">
			<label class="label" for="ing-manufacturer"><span class="label-text">Nhà Sản xuất</span></label>
            <select id="ing-manufacturer" bind:value={formData.manufacturerId} class="select select-bordered w-full">
                <option value="" disabled selected>-- Chọn Nhà sản xuất --</option>
                {#each manufacturers as mfg}
                    <option value={mfg.id}>{mfg.name}</option>
                {/each}
            </select>
		</div>

		<div class="flex gap-4 mb-3">
			<div class="form-control w-1/2">
				<label class="label" for="ing-unit"><span class="label-text">Đơn vị gốc (Base Unit)</span></label>
				<select id="ing-unit" bind:value={formData.baseUnit} class="select select-bordered w-full" disabled={isEditing}>
					<option value="g">Gram (g)</option>
					<option value="ml">Mililit (ml)</option>
					<option value="cai">Cái / Quả</option>
				</select>
                <label class="label"><span class="label-text-alt text-warning">Đơn vị nhỏ nhất dùng để tính công thức</span></label>
			</div>
			<div class="form-control w-1/2">
				<label class="label" for="ing-min"><span class="label-text">Cảnh báo khi tồn dưới</span></label>
				<input id="ing-min" type="number" bind:value={formData.minStock} class="input input-bordered w-full" />
			</div>
		</div>

		<div class="modal-action">
			<button class="btn" on:click={() => isModalOpen = false}>Hủy</button>
			<button class="btn btn-primary" on:click={handleSubmit}>Lưu lại</button>
		</div>
	</div>
</div>