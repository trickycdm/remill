import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { serveMedia } from '@/lib/media-serve';

const factory = createFactory<{ Bindings: Env }>();

/** GET /media/:id — stream the original asset from R2 (range-capable, cached). */
export const onRequestGet = factory.createHandlers((c) => serveMedia(c, pathParam(c, 'id')));
