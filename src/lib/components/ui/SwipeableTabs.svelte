<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    export let tabs: { id: string; label: string; icon: any }[] = [];
    export let activeTab: string;

    const dispatch = createEventDispatcher();

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

        // Ensure it's a horizontal swipe and long enough
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
            const currentIndex = tabs.findIndex(t => t.id === activeTab);
            if (diffX > 0) {
                // Swipe Right -> Prev Tab
                if (currentIndex > 0) {
                    dispatch('change', tabs[currentIndex - 1].id);
                }
            } else {
                // Swipe Left -> Next Tab
                if (currentIndex < tabs.length - 1) {
                    dispatch('change', tabs[currentIndex + 1].id);
                }
            }
        }
    }
</script>

<div class="flex flex-col h-full">
    <!-- Tab Bar -->
    <div class="bg-white border-b border-slate-100 flex overflow-x-auto no-scrollbar sticky top-0 z-20 shadow-sm">
        {#each tabs as tab}
            <button
                class="flex-1 min-w-[80px] py-3 flex flex-col items-center gap-1 transition-colors relative"
                on:click={() => dispatch('change', tab.id)}
            >
                <div class="{activeTab === tab.id ? 'text-primary' : 'text-slate-400'} transition-colors">
                    <svelte:component this={tab.icon} size={20} strokeWidth={activeTab === tab.id ? 2.5 : 2} />
                </div>
                <span class="text-[10px] font-bold uppercase tracking-wide {activeTab === tab.id ? 'text-primary' : 'text-slate-400'}">
                    {tab.label}
                </span>

                {#if activeTab === tab.id}
                    <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" transition:fade={{ duration: 150 }}></div>
                {/if}
            </button>
        {/each}
    </div>

    <!-- Content Area -->
    <div
        class="flex-1 touch-pan-y"
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
