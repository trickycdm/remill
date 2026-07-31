/**
 * POST /admin/settings/snapshot — full-site snapshot to R2 (D37): every
 * collection def + all documents + media metadata under `snapshots/<ISO>/`.
 * Admin-gated like the rest of Settings; the service additionally authorizes
 * `manage_schema` (the rebuild-search precedent). Cron scheduling is
 * deliberately NOT wired in v1 (hook point in src/jobs).
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { snapshotSite } from '@/services/transfer';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireRole('admin'), async (c) => {
  const { prefix } = await snapshotSite(
    getDb(c.env.DB),
    c.env.MEDIA,
    requirePrincipal(c),
    nowIso(),
  );
  return c.redirect(`/admin/settings?snapshot=${encodeURIComponent(prefix)}`, 303);
});
