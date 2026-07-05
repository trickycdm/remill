/**
 * Shared list-query parsing (steering/API_AND_MCP_STANDARDS.md). BOTH the REST
 * surface (src/lib/api.ts) and the MCP surface (src/mcp/tools.ts) parse the same
 * `?sort=` grammar and clamp page sizes the same way, so the two doors behave
 * identically — one place to change, not three. See TD-4.
 */

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';

export interface SortSpec {
  readonly field: string;
  readonly dir: 'asc' | 'desc';
}

/** Parse a sort token. A leading `-` means descending (`-title` → title desc).
 *  Empty/undefined yields no sort. */
export function parseSort(raw: string | undefined): SortSpec | undefined {
  if (!raw) return undefined;
  return raw.startsWith('-') ? { field: raw.slice(1), dir: 'desc' } : { field: raw, dir: 'asc' };
}

/** Clamp a requested page number to an integer >= 1 (default 1). */
export function clampPage(raw: unknown): number {
  const n = Math.floor(Number(raw ?? 1));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Clamp a requested page size into [1, MAX_PAGE_SIZE] (default DEFAULT_PAGE_SIZE). */
export function clampPageSize(raw: unknown): number {
  const n = Math.floor(Number(raw ?? DEFAULT_PAGE_SIZE));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}
