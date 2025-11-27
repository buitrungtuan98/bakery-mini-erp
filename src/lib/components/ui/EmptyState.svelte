<script lang="ts">
    export let message = "Không tìm thấy dữ liệu.";
</script>

<div class="text-center py-12 px-4">
    <div class="text-base-content/40 italic">{message}</div>
    <div class="mt-4">
        <slot name="actions" />
    </div>
</div>
