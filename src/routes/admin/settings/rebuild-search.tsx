/**
 * POST /admin/settings/rebuild-search — recompute every document's FTS row
 * (D28): the post-deploy backfill for migration 0007 and the drift-recovery
 * path. Admin-gated like the rest of Settings; the service additionally
 * authorizes `manage_schema`.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { rebuildSearchIndex } from '@/services/search';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireRole('admin'), async (c) => {
  const count = await rebuildSearchIndex(getDb(c.env.DB), requirePrincipal(c), nowIso());
  return c.redirect(`/admin/settings?rebuilt=${count}`, 303);
});
