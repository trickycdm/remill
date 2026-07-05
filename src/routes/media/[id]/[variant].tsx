import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { serveMedia } from '@/lib/media-serve';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /media/:id/:variant — the variant-ready URL scheme (decision D11). v1 has no
 * transforms, so every variant resolves to the original; the route exists so
 * consumers can adopt `/media/:id/:variant` now and image transforms slot in later
 * without a URL change.
 */
export const onRequestGet = factory.createHandlers((c) => serveMedia(c, pathParam(c, 'id')));
