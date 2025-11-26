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

<!--
    REFACTOR NOTES:
    - This Navbar is now ONLY for Desktop.
    - Removed all mobile-specific logic (hamburger menu, mobile avatar).
    - Simplified styling to be cleaner (no blur, no heavy shadow).
    - The entire component is hidden on mobile (`hidden lg:flex`).
-->
<div class="navbar bg-base-100 border-b border-base-200 sticky top-0 z-40 py-0 min-h-12 hidden lg:flex">
	<div class="navbar-start">
		<a href="/" class="btn btn-ghost normal-case text-lg text-primary font-bold">Bánh Mì Boss</a>
	</div>
	
	<div class="navbar-center">
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
                <ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
                    <li class="menu-title">{$authStore.user.email}</li>
                    <li class="menu-title text-primary font-bold uppercase text-xs">Role: {$authStore.user.role}</li>
                    <li><button on:click={handleLogout}>Đăng xuất</button></li>
                </ul>
            </div>
        {/if}
	</div>
</div>