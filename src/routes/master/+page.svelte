<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';

    onMount(() => {
        // Default redirect to products
        goto('/master/products');
    });
</script>

<div class="p-8 text-center text-slate-400">
    Đang chuyển hướng...
</div>
