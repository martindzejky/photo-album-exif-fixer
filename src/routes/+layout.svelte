<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen grid grid-cols-[1fr_320px] gap-0">
    <main class="p-6">
        {@render children?.()}
    </main>
    <aside class="border-l border-gray-200 p-4 bg-gray-50">
        <h2 class="text-sm font-semibold text-gray-600 mb-2">Log</h2>
        <div class="text-xs text-gray-700 space-y-1" id="log-panel">
            <div>App initialized.</div>
        </div>
    </aside>
</div>
