<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	export let title: string;
	export let isOpen: boolean;
	export let onClose: () => void;
	export let onConfirm: (() => void) | undefined = undefined;
	export let confirmText = "Lưu lại";
	export let cancelText = "Hủy";
	export let confirmBtnClass = "btn-primary";
	export let loading = false;
	export let showConfirm = true;
    export let showCancel = true;

    // Use a key to force re-render transitions
    $: modalKey = isOpen;
</script>

{#if isOpen}
    <!-- Backdrop -->
    <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        on:click={onClose}
        transition:fade={{ duration: 150 }}
    ></div>

    <!-- Responsive Modal Container -->
    <!-- On lg screens: centered modal. On smaller screens: bottom sheet -->
    <div class="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
        <div
            class="modal-box w-full max-h-[85vh] lg:max-h-none lg:w-11/12 lg:max-w-lg rounded-t-2xl lg:rounded-lg shadow-2xl p-0 flex flex-col"
            transition:slide={{ duration: 300, axis: 'y', easing: quintOut }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
        >
            <!-- Header -->
            <header class="flex items-center justify-between p-4 border-b border-base-200 sticky top-0 bg-base-100 z-10">
                <h3 id="modal-title" class="font-bold text-lg">{title}</h3>
                <button class="btn btn-sm btn-circle btn-ghost" on:click={onClose}>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </header>

            <!-- Body (Scrollable) -->
            <div class="p-4 overflow-y-auto flex-grow">
                <slot />
            </div>

            <!-- Footer -->
            {#if showConfirm || showCancel}
            <footer class="p-4 border-t border-base-200 sticky bottom-0 bg-base-100 z-10">
                <div class="flex justify-end gap-2">
                    {#if showCancel}
                        <button class="btn" on:click={onClose} disabled={loading}>{cancelText}</button>
                    {/if}

                    {#if showConfirm && onConfirm}
                        <button class="btn {confirmBtnClass}" on:click={onConfirm} disabled={loading}>
                            {#if loading}
                                <span class="loading loading-spinner loading-xs"></span>
                            {/if}
                            {confirmText}
                        </button>
                    {/if}
                </div>
            </footer>
            {/if}

        </div>
    </div>
{/if}
