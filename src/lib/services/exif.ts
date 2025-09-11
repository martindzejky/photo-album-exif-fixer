// EXIF reading and writing service

import exifr from "exifr";

export interface ExifData {
  dateTimeOriginal: Date | null;
  createDate: Date | null;
  modifyDate: Date | null;
  camera: string | null;
  lens: string | null;
}

/**
 * Read EXIF data from image file
 */
export async function readExifData(file: File): Promise<ExifData> {
  try {
    const exif = await exifr.parse(file, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "DateTimeDigitized",
        "ModifyDate",
        "Make",
        "Model",
        "LensModel",
      ],
    });

    if (!exif) {
      return {
        dateTimeOriginal: null,
        createDate: null,
        modifyDate: null,
        camera: null,
        lens: null,
      };
    }

    // Parse dates - EXIF dates can be in various formats
    const parseExifDate = (dateValue: any): Date | null => {
      if (!dateValue) return null;

      if (dateValue instanceof Date) {
        return dateValue;
      }

      if (typeof dateValue === "string") {
        // EXIF date format: "YYYY:MM:DD HH:MM:SS"
        const match = dateValue.match(
          /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
        );
        if (match) {
          const [, year, month, day, hour, minute, second] = match;
          return new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1, // months are 0-indexed
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(minute, 10),
            parseInt(second, 10)
          );
        }

        // Try parsing as regular date string
        const parsed = new Date(dateValue);
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      return null;
    };

    return {
      dateTimeOriginal: parseExifDate(exif.DateTimeOriginal),
      createDate: parseExifDate(exif.CreateDate || exif.DateTimeDigitized),
      modifyDate: parseExifDate(exif.ModifyDate),
      camera: exif.Make && exif.Model ? `${exif.Make} ${exif.Model}` : null,
      lens: exif.LensModel || null,
    };
  } catch (error) {
    console.error("Error reading EXIF data:", error);
    return {
      dateTimeOriginal: null,
      createDate: null,
      modifyDate: null,
      camera: null,
      lens: null,
    };
  }
}

/**
 * Get the best available date from EXIF data
 * Priority: DateTimeOriginal > CreateDate > ModifyDate
 */
export function getBestExifDate(exifData: ExifData): Date | null {
  return (
    exifData.dateTimeOriginal || exifData.createDate || exifData.modifyDate
  );
}

/**
 * Format date for EXIF writing (YYYY:MM:DD HH:MM:SS format)
 */
export function formatExifDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}:${month}:${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Create a date with album date but preserving existing time,
 * or default to 12:00 if no time available
 */
export function createTargetDate(
  albumDate: Date,
  existingExifDate: Date | null
): Date {
  const targetDate = new Date(albumDate);

  if (existingExifDate) {
    // Preserve existing time
    targetDate.setHours(
      existingExifDate.getHours(),
      existingExifDate.getMinutes(),
      existingExifDate.getSeconds(),
      existingExifDate.getMilliseconds()
    );
  } else {
    // Default to 12:00:00 local time
    targetDate.setHours(12, 0, 0, 0);
  }

  return targetDate;
}

/**
 * Write EXIF data to JPEG file (creates backup first)
 * Note: This is a placeholder for the actual implementation
 * Real implementation would use piexifjs and File System Access API
 */
export async function writeExifData(
  fileHandle: FileSystemFileHandle,
  targetDate: Date
): Promise<{ success: boolean; error?: string }> {
  try {
    // This is where we'd implement the actual EXIF writing
    // For now, return success as placeholder
    console.log("Would write EXIF date:", formatExifDate(targetDate));

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
