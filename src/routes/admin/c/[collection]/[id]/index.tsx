import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollection } from '@/services/collections';
import { getDocument, updateDocument, listRevisions } from '@/services/documents';
import { coerceAdminForm } from '@/lib/admin-form';
import { nowIso } from '@/lib/now';
import { dsRedirect, jsLiteral } from '@/lib/datastar-response';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Button, Badge, Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { GeneratedForm } from '@/components/admin/generated';
import { NotFoundError } from '@/lib/errors';
import { renderSaveError } from '@/lib/save-error';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c/:collection/:id — the generated edit form + publish + revisions. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const def = await getCollection(db, slug);
  if (!def) throw new NotFoundError('Collection');

  const principal = requirePrincipal(c);
  const now = nowIso();
  const doc = await getDocument(db, principal, slug, id, now);
  const revisions = await listRevisions(db, principal, slug, id, now);
  const published = doc.status === 'published';

  return c.render(
    <AdminShell user={user} current="content">
      <PageHeader
        title={`Edit ${def.name}`}
        eyebrow={def.name}
        actions={
          <div class="flex items-center gap-3">
            <Badge tone={published ? 'success' : 'neutral'}>{doc.status}</Badge>
            {def.workflow?.draftPublish && (
              <form method="post" action={`/admin/c/${slug}/${id}/publish`} class="contents">
                <input type="hidden" name="publish" value={published ? '0' : '1'} />
                <Button type="submit" variant={published ? 'secondary' : 'primary'}>
                  {published ? 'Unpublish' : 'Publish'}
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div class="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div class="max-w-2xl">
          <GeneratedForm def={def} doc={doc} action={`/admin/c/${slug}/${id}`} submitLabel="Save changes" />

          <form
            method="post"
            action={`/admin/c/${slug}/${id}/delete`}
            class="mt-8 border-t border-border pt-6"
            onsubmit={`return confirm('Delete this ${jsLiteral(def.name.toLowerCase())}? This cannot be undone.')`}
          >
            <Button type="submit" variant="danger" size="sm">
              Delete
            </Button>
          </form>
        </div>

        <aside>
          <Card>
            <CardHeader>
              <CardTitle>Revisions</CardTitle>
            </CardHeader>
            <CardContent>
              <ol class="flex flex-col gap-2 text-sm">
                {revisions.map((r) => (
                  <li class="flex items-center justify-between gap-2">
                    <span class="font-mono text-xs text-ink-subtle">
                      #{r.revision} · {r.savedAt.slice(0, 16).replace('T', ' ')}
                    </span>
                    {r.revision !== revisions[0]?.revision && (
                      <form method="post" action={`/admin/c/${slug}/${id}/restore`} class="contents">
                        <input type="hidden" name="revision" value={String(r.revision)} />
                        <button type="submit" class="text-xs text-accent-text hover:underline">
                          Restore
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </div>
    </AdminShell>,
  );
});

/** POST /admin/c/:collection/:id — validate + update. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const def = await getCollection(db, slug);
  if (!def) throw new NotFoundError('Collection');

  const body = await c.req.parseBody();
  const input = coerceAdminForm(def, body);
  try {
    await updateDocument(db, requirePrincipal(c), slug, id, input, nowIso());
    return dsRedirect(c, `/admin/c/${slug}/${id}`);
  } catch (err) {
    return renderSaveError(c, err);
  }
});
