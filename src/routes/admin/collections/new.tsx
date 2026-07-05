import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { createCollection } from '@/services/collections';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader } from '@/components/ui';
import { CollectionBuilder, parseCollectionForm } from '@/components/admin/collection-builder';
import { renderSaveError } from '@/lib/save-error';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/collections/new — the empty schema builder. */
export const onRequestGet = factory.createHandlers(requireAuth(), (c) => {
  const user = getUser(c);
  return c.render(
    <AdminShell user={user} current="collections">
      <PageHeader title="New collection" eyebrow="Collections" />
      <div class="mt-8 max-w-3xl">
        <CollectionBuilder action="/admin/collections/new" submitLabel="Create collection" />
      </div>
    </AdminShell>,
  );
});

/** POST /admin/collections/new — validate + create, then redirect to the editor. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const def = parseCollectionForm(body);
  try {
    const created = await createCollection(getDb(c.env.DB), requirePrincipal(c), def, nowIso());
    return dsRedirect(c, `/admin/collections/${created.slug}`);
  } catch (err) {
    return renderSaveError(c, err);
  }
});
