<script lang="ts">
    import { Plus } from 'lucide-svelte';
    import { fly } from 'svelte/transition';

    export let onClick: () => void;
    export let icon: any = Plus;
    export let label: string = '';
    export let visible: boolean = true;
    export let bottomOffset: string = '80px'; // Default to clear BottomNav (approx 64px + padding)
</script>

{#if visible}
    <button
        class="fixed right-4 z-[55] btn btn-circle btn-primary btn-lg shadow-xl shadow-primary/30 text-white flex flex-col items-center justify-center gap-0.5 border-2 border-white/20"
        style="bottom: {bottomOffset};"
        on:click={onClick}
        transition:fly={{ y: 50, duration: 200 }}
    >
        <svelte:component this={icon} size={28} strokeWidth={2.5} />
        {#if label}
             <span class="text-[8px] font-bold uppercase leading-none">{label}</span>
        {/if}
    </button>
{/if}
