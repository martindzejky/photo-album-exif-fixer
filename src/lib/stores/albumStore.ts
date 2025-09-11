// Album data store for caching between page navigations

import type { Album } from '$lib/services/albums';

interface AlbumStore {
  albums: Album[];
  lastScanTime: number | null;
  rootFolderName: string | null;
}

let albumCache: AlbumStore = {
  albums: [],
  lastScanTime: null,
  rootFolderName: null
};

export const albumStore = {
  /**
   * Get cached albums if still valid
   */
  getAlbums: (currentRootName: string): Album[] | null => {
    // Return cached data if it's for the same root folder and less than 5 minutes old
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();
    
    if (
      albumCache.rootFolderName === currentRootName &&
      albumCache.lastScanTime &&
      (now - albumCache.lastScanTime) < fiveMinutes &&
      albumCache.albums.length > 0
    ) {
      return albumCache.albums;
    }
    
    return null;
  },

  /**
   * Cache albums data
   */
  setAlbums: (albums: Album[], rootFolderName: string): void => {
    albumCache = {
      albums: [...albums],
      lastScanTime: Date.now(),
      rootFolderName
    };
  },

  /**
   * Clear cache (useful when folder changes)
   */
  clearCache: (): void => {
    albumCache = {
      albums: [],
      lastScanTime: null,
      rootFolderName: null
    };
  },

  /**
   * Update a specific album in cache (useful after analyzing photos)
   */
  updateAlbum: (albumName: string, updates: Partial<Album>): void => {
    const index = albumCache.albums.findIndex(album => album.name === albumName);
    if (index !== -1) {
      albumCache.albums[index] = { ...albumCache.albums[index], ...updates };
    }
  }
};
