<script lang="ts">
	import { fileSystemService } from '$lib/services/fileSystem';
	import { logger } from '$lib/services/logger';
	import { goto } from '$app/navigation';

	let isSelecting = false;
	let error = '';

	async function handleSelectFolder() {
		if (!fileSystemService.isSupported()) {
			error = 'File System Access API not supported. Please use Chrome, Edge, or another Chromium-based browser.';
			logger.error('Browser not supported', error);
			return;
		}

		isSelecting = true;
		error = '';

		try {
			logger.info('Requesting folder selection...');
			const folder = await fileSystemService.selectRootFolder();
			
			logger.success(`Selected folder: ${folder.name}`, `Path: ${folder.path}`);
			
			// Navigate to main page
			goto('/main');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error occurred';
			error = message;
			logger.error('Folder selection failed', message);
		} finally {
			isSelecting = false;
		}
	}
</script>

<div class="max-w-xl">
	<h1 class="text-2xl font-semibold mb-4">Select root folder</h1>
	<p class="text-sm text-gray-600 mb-6">
		This app works locally in your browser. Choose the root folder containing your albums (immediate subfolders).
	</p>
	
	{#if error}
		<div class="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
			{error}
		</div>
	{/if}

	<button 
		class="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
		onclick={handleSelectFolder}
		disabled={isSelecting}
	>
		{isSelecting ? 'Selecting...' : 'Pick folder'}
	</button>

	<p class="text-xs text-gray-500 mt-4">
		<strong>Browser requirement:</strong> This app requires Chrome, Edge, or another Chromium-based browser for folder access.
	</p>
</div>

