/**
 * Strict base64 decoding for the MCP `upload_media` tool (D34). Validates the
 * charset/padding BEFORE decoding — `Buffer.from(s, 'base64')` silently skips
 * invalid characters, which would let corrupted payloads decode to garbage
 * bytes instead of failing loudly.
 */

import { Buffer } from 'node:buffer';
import { InputValidationError } from '@/lib/errors';

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decode standard base64 (whitespace tolerated) into bytes, or throw a 400. */
export function decodeBase64(input: string, path = 'content_base64'): Uint8Array {
  const clean = input.replace(/\s+/g, '');
  if (clean.length === 0 || clean.length % 4 !== 0 || !BASE64_RE.test(clean)) {
    throw new InputValidationError([{ path, message: 'Not valid base64 content.' }]);
  }
  return new Uint8Array(Buffer.from(clean, 'base64'));
}
