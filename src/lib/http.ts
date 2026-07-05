/**
 * Small HTTP helpers for routes. `pathParam` reads a required path segment as a
 * definite string — the route only matches when the segment is present, so a
 * missing one is a routing bug, surfaced as a 400 rather than an `undefined` leak.
 */

import type { Context } from 'hono';
import { BadRequestError } from '@/lib/errors';

export function pathParam(c: Context, name: string): string {
  const v = c.req.param(name);
  if (v === undefined || v === '') throw new BadRequestError(`Missing route parameter '${name}'`);
  return v;
}
