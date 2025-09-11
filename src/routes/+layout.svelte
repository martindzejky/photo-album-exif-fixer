<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { logger, type LogEntry } from '$lib/services/logger';
	import { onMount } from 'svelte';

	let { children } = $props();
	let logs: LogEntry[] = $state([]);

	onMount(() => {
		// Subscribe to log updates
		const unsubscribe = logger.subscribe((newLogs) => {
			logs = newLogs;
		});

		// Initial log
		logger.info('App initialized');

		return unsubscribe;
	});

	function formatTime(date: Date): string {
		return date.toLocaleTimeString('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function getLogColor(level: LogEntry['level']): string {
		switch (level) {
			case 'error': return 'text-red-600';
			case 'warning': return 'text-yellow-600';
			case 'success': return 'text-green-600';
			default: return 'text-gray-700';
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen grid grid-cols-[1fr_320px] gap-0">
    <main class="p-6">
        {@render children?.()}
    </main>
    <aside class="border-l border-gray-200 p-4 bg-gray-50 flex flex-col">
        <h2 class="text-sm font-semibold text-gray-600 mb-2">Log</h2>
        <div class="text-xs space-y-1 overflow-y-auto flex-1 max-h-screen" id="log-panel">
            {#each logs as entry (entry.id)}
                <div class="flex flex-col">
                    <div class="flex items-start gap-2">
                        <span class="text-gray-400 shrink-0">{formatTime(entry.timestamp)}</span>
                        <span class={getLogColor(entry.level)}>{entry.message}</span>
                    </div>
                    {#if entry.details}
                        <div class="text-gray-500 text-xs ml-14 mt-1">{entry.details}</div>
                    {/if}
                </div>
            {/each}
            {#if logs.length === 0}
                <div class="text-gray-500">No logs yet...</div>
            {/if}
        </div>
    </aside>
</div>
