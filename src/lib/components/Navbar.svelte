<script lang="ts">
	import { authStore } from '$lib/stores/authStore';
	import { auth } from '$lib/firebase';
	import { signOut } from 'firebase/auth';
    import { page } from '$app/stores';

	// Highlight menu đang chọn
	$: activeRoute = $page.url.pathname;

	async function handleLogout() {
		await signOut(auth);
	}
    
    // Loai bỏ logic isGroupActive và masterPaths/transactionPaths
</script>

<div class="navbar bg-white/95 backdrop-blur-sm shadow-sm sticky top-0 z-50 py-0"> 
	<div class="navbar-start">
		<div class="dropdown">
			<div role="button" tabindex="0" class="btn btn-ghost btn-sm lg:hidden">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16" /></svg>
			</div>
			<ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
				<li><a href="/" class="{activeRoute === '/' ? 'active' : ''}">Dashboard</a></li>
				<li><a href="/ingredients" class="{activeRoute.startsWith('/ingredients') ? 'active' : ''}">Nguyên liệu</a></li>
                <li><a href="/products" class="{activeRoute.startsWith('/products') ? 'active' : ''}">Sản phẩm/CT</a></li>
                <li><a href="/partners" class="{activeRoute.startsWith('/partners') ? 'active' : ''}">Đối tác</a></li>
                <li><a href="/assets" class="{activeRoute.startsWith('/assets') ? 'active' : ''}">Tài sản/Công cụ</a></li>
                <li><a href="/imports" class="{activeRoute.startsWith('/imports') ? 'active' : ''}">Nhập hàng</a></li>
                <li><a href="/production" class="{activeRoute.startsWith('/production') ? 'active' : ''}">Sản xuất</a></li>
                <li><a href="/sales" class="{activeRoute.startsWith('/sales') ? 'active' : ''}">Bán hàng</a></li>
                <li><a href="/expenses" class="{activeRoute.startsWith('/expenses') ? 'active' : ''}">Chi phí Khác</a></li>
                <li><a href="/stocktake" class="{activeRoute.startsWith('/stocktake') ? 'active' : ''}">Kiểm kho</a></li>
                <li><a href="/reports" class="{activeRoute.startsWith('/reports') ? 'active' : ''}">Báo cáo</a></li>
                <li><a href="/history" class="{activeRoute.startsWith('/history') ? 'active' : ''}">History</a></li>
			</ul>
		</div>
		<a href="/" class="btn btn-ghost normal-case text-lg text-primary font-bold">Bánh Mì Boss</a>
	</div>
	
	<div class="navbar-center hidden lg:flex">
		<ul class="menu menu-horizontal px-0 text-sm"> 
			<li class="relative"><a href="/" class="{activeRoute === '/' ? 'active' : ''} py-1">Dashboard</a></li>

			<li class="relative"><a href="/ingredients" class="{activeRoute.startsWith('/ingredients') ? 'active' : ''} py-1">Nguyên liệu</a></li>
			<li class="relative"><a href="/products" class="{activeRoute.startsWith('/products') ? 'active' : ''} py-1">Sản phẩm/CT</a></li>
			<li class="relative"><a href="/partners" class="{activeRoute.startsWith('/partners') ? 'active' : ''} py-1">Đối tác</a></li>
			<li class="relative"><a href="/assets" class="{activeRoute.startsWith('/assets') ? 'active' : ''} py-1">Tài sản</a></li>

			<li class="relative"><a href="/imports" class="{activeRoute.startsWith('/imports') ? 'active' : ''} py-1">Nhập hàng</a></li>
			<li class="relative"><a href="/production" class="{activeRoute.startsWith('/production') ? 'active' : ''} py-1">Sản xuất</a></li>
			<li class="relative"><a href="/sales" class="{activeRoute.startsWith('/sales') ? 'active' : ''} py-1">Bán hàng</a></li>
			<li class="relative"><a href="/expenses" class="{activeRoute.startsWith('/expenses') ? 'active' : ''} py-1">Chi phí</a></li>
			
			<li class="relative"><a href="/stocktake" class="{activeRoute.startsWith('/stocktake') ? 'active' : ''} py-1">Kiểm kho</a></li>
			<li class="relative"><a href="/reports" class="{activeRoute.startsWith('/reports') ? 'active' : ''} py-1">Báo cáo</a></li>
			<li class="relative"><a href="/history" class="{activeRoute.startsWith('/history') ? 'active' : ''} py-1">History</a></li>
		</ul>
	</div>
	
	<div class="navbar-end">
        {#if $authStore.user}
            <div class="dropdown dropdown-end">
                <div role="button" tabindex="0" class="btn btn-ghost btn-circle avatar">
                    <div class="w-10 rounded-full">
                        <img src={$authStore.user.photoURL || "https://ui-avatars.com/api/?name=User"} alt="avatar" />
                    </div>
                </div>
                <ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
                    <li class="menu-title">{$authStore.user.email} ({$authStore.user.role})</li>
                    <li><button on:click={handleLogout}>Đăng xuất</button></li>
                </ul>
            </div>
        {/if}
	</div>
</div>