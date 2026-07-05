import { createFactory } from 'hono/factory';
import type { Context } from 'hono';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { getCollection } from '@/services/collections';
import { listDocuments, createDocument, updateDocument } from '@/services/documents';
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

/** GET /admin/settings — the singleton editor for the `settings` collection. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const { def, doc } = await loadSingleton(c);
  if (!def) {
    return c.render(
      <AdminShell user={user} current="settings">
        <PageHeader title="Settings" description="Site-wide configuration." />
        <EmptyState title="Settings collection missing" description="Re-seed the database to restore it." />
      </AdminShell>,
    );
  }
  return c.render(
    <AdminShell user={user} current="settings">
      <PageHeader title="Settings" description="Site-wide configuration." />
      <div class="max-w-2xl">
        <GeneratedForm def={def} doc={doc} action="/admin/settings" submitLabel="Save settings" />
      </div>
    </AdminShell>,
  );
});

/** POST /admin/settings — create the singleton on first save, update thereafter. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const { db, def, doc } = await loadSingleton(c);
  if (!def) return dsRedirect(c, '/admin/settings');
  const input = coerceAdminForm(def, await c.req.parseBody());
  try {
    if (doc) await updateDocument(db, requirePrincipal(c), 'settings', doc.id, input, nowIso());
    else await createDocument(db, requirePrincipal(c), 'settings', input, nowIso());
    return dsRedirect(c, '/admin/settings');
  } catch (err) {
    return renderSaveError(c, err);
  }
});
