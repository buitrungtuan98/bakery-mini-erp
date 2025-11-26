<script lang="ts">
	import { Toaster } from 'svelte-sonner';
	import "../app.css";
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/authStore';
    import { initMasterData } from '$lib/stores/masterDataStore';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Navbar from '$lib/components/Navbar.svelte';
    import BottomNav from '$lib/components/BottomNav.svelte';

	onMount(() => {
		authStore.init();
        if ($authStore.user) {
             initMasterData();
        }
	});

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
	<div class="min-h-screen bg-base-100 text-base-content font-sans pb-16 lg:pb-0"> <!-- Added pb-16 for BottomNav -->
		{#if $authStore.user}
			<Navbar />
		{/if}

		<main class="p-2 md:p-4 max-w-7xl mx-auto">
			<slot />
		</main>

        {#if $authStore.user}
            <BottomNav />
        {/if}
	</div>
	<Toaster />
{/if}

<svelte:head>
	<link rel="manifest" href="/manifest.json" />
</svelte:head>