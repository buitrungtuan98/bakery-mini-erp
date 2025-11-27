<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
    import { X } from 'lucide-svelte';

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
</script>

{#if isOpen}
    <!-- Backdrop: z-[60] to sit above BottomNav (z-50) -->
    <div
        role="button"
        tabindex="0"
        class="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm"
        on:click={onClose}
        on:keydown={(e) => e.key === 'Escape' && onClose()}
        transition:fade={{ duration: 200 }}
    ></div>

    <!-- Responsive Modal Container: z-[60] -->
    <!-- On lg screens: centered modal. On smaller screens: bottom sheet with safe area padding -->
    <div class="fixed inset-0 z-[60] flex items-end lg:items-center justify-center p-0 lg:p-4 pointer-events-none">
        <div
            class="pointer-events-auto bg-base-100 w-full max-h-[85vh] lg:max-h-[80vh] lg:w-full lg:max-w-lg rounded-t-3xl lg:rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-black/5"
            transition:slide={{ duration: 300, axis: 'y', easing: quintOut }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
        >
            <!-- Mobile Drag Indicator (Visual Only) -->
            <div
                role="button"
                tabindex="0"
                class="lg:hidden w-full flex justify-center pt-3 pb-1 bg-base-100"
                on:click={onClose}
                on:keydown={(e) => e.key === 'Enter' && onClose()}
            >
                <div class="w-12 h-1.5 rounded-full bg-slate-200"></div>
            </div>

            <!-- Header -->
            <header class="flex items-center justify-between px-6 py-4 border-b border-base-200 bg-base-100 z-10 shrink-0">
                <h3 id="modal-title" class="font-bold text-xl text-slate-800 tracking-tight">{title}</h3>
                <button class="btn btn-sm btn-circle btn-ghost text-slate-400 hover:bg-slate-100" on:click={onClose}>
                    <X size={20} />
                </button>
            </header>

            <!-- Body (Scrollable) -->
            <div class="p-6 overflow-y-auto overflow-x-hidden flex-grow overscroll-contain">
                <slot />
            </div>

            <!-- Footer -->
            {#if showConfirm || showCancel}
            <footer class="p-4 px-6 border-t border-base-200 bg-base-100 z-10 shrink-0 pb-safe">
                <div class="flex flex-col-reverse lg:flex-row justify-end gap-3 lg:gap-2">
                    {#if showCancel}
                        <button class="btn btn-ghost w-full lg:w-auto" on:click={onClose} disabled={loading}>{cancelText}</button>
                    {/if}

                    {#if showConfirm && onConfirm}
                        <button class="btn {confirmBtnClass} w-full lg:w-auto shadow-lg shadow-primary/20" on:click={onConfirm} disabled={loading}>
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

<style>
    .pb-safe {
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
    }
</style>