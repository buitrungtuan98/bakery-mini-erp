<script lang="ts">
    import { page } from '$app/stores';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { fade, slide } from 'svelte/transition';
    import { Home, ShoppingCart, Factory, ChefHat, Menu as MenuIcon, X, Package, Truck, ClipboardList, Wallet, BarChart3, Users, History, Lock, UserCog, Database } from 'lucide-svelte';

    $: activeRoute = $page.url.pathname;

    $: canSell = $permissionStore.userPermissions.has('view_sales');
    $: canProduce = $permissionStore.userPermissions.has('view_production');
    $: isAdmin = $permissionStore.userPermissions.has('view_users');

    let isMenuOpen = false;

    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }

    function closeMenu() {
        isMenuOpen = false;
    }

    // Helper to check active state more cleanly
    function isActive(path: string) {
        return activeRoute === path || (path !== '/' && activeRoute.startsWith(path));
    }
</script>

<!-- Bottom Nav -->
<div class="btm-nav btm-nav-lg lg:hidden bg-base-100/90 backdrop-blur-md border-t border-base-200 z-50 pb-safe shadow-[0_-4px_20px_-1px_rgba(0,0,0,0.05)]">

  <!-- Home -->
  <a href="/" data-sveltekit-preload-data="hover"
     class="active-press flex flex-col items-center justify-center gap-1 {isActive('/') ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
     on:click={closeMenu}>
    <Home size={24} strokeWidth={isActive('/') ? 2.5 : 2} />
    <span class="text-[10px] font-medium">Home</span>
    {#if isActive('/')}
        <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-4 rounded-b-full" transition:fade></span>
    {/if}
  </a>

  <!-- Sales -->
  {#if canSell}
      <a href="/sales" data-sveltekit-preload-data="hover"
         class="active-press flex flex-col items-center justify-center gap-1 {isActive('/sales') ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
         on:click={closeMenu}>
        <ShoppingCart size={24} strokeWidth={isActive('/sales') ? 2.5 : 2} />
        <span class="text-[10px] font-medium">Bán hàng</span>
        {#if isActive('/sales')}
            <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-4 rounded-b-full" transition:fade></span>
        {/if}
      </a>
  {/if}

  <!-- Production -->
  {#if canProduce}
      <a href="/production" data-sveltekit-preload-data="hover"
         class="active-press flex flex-col items-center justify-center gap-1 {isActive('/production') ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
         on:click={closeMenu}>
        <Factory size={24} strokeWidth={isActive('/production') ? 2.5 : 2} />
        <span class="text-[10px] font-medium">Sản xuất</span>
        {#if isActive('/production')}
            <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-4 rounded-b-full" transition:fade></span>
        {/if}
      </a>
  {/if}

  <!-- Master Data (Replaced Products) -->
  <a href="/master" data-sveltekit-preload-data="hover"
     class="active-press flex flex-col items-center justify-center gap-1 {isActive('/master') ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
     on:click={closeMenu}>
    <Database size={24} strokeWidth={isActive('/master') ? 2.5 : 2} />
    <span class="text-[10px] font-medium">Dữ liệu</span>
    {#if isActive('/master')}
        <span class="absolute top-0 inset-x-0 h-0.5 bg-primary mx-4 rounded-b-full" transition:fade></span>
    {/if}
  </a>

  <!-- MORE / MENU -->
  <button
      class="active-press flex flex-col items-center justify-center gap-1 {isMenuOpen ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}"
      on:click={toggleMenu}
  >
    <MenuIcon size={24} strokeWidth={isMenuOpen ? 2.5 : 2} />
    <span class="text-[10px] font-medium">Menu</span>
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
                <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Kho & Nhập liệu</div>

                <!-- Removed Ingredients (moved to Master) -->
                <a href="/imports" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                     <div class="p-2 rounded-lg bg-blue-100 text-blue-600"><Truck size={20} /></div>
                    <span class="font-medium text-slate-700">Nhập hàng (Imports)</span>
                </a>
                <a href="/stocktake" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                     <div class="p-2 rounded-lg bg-emerald-100 text-emerald-600"><ClipboardList size={20} /></div>
                    <span class="font-medium text-slate-700">Kiểm kho (Stocktake)</span>
                </a>

                <div class="h-4"></div>

                <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Tài chính & Báo cáo</div>

                <a href="/expenses" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                    <div class="p-2 rounded-lg bg-red-100 text-red-600"><Wallet size={20} /></div>
                    <span class="font-medium text-slate-700">Chi phí (Expenses)</span>
                </a>
                <a href="/reports" on:click={closeMenu} class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                     <div class="p-2 rounded-lg bg-indigo-100 text-indigo-600"><BarChart3 size={20} /></div>
                    <span class="font-medium text-slate-700">Báo cáo (Reports)</span>
                </a>
                <!-- Removed Partners (Moved to Master) -->
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
