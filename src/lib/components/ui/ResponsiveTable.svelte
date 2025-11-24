<script lang="ts">
    /**
     * ResponsiveTable.svelte
     * Renders a <table> on desktop (md+) and a Grid of Cards on mobile.
     */
</script>

<div class="block md:hidden space-y-4">
    <slot name="mobile" />
</div>

<div class="hidden md:block overflow-x-auto bg-white shadow-sm rounded-lg border border-slate-200">
    <table class="table w-full">
        <slot name="desktop" />
    </table>
</div>