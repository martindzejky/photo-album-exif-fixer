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
    categorizePhotoDate,
    formatDisplayDate,
    type Album
  } from '$lib/services/albums';
  import { readExifData, getBestExifDate } from '$lib/services/exif';
  import { albumStore } from '$lib/stores/albumStore';

  let albums: Album[] = $state([]);
  let filterMode: 'all'
    | 'invalidName'
    | 'nestedFolders'
    | 'exifGood'
    | 'exifWarning'
    | 'exifError'
    | 'exifMissing' = $state('all');
  let filteredAlbums: Album[] = $derived(albums.filter(matchesFilter));
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

        // Full EXIF analysis for ALL supported photos to get comprehensive status
        if (parsedDate.isValid && supportedFiles.length > 0) {
          analyzeAlbumExifStatus(album, supportedFiles).catch(() => {
            // Silently ignore EXIF analysis errors for scan
          });
        }

        if (warnings.length > 0) {
          logger.warning(`Album ${folderHandle.name}`, warnings.join('; '));
        }
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error = message;
      logger.error('Failed to scan albums', message);
    } finally {
      isLoading = false;
    }
  }

  function refreshAlbums() {
    // Clear cache and force a rescan from disk
    albumStore.clearCache();
    scanAlbums();
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

  function getRandomSample<T>(array: T[], sampleSize: number): T[] {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, sampleSize);
  }

  function getAlbumBorderColor(album: Album): string {
    // Red border for serious issues
    if (!album.isValidFormat || (album.photoStatus && album.photoStatus.severity === 'error')) {
      return 'border-red-300 hover:border-red-400';
    }

    // Yellow border for warnings
    if (
      album.hasNestedDirectories ||
      album.unsupportedPhotoCount > 0 ||
      (album.photoStatus && (album.photoStatus.severity === 'warning' || album.photoStatus.missingExif > 0))
    ) {
      return 'border-yellow-300 hover:border-yellow-400';
    }

    // Default border
    return 'border-gray-200 hover:border-blue-300';
  }

  function hasProblems(album: Album): boolean {
    if (!album.isValidFormat) return true;
    if (album.hasNestedDirectories) return true;
    if (album.unsupportedPhotoCount > 0) return true;
    if (album.photoStatus && (album.photoStatus.severity !== 'good' || album.photoStatus.missingExif > 0)) return true;
    return false;
  }

  function matchesFilter(album: Album): boolean {
    switch (filterMode) {
      case 'all':
        return true;
      case 'invalidName':
        return !album.isValidFormat;
      case 'nestedFolders':
        return album.hasNestedDirectories;
      case 'exifGood':
        return !!album.photoStatus && album.photoStatus.severity === 'good' && album.photoStatus.missingExif === 0;
      case 'exifWarning':
        return !!album.photoStatus && album.photoStatus.severity === 'warning';
      case 'exifError':
        return !!album.photoStatus && album.photoStatus.severity === 'error';
      case 'exifMissing':
        return !!album.photoStatus && album.photoStatus.missingExif > 0;
      default:
        return true;
    }
  }

  function getOverallExifDotClass(photoStatus: NonNullable<Album['photoStatus']>): { dot: string; text: string } {
    if (photoStatus.severity === 'error') {
      return { dot: 'bg-red-500', text: 'text-red-700' };
    }
    if (photoStatus.severity === 'warning' || photoStatus.missingExif > 0) {
      return { dot: 'bg-yellow-500', text: 'text-yellow-700' };
    }
    return { dot: 'bg-green-500', text: 'text-green-700' };
  }

  function getDiffColor(maxDays: number): string {
    if (maxDays <= 7) return 'text-green-700';
    if (maxDays <= 30) return 'text-yellow-700';
    return 'text-red-700';
  }

  async function analyzeAlbumExifStatus(album: Album, allFiles: FileSystemFileHandle[]) {
    if (!album.parsedDate) return;

    try {
      const toDateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const daysBetween = (a: Date, b: Date) => {
        const ms = toDateOnly(a).getTime() - toDateOnly(b).getTime();
        return Math.round(ms / (1000 * 60 * 60 * 24));
      };

      const photoStatus = {
        correct: 0,
        earlierCount: 0,
        laterCount: 0,
        missingExif: 0,
        unsupported: 0,
        totalAnalyzed: allFiles.length,
        earliestExifDate: null as Date | null,
        latestExifDate: null as Date | null,
        maxEarlierDays: 0,
        maxLaterDays: 0,
        severity: 'good' as 'good' | 'warning' | 'error'
      };

      for (const fileHandle of allFiles) {
        try {
          const file = await fileHandle.getFile();
          const exifData = await readExifData(file);
          const exifDate = getBestExifDate(exifData);

          const category = categorizePhotoDate(album.parsedDate, exifDate);

          switch (category) {
            case 'correct':
              photoStatus.correct++;
              break;
            case 'futureDate': {
              if (exifDate) {
                const diff = daysBetween(exifDate, album.parsedDate);
                photoStatus.laterCount++;
                if (!photoStatus.latestExifDate || exifDate > photoStatus.latestExifDate) {
                  photoStatus.latestExifDate = exifDate;
                }
                photoStatus.maxLaterDays = Math.max(photoStatus.maxLaterDays, Math.abs(diff));
              }
              break;
            }
            case 'pastDate': {
              if (exifDate) {
                const diffAbs = Math.abs(daysBetween(album.parsedDate, exifDate));
                photoStatus.earlierCount++;
                if (!photoStatus.earliestExifDate || exifDate < photoStatus.earliestExifDate) {
                  photoStatus.earliestExifDate = exifDate;
                }
                photoStatus.maxEarlierDays = Math.max(photoStatus.maxEarlierDays, diffAbs);
              }
              break;
            }
            case 'missingExif':
              photoStatus.missingExif++;
              break;
          }
        } catch (err) {
          photoStatus.missingExif++;
        }
      }

      // Determine severity
      const maxDiff = Math.max(photoStatus.maxEarlierDays, photoStatus.maxLaterDays);
      if (maxDiff > 30) {
        photoStatus.severity = 'error';
      } else if (maxDiff > 7 || photoStatus.missingExif > 0) {
        photoStatus.severity = 'warning';
      } else {
        photoStatus.severity = 'good';
      }

      // Update the album in the albums array
      const albumIndex = albums.findIndex(a => a.name === album.name);
      if (albumIndex !== -1) {
        albums[albumIndex] = { ...albums[albumIndex], photoStatus };
        albums = [...albums]; // Trigger reactivity

        // Also update cache
        albumStore.updateAlbum(album.name, { photoStatus });

        logger.info(`EXIF analysis for ${album.name} (${photoStatus.totalAnalyzed} photos): ${photoStatus.correct} exact, ${photoStatus.earlierCount} earlier (up to ${photoStatus.maxEarlierDays}d), ${photoStatus.laterCount} later (up to ${photoStatus.maxLaterDays}d), ${photoStatus.missingExif} missing`);
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
    <div class="flex items-center gap-2">
      <div class="flex rounded bg-gray-100 dark:bg-gray-800 flex-wrap">
        <button class="px-3 py-1 text-sm rounded {filterMode === 'all' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}" onclick={() => (filterMode = 'all')} aria-pressed={filterMode === 'all'}>All</button>
        <button class="px-3 py-1 text-sm rounded {filterMode === 'invalidName' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}" onclick={() => (filterMode = 'invalidName')} aria-pressed={filterMode === 'invalidName'}>Invalid name</button>
        <button class="px-3 py-1 text-sm rounded {filterMode === 'nestedFolders' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}" onclick={() => (filterMode = 'nestedFolders')} aria-pressed={filterMode === 'nestedFolders'}>Nested folders</button>
        <button class="px-3 py-1 text-sm rounded {filterMode === 'exifGood' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}" onclick={() => (filterMode = 'exifGood')} aria-pressed={filterMode === 'exifGood'}>EXIF good (≤7d)</button>
        <button class="px-3 py-1 text-sm rounded {filterMode === 'exifWarning' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}" onclick={() => (filterMode = 'exifWarning')} aria-pressed={filterMode === 'exifWarning'}>EXIF warn (8–30d)</button>
        <button class="px-3 py-1 text-sm rounded {filterMode === 'exifError' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}" onclick={() => (filterMode = 'exifError')} aria-pressed={filterMode === 'exifError'}>EXIF error (>30d)</button>
        <button class="px-3 py-1 text-sm rounded {filterMode === 'exifMissing' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}" onclick={() => (filterMode = 'exifMissing')} aria-pressed={filterMode === 'exifMissing'}>Missing date</button>
      </div>
      <button
        class="px-3 py-1 text-sm rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
        onclick={refreshAlbums}
        disabled={isLoading}
      >
        {isLoading ? 'Scanning...' : 'Refresh'}
      </button>
    </div>
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
    <div class="grid grid-cols-4 gap-4">
      {#each filteredAlbums as album (album.name)}
        <a
          class="border rounded-lg p-4 cursor-pointer transition-colors min-w-0 {getAlbumBorderColor(album)} block"
          href={`/album/${encodeURIComponent(album.name)}`}
        >
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="mb-3">
                <h3 class="font-medium text-base mb-1">{album.name}</h3>
                <p class="text-sm {album.isValidFormat ? 'text-gray-600 dark:text-gray-300' : 'text-red-600'}">
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

                <!-- EXIF status (if analyzed) -->
                {#if album.photoStatus}
                  <div class="space-y-1">
                    <!-- Overall status -->
                    {#key album.photoStatus}
                      {#await Promise.resolve(getOverallExifDotClass(album.photoStatus)) then classes}
                        <div class="flex items-center gap-2 text-xs">
                          <span class="w-2 h-2 rounded-full {classes.dot}"></span>
                          <span class="{classes.text} font-medium">
                            {album.photoStatus.totalAnalyzed} photos analyzed
                          </span>
                        </div>
                      {/await}
                    {/key}

                    <!-- Detailed breakdown -->
                    <div class="text-xs text-gray-600 space-y-1 ml-4">
                      {#if album.photoStatus.correct > 0}
                        <div class="flex items-center gap-1">
                          <span class="w-1 h-1 bg-green-500 rounded-full"></span>
                          <span class="text-green-700">{album.photoStatus.correct} exact dates</span>
                        </div>
                      {/if}

                      {#if album.photoStatus.laterCount > 0}
                        <div class="flex items-center gap-1">
                          <span class="w-1 h-1 bg-orange-500 rounded-full"></span>
                          <span class={getDiffColor(album.photoStatus.maxLaterDays)}>{album.photoStatus.laterCount} photos taken after album date (up to {album.photoStatus.maxLaterDays} days)</span>
                        </div>
                      {/if}

                      {#if album.photoStatus.earlierCount > 0}
                        <div class="flex items-center gap-1">
                          <span class="w-1 h-1 bg-purple-500 rounded-full"></span>
                          <span class={getDiffColor(album.photoStatus.maxEarlierDays)}>{album.photoStatus.earlierCount} photos taken before album date (up to {album.photoStatus.maxEarlierDays} days)</span>
                        </div>
                      {/if}

                      {#if album.photoStatus.missingExif > 0}
                        <div class="flex items-center gap-1">
                          <span class="w-1 h-1 bg-yellow-500 rounded-full"></span>
                          <span class="text-yellow-700">{album.photoStatus.missingExif} photos missing date</span>
                        </div>
                      {/if}
                    </div>
                  </div>
                {:else if album.supportedPhotoCount > 0 && album.isValidFormat}
                  <div class="flex items-center gap-2 text-xs">
                    <span class="w-2 h-2 rounded-full bg-gray-400 animate-pulse"></span>
                    <span class="text-gray-500">Analyzing all {album.supportedPhotoCount} photos...</span>
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
        </a>
      {/each}
    </div>
  {/if}
</div>

