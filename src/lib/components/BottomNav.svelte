<script lang="ts">
    import { page } from '$app/stores';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { fade, slide } from 'svelte/transition';
    import { Home, ShoppingCart, Factory, ChefHat, Menu as MenuIcon, X, Package, Truck, ClipboardList, Wallet, BarChart3, Users, History, Lock, UserCog, Database, RefreshCw } from 'lucide-svelte';

    $: activeRoute = $page.url.pathname;

    $: canSell = $permissionStore.userPermissions.has('view_sales');
    $: canProduce = $permissionStore.userPermissions.has('view_production');
    $: canManageInventory = $permissionStore.userPermissions.has('view_inventory') || $permissionStore.userPermissions.has('manage_imports');
    $: canViewFinance = $permissionStore.userPermissions.has('view_finance') || $permissionStore.userPermissions.has('manage_expenses');
    $: isAdmin = $permissionStore.userPermissions.has('view_users');

    let isMenuOpen = false;

    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }

    function closeMenu() {
        isMenuOpen = false;
    }

    // Helper to check active state more cleanly
    function isActive(path: string, currentRoute: string) {
        if (path === '/') {
            return currentRoute === '/';
        }
        return currentRoute.startsWith(path);
    }
</script>

<!-- Bottom Nav -->
<!-- Adjusted layout to fit 6 items: Home, Sales, Prod, Imports, Expenses, Menu -->
<!-- Using 'btm-nav-sm' or just default size flexbox. DaisyUI handles it but text might wrap. -->
<div class="btm-nav lg:hidden bg-base-100/90 backdrop-blur-md border-t border-base-200 z-50 pb-safe shadow-[0_-4px_20px_-1px_rgba(0,0,0,0.05)]">

  <!-- Home -->
  <a href="/" data-sveltekit-preload-data="hover"
     class="active-press flex flex-col items-center justify-center gap-0.5 min-w-[3rem] px-1 {isActive('/', activeRoute) ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
     on:click={closeMenu}>
    <Home size={20} strokeWidth={isActive('/', activeRoute) ? 2.5 : 2} />
    <span class="text-[9px] font-medium truncate w-full text-center">Home</span>
    {#if isActive('/', activeRoute)}
        <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-2 rounded-b-full" transition:fade></span>
    {/if}
  </a>

  <!-- Sales -->
  {#if canSell}
      <a href="/sales" data-sveltekit-preload-data="hover"
         class="active-press flex flex-col items-center justify-center gap-0.5 min-w-[3rem] px-1 {isActive('/sales', activeRoute) ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
         on:click={closeMenu}>
        <ShoppingCart size={20} strokeWidth={isActive('/sales', activeRoute) ? 2.5 : 2} />
        <span class="text-[9px] font-medium truncate w-full text-center">Bán hàng</span>
        {#if isActive('/sales', activeRoute)}
            <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-2 rounded-b-full" transition:fade></span>
        {/if}
      </a>
  {/if}

  <!-- Production -->
  {#if canProduce}
      <a href="/production" data-sveltekit-preload-data="hover"
         class="active-press flex flex-col items-center justify-center gap-0.5 min-w-[3rem] px-1 {isActive('/production', activeRoute) ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
         on:click={closeMenu}>
        <Factory size={20} strokeWidth={isActive('/production', activeRoute) ? 2.5 : 2} />
        <span class="text-[9px] font-medium truncate w-full text-center">Sản xuất</span>
        {#if isActive('/production', activeRoute)}
            <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-2 rounded-b-full" transition:fade></span>
        {/if}
      </a>
  {/if}

  <!-- Imports -->
  {#if canManageInventory}
      <a href="/imports" data-sveltekit-preload-data="hover"
         class="active-press flex flex-col items-center justify-center gap-0.5 min-w-[3rem] px-1 {isActive('/imports', activeRoute) ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
         on:click={closeMenu}>
        <Truck size={20} strokeWidth={isActive('/imports', activeRoute) ? 2.5 : 2} />
        <span class="text-[9px] font-medium truncate w-full text-center">Nhập hàng</span>
        {#if isActive('/imports', activeRoute)}
            <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-2 rounded-b-full" transition:fade></span>
        {/if}
      </a>
  {/if}

  <!-- Expenses -->
  {#if canViewFinance}
      <a href="/expenses" data-sveltekit-preload-data="hover"
         class="active-press flex flex-col items-center justify-center gap-0.5 min-w-[3rem] px-1 {isActive('/expenses', activeRoute) ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
         on:click={closeMenu}>
        <Wallet size={20} strokeWidth={isActive('/expenses', activeRoute) ? 2.5 : 2} />
        <span class="text-[9px] font-medium truncate w-full text-center">Chi phí</span>
        {#if isActive('/expenses', activeRoute)}
            <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-2 rounded-b-full" transition:fade></span>
        {/if}
      </a>
  {/if}

  <!-- MORE / MENU -->
  <button
      class="active-press flex flex-col items-center justify-center gap-0.5 min-w-[3rem] px-1 {isMenuOpen ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
      on:click={toggleMenu}
  >
    <MenuIcon size={20} strokeWidth={isMenuOpen ? 2.5 : 2} />
    <span class="text-[9px] font-medium truncate w-full text-center">Menu</span>
  </button>
</div>

<!-- Full Screen Menu Drawer -->
{#if isMenuOpen}
    <div
        role="button"
        tabindex="0"
        class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm lg:hidden"
        transition:fade={{ duration: 200 }}
        on:click={closeMenu}
        on:keydown={(e) => e.key === 'Escape' && (isMenuOpen = false)}
    ></div>

    <div
        class="fixed bottom-0 left-0 right-0 z-50 bg-base-100 rounded-t-3xl max-h-[85vh] overflow-y-auto lg:hidden shadow-2xl pb-safe ring-1 ring-slate-900/5"
        transition:slide={{ duration: 300, axis: 'y' }}
    >
        <div class="p-6">
            <div class="flex justify-between items-center mb-8">
                <h3 class="font-bold text-xl text-slate-800 tracking-tight">Menu Chức năng</h3>
                <button class="btn btn-sm btn-circle btn-ghost text-slate-400 hover:bg-slate-100" on:click={closeMenu}>
                    <X size={24} />
                </button>
            </div>

            <div class="grid grid-cols-1 gap-1">
                <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Quản lý Dữ liệu</div>

                <!-- Master Data (Moved to Menu) -->
                <a href="/master" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                    <div class="p-2 rounded-lg bg-indigo-100 text-indigo-600"><Database size={20} /></div>
                    <span class="font-medium text-slate-700">Dữ liệu Chủ (Master Data)</span>
                </a>

                <div class="h-4"></div>
                <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Kho & Báo cáo</div>

                <a href="/stocktake" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                     <div class="p-2 rounded-lg bg-emerald-100 text-emerald-600"><ClipboardList size={20} /></div>
                    <span class="font-medium text-slate-700">Kiểm kho (Stocktake)</span>
                </a>

                <a href="/reports" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                     <div class="p-2 rounded-lg bg-blue-100 text-blue-600"><BarChart3 size={20} /></div>
                    <span class="font-medium text-slate-700">Báo cáo (Reports)</span>
                </a>

                 <a href="/history" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                     <div class="p-2 rounded-lg bg-slate-100 text-slate-600"><History size={20} /></div>
                    <span class="font-medium text-slate-700">Lịch sử Hệ thống</span>
                </a>

                {#if isAdmin}
                    <div class="h-4"></div>
                    <div class="text-xs font-bold text-error/80 uppercase tracking-wider mb-2 ml-2">Admin Zone</div>

                    <a href="/admin/users" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 active:bg-red-100 transition-colors">
                        <div class="p-2 rounded-lg bg-red-100 text-error"><UserCog size={20} /></div>
                        <span class="font-medium text-error">Quản lý Users</span>
                    </a>
                    <a href="/admin/roles" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 active:bg-red-100 transition-colors">
                        <div class="p-2 rounded-lg bg-red-100 text-error"><Lock size={20} /></div>
                        <span class="font-medium text-error">Phân quyền (Roles)</span>
                    </a>
                    <a href="/admin/sync" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 active:bg-red-100 transition-colors">
                        <div class="p-2 rounded-lg bg-red-100 text-error"><RefreshCw size={20} /></div>
                        <span class="font-medium text-error">Đồng bộ (Sync)</span>
                    </a>
                {/if}
            </div>

            <div class="h-20"></div> <!-- Spacer for scrolling -->
        </div>
    </div>
{/if}

<style>
    /* Safe area padding for iPhones */
    .pb-safe {
        padding-bottom: env(safe-area-inset-bottom);
    }
</style>
