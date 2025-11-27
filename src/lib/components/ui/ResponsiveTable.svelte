<script lang="ts">
    /**
     * ResponsiveTable.svelte
     * Renders a <table> on desktop (md+) and a Clean List on mobile.
     */
</script>

<!-- Mobile View: Stacked List (Less visual noise) -->
<div class="block md:hidden space-y-3 pb-20"> <!-- Added padding bottom for BottomNav -->
    <slot name="mobile" />
</div>

<!-- Desktop View: Table -->
<div class="hidden md:block overflow-hidden bg-white shadow-sm rounded-xl border border-slate-200">
    <div class="overflow-x-auto">
        <table class="table w-full">
            <slot name="desktop" />
        </table>
    </div>
</div>