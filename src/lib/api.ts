/**
 * REST helpers (steering/API_AND_MCP_STANDARDS.md). Resolve the bearer principal,
 * parse JSON bodies, and stamp the (stubbed, v1) rate-limit headers. Responses are
 * plain JSON; errors flow through the global onError (which returns JSON + the
 * structured 403 for /api paths).
 */

import type { Context } from 'hono';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { resolvePrincipal } from '@/lib/api-auth';
import { AppError, BadRequestError } from '@/lib/errors';
import type { Principal } from '@/access';
import { parseSort, clampPage, clampPageSize, type SortSpec } from '@/lib/list-query';
import { FILTER_OPS, type FilterOp } from '@/services/documents';
import {
  GLOBAL_RATE_LIMIT,
  RATE_LIMIT_INFO_KEY,
  type RateLimitInfo,
} from '@/middleware/rate-limit';

/** Max accepted JSON request-body size (SEC-4). Content beyond this is a DoS vector;
 *  reject before parsing. 1 MiB is generous for document/collection payloads. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** The /mcp body cap (D34) — larger than REST's because `upload_media` carries
 *  base64 file content (~33% inflation ⇒ ~6 MiB effective file). Larger files
 *  use REST multipart POST /api/media (25 MiB service cap). */
export const MAX_MCP_BODY_BYTES = 8 * 1024 * 1024;

/** The NDJSON import body cap (D37) — larger imports split into multiple files
 *  (documented in API_AND_MCP_STANDARDS; per-line format makes splitting trivial). */
export const MAX_IMPORT_BODY_BYTES = 10 * 1024 * 1024;

export async function apiPrincipal(c: Context<{ Bindings: Env }>, now: string): Promise<Principal> {
  return resolvePrincipal(getDb(c.env.DB), c, 'rest', now);
}

/**
 * Guard a request body against oversized payloads (SEC-4). Rejects with 413 when the
 * declared `Content-Length` exceeds `max`. Shared by the REST and MCP entrypoints.
 */
export function assertBodyWithinLimit(c: Context, max = MAX_JSON_BODY_BYTES): void {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) {
    throw new AppError(
      `Request body ${declared} bytes exceeds the ${max}-byte limit`,
      413,
      'PAYLOAD_TOO_LARGE',
      'Request body is too large.',
    );
  }
}

/** Parse a JSON request body into a plain object, or throw. Enforces the size cap. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  assertBodyWithinLimit(c);
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new BadRequestError('Request body must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/** Parse REST list query params (?page, ?pageSize, ?status, ?sort, ?q,
 *  ?filter[f]=v and ?filter[f][op]=v — D28). Operator entries for one field
 *  merge, so `filter[views][gte]=10&filter[views][lte]=20` is a range. */
export function listQuery(c: Context): {
  page: number;
  pageSize: number;
  status?: 'draft' | 'published';
  sort?: SortSpec;
  q?: string;
  filters: Record<string, Partial<Record<FilterOp, string>>>;
} {
  const q = c.req.query();
  const filters: Record<string, Partial<Record<FilterOp, string>>> = {};
  for (const [k, v] of Object.entries(q)) {
    const m = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(k);
    if (!m) continue;
    const [, field, rawOp] = m;
    const op = rawOp ?? 'eq';
    if (!FILTER_OPS.includes(op as FilterOp)) {
      throw new BadRequestError(`Unknown filter operator '${op}' (expected ${FILTER_OPS.join('/')}).`);
    }
    filters[field] = { ...filters[field], [op]: v };
  }
  const status = q.status === 'draft' || q.status === 'published' ? q.status : undefined;
  return {
    page: clampPage(q.page),
    pageSize: clampPageSize(q.pageSize),
    status,
    sort: parseSort(q.sort),
    q: typeof q.q === 'string' && q.q.trim() ? q.q : undefined,
    filters,
  };
}

/**
 * A JSON response stamped with the REAL rate-limit headers (SEC-2). The limiter
 * middleware records its decision on the context; if it did not run (e.g. the KV
 * binding is absent in tests), fall back to the global tier so REST clients always
 * see a coherent quota.
 */
export function apiJson(c: Context, body: unknown, status = 200): Response {
  const info = c.get(RATE_LIMIT_INFO_KEY) as RateLimitInfo | undefined;
  const limit = info?.limit ?? GLOBAL_RATE_LIMIT.limit;
  const remaining = info?.remaining ?? GLOBAL_RATE_LIMIT.limit;
  return c.json(body as object, status as 200, {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
  });
}
