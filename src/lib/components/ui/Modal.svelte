<script lang="ts">
	export let title: string;
	export let isOpen: boolean;
	export let onClose: () => void;
	export let onConfirm: (() => void) | undefined = undefined;
	export let confirmText = 'Lưu lại';
	export let cancelText = 'Hủy';
	export let confirmBtnClass = 'btn-primary';
	export let loading = false;
	export let showConfirm = true;
	export let showCancel = true;
</script>

<input type="checkbox" class="modal-toggle" checked={isOpen} />
<div
	class="modal modal-bottom sm:modal-middle"
	role="dialog"
	on:click={onClose}
	on:keydown={(e) => e.key === 'Escape' && onClose()}
	tabindex="-1"
>
	<div class="modal-box" role="document">
		<h3 class="font-bold text-lg mb-4">{title}</h3>

		<div class="py-2 max-h-[60vh] overflow-y-auto">
			<slot />
		</div>

		{#if showConfirm || showCancel}
			<div class="modal-action mt-4">
				{#if showCancel}
					<button class="btn btn-ghost" on:click={onClose} disabled={loading}>{cancelText}</button>
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
		{/if}
	</div>
</div>
