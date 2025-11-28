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
			<p class="text-sm text-slate-500 font-medium animate-pulse">Đang tải dữ liệu hệ thống...</p>
		</div>
	</div>
{:else}
	<div class="min-h-screen bg-base-200 text-slate-800 font-sans pb-24 lg:pb-0"> <!-- Increased pb for taller BottomNav -->
		{#if $authStore.user}
			<Navbar />
		{/if}

        <!-- Padding adjustment: Mobile needs less padding as we have cards -->
		<main class="p-2 md:p-6 max-w-7xl mx-auto w-full">
			<slot />
		</main>

        {#if $authStore.user}
            <BottomNav />
        {/if}
	</div>
	<Toaster />
{/if}
