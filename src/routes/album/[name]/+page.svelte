<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fileSystemService } from '$lib/services/fileSystem';
  import { logger } from '$lib/services/logger';
  import { readExifData, getBestExifDate } from '$lib/services/exif';
  import { 
    parseAlbumDate, 
    getImageFiles, 
    datesMatch,
    isSupportedImageFile,
    type Photo 
  } from '$lib/services/albums';

  const albumName = $page.params.name;
  
  let albumDate: Date | null = $state(null);
  let albumDateString: string = $state('');
  let isValidAlbum: boolean = $state(false);
  let photos: Photo[] = $state([]);
  let isLoading: boolean = $state(false);
  let error: string = $state('');
  let photoUrls: Map<string, string> = $state(new Map());

  onMount(async () => {
    const rootHandle = fileSystemService.getRootHandle();
    if (!rootHandle) {
      logger.warning('No folder selected, redirecting to select page');
      goto('/select');
      return;
    }

    await loadAlbumPhotos();

    // Cleanup object URLs on unmount
    return () => {
      for (const url of photoUrls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  });

  async function loadAlbumPhotos() {
    isLoading = true;
    error = '';
    photos = [];

    try {
      logger.info(`Loading album: ${albumName}`);
      
      // Parse album date
      const parsedDate = parseAlbumDate(albumName);
      albumDate = parsedDate.date;
      albumDateString = parsedDate.dateString || '';
      isValidAlbum = parsedDate.isValid;

      if (!isValidAlbum) {
        logger.warning(`Invalid album name format: ${albumName}`);
      }

      // Get album directory handle
      const rootHandle = fileSystemService.getRootHandle()!;
      let albumHandle: FileSystemDirectoryHandle | null = null;
      
      for await (const [name, entry] of rootHandle.entries()) {
        if (entry.kind === 'directory' && name === albumName) {
          albumHandle = entry;
          break;
        }
      }

      if (!albumHandle) {
        throw new Error(`Album directory not found: ${albumName}`);
      }

      // Get image files
      const imageFiles = await getImageFiles(albumHandle);
      logger.info(`Found ${imageFiles.length} image files`);

      // Process each photo
      for (const fileHandle of imageFiles) {
        try {
          logger.info(`Processing photo: ${fileHandle.name}`);
          
          const file = await fileHandle.getFile();
          const isSupported = isSupportedImageFile(fileHandle.name);
          
          let exifDate: Date | null = null;
          let exifDateString: string | null = null;
          const warnings: string[] = [];

          if (isSupported) {
            try {
              const exifData = await readExifData(file);
              exifDate = getBestExifDate(exifData);
              
              if (exifDate) {
                exifDateString = exifDate.toLocaleString();
              } else {
                warnings.push('No EXIF date found');
              }
            } catch (err) {
              warnings.push('Failed to read EXIF data');
              logger.warning(`EXIF read failed for ${fileHandle.name}`, 
                err instanceof Error ? err.message : 'Unknown error');
            }
          } else {
            warnings.push('Unsupported file type for EXIF writing');
          }

          // Determine status
          let status: Photo['status'] = 'unknown';
          if (!isSupported) {
            status = 'unsupported';
          } else if (albumDate && exifDate) {
            status = datesMatch(albumDate, exifDate) ? 'correct' : 'incorrect';
          } else if (!exifDate) {
            status = 'unknown';
          }

          const photo: Photo = {
            handle: fileHandle,
            name: fileHandle.name,
            size: file.size,
            type: file.type,
            isSupported,
            exifDate,
            exifDateString,
            status,
            warnings
          };

          photos.push(photo);

          // Create object URL for image display
          if (file.type.startsWith('image/')) {
            const url = URL.createObjectURL(file);
            photoUrls.set(fileHandle.name, url);
          }

        } catch (err) {
          logger.error(`Error processing ${fileHandle.name}`, 
            err instanceof Error ? err.message : 'Unknown error');
        }
      }

      // Sort photos by name
      photos.sort((a, b) => a.name.localeCompare(b.name));
      
      logger.success(`Loaded ${photos.length} photos from album ${albumName}`);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error = message;
      logger.error('Failed to load album photos', message);
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

  function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function getStatusColor(status: Photo['status']): string {
    switch (status) {
      case 'correct': return 'text-green-600';
      case 'incorrect': return 'text-red-600';
      case 'unsupported': return 'text-gray-500';
      default: return 'text-yellow-600';
    }
  }

  function getStatusBadge(status: Photo['status']): { text: string; color: string } {
    switch (status) {
      case 'correct': 
        return { text: 'Correct', color: 'bg-green-100 text-green-800' };
      case 'incorrect': 
        return { text: 'Incorrect', color: 'bg-red-100 text-red-800' };
      case 'unsupported': 
        return { text: 'Unsupported', color: 'bg-gray-100 text-gray-800' };
      default: 
        return { text: 'Unknown', color: 'bg-yellow-100 text-yellow-800' };
    }
  }

  function getStatusCounts() {
    const counts = {
      correct: photos.filter(p => p.status === 'correct').length,
      incorrect: photos.filter(p => p.status === 'incorrect').length,
      unsupported: photos.filter(p => p.status === 'unsupported').length,
      unknown: photos.filter(p => p.status === 'unknown').length
    };
    return counts;
  }
</script>

<div class="w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-semibold">{albumName}</h1>
      <p class="text-sm {isValidAlbum ? 'text-gray-600' : 'text-red-600'} mt-1">
        {formatAlbumDate(albumDate)}
        {#if !isValidAlbum}
          (Invalid album name format)
        {/if}
      </p>
    </div>
    <div class="flex gap-2">
      <button 
        class="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
        onclick={() => goto('/main')}
      >
        ← Back to Albums
      </button>
      <button 
        class="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
        onclick={loadAlbumPhotos}
        disabled={isLoading}
      >
        {isLoading ? 'Loading...' : 'Refresh'}
      </button>
    </div>
  </div>

  {#if error}
    <div class="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
      {error}
    </div>
  {/if}

  {#if !isLoading && photos.length > 0}
    <div class="mb-6 p-4 bg-gray-50 rounded-lg">
      <h3 class="text-sm font-medium mb-2">Status Summary</h3>
      <div class="flex gap-4 text-xs">
        {#each Object.entries(getStatusCounts()) as [status, count]}
          <div class="flex items-center gap-1">
            <span class="px-2 py-1 rounded {getStatusBadge(status).color}">
              {getStatusBadge(status).text}
            </span>
            <span>{count}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if isLoading}
    <div class="text-center py-8 text-gray-500">
      Loading photos...
    </div>
  {:else if photos.length === 0}
    <div class="text-center py-8 text-gray-500">
      No photos found in this album.
    </div>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
      {#each photos as photo (photo.name)}
        <div class="border rounded-lg p-4 bg-white">
          <div class="flex items-start justify-between mb-3">
            <div class="flex-1 min-w-0">
              <h3 class="font-medium text-sm truncate" title={photo.name}>
                {photo.name}
              </h3>
              <p class="text-xs text-gray-500">
                {formatFileSize(photo.size)}
              </p>
            </div>
            <span class="px-2 py-1 text-xs rounded {getStatusBadge(photo.status).color} ml-2">
              {getStatusBadge(photo.status).text}
            </span>
          </div>

          <div class="space-y-2 text-xs">
            <div>
              <span class="text-gray-500">Album date:</span>
              <span class={isValidAlbum ? 'text-gray-700' : 'text-red-600'}>
                {formatAlbumDate(albumDate)}
              </span>
            </div>
            
            <div>
              <span class="text-gray-500">EXIF date:</span>
              <span class={getStatusColor(photo.status)}>
                {photo.exifDateString || 'No date found'}
              </span>
            </div>

            {#if photo.warnings.length > 0}
              <div class="text-yellow-700">
                ⚠️ {photo.warnings.join('; ')}
              </div>
            {/if}
          </div>

          {#if photoUrls.has(photo.name)}
            <div class="mt-3 pt-3 border-t border-gray-200">
              <img 
                src={photoUrls.get(photo.name)} 
                alt={photo.name}
                class="w-full h-auto rounded"
                loading="lazy"
              />
            </div>
          {/if}

          {#if photo.status === 'incorrect' && photo.isSupported}
            <div class="mt-3 pt-3 border-t border-gray-200">
              <button 
                class="w-full px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                onclick={() => {/* TODO: Fix EXIF */}}
              >
                Fix EXIF Date
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

