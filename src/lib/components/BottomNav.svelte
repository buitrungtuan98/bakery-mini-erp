<script lang="ts">
    import { page } from '$app/stores';
    import { authStore } from '$lib/stores/authStore';

    $: activeRoute = $page.url.pathname;
    $: role = $authStore.user?.role || 'staff';

    // Check permissions
    $: canSell = ['admin', 'sales'].includes(role);
    $: canProduce = ['admin', 'manager'].includes(role);
    $: canStock = ['admin', 'manager'].includes(role);
</script>

<div class="btm-nav btm-nav-md lg:hidden bg-white/95 backdrop-blur border-t border-slate-200 z-50">

  <!-- Home -->
  <a href="/" class="{activeRoute === '/' ? 'active text-primary bg-primary/10' : 'text-slate-500'}">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
    <span class="btm-nav-label text-xs">Home</span>
  </a>

  <!-- Sales -->
  {#if canSell}
      <a href="/sales" class="{activeRoute.startsWith('/sales') ? 'active text-primary bg-primary/10' : 'text-slate-500'}">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
        <span class="btm-nav-label text-xs">Bán hàng</span>
      </a>
  {/if}

  <!-- Production -->
  {#if canProduce}
      <a href="/production" class="{activeRoute.startsWith('/production') ? 'active text-primary bg-primary/10' : 'text-slate-500'}">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
        <span class="btm-nav-label text-xs">Sản xuất</span>
      </a>
  {/if}

  <!-- Products / Recipe (User request: View Recipe easily) -->
  <a href="/products" class="{activeRoute.startsWith('/products') ? 'active text-primary bg-primary/10' : 'text-slate-500'}">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
    <span class="btm-nav-label text-xs">SP/CT</span>
  </a>

  <!-- Menu Drawer Trigger (Replaces stocktake/admin in main bar to save space) -->
  <!-- We point this to a Menu page or just use a drawer. For simplicity, let's point to a "More" page or just keep Stocktake if space allows. -->
  <!-- Let's add Stocktake if 4 items, or Menu if 5. -->

  {#if canStock}
       <a href="/stocktake" class="{activeRoute.startsWith('/stocktake') ? 'active text-primary bg-primary/10' : 'text-slate-500'}">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
        <span class="btm-nav-label text-xs">Kho</span>
      </a>
  {/if}

</div>