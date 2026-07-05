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
import { BadRequestError } from '@/lib/errors';
import type { Principal } from '@/access';

export async function apiPrincipal(c: Context<{ Bindings: Env }>, now: string): Promise<Principal> {
  return resolvePrincipal(getDb(c.env.DB), c, 'rest', now);
}

/** Parse a JSON request body into a plain object, or throw 400. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
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

/** Parse REST list query params (?page, ?pageSize, ?status, ?sort, ?filter[f]=v). */
export function listQuery(c: Context): {
  page: number;
  pageSize: number;
  status?: 'draft' | 'published';
  sort?: { field: string; dir: 'asc' | 'desc' };
  filters: Record<string, string>;
} {
  const q = c.req.query();
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    const m = /^filter\[(.+)\]$/.exec(k);
    if (m) filters[m[1]] = v;
  }
  const sortRaw = q.sort;
  const sort = sortRaw
    ? sortRaw.startsWith('-')
      ? { field: sortRaw.slice(1), dir: 'desc' as const }
      : { field: sortRaw, dir: 'asc' as const }
    : undefined;
  const status = q.status === 'draft' || q.status === 'published' ? q.status : undefined;
  return {
    page: Number(q.page ?? '1') || 1,
    pageSize: Number(q.pageSize ?? '25') || 25,
    status,
    sort,
    filters,
  };
}

/** A JSON response with the stubbed rate-limit headers (not enforced in v1). */
export function apiJson(c: Context, body: unknown, status = 200): Response {
  return c.json(body as object, status as 200, {
    'X-RateLimit-Limit': '1000',
    'X-RateLimit-Remaining': '1000',
  });
}
