<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fileSystemService } from '$lib/services/fileSystem';
  import { logger } from '$lib/services/logger';
  import { albumStore } from '$lib/stores/albumStore';
  import { readExifData, getBestExifDate } from '$lib/services/exif';
  import { writeExifData, createTargetDate, formatExifDate } from '$lib/services/exif';
  import {
    parseAlbumDate,
    getImageFiles,
    datesMatch,
    isSupportedImageFile,
    formatDisplayDate,
    type Photo
  } from '$lib/services/albums';

  const albumName = $page.params.name as string;

  let albumDate: Date | null = $state(null);
  let albumDateString: string = $state('');
  let isValidAlbum: boolean = $state(false);
  let photos: Photo[] = $state([]);
  let photoFilter: 'all' | 'correct' | 'incorrect' | 'unknown' | 'unsupported' = $state('all');
  let filteredPhotos: Photo[] = $derived(photoFilter === 'all' ? photos : photos.filter(p => p.status === photoFilter));
  let isLoading: boolean = $state(false);
  let error: string = $state('');
  let photoUrls: Map<string, string> = $state(new Map());
  let albumDirHandle: FileSystemDirectoryHandle | null = $state(null);
  let deletingNames: Set<string> = $state(new Set());
  let isDeletingAlbum: boolean = $state(false);
  let isRenamingAlbum: boolean = $state(false);
  let showRenamePopup: boolean = $state(false);
  let pendingDate: string = $state('');

  onMount(() => {
    const rootHandle = fileSystemService.getRootHandle();
    if (!rootHandle) {
      logger.warning('No folder selected, redirecting to select page');
      goto('/select');
      return;
    }

    // Fire and forget
    loadAlbumPhotos();

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
      albumDirHandle = null;

      // @ts-ignore entries() is available in Chromium's File System Access API
      for await (const [name, entry] of rootHandle.entries()) {
        if (entry.kind === 'directory' && name === albumName) {
          albumDirHandle = entry;
          break;
        }
      }

      if (!albumDirHandle) {
        throw new Error(`Album directory not found: ${albumName}`);
      }

      // Get image files
      const imageFiles = await getImageFiles(albumDirHandle);
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
                exifDateString = formatDisplayDate(exifDate);
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

  function formatYyyyMmDd(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  async function deleteAlbum() {
    const rootHandle = fileSystemService.getRootHandle();
    if (!rootHandle) return;
    const confirmed = confirm(`Delete album "${albumName}" and all its contents? This cannot be undone.`);
    if (!confirmed) return;
    try {
      isDeletingAlbum = true;
      albumStore.clearCache();
      // @ts-ignore recursive supported in Chromium
      await rootHandle.removeEntry(albumName, { recursive: true });
      logger.success('Album deleted', albumName);
      goto('/main');
    } catch (err) {
      logger.error('Failed to delete album', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      isDeletingAlbum = false;
    }
  }

  async function renameAlbum(newName: string) {
    const rootHandle = fileSystemService.getRootHandle();
    if (!rootHandle || !albumDirHandle) return;
    try {
      isRenamingAlbum = true;
      albumStore.clearCache();

      // Try native move/rename if available
      const anyHandle: any = albumDirHandle as any;
      if (typeof anyHandle.move === 'function') {
        await anyHandle.move(newName);
      } else if (typeof (rootHandle as any).move === 'function') {
        await (rootHandle as any).move(albumName, newName);
      } else {
        // Fallback: copy all entries to a new dir then delete old
        const newDir = await rootHandle.getDirectoryHandle(newName, { create: true });
        // Copy recursively
        await copyDirectoryRecursive(albumDirHandle, newDir);
        // Delete old
        // @ts-ignore recursive supported in Chromium
        await rootHandle.removeEntry(albumName, { recursive: true });
      }

      logger.success('Album renamed', `${albumName} → ${newName}`);
      goto(`/album/${encodeURIComponent(newName)}`);
    } catch (err) {
      logger.error('Failed to rename album', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      isRenamingAlbum = false;
    }
  }

  async function copyDirectoryRecursive(src: FileSystemDirectoryHandle, dest: FileSystemDirectoryHandle) {
    // @ts-ignore entries() is available in Chromium's File System Access API
    for await (const [name, entry] of src.entries()) {
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          const newFile = await dest.getFileHandle(name, { create: true });
          const writable = await newFile.createWritable();
          await writable.write(await file.arrayBuffer());
          await writable.close();
        } catch (err) {
          logger.warning(`Failed to copy file ${name}`, err instanceof Error ? err.message : 'Unknown error');
        }
      } else if (entry.kind === 'directory') {
        const newSub = await dest.getDirectoryHandle(name, { create: true });
        await copyDirectoryRecursive(entry, newSub);
      }
    }
  }

  function formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function toggleRenamePopup() {
    showRenamePopup = !showRenamePopup;
    if (showRenamePopup) {
      if (albumDate) {
        pendingDate = formatDateForInput(albumDate);
      } else {
        pendingDate = '';
      }
    }
  }

  function closeRenamePopup() {
    showRenamePopup = false;
  }

  async function confirmRename() {
    if (!pendingDate) return;
    const selected = new Date(pendingDate);
    if (isNaN(selected.getTime())) return;
    const prefix = formatYyyyMmDd(selected);
    const rest = albumName.replace(/^\d{8}/, '').replace(/^\s+/, '');
    const newName = /^\d{8}/.test(albumName) ? `${prefix}${rest}` : `${prefix} ${albumName}`;
    await renameAlbum(newName);
    showRenamePopup = false;
  }

  async function deletePhoto(photo: Photo) {
    if (!albumDirHandle) {
      logger.error('Failed to delete photo', 'Album handle is missing');
      return;
    }

    const confirmed = confirm(`Delete "${photo.name}"? This cannot be undone.`);
    if (!confirmed) return;

    const nextDeleting = new Set(deletingNames);
    nextDeleting.add(photo.name);
    deletingNames = nextDeleting;

    try {
      logger.warning('Deleting photo', photo.name);
      // Remove from disk
      // @ts-ignore - removeEntry may not be in older TS lib.dom
      await albumDirHandle.removeEntry(photo.name);

      // Cleanup URL if present
      if (photoUrls.has(photo.name)) {
        const url = photoUrls.get(photo.name)!;
        URL.revokeObjectURL(url);
        const nextMap = new Map(photoUrls);
        nextMap.delete(photo.name);
        photoUrls = nextMap;
      }

      // Update UI list
      photos = photos.filter(p => p.name !== photo.name);

      logger.success('Photo deleted', photo.name);
    } catch (err) {
      logger.error('Failed to delete photo', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      const after = new Set(deletingNames);
      after.delete(photo.name);
      deletingNames = after;
    }
  }

  async function fixPhotoExifDate(photo: Photo) {
    if (!albumDate) {
      logger.error('Cannot fix EXIF date', 'Album date is invalid');
      return;
    }
    try {
      logger.info('Preparing to fix EXIF date', photo.name);

      const file = await photo.handle.getFile();
      const existing = await readExifData(file);
      const currentBest = getBestExifDate(existing);
      const target = createTargetDate(albumDate, currentBest);

      logger.info('Writing EXIF date', `${photo.name} → ${formatExifDate(target)}`);
      const result = await writeExifData(photo.handle, target);
      if (!result.success) {
        logger.error('Failed to write EXIF', result.error);
        return;
      }

      // Refresh this photo's displayed EXIF date
      const refreshedFile = await photo.handle.getFile();
      const refreshedExif = await readExifData(refreshedFile);
      const newDate = getBestExifDate(refreshedExif);

      const updated: Photo = {
        ...photo,
        exifDate: newDate,
        exifDateString: newDate ? formatDisplayDate(newDate) : null,
        status: (albumDate && newDate && (albumDate.getFullYear() === newDate.getFullYear() && albumDate.getMonth() === newDate.getMonth() && albumDate.getDate() === newDate.getDate())) ? 'correct' : 'incorrect'
      };
      photos = photos.map(p => p.name === photo.name ? updated : p);

      logger.success('EXIF date updated', photo.name);
    } catch (err) {
      logger.error('Error fixing EXIF date', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function fixAllExifDates() {
    if (!albumDate) {
      logger.error('Cannot fix EXIF dates', 'Album date is invalid');
      return;
    }
    const targets = photos.filter(p => p.isSupported);
    logger.info('Fixing EXIF dates for album', `${albumName} (${targets.length} photos)`);
    for (const photo of targets) {
      await fixPhotoExifDate(photo);
    }
    logger.success('Finished fixing EXIF dates', `${albumName}`);
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
      case 'correct': return 'text-green-600 dark:text-green-400';
      case 'incorrect': return 'text-red-600 dark:text-red-400';
      case 'unsupported': return 'text-gray-500 dark:text-gray-400';
      default: return 'text-yellow-700 dark:text-yellow-400';
    }
  }

  function getStatusBadge(status: Photo['status']): { text: string; color: string } {
    switch (status) {
      case 'correct':
        return { text: 'Correct', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' };
      case 'incorrect':
        return { text: 'Incorrect', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' };
      case 'unsupported':
        return { text: 'Unsupported', color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' };
      default:
        return { text: 'Unknown', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' };
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
      <p class="text-sm {isValidAlbum ? 'text-gray-600 dark:text-gray-300' : 'text-red-600'} mt-1">
        {formatAlbumDate(albumDate)}
        {#if !isValidAlbum}
          (Invalid album name format)
        {/if}
      </p>
    </div>
    <div class="flex gap-2">
      <div class="relative">
        <button
          class="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          onclick={toggleRenamePopup}
          disabled={isRenamingAlbum || isDeletingAlbum}
        >
          Rename
        </button>
        {#if showRenamePopup}
          <div class="absolute z-10 right-0 mt-2 w-64 p-3 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow">
            <label class="block text-xs text-gray-600 mb-1" for="rename-date-input">Album date</label>
            <input
              type="date"
              id="rename-date-input"
              class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded mb-3"
              bind:value={pendingDate}
            />
            <div class="flex justify-end gap-2">
              <button
                class="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                onclick={closeRenamePopup}
              >
                Cancel
              </button>
              <button
                class="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                onclick={confirmRename}
                disabled={!pendingDate || isRenamingAlbum}
              >
                Confirm
              </button>
            </div>
          </div>
        {/if}
      </div>
      <button
        class="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
        onclick={deleteAlbum}
        disabled={isDeletingAlbum}
      >
        {isDeletingAlbum ? 'Deleting…' : 'Delete'}
      </button>
      <button
        class="px-3 py-1 text-sm rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
        onclick={() => goto('/main')}
      >
        ← Back to Albums
      </button>
      <button
        class="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
        onclick={fixAllExifDates}
        disabled={isLoading}
        title="Fix EXIF dates of all supported photos"
      >
        Fix all EXIF dates
      </button>
      <button
        class="px-3 py-1 text-sm rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
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
    <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <h3 class="text-sm font-medium mb-2">Status Summary</h3>
      <div class="flex gap-4 text-xs items-center justify-between flex-wrap">
        <div class="flex gap-4">
          {#each Object.entries(getStatusCounts()) as [status, count]}
            <div class="flex items-center gap-1">
              <span class="px-2 py-1 rounded {getStatusBadge(status as 'unknown' | 'correct' | 'incorrect' | 'unsupported').color}">
                {getStatusBadge(status as 'unknown' | 'correct' | 'incorrect' | 'unsupported').text}
              </span>
              <span>{count}</span>
            </div>
          {/each}
        </div>

        <div class="flex rounded bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <button class="px-2.5 py-1 rounded text-xs {photoFilter === 'all' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}" onclick={() => (photoFilter = 'all')} aria-pressed={photoFilter === 'all'}>All</button>
          <button class="px-2.5 py-1 rounded text-xs {photoFilter === 'correct' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}" onclick={() => (photoFilter = 'correct')} aria-pressed={photoFilter === 'correct'}>Correct</button>
          <button class="px-2.5 py-1 rounded text-xs {photoFilter === 'incorrect' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}" onclick={() => (photoFilter = 'incorrect')} aria-pressed={photoFilter === 'incorrect'}>Incorrect</button>
          <button class="px-2.5 py-1 rounded text-xs {photoFilter === 'unknown' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}" onclick={() => (photoFilter = 'unknown')} aria-pressed={photoFilter === 'unknown'}>Unknown</button>
          <button class="px-2.5 py-1 rounded text-xs {photoFilter === 'unsupported' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}" onclick={() => (photoFilter = 'unsupported')} aria-pressed={photoFilter === 'unsupported'}>Unsupported</button>
        </div>
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
    <div class="grid grid-cols-4 gap-4">
      {#each filteredPhotos as photo (photo.name)}
        <div class="border border-gray-200 rounded-lg p-4 bg-white dark:bg-gray-800 dark:border-gray-700">
          <div class="flex items-start justify-between mb-3">
            <div class="flex-1 min-w-0">
              <h3 class="font-medium text-sm truncate" title={photo.name}>
                {photo.name}
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {formatFileSize(photo.size)}
              </p>
            </div>
            <span class="px-2 py-1 text-xs rounded {getStatusBadge(photo.status).color} ml-2">
              {getStatusBadge(photo.status).text}
            </span>
          </div>

          <div class="space-y-2 text-xs">
            <div>
              <span class="text-gray-500 dark:text-gray-400">Album date:</span>
              <span class={isValidAlbum ? 'text-gray-700 dark:text-gray-200' : 'text-red-600 dark:text-red-400'}>
                {formatAlbumDate(albumDate)}
              </span>
            </div>

            <div>
              <span class="text-gray-500 dark:text-gray-400">EXIF date:</span>
              <span class={getStatusColor(photo.status)}>
                {photo.exifDateString || 'No date found'}
              </span>
            </div>

            <div>
              <span class="text-gray-500 dark:text-gray-400">Difference:</span>
              <span class="{photo.exifDate ? (datesMatch(albumDate, photo.exifDate) ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-200') : 'text-yellow-700 dark:text-yellow-400'}">
                {#if photo.exifDate && albumDate}
                  {(() => {
                    const d1 = new Date(albumDate.getFullYear(), albumDate.getMonth(), albumDate.getDate());
                    const d2 = new Date(photo.exifDate.getFullYear(), photo.exifDate.getMonth(), photo.exifDate.getDate());
                    const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
                    if (diff === 0) return 'same day';
                    if (diff > 0) return `${diff} day(s) after`;
                    return `${Math.abs(diff)} day(s) before`;
                  })()}
                {:else}
                  {photo.exifDate ? 'Album date unknown' : 'Missing EXIF date'}
                {/if}
              </span>
            </div>

            {#if photo.warnings.length > 0}
              <div class="text-yellow-700 dark:text-yellow-400">
                ⚠️ {photo.warnings.join('; ')}
              </div>
            {/if}
          </div>

          {#if photoUrls.has(photo.name)}
            <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <img
                src={photoUrls.get(photo.name)}
                alt={photo.name}
                class="w-full h-auto rounded"
                loading="lazy"
              />
            </div>
          {/if}

          <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
            {#if photo.isSupported}
              <button
                class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                onclick={() => fixPhotoExifDate(photo)}
              >
                {photo.status === 'correct' ? 'Re-write EXIF Date' : 'Fix EXIF Date'}
              </button>
            {/if}
            <button
              class="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
              onclick={() => deletePhoto(photo)}
              disabled={deletingNames.has(photo.name)}
              title="Delete photo"
            >
              {deletingNames.has(photo.name) ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

