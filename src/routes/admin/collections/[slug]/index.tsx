import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow, updateCollection } from '@/services/collections';
import { nowIso } from '@/lib/now';
import { dsRedirect, jsLiteral } from '@/lib/datastar-response';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Button, Badge } from '@/components/ui';
import { CollectionBuilder, parseCollectionForm } from '@/components/admin/collection-builder';
import { renderSaveError } from '@/lib/save-error';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/collections/:slug — the schema builder, prefilled from the definition. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const slug = pathParam(c, 'slug');
  const def = await getCollectionOrThrow(getDb(c.env.DB), slug);

  return c.render(
    <AdminShell user={user} current="collections">
      <PageHeader
        title={def.name}
        eyebrow="Collections"
        actions={def.protected ? <Badge tone="warning">Protected</Badge> : undefined}
      />

      <div class="mt-8 max-w-3xl">
        <CollectionBuilder def={def} action={`/admin/collections/${slug}`} submitLabel="Save changes" />

        {!def.protected && (
          <form
            method="post"
            action={`/admin/collections/${slug}/delete`}
            class="mt-10 border-t border-border pt-6"
            onsubmit={`return confirm('Delete the ${jsLiteral(def.name)} collection and everything in it? This cannot be undone.')`}
          >
            <Button type="submit" variant="danger" size="sm">
              Delete collection
            </Button>
          </form>
        )}
      </div>
    </AdminShell>,
  );
});

/** POST /admin/collections/:slug — validate + update. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'slug');
  const body = await c.req.parseBody();
  const def = parseCollectionForm(body);
  try {
    await updateCollection(getDb(c.env.DB), requirePrincipal(c), slug, def, nowIso());
    return dsRedirect(c, `/admin/collections/${slug}`);
  } catch (err) {
    return renderSaveError(c, err);
  }
});
