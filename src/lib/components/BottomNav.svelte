<script lang="ts">
    import { page } from '$app/stores';
    import { authStore } from '$lib/stores/authStore';
    import { permissionStore } from '$lib/stores/permissionStore';
    import { fade, slide } from 'svelte/transition';

    $: activeRoute = $page.url.pathname;

    $: canSell = $permissionStore.userPermissions.has('view_sales');
    $: canProduce = $permissionStore.userPermissions.has('view_production');
    $: canStock = $permissionStore.userPermissions.has('view_inventory');
    $: isAdmin = $permissionStore.userPermissions.has('view_users');

    let isMenuOpen = false;

    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }

    function closeMenu() {
        isMenuOpen = false;
    }
</script>

<!-- Bottom Nav -->
<div class="btm-nav btm-nav-md lg:hidden bg-base-100 border-t border-base-200 z-40 pb-safe">

  <!-- Home -->
  <a href="/" class="{activeRoute === '/' ? 'active text-primary' : 'text-slate-500'}" on:click={closeMenu}>
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
    <span class="btm-nav-label text-xs">Home</span>
  </a>

  <!-- Sales -->
  {#if canSell}
      <a href="/sales" class="{activeRoute.startsWith('/sales') ? 'active text-primary' : 'text-slate-500'}" on:click={closeMenu}>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
        <span class="btm-nav-label text-xs">Bán hàng</span>
      </a>
  {/if}

  <!-- Production -->
  {#if canProduce}
      <a href="/production" class="{activeRoute.startsWith('/production') ? 'active text-primary' : 'text-slate-500'}" on:click={closeMenu}>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
        <span class="btm-nav-label text-xs">Sản xuất</span>
      </a>
  {/if}

  <!-- Products / Recipe -->
  <a href="/products" class="{activeRoute.startsWith('/products') ? 'active text-primary' : 'text-slate-500'}" on:click={closeMenu}>
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
    <span class="btm-nav-label text-xs">SP/CT</span>
  </a>

  <!-- MORE / MENU -->
  <button
      class="{isMenuOpen ? 'active text-primary' : 'text-slate-500'}"
      on:click={toggleMenu}
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
    <span class="btm-nav-label text-xs">Menu</span>
  </button>
</div>

<!-- Full Screen Menu Drawer -->
{#if isMenuOpen}
    <div
        class="fixed inset-0 z-50 bg-black/50 lg:hidden"
        transition:fade={{ duration: 150 }}
        on:click={closeMenu}
    ></div>

    <div
        class="fixed bottom-0 left-0 right-0 z-50 bg-base-100 rounded-t-2xl max-h-[85vh] overflow-y-auto lg:hidden shadow-2xl pb-safe"
        transition:slide={{ duration: 300, axis: 'y' }}
    >
        <div class="p-4">
            <div class="flex justify-between items-center mb-6">
                <h3 class="font-bold text-lg text-primary">Menu Chức năng</h3>
                <button class="btn btn-sm btn-circle btn-ghost" on:click={closeMenu}>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <ul class="menu bg-base-100 w-full p-0 [&_li>*]:py-3 [&_li>*]:font-medium text-base">
                <li class="menu-title text-xs uppercase tracking-wider text-gray-400 mt-2">Quản lý Kho & Nhập liệu</li>
                <li><a href="/ingredients" on:click={closeMenu}>📦 Nguyên liệu</a></li>
                <li><a href="/imports" on:click={closeMenu}>🚚 Nhập hàng (Imports)</a></li>
                <li><a href="/stocktake" on:click={closeMenu}>📝 Kiểm kho (Stocktake)</a></li>
                <li><a href="/assets" on:click={closeMenu}>🛠️ Công cụ & Tài sản (Assets)</a></li>

                <li class="menu-title text-xs uppercase tracking-wider text-gray-400 mt-2">Tài chính & Báo cáo</li>
                <li><a href="/expenses" on:click={closeMenu}>💸 Chi phí (Expenses)</a></li>
                <li><a href="/reports" on:click={closeMenu}>📊 Báo cáo (Reports)</a></li>
                <li><a href="/partners" on:click={closeMenu}>🤝 Đối tác (Partners)</a></li>
                <li><a href="/history" on:click={closeMenu}>📜 Lịch sử Hệ thống</a></li>

                {#if isAdmin}
                    <li class="menu-title text-xs uppercase tracking-wider text-error mt-2">Admin Zone</li>
                    <li><a href="/admin/users" on:click={closeMenu} class="text-error">👥 Quản lý Users</a></li>
                    <li><a href="/admin/roles" on:click={closeMenu} class="text-error">🔐 Phân quyền (Roles)</a></li>
                {/if}
            </ul>

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