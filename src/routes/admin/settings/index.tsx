import { createFactory } from 'hono/factory';
import type { Context } from 'hono';
import type { Env } from '@/types';
import { requireRole, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { getCollection } from '@/services/collections';
import { listDocuments, createDocument, updateDocument } from '@/services/documents';
import { getSettings } from '@/services/settings';
import { coerceAdminForm } from '@/lib/admin-form';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, EmptyState } from '@/components/ui';
import { GeneratedForm } from '@/components/admin/generated';
import { renderSaveError } from '@/lib/save-error';

const factory = createFactory<{ Bindings: Env }>();

async function loadSingleton(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB);
  const def = await getCollection(db, 'settings');
  if (!def) return { db, def: null, doc: undefined };
  const { rows } = await listDocuments(db, requirePrincipal(c), 'settings', { pageSize: 1 }, nowIso());
  return { db, def, doc: rows[0] };
}

/**
 * GET /admin/settings — the singleton editor for the `settings` collection.
 *
 * Admin-only (requireRole('admin')): instance configuration is a schema/access-tier
 * concern, matching how Collections and Access are gated. The `editor` role no longer
 * sees Settings in the nav, and this guard denies a direct hit (401 no session / 403
 * wrong role).
 */
export const onRequestGet = factory.createHandlers(requireRole('admin'), async (c) => {
  const user = getUser(c);
  const { db, def, doc } = await loadSingleton(c);
  const settings = await getSettings(db);
  // Echo the saved site name so the surface visibly reflects a stored value.
  const description = `Configure ${settings.siteName || 'your site'}.`;
  if (!def) {
    return c.render(
      <AdminShell user={user} current="settings">
        <PageHeader title="Settings" description={description} />
        <EmptyState title="Settings collection missing" description="Re-seed the database to restore it." />
      </AdminShell>,
    );
  }
  return c.render(
    <AdminShell user={user} current="settings">
      <PageHeader title="Settings" description={description} />
      <div class="max-w-2xl">
        <GeneratedForm def={def} doc={doc} action="/admin/settings" submitLabel="Save settings" />
      </div>
    </AdminShell>,
  );
});

/** POST /admin/settings — create the singleton on first save, update thereafter. */
export const onRequestPost = factory.createHandlers(requireRole('admin'), async (c) => {
  const { db, def, doc } = await loadSingleton(c);
  if (!def) return dsRedirect(c, '/admin/settings');
  // all: true so a <select multiple> posts repeated keys as an array (COR-4).
  const input = coerceAdminForm(def, await c.req.parseBody({ all: true }));
  try {
    if (doc) await updateDocument(db, requirePrincipal(c), 'settings', doc.id, input, nowIso());
    else await createDocument(db, requirePrincipal(c), 'settings', input, nowIso());
    return dsRedirect(c, '/admin/settings');
  } catch (err) {
    return renderSaveError(c, err);
  }
});
