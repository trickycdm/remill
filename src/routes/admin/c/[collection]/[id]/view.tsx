import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { getDocument, getBacklinks } from '@/services/documents';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Button } from '@/components/ui';
import { DocumentView } from '@/components/document-view';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c/:collection/:id/view — the read-only detail view (C2): the same
 *  DocumentView the public page renders, on the admin surface (admin-routed
 *  links, drafts visible to those who may read them). */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const now = nowIso();
  const principal = requirePrincipal(c);

  const def = await getCollectionOrThrow(db, slug);
  const doc = await getDocument(db, principal, slug, id, now);
  const backlinks = await getBacklinks(db, principal, slug, id, now);

  // The public URL, when this document is publicly reachable right now.
  const slugField = def.fields.find((f) => f.type === 'slug' && f.index);
  const slugValue = slugField ? doc.data[slugField.key] : undefined;
  const publicHref =
    def.access?.publicRead && doc.status === 'published'
      ? `/${slug}/${typeof slugValue === 'string' && slugValue ? slugValue : doc.id}`
      : undefined;

  return c.render(
    <AdminShell user={user} current="content">
      <PageHeader
        breadcrumb={[
          { label: 'Content', href: '/admin/c' },
          { label: def.name, href: `/admin/c/${slug}` },
          { label: 'View' },
        ]}
        title={`View ${def.name}`}
        actions={
          <div class="flex items-center gap-2">
            {publicHref ? (
              <Button href={publicHref} variant="ghost" size="sm">
                Public page ↗
              </Button>
            ) : null}
            <Button href={`/admin/c/${slug}/${id}`} variant="secondary" size="sm">
              Edit
            </Button>
          </div>
        }
      />
      <div class="max-w-2xl">
        <DocumentView def={def} doc={doc} backlinks={backlinks} surface="admin" />
      </div>
    </AdminShell>,
  );
});
