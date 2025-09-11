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

<!-- Centered layout matching landing page -->
<div class="min-h-full flex items-center justify-center px-6">
  <div class="max-w-md text-center">
    <h1 class="text-3xl font-bold text-gray-900 mb-6">
      Select Root Folder
    </h1>
    
    <p class="text-lg text-gray-600 mb-8 leading-relaxed">
      Choose the folder containing your photo albums. Each subfolder should 
      represent an album with a date in YYYYMMdd format.
    </p>
    
    {#if error}
      <div class="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
        {error}
      </div>
    {/if}

    <button 
      class="inline-block px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      onclick={handleSelectFolder}
      disabled={isSelecting}
    >
      {isSelecting ? 'Selecting folder...' : 'Pick Folder'}
    </button>

    <p class="text-xs text-gray-500 mt-6">
      <strong>Browser requirement:</strong> Chrome, Edge, or another Chromium-based browser
    </p>
  </div>
</div>

