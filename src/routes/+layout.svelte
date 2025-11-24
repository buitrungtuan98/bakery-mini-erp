<script lang="ts">
	import "../app.css";
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/authStore';
    import { initMasterData } from '$lib/stores/masterDataStore'; // Cache Master Data
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Navbar from '$lib/components/Navbar.svelte';

	onMount(() => {
		authStore.init();
        // Init Master Data (Lazy load but consistent)
        // Chỉ cần gọi 1 lần, các store sẽ tự quản lý subscription
        if ($authStore.user) {
             initMasterData();
        }
	});

    // Reactive init khi user đăng nhập sau
    $: if ($authStore.user) {
        initMasterData();
    }

	$: if (!$authStore.loading) {
		if (!$authStore.user && $page.url.pathname !== '/login') {
			goto('/login');
		}
	}
</script>

{#if $authStore.loading}
	<div class="flex h-screen w-full justify-center items-center bg-base-100">
		<div class="flex flex-col items-center gap-4">
			<span class="loading loading-dots loading-lg text-primary"></span>
			<p class="text-sm text-gray-500">Đang tải dữ liệu hệ thống...</p>
		</div>
	</div>
{:else}
	<div class="min-h-screen bg-base-100 text-base-content font-sans">
		{#if $authStore.user}
			<Navbar />
		{/if}

		<main class="p-4 max-w-7xl mx-auto">
			<slot />
		</main>
	</div>
{/if}