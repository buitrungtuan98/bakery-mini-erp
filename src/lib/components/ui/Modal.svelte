<script lang="ts">
    export let title: string;
    export let isOpen: boolean;
    export let onClose: () => void;
    // Make onConfirm optional
    export let onConfirm: (() => void) | undefined = undefined;
    export let confirmText = "Lưu lại";
    export let cancelText = "Hủy";
    export let confirmBtnClass = "btn-primary";
    export let loading = false;
    export let showConfirm = true; // New prop to hide confirm button
</script>

<input type="checkbox" class="modal-toggle" checked={isOpen} />
<div class="modal" role="dialog">
    <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">{title}</h3>

        <div class="py-2">
            <slot />
        </div>

        <div class="modal-action">
            <button class="btn" on:click={onClose} disabled={loading}>{cancelText}</button>
            {#if showConfirm && onConfirm}
                <button class="btn {confirmBtnClass}" on:click={onConfirm} disabled={loading}>
                    {#if loading}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    {confirmText}
                </button>
            {/if}
        </div>
    </div>
</div>