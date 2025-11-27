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
    DESKTOP NAVBAR
    - Minimalist, whitespace-focused.
    - Hidden on mobile (lg:flex).
-->
<div class="navbar bg-white/95 backdrop-blur border-b border-slate-100 sticky top-0 z-40 py-2 min-h-[60px] hidden lg:flex px-6">
	<div class="navbar-start w-auto mr-8">
		<a href="/" class="text-xl font-bold text-primary tracking-tight">Bánh Mì Boss</a>
	</div>
	
	<div class="navbar-center flex-1">
		<ul class="menu menu-horizontal px-0 text-sm font-medium gap-1">
			<li><a href="/" data-sveltekit-preload-data="hover" class="{activeRoute === '/' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Dashboard</a></li>

            {#if canManage}
                <li><a href="/ingredients" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/ingredients') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Nguyên liệu</a></li>
                <li><a href="/products" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/products') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Sản phẩm</a></li>
                <li><a href="/imports" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/imports') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Nhập hàng</a></li>
                <li><a href="/production" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/production') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Sản xuất</a></li>
                <li><a href="/stocktake" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/stocktake') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Kiểm kho</a></li>
            {/if}

            {#if canSell}
                <li><a href="/sales" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/sales') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Bán hàng</a></li>
                <li><a href="/partners" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/partners') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Đối tác</a></li>
            {/if}

            {#if canManage || canSell}
                <li><a href="/reports" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/reports') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Báo cáo</a></li>
            {/if}

            {#if isAdmin}
                 <li><a href="/admin/users" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/admin/users') ? 'bg-red-50 text-red-600' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2 font-semibold">Admin</a></li>
            {/if}
		</ul>
	</div>
	
	<div class="navbar-end hidden lg:flex w-auto">
        {#if $authStore.user}
            <div class="dropdown dropdown-end">
                <div role="button" tabindex="0" class="btn btn-ghost btn-circle avatar ring-2 ring-slate-100">
                    <div class="w-9 rounded-full">
                        <img src={$authStore.user.photoURL || "https://ui-avatars.com/api/?name=User"} alt="avatar" />
                    </div>
                </div>
                <ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow-soft bg-white rounded-xl w-52 border border-slate-100">
                    <li class="px-4 py-2 border-b border-slate-50 mb-2">
                        <span class="font-bold text-slate-800 block truncate">{$authStore.user.email}</span>
                        <span class="text-xs text-slate-400 uppercase">{$authStore.user.role}</span>
                    </li>
                    <li><button on:click={handleLogout} class="text-red-500 hover:bg-red-50">Đăng xuất</button></li>
                </ul>
            </div>
        {/if}
	</div>
</div>