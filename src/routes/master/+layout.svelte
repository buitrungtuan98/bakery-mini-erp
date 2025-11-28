<script lang="ts">
    import { page } from '$app/stores';
    import { Package, ChefHat, Users, Wrench, Tags, Database } from 'lucide-svelte';
    import { goto } from '$app/navigation';
    import { fade } from 'svelte/transition';

    $: activePath = $page.url.pathname;

    const tabs = [
        { href: '/master/products', label: 'Sản phẩm', icon: ChefHat },
        { href: '/master/ingredients', label: 'Nguyên liệu', icon: Package },
        { href: '/master/partners', label: 'Đối tác', icon: Users },
        { href: '/master/assets', label: 'Tài sản', icon: Wrench },
        { href: '/master/categories', label: 'Danh mục', icon: Tags },
    ];

    function isActive(href: string) {
        return activePath.startsWith(href);
    }

    // Swipe Logic
    let touchStartX = 0;
    let touchStartY = 0;

    function handleTouchStart(e: TouchEvent) {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }

    function handleTouchEnd(e: TouchEvent) {
        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;

        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        // Ensure horizontal swipe
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
            const currentIndex = tabs.findIndex(t => activePath.startsWith(t.href));

            if (currentIndex !== -1) {
                 if (diffX > 0) {
                    // Swipe Right -> Prev
                    if (currentIndex > 0) {
                        goto(tabs[currentIndex - 1].href);
                    }
                } else {
                    // Swipe Left -> Next
                    if (currentIndex < tabs.length - 1) {
                         goto(tabs[currentIndex + 1].href);
                    }
                }
            }
        }
    }
</script>

<div class="h-full flex flex-col pb-safe max-w-7xl mx-auto">
    <!-- Header -->
    <div class="px-4 pt-4 pb-2">
        <h1 class="text-2xl font-bold flex items-center gap-2 text-slate-800">
            <Database class="text-primary" />
            Quản lý Dữ liệu Chủ
        </h1>
    </div>

    <!-- Scrollable Tab Bar (Styled like SwipeableTabs) -->
    <div class="bg-white border-b border-slate-100 flex overflow-x-auto no-scrollbar sticky top-0 z-20 shadow-sm">
        {#each tabs as tab}
            <a
                href={tab.href}
                class="flex-1 min-w-[80px] py-3 flex flex-col items-center gap-1 transition-colors relative text-center"
            >
                <div class="{isActive(tab.href) ? 'text-primary' : 'text-slate-400'} transition-colors">
                    <svelte:component this={tab.icon} size={20} strokeWidth={isActive(tab.href) ? 2.5 : 2} />
                </div>
                <span class="text-[10px] font-bold uppercase tracking-wide {isActive(tab.href) ? 'text-primary' : 'text-slate-400'}">
                    {tab.label}
                </span>

                {#if isActive(tab.href)}
                    <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" transition:fade={{ duration: 150 }}></div>
                {/if}
            </a>
        {/each}
    </div>

    <div
        class="flex-1 touch-pan-y px-2 py-4"
        on:touchstart={handleTouchStart}
        on:touchend={handleTouchEnd}
    >
        <slot />
    </div>
</div>

<style>
    /* Hide scrollbar for Chrome, Safari and Opera */
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    /* Hide scrollbar for IE, Edge and Firefox */
    .no-scrollbar {
        -ms-overflow-style: none;  /* IE and Edge */
        scrollbar-width: none;  /* Firefox */
    }
</style>
