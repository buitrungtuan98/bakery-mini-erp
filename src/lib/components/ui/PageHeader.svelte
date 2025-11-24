<script lang="ts">
    export let title: string;
    export let actionLabel: string = "";
    export let onAction: () => void = () => {};
    export let showAction = true;
</script>

<div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
    <h1 class="text-2xl font-bold text-slate-800">{title}</h1>
    {#if showAction && actionLabel}
        <button class="btn btn-primary shadow-sm" on:click={onAction}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
            </svg>
            {actionLabel}
        </button>
    {/if}
</div>