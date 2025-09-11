<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { fileSystemService } from '$lib/services/fileSystem';
  import { logger } from '$lib/services/logger';
  import { 
    parseAlbumDate, 
    getImageFiles, 
    checkForNestedDirectories,
    type Album 
  } from '$lib/services/albums';

  let albums: Album[] = $state([]);
  let isLoading = $state(false);
  let error = $state('');
  let albumThumbnails: Map<string, string[]> = $state(new Map());

  onMount(async () => {
    const rootHandle = fileSystemService.getRootHandle();
    if (!rootHandle) {
      logger.warning('No folder selected, redirecting to select page');
      goto('/select');
      return;
    }

    await scanAlbums();
  });

  async function scanAlbums() {
    isLoading = true;
    error = '';
    albums = [];

    try {
      logger.info('Scanning albums...');
      const folderHandles = await fileSystemService.getAlbums();
      
      for (const folderHandle of folderHandles) {
        logger.info(`Processing album: ${folderHandle.name}`);
        
        const parsedDate = parseAlbumDate(folderHandle.name);
        const imageFiles = await getImageFiles(folderHandle.handle);
        const nestedDirs = await checkForNestedDirectories(folderHandle.handle);
        
        const warnings: string[] = [];
        
        if (!parsedDate.isValid) {
          warnings.push('Invalid album name format (expected YYYYMMdd)');
        }
        
        if (nestedDirs.length > 0) {
          warnings.push(`Contains nested folders: ${nestedDirs.join(', ')}`);
        }
        
        const album: Album = {
          handle: folderHandle.handle,
          name: folderHandle.name,
          parsedDate: parsedDate.date,
          dateString: parsedDate.dateString,
          isValidFormat: parsedDate.isValid,
          warnings,
          photoCount: imageFiles.length,
          status: 'unknown' // Will be determined when photos are analyzed
        };
        
        albums.push(album);
        
        if (warnings.length > 0) {
          logger.warning(`Album ${folderHandle.name}`, warnings.join('; '));
        }

        // Load thumbnails immediately after the main scan completes
        // We'll load them all at once but asynchronously
      }
      
      albums.sort((a, b) => {
        if (a.parsedDate && b.parsedDate) {
          return b.parsedDate.getTime() - a.parsedDate.getTime(); // newest first
        }
        return a.name.localeCompare(b.name);
      });
      
      logger.success(`Found ${albums.length} albums`);
      
      // Load thumbnails for all albums after the main scan is complete
      logger.info('Loading album thumbnails...');
      for (const album of albums) {
        loadAlbumThumbnails(album.name).catch(() => {
          // Silently ignore individual thumbnail loading errors
        });
      }
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error = message;
      logger.error('Failed to scan albums', message);
    } finally {
      isLoading = false;
    }
  }

  function formatAlbumDate(date: Date | null): string {
    if (!date) return 'Invalid date';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function getStatusColor(album: Album): string {
    if (!album.isValidFormat) return 'text-red-600';
    if (album.warnings.length > 0) return 'text-yellow-600';
    return 'text-gray-600';
  }

  function getStatusBadge(album: Album): { text: string; color: string } {
    if (!album.isValidFormat) {
      return { text: 'Invalid', color: 'bg-red-100 text-red-800' };
    }
    if (album.warnings.length > 0) {
      return { text: 'Warning', color: 'bg-yellow-100 text-yellow-800' };
    }
    return { text: 'OK', color: 'bg-green-100 text-green-800' };
  }

  async function loadAlbumThumbnails(albumName: string) {
    if (albumThumbnails.has(albumName)) {
      return; // Already loaded
    }

    try {
      logger.info(`Loading thumbnails for ${albumName}...`);
      const rootHandle = fileSystemService.getRootHandle();
      if (!rootHandle) {
        logger.warning(`No root handle for thumbnails: ${albumName}`);
        return;
      }

      // Find the album directory
      for await (const [name, entry] of rootHandle.entries()) {
        if (entry.kind === 'directory' && name === albumName) {
          const imageFiles = await getImageFiles(entry);
          const firstThreeFiles = imageFiles.slice(0, 3);
          const thumbnailUrls: string[] = [];
          
          logger.info(`Found ${firstThreeFiles.length} images for ${albumName} thumbnails`);
          
          for (const fileHandle of firstThreeFiles) {
            try {
              const file = await fileHandle.getFile();
              if (file.type.startsWith('image/')) {
                const url = URL.createObjectURL(file);
                thumbnailUrls.push(url);
                logger.info(`Created thumbnail URL for ${fileHandle.name}`);
              }
            } catch (err) {
              logger.warning(`Failed to create thumbnail for ${fileHandle.name}`, 
                err instanceof Error ? err.message : 'Unknown error');
            }
          }
          
          if (thumbnailUrls.length > 0) {
            albumThumbnails.set(albumName, thumbnailUrls);
            albumThumbnails = albumThumbnails; // Trigger reactivity
            logger.success(`Loaded ${thumbnailUrls.length} thumbnails for ${albumName}`);
          } else {
            logger.warning(`No thumbnails loaded for ${albumName}`);
          }
          break;
        }
      }
    } catch (err) {
      logger.error(`Error loading thumbnails for ${albumName}`, 
        err instanceof Error ? err.message : 'Unknown error');
    }
  }
</script>

<div class="w-full">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-semibold">Albums</h1>
    <button 
      class="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
      onclick={scanAlbums}
      disabled={isLoading}
    >
      {isLoading ? 'Scanning...' : 'Refresh'}
    </button>
  </div>

  {#if error}
    <div class="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
      {error}
    </div>
  {/if}

  {#if isLoading}
    <div class="text-center py-8 text-gray-500">
      Scanning albums...
    </div>
  {:else if albums.length === 0}
    <div class="text-center py-8 text-gray-500">
      No albums found. Make sure your folder contains subdirectories.
    </div>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
      {#each albums as album (album.name)}
        <div 
          class="border rounded-lg p-4 hover:border-blue-300 cursor-pointer transition-colors min-w-0"
          onclick={() => goto(`/album/${encodeURIComponent(album.name)}`)}
          onmouseenter={() => loadAlbumThumbnails(album.name)}
        >
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="font-medium">{album.name}</h3>
                <span class="px-2 py-1 text-xs rounded {getStatusBadge(album).color}">
                  {getStatusBadge(album).text}
                </span>
              </div>
              
              <p class="text-sm {getStatusColor(album)} mb-2">
                {formatAlbumDate(album.parsedDate)}
              </p>
              
              <div class="text-xs text-gray-500">
                {album.photoCount} photos
              </div>
              
              {#if album.warnings.length > 0}
                <div class="mt-2 text-xs text-yellow-700">
                  ⚠️ {album.warnings.join('; ')}
                </div>
              {/if}
            </div>
            
            <div class="text-right text-xs text-gray-400">
              Click to view
            </div>
          </div>
          
          <div class="mt-4 pt-3 border-t border-gray-200">
            {#if albumThumbnails.has(album.name)}
              <div class="flex gap-2 overflow-hidden">
                {#each albumThumbnails.get(album.name) || [] as thumbnailUrl}
                  <img 
                    src={thumbnailUrl} 
                    alt="Album preview"
                    class="w-16 h-16 object-cover rounded flex-shrink-0"
                    loading="lazy"
                  />
                {/each}
              </div>
            {:else}
              <div class="flex gap-2">
                {#each Array(3) as _, i}
                  <div class="w-16 h-16 bg-gray-200 rounded animate-pulse flex-shrink-0"></div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

