// Album parsing and management service

export interface Album {
  handle: FileSystemDirectoryHandle;
  name: string;
  parsedDate: Date | null;
  dateString: string | null;
  isValidFormat: boolean;
  warnings: string[];
  photoCount: number;
  supportedPhotoCount: number;
  unsupportedPhotoCount: number;
  hasNestedDirectories: boolean;
  nestedDirectoryNames: string[];
  status: 'unknown' | 'correct' | 'mixed' | 'incorrect';
  // Detailed status breakdown (will be populated when photos are analyzed)
  photoStatus?: {
    correct: number;           // EXIF date matches album date exactly
    incorrect: number;         // EXIF date doesn't match album date  
    futureDate: number;        // EXIF date is after album date (photo taken later)
    pastDate: number;          // EXIF date is before album date (photo taken earlier)
    missingExif: number;       // No EXIF date found
    unsupported: number;       // Non-JPG files
    totalAnalyzed: number;     // Total photos analyzed
  };
}

export interface Photo {
  handle: FileSystemFileHandle;
  name: string;
  size: number;
  type: string;
  isSupported: boolean;
  exifDate: Date | null;
  exifDateString: string | null;
  status: 'unknown' | 'correct' | 'incorrect' | 'unsupported';
  warnings: string[];
}

/**
 * Parse album name to extract date in YYYYMMdd format
 */
export function parseAlbumDate(albumName: string): {
  date: Date | null;
  dateString: string | null;
  isValid: boolean;
} {
  // Match YYYYMMdd at the start of the name
  const match = albumName.match(/^(\d{8})/);
  
  if (!match) {
    return {
      date: null,
      dateString: null,
      isValid: false
    };
  }

  const dateString = match[1];
  const year = parseInt(dateString.substring(0, 4), 10);
  const month = parseInt(dateString.substring(4, 6), 10);
  const day = parseInt(dateString.substring(6, 8), 10);

  // Validate date components
  if (
    year < 1900 || year > 2100 ||
    month < 1 || month > 12 ||
    day < 1 || day > 31
  ) {
    return {
      date: null,
      dateString,
      isValid: false
    };
  }

  // Try to create a valid date
  const date = new Date(year, month - 1, day);
  
  // Check if the date is valid (handles invalid dates like Feb 30)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return {
      date: null,
      dateString,
      isValid: false
    };
  }

  return {
    date,
    dateString,
    isValid: true
  };
}

/**
 * Check if dates match (date-only comparison)
 */
export function datesMatch(date1: Date | null, date2: Date | null): boolean {
  if (!date1 || !date2) return false;
  
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Compare photo date with album date to categorize relationship
 */
export function categorizePhotoDate(
  albumDate: Date, 
  photoDate: Date | null
): 'correct' | 'futureDate' | 'pastDate' | 'missingExif' {
  if (!photoDate) {
    return 'missingExif';
  }

  if (datesMatch(albumDate, photoDate)) {
    return 'correct';
  }

  // Compare dates to see if photo is before or after album date
  const albumTime = albumDate.getTime();
  const photoTime = photoDate.getTime();

  if (photoTime > albumTime) {
    return 'futureDate'; // Photo was taken after the album date
  } else {
    return 'pastDate'; // Photo was taken before the album date
  }
}

/**
 * Get supported image file extensions
 */
export function getSupportedImageExtensions(): string[] {
  return ['.jpg', '.jpeg', '.JPG', '.JPEG'];
}

/**
 * Check if file is a supported image type
 */
export function isSupportedImageFile(filename: string): boolean {
  const supportedExts = getSupportedImageExtensions();
  return supportedExts.some(ext => filename.endsWith(ext));
}

/**
 * Get all image files from directory
 */
export async function getImageFiles(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemFileHandle[]> {
  const imageFiles: FileSystemFileHandle[] = [];
  
  try {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file') {
        // Check if it's an image file (any extension)
        const ext = name.toLowerCase();
        if (
          ext.endsWith('.jpg') || ext.endsWith('.jpeg') ||
          ext.endsWith('.png') || ext.endsWith('.gif') ||
          ext.endsWith('.bmp') || ext.endsWith('.webp') ||
          ext.endsWith('.heic') || ext.endsWith('.heif') ||
          ext.endsWith('.tiff') || ext.endsWith('.tif')
        ) {
          imageFiles.push(entry);
        }
      }
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }

  return imageFiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check for nested directories in album (warning condition)
 */
export async function checkForNestedDirectories(
  dirHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  const nestedDirs: string[] = [];
  
  try {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'directory') {
        nestedDirs.push(name);
      }
    }
  } catch (error) {
    console.error('Error checking for nested directories:', error);
  }

  return nestedDirs;
}
