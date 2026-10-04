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
import { readingPageOf } from '@/lib/def-helpers';

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

  // The styled reading page, when the collection has one (`readingPageOf`:
  // D50-aware URL, `?preview=1` — D49, session principal — for anything an
  // anonymous reader can't open).
  const readingPage = readingPageOf(def, doc);

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
            {readingPage ? (
              <Button href={readingPage.href} variant="ghost" size="sm">
                {readingPage.live ? 'Public page ↗' : 'Preview ↗'}
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
