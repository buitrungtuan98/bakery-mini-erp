<script lang="ts">
    import { page } from '$app/stores';
    import { Package, ChefHat, Users, Wrench, Tags, Database } from 'lucide-svelte';

    $: activePath = $page.url.pathname;

    const tabs = [
        { href: '/master/products', label: 'Sản phẩm', icon: ChefHat },
        { href: '/master/ingredients', label: 'Nguyên liệu', icon: Package },
        { href: '/master/partners', label: 'Đối tác', icon: Users },
        { href: '/master/assets', label: 'Tài sản', icon: Wrench },
        { href: '/master/categories', label: 'Danh mục Chi phí', icon: Tags },
    ];

    function isActive(href: string) {
        return activePath.startsWith(href);
    }
</script>

<div class="pb-safe max-w-7xl mx-auto">
    <!-- Header -->
    <div class="px-4 pt-4 pb-2">
        <h1 class="text-2xl font-bold flex items-center gap-2 text-slate-800">
            <Database class="text-primary" />
            Quản lý Dữ liệu Chủ (Master Data)
        </h1>
    </div>

    <!-- Scrollable Tab Bar -->
    <div class="w-full overflow-x-auto bg-base-100 border-b border-base-200 mb-4 sticky top-0 z-20">
        <div class="flex whitespace-nowrap px-2">
            {#each tabs as tab}
                <a
                    href={tab.href}
                    class="flex items-center gap-2 px-4 py-3 border-b-2 transition-colors text-sm font-medium
                    {isActive(tab.href) ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}"
                >
                    <svelte:component this={tab.icon} size={18} />
                    {tab.label}
                </a>
            {/each}
        </div>
    </div>

    <div class="px-2">
        <slot />
    </div>
</div>
