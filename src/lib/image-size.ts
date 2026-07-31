/**
 * Extract pixel dimensions from image header bytes — no full decode, cheap
 * (MEDIA_STANDARDS.md: "dimensions/duration where cheap"). Covers PNG, GIF, JPEG.
 * Returns null when unknown (e.g. WebP, or a truncated header) — callers store
 * null dimensions rather than guessing.
 */

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

export function imageSize(bytes: Uint8Array, mime: string): Dimensions | null {
  try {
    if (mime === 'image/png') return pngSize(bytes);
    if (mime === 'image/gif') return gifSize(bytes);
    if (mime === 'image/jpeg') return jpegSize(bytes);
  } catch {
    return null;
  }
  return null;
}

function pngSize(b: Uint8Array): Dimensions | null {
  // IHDR width/height are big-endian uint32 at offsets 16 and 20.
  if (b.length < 24) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifSize(b: Uint8Array): Dimensions | null {
  // Logical screen width/height are little-endian uint16 at offsets 6 and 8.
  if (b.length < 10) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function jpegSize(b: Uint8Array): Dimensions | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let offset = 2; // skip SOI (0xFFD8)
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) return null;
    const marker = b[offset + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry dimensions.
    const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    const segmentLength = view.getUint16(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}
