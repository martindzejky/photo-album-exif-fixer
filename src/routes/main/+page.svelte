<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { fileSystemService } from '$lib/services/fileSystem';
  import { logger } from '$lib/services/logger';
  import { 
    parseAlbumDate, 
    getImageFiles, 
    checkForNestedDirectories,
    isSupportedImageFile,
    datesMatch,
    type Album 
  } from '$lib/services/albums';
  import { readExifData, getBestExifDate } from '$lib/services/exif';
  import { albumStore } from '$lib/stores/albumStore';

  let albums: Album[] = $state([]);
  let isLoading = $state(false);
  let error = $state('');

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
    const rootHandle = fileSystemService.getRootHandle();
    if (!rootHandle) {
      logger.error('No root folder handle available');
      return;
    }

    // Check cache first
    const cachedAlbums = albumStore.getAlbums(rootHandle.name);
    if (cachedAlbums) {
      albums = cachedAlbums;
      logger.info(`Loaded ${albums.length} albums from cache`);
      return;
    }

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
        
        // Count supported vs unsupported files
        const supportedFiles = imageFiles.filter(file => isSupportedImageFile(file.name));
        const unsupportedFiles = imageFiles.filter(file => !isSupportedImageFile(file.name));
        
        const warnings: string[] = [];
        
        if (!parsedDate.isValid) {
          warnings.push('Invalid album name format (expected YYYYMMdd)');
        }
        
        if (nestedDirs.length > 0) {
          warnings.push(`Contains nested folders: ${nestedDirs.join(', ')}`);
        }

        if (unsupportedFiles.length > 0) {
          warnings.push(`${unsupportedFiles.length} unsupported file(s)`);
        }
        
        const album: Album = {
          handle: folderHandle.handle,
          name: folderHandle.name,
          parsedDate: parsedDate.date,
          dateString: parsedDate.dateString,
          isValidFormat: parsedDate.isValid,
          warnings,
          photoCount: imageFiles.length,
          supportedPhotoCount: supportedFiles.length,
          unsupportedPhotoCount: unsupportedFiles.length,
          hasNestedDirectories: nestedDirs.length > 0,
          nestedDirectoryNames: nestedDirs,
          status: 'unknown' // Will be determined when photos are analyzed
        };

        albums.push(album);

        // Quick EXIF analysis for random sample of supported photos to get status
        if (parsedDate.isValid && supportedFiles.length > 0) {
          const sampleSize = Math.min(9, supportedFiles.length);
          const randomSample = getRandomSample(supportedFiles, sampleSize);
          analyzeAlbumExifStatus(album, randomSample).catch(() => {
            // Silently ignore EXIF analysis errors for quick scan
          });
        }

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
      
      // Cache the albums data
      albumStore.setAlbums(albums, rootHandle.name);
      
      // Album thumbnails removed for performance - only show in detail view

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

  // Album thumbnail loading removed for performance
  
  function getRandomSample<T>(array: T[], sampleSize: number): T[] {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, sampleSize);
  }

  function getAlbumBorderColor(album: Album): string {
    // Red border for serious issues
    if (!album.isValidFormat || (album.photoStatus && album.photoStatus.incorrect > 0)) {
      return 'border-red-300 hover:border-red-400';
    }
    
    // Yellow border for warnings
    if (album.hasNestedDirectories || album.unsupportedPhotoCount > 0 || 
        (album.photoStatus && album.photoStatus.unknown > 0)) {
      return 'border-yellow-300 hover:border-yellow-400';
    }
    
    // Default border
    return 'border-gray-200 hover:border-blue-300';
  }
  
  async function analyzeAlbumExifStatus(album: Album, sampleFiles: FileSystemFileHandle[]) {
    if (!album.parsedDate) return;

    try {
      const photoStatus = {
        correct: 0,
        incorrect: 0,
        unknown: 0,
        unsupported: 0
      };

      for (const fileHandle of sampleFiles) {
        try {
          const file = await fileHandle.getFile();
          const exifData = await readExifData(file);
          const exifDate = getBestExifDate(exifData);

          if (exifDate) {
            if (datesMatch(album.parsedDate, exifDate)) {
              photoStatus.correct++;
            } else {
              photoStatus.incorrect++;
            }
          } else {
            photoStatus.unknown++;
          }
        } catch (err) {
          photoStatus.unknown++;
        }
      }

      // Update the album in the albums array
      const albumIndex = albums.findIndex(a => a.name === album.name);
      if (albumIndex !== -1) {
        albums[albumIndex] = { ...albums[albumIndex], photoStatus };
        albums = [...albums]; // Trigger reactivity
        
        // Also update cache
        albumStore.updateAlbum(album.name, { photoStatus });
        
        logger.info(`EXIF analysis for ${album.name} (${sampleFiles.length} photos sampled): ${photoStatus.correct} correct, ${photoStatus.incorrect} incorrect, ${photoStatus.unknown} unknown`);
      }
    } catch (err) {
      logger.warning(`Failed to analyze EXIF for ${album.name}`, 
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
          class="border rounded-lg p-4 cursor-pointer transition-colors min-w-0 {getAlbumBorderColor(album)}"
          onclick={() => goto(`/album/${encodeURIComponent(album.name)}`)}
        >
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="mb-3">
                <h3 class="font-medium text-base mb-1">{album.name}</h3>
                <p class="text-sm {album.isValidFormat ? 'text-gray-600' : 'text-red-600'}">
                  {formatAlbumDate(album.parsedDate)}
                </p>
              </div>

              <!-- Status indicators -->
              <div class="space-y-2">
                <!-- Name validity -->
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-2 h-2 rounded-full {album.isValidFormat ? 'bg-green-500' : 'bg-red-500'}"></span>
                  <span class="{album.isValidFormat ? 'text-green-700' : 'text-red-700'}">
                    {album.isValidFormat ? 'Valid name format' : 'Invalid name format'}
                  </span>
                </div>

                <!-- Nested directories warning -->
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-2 h-2 rounded-full {album.hasNestedDirectories ? 'bg-yellow-500' : 'bg-green-500'}"></span>
                  <span class="{album.hasNestedDirectories ? 'text-yellow-700' : 'text-green-700'}">
                    {album.hasNestedDirectories ? `${album.nestedDirectoryNames.length} nested folder(s)` : 'No nested folders'}
                  </span>
                </div>

                <!-- Photo counts -->
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-2 h-2 rounded-full {album.photoCount > 0 ? 'bg-blue-500' : 'bg-gray-400'}"></span>
                  <span class="text-gray-700">
                    {album.photoCount} photos ({album.supportedPhotoCount} supported, {album.unsupportedPhotoCount} unsupported)
                  </span>
                </div>

                <!-- EXIF status (if analyzed) -->
                {#if album.photoStatus}
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-2 h-2 rounded-full {album.photoStatus.incorrect > 0 ? 'bg-red-500' : album.photoStatus.unknown > 0 ? 'bg-yellow-500' : 'bg-green-500'}"></span>
                    <span class="{album.photoStatus.incorrect > 0 ? 'text-red-700' : album.photoStatus.unknown > 0 ? 'text-yellow-700' : 'text-green-700'}">
                      {#if album.photoStatus.incorrect > 0}
                        Sample: {album.photoStatus.incorrect} incorrect EXIF dates
                      {:else if album.photoStatus.unknown > 0}
                        Sample: {album.photoStatus.unknown} photos missing EXIF
                      {:else}
                        Sample: All photos have correct dates
                      {/if}
                    </span>
                  </div>
                {:else if album.supportedPhotoCount > 0 && album.isValidFormat}
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-2 h-2 rounded-full bg-gray-400 animate-pulse"></span>
                    <span class="text-gray-500">Analyzing EXIF data...</span>
                  </div>
                {/if}
              </div>

              {#if album.warnings.length > 0}
                <div class="mt-3 pt-2 border-t border-gray-200">
                  <div class="text-xs text-yellow-700">
                    ⚠️ {album.warnings.join('; ')}
                  </div>
                </div>
              {/if}
            </div>

            <div class="text-right text-xs text-gray-400">
              Click to view
            </div>
          </div>

          <!-- Album thumbnails removed for performance -->
        </div>
      {/each}
    </div>
  {/if}
</div>

