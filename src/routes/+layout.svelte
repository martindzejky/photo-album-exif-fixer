<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { logger, type LogEntry } from '$lib/services/logger';
	import { onMount } from 'svelte';

	let { children } = $props();
	let logs: LogEntry[] = $state([]);
	let autoScrollLogs = $state(true);
	let logContainer: HTMLElement;

	onMount(() => {
		// Subscribe to log updates
		const unsubscribe = logger.subscribe((newLogs) => {
			logs = newLogs;

			// Auto-scroll to bottom if enabled
			if (autoScrollLogs && logContainer) {
				setTimeout(() => {
					logContainer.scrollTop = logContainer.scrollHeight;
				}, 0);
			}
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

<div class="h-screen grid grid-cols-[1fr_320px] gap-0 overflow-hidden">
    <main class="p-6 overflow-y-auto bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        {@render children?.()}
    </main>
    <aside class="border-l border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-800 flex flex-col overflow-hidden">
        <div class="flex items-center justify-between mb-2">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-300">Log</h2>
            <button
                class="text-xs px-2 py-1 rounded {autoScrollLogs ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200'} hover:bg-opacity-80 transition-colors"
                onclick={() => autoScrollLogs = !autoScrollLogs}
                title={autoScrollLogs ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
            >
                {autoScrollLogs ? '⬇️' : '⏸️'}
            </button>
        </div>
        <div class="text-xs space-y-1 overflow-y-auto flex-1" bind:this={logContainer}>
            {#each logs as entry (entry.id)}
                <div class="flex flex-col">
                    <div class="flex items-start gap-2">
                        <span class="text-gray-400 dark:text-gray-500 shrink-0">{formatTime(entry.timestamp)}</span>
                        <span class={getLogColor(entry.level)}>{entry.message}</span>
                    </div>
                    {#if entry.details}
                        <div class="text-gray-500 dark:text-gray-400 text-xs ml-14 mt-1">{entry.details}</div>
                    {/if}
                </div>
            {/each}
            {#if logs.length === 0}
                <div class="text-gray-500 dark:text-gray-400">No logs yet...</div>
            {/if}
        </div>
    </aside>
</div>
