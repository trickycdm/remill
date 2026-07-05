/**
 * Magic-number MIME sniffing (steering/MEDIA_STANDARDS.md, SECURITY_STANDARDS.md).
 * NEVER trust the client-declared type or the filename extension — the stored mime
 * is the SNIFFED type. A file whose sniffed type isn't on the allowlist is rejected.
 *
 * We read the leading bytes and match known signatures. This is intentionally a
 * small, conservative set covering the media the CMS accepts; unknown → rejected.
 */

export interface SniffResult {
  readonly mime: string;
  readonly kind: 'image' | 'audio' | 'video' | 'document';
}

/** The accepted types. Anything not represented here is rejected on upload. */
const SIGNATURES: Array<{
  mime: string;
  kind: SniffResult['kind'];
  test: (b: Uint8Array) => boolean;
}> = [
  { mime: 'image/jpeg', kind: 'image', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', kind: 'image', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif', kind: 'image', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', kind: 'image', test: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
  { mime: 'application/pdf', kind: 'document', test: (b) => ascii(b, 0, '%PDF-') },
  { mime: 'audio/mpeg', kind: 'audio', test: (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { mime: 'audio/wav', kind: 'audio', test: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE') },
  { mime: 'audio/ogg', kind: 'audio', test: (b) => ascii(b, 0, 'OggS') },
  // ISO-BMFF (mp4/m4a/mov): 'ftyp' box at offset 4; distinguish audio vs video by brand.
  { mime: 'video/mp4', kind: 'video', test: (b) => ascii(b, 4, 'ftyp') && !ascii(b, 8, 'M4A') },
  { mime: 'audio/mp4', kind: 'audio', test: (b) => ascii(b, 4, 'ftyp') && ascii(b, 8, 'M4A') },
  { mime: 'video/webm', kind: 'video', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

function ascii(b: Uint8Array, offset: number, str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (b[offset + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

/** Sniff the leading bytes. Returns null if the type isn't on the allowlist. */
export function sniffMime(bytes: Uint8Array): SniffResult | null {
  for (const sig of SIGNATURES) {
    if (sig.test(bytes)) return { mime: sig.mime, kind: sig.kind };
  }
  return null;
}

/** Number of leading bytes sniffing needs (enough for every signature above). */
export const SNIFF_BYTES = 16;
