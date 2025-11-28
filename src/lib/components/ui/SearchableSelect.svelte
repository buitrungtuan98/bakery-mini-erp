<script lang="ts">
    import { createEventDispatcher, tick } from 'svelte';
    import { fade, slide } from 'svelte/transition';
    import { Search, X, Check, ChevronDown } from 'lucide-svelte';
    import { clickOutside } from '$lib/utils/clickOutside';

    // Type definition for options
    export let options: { value: string | number; label: string; subLabel?: string }[] = [];
    export let value: string | number | null = null;
    export let placeholder: string = "Select option...";
    export let disabled: boolean = false;
    export let id: string = `select-${Math.random().toString(36).substr(2, 9)}`;

    const dispatch = createEventDispatcher();

    let isOpen = false;
    let searchQuery = '';
    let filteredOptions = options;
    let inputElement: HTMLInputElement;

    // Reactively filter options
    $: {
        const query = searchQuery.toLowerCase().trim();
        if (!query) {
            filteredOptions = options;
        } else {
            filteredOptions = options.filter(opt =>
                opt.label.toLowerCase().includes(query) ||
                (opt.subLabel && opt.subLabel.toLowerCase().includes(query))
            );
        }
    }

    // Update selected label
    $: selectedOption = options.find(o => o.value === value);
    $: displayLabel = selectedOption ? selectedOption.label : placeholder;

    function toggleOpen() {
        if (disabled) return;
        isOpen = !isOpen;
        if (isOpen) {
            searchQuery = '';
            tick().then(() => inputElement?.focus());
        }
    }

    function selectOption(option: typeof options[0]) {
        value = option.value;
        dispatch('change', value); // Standard change event
        dispatch('select', option); // Detailed select event
        isOpen = false;
        searchQuery = '';
    }

    function clearSelection(e: Event) {
        e.stopPropagation();
        value = null;
        dispatch('change', null);
        dispatch('clear');
    }

    function close() {
        isOpen = false;
    }
</script>

<div class="relative w-full" use:clickOutside={close}>
    <!-- Trigger Button -->
    <div
        role="button"
        tabindex="0"
        on:click={toggleOpen}
        on:keydown={(e) => e.key === 'Enter' && toggleOpen()}
        class="input input-bordered w-full flex items-center justify-between cursor-pointer {disabled ? 'bg-base-200 cursor-not-allowed text-base-content/50' : 'bg-base-100 hover:border-base-content/40'} transition-all"
        class:input-primary={isOpen}
    >
        <div class="truncate select-none {selectedOption ? 'text-base-content' : 'text-base-content/50'}">
            {displayLabel}
        </div>
        <div class="flex items-center gap-1">
            {#if value && !disabled}
                <button
                    class="btn btn-ghost btn-xs btn-circle text-base-content/50 hover:text-error"
                    on:click={clearSelection}
                >
                    <X size={14} />
                </button>
            {/if}
            <ChevronDown size={16} class="text-base-content/50 transition-transform {isOpen ? 'rotate-180' : ''}" />
        </div>
    </div>

    <!-- Dropdown Content (Desktop & Mobile Unified Logic, styled differently) -->
    {#if isOpen}
        <!-- Mobile Bottom Sheet Overlay (Only visible on mobile breakpoints usually, but here we control via logic) -->
        <!-- We use media queries in class to switch between Modal (mobile) and Dropdown (desktop) -->

        <!-- BACKDROP (Mobile Only) -->
        <div
            class="fixed inset-0 bg-black/40 z-50 lg:hidden backdrop-blur-sm"
            transition:fade={{ duration: 200 }}
            on:click={close}
        ></div>

        <!-- CONTENT CONTAINER -->
        <div
            class="
                fixed bottom-0 left-0 right-0 z-50 bg-base-100 rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh] lg:max-h-[300px]
                lg:absolute lg:inset-auto lg:top-[calc(100%+0.5rem)] lg:w-full lg:rounded-xl lg:shadow-lg lg:border lg:border-base-200 lg:z-50
            "
            transition:slide={{ duration: 200, axis: 'y' }}
        >
            <!-- Header (Mobile Only) -->
            <div class="p-4 border-b border-base-200 flex items-center justify-between lg:hidden">
                <h3 class="font-bold text-lg">Select Option</h3>
                <button class="btn btn-circle btn-ghost btn-sm" on:click={close}>
                    <X size={20} />
                </button>
            </div>

            <!-- Search Bar -->
            <div class="p-3 border-b border-base-200 bg-base-100 sticky top-0 z-10">
                <div class="relative">
                    <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" size={16} />
                    <input
                        bind:this={inputElement}
                        type="text"
                        placeholder="Search..."
                        bind:value={searchQuery}
                        class="input input-sm input-bordered w-full pl-9"
                    />
                </div>
            </div>

            <!-- Options List -->
            <div class="overflow-y-auto flex-1 p-2">
                {#if filteredOptions.length === 0}
                    <div class="p-8 text-center text-base-content/50 flex flex-col items-center gap-2">
                        <Search size={24} class="opacity-20" />
                        <span class="text-sm">No results found</span>
                    </div>
                {:else}
                    <ul class="menu menu-sm w-full gap-1">
                        {#each filteredOptions as option (option.value)}
                            <li>
                                <button
                                    class="justify-between py-3 px-3 rounded-lg {value === option.value ? 'active bg-primary text-primary-content' : ''}"
                                    on:click={() => selectOption(option)}
                                >
                                    <div class="flex flex-col items-start gap-0.5 text-left">
                                        <span class="font-medium text-sm {value === option.value ? '' : 'text-base-content'}">{option.label}</span>
                                        {#if option.subLabel}
                                            <span class="text-[11px] {value === option.value ? 'text-primary-content/80' : 'text-base-content/50'}">{option.subLabel}</span>
                                        {/if}
                                    </div>
                                    {#if value === option.value}
                                        <Check size={16} />
                                    {/if}
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        </div>
    {/if}
</div>
