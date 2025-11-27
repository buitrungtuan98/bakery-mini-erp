<script lang="ts">
	import { authStore } from '$lib/stores/authStore';
    import { permissionStore } from '$lib/stores/permissionStore';
	import { auth } from '$lib/firebase';
	import { signOut } from 'firebase/auth';
    import { page } from '$app/stores';

	// Highlight menu đang chọn
	$: activeRoute = $page.url.pathname;

    // Check permission
    $: canSell = $permissionStore.userPermissions.has('view_sales');
    $: canProduce = $permissionStore.userPermissions.has('view_production');
    $: canManageInventory = $permissionStore.userPermissions.has('view_inventory') || $permissionStore.userPermissions.has('manage_imports');
    $: canViewFinance = $permissionStore.userPermissions.has('view_finance') || $permissionStore.userPermissions.has('manage_expenses');
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

            {#if canSell}
                <li><a href="/sales" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/sales') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Bán hàng</a></li>
            {/if}

            {#if canProduce}
                <li><a href="/production" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/production') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Sản xuất</a></li>
            {/if}

            {#if canManageInventory}
                <li><a href="/imports" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/imports') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Nhập hàng</a></li>
                <li><a href="/stocktake" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/stocktake') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Kiểm kho</a></li>
            {/if}

            {#if canViewFinance}
                <li><a href="/expenses" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/expenses') ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Chi phí</a></li>
            {/if}

            <!-- Master Data Link -->
            {#if canManageInventory || canViewFinance}
                 <li><a href="/master" data-sveltekit-preload-data="hover" class="{activeRoute.startsWith('/master') ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-slate-600 hover:bg-slate-50'} rounded-lg py-2">Dữ liệu Chủ</a></li>
            {/if}

            <!-- Reports -->
            {#if canManageInventory || canSell || canViewFinance}
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
                <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
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
