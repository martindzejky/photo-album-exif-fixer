// EXIF reading and writing service

import exifr from "exifr";
import piexif from "piexifjs";

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
    // Only JPEG supported (detect by MIME or filename extension)
    const file = await fileHandle.getFile();
    if (!file) {
      return { success: false, error: "Could not read file from handle" };
    }

    const name = (fileHandle as any).name as string | undefined;
    const isJpegByName = !!name && /\.jpe?g$/i.test(name);
    if (!isJpegByName) {
      return {
        success: false,
        error: "Only JPEG files are supported for EXIF writing",
      };
    }

    // Read original bytes
    const dataUrl = await fileToDataURL(file);

    // Extract existing EXIF, or create a new one
    let exifObj: any;
    try {
      const exifDict = piexif.load(dataUrl);
      exifObj = exifDict;
    } catch {
      exifObj = { "0th": {}, Exif: {}, GPS: {}, Interop: {}, "1st": {} };
    }

    const formatted = formatExifDate(targetDate);

    // Tags: set all 3 for consistency
    const exifIFD = exifObj.Exif || (exifObj.Exif = {});
    const zerothIFD = exifObj["0th"] || (exifObj["0th"] = {});

    exifIFD[piexif.ExifIFD.DateTimeOriginal] = formatted;
    exifIFD[piexif.ExifIFD.DateTimeDigitized] = formatted; // CreateDate
    zerothIFD[piexif.ImageIFD.DateTime] = formatted; // ModifyDate equivalent in 0th IFD

    // Insert EXIF back
    const exifBytes = piexif.dump(exifObj);
    const newDataUrl = piexif.insert(exifBytes, dataUrl);

    // Write back to the same handle (createWritable overwrites)
    const writable = await fileHandle.createWritable();
    await writable.write(binaryStringToUint8Array(newDataUrl));
    await writable.close();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function fileToDataURL(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function binaryStringToUint8Array(b64DataUrl: string): Uint8Array {
  // piexif.insert returns data URL string. We need raw bytes from it
  const base64 = b64DataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
