<script lang="ts">
	import { authStore } from '$lib/stores/authStore';
    import { permissionStore } from '$lib/stores/permissionStore';
	import { auth } from '$lib/firebase';
	import { signOut } from 'firebase/auth';
    import { page } from '$app/stores';

	// Highlight menu đang chọn
	$: activeRoute = $page.url.pathname;

    // Check permission
    $: canManage = $permissionStore.userPermissions.has('view_inventory') || $permissionStore.userPermissions.has('manage_imports');
    $: canSell = $permissionStore.userPermissions.has('view_sales');
    $: isAdmin = $permissionStore.userPermissions.has('view_users');

	async function handleLogout() {
		await signOut(auth);
	}
</script>

<div class="navbar bg-white/95 backdrop-blur-sm shadow-sm sticky top-0 z-40 py-0 min-h-12">
	<div class="navbar-start w-full lg:w-1/2 justify-between lg:justify-start">

        <!-- Mobile: Drawer / Menu Trigger (Keep for accessing less used items) -->
		<div class="dropdown lg:hidden">
			<div role="button" tabindex="0" class="btn btn-ghost btn-sm">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16" /></svg>
			</div>
			<ul class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
				<li><a href="/" class="{activeRoute === '/' ? 'active' : ''}">Dashboard</a></li>

                <li class="menu-title">Quản lý</li>
                {#if canManage}
                    <li><a href="/ingredients" class="{activeRoute.startsWith('/ingredients') ? 'active' : ''}">Nguyên liệu</a></li>
                    <li><a href="/imports" class="{activeRoute.startsWith('/imports') ? 'active' : ''}">Nhập hàng</a></li>
                {/if}

                {#if canSell}
                    <li><a href="/partners" class="{activeRoute.startsWith('/partners') ? 'active' : ''}">Đối tác</a></li>
                {/if}

                {#if canManage || canSell}
                    <li><a href="/reports" class="{activeRoute.startsWith('/reports') ? 'active' : ''}">Báo cáo</a></li>
                {/if}

                {#if isAdmin}
                     <li class="menu-title">Admin</li>
                     <li><a href="/admin/users" class="{activeRoute.startsWith('/admin/users') ? 'active' : ''} text-secondary">Quản lý User</a></li>
                     <li><a href="/admin/roles" class="{activeRoute.startsWith('/admin/roles') ? 'active' : ''} text-secondary">Phân quyền</a></li>
                     <li><a href="/history" class="{activeRoute.startsWith('/history') ? 'active' : ''}">Lịch sử HT</a></li>
                {/if}
			</ul>
		</div>

		<a href="/" class="btn btn-ghost normal-case text-lg text-primary font-bold">Bánh Mì Boss</a>

        <!-- Mobile: Profile Avatar (Right aligned on mobile) -->
         <div class="dropdown dropdown-end lg:hidden">
            <div role="button" tabindex="0" class="btn btn-ghost btn-circle avatar btn-sm">
                <div class="w-8 rounded-full">
                    <img src={$authStore.user?.photoURL || "https://ui-avatars.com/api/?name=User"} alt="avatar" />
                </div>
            </div>
            <ul class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
                <li class="menu-title">{$authStore.user?.email}</li>
                <li><button on:click={handleLogout}>Đăng xuất</button></li>
            </ul>
        </div>
	</div>
	
	<div class="navbar-center hidden lg:flex">
		<ul class="menu menu-horizontal px-0 text-sm"> 
			<li class="relative"><a href="/" class="{activeRoute === '/' ? 'active' : ''} py-1">Dashboard</a></li>

            {#if canManage}
                <li class="relative"><a href="/ingredients" class="{activeRoute.startsWith('/ingredients') ? 'active' : ''} py-1">Nguyên liệu</a></li>
                <li class="relative"><a href="/products" class="{activeRoute.startsWith('/products') ? 'active' : ''} py-1">Sản phẩm/CT</a></li>
                <li class="relative"><a href="/imports" class="{activeRoute.startsWith('/imports') ? 'active' : ''} py-1">Nhập hàng</a></li>
                <li class="relative"><a href="/production" class="{activeRoute.startsWith('/production') ? 'active' : ''} py-1">Sản xuất</a></li>
                <li class="relative"><a href="/stocktake" class="{activeRoute.startsWith('/stocktake') ? 'active' : ''} py-1">Kiểm kho</a></li>
            {/if}

            {#if canSell}
                <li class="relative"><a href="/sales" class="{activeRoute.startsWith('/sales') ? 'active' : ''} py-1">Bán hàng</a></li>
                <li class="relative"><a href="/partners" class="{activeRoute.startsWith('/partners') ? 'active' : ''} py-1">Đối tác</a></li>
            {/if}

            {#if canManage || canSell}
                <li class="relative"><a href="/reports" class="{activeRoute.startsWith('/reports') ? 'active' : ''} py-1">Báo cáo</a></li>
            {/if}

            {#if isAdmin}
                 <li class="relative"><a href="/admin/users" class="{activeRoute.startsWith('/admin/users') ? 'active' : ''} py-1 text-secondary font-bold">Quản lý User</a></li>
                 <li class="relative"><a href="/history" class="{activeRoute.startsWith('/history') ? 'active' : ''} py-1">Lịch sử HT</a></li>
            {/if}
		</ul>
	</div>
	
	<div class="navbar-end hidden lg:flex">
        {#if $authStore.user}
            <div class="dropdown dropdown-end">
                <div role="button" tabindex="0" class="btn btn-ghost btn-circle avatar">
                    <div class="w-10 rounded-full">
                        <img src={$authStore.user.photoURL || "https://ui-avatars.com/api/?name=User"} alt="avatar" />
                    </div>
                </div>
                <ul class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
                    <li class="menu-title">{$authStore.user.email}</li>
                    <li class="menu-title text-primary font-bold uppercase text-xs">Role: {$authStore.user.role}</li>
                    <li><button on:click={handleLogout}>Đăng xuất</button></li>
                </ul>
            </div>
        {/if}
	</div>
</div>