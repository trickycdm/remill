import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { getDocument, getBacklinks, listRevisionMeta } from '@/services/documents';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Button } from '@/components/ui';
import { DocumentView } from '@/components/document-view';
import { readingPageOf, titleOf, effectiveVisibility } from '@/lib/def-helpers';
import { ViewerShell } from '@/components/layouts/viewer-shell';
import { framePageHtml, pageFieldOf } from '@/lib/frame/document';
import { Script } from 'vite-ssr-components/hono';
import { principalPanel } from '@/lib/review-http';
import { ForbiddenError } from '@/lib/errors';
import { mintFrameSrc } from '@/services/frame';
import { canAuthorize } from '@/access';
import { getSettings } from '@/services/settings';
import { getShareOverview, canSeeSharing } from '@/services/sharing';
import { resolveBaseUrl } from '@/lib/base-url';
import { ShareDrawer, SHARE_DRAWER_ID } from '@/components/admin/share-drawer';
import { VersionsDrawer, RestoreForm, VERSIONS_DRAWER_ID } from '@/components/viewer/versions-drawer';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c/:collection/:id/view — the read-only detail view (C2): the same
 *  DocumentView the public page renders, on the admin surface (admin-routed
 *  links, drafts visible to those who may read them). A frame-mode collection
 *  (D60) gets the viewer shell instead. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const now = nowIso();
  const principal = requirePrincipal(c);

  const def = await getCollectionOrThrow(db, slug);
  const doc = await getDocument(db, principal, slug, id, now);

  // Frame mode (D60): the page renders in the viewer shell's sandboxed iframe,
  // never inlined into the admin DOM — the author's scripts must not run on
  // the admin origin. The bar carries what this principal may do: share, look
  // through versions, download, edit.
  if (framePageHtml(def, doc.data) !== null) {
    const title = titleOf(def, doc);
    const resource = { collection: slug, documentId: id };
    const canUpdate = await canAuthorize(db, principal, 'update', resource, now);
    const settings = await getSettings(db);
    const overview = await getShareOverview(
      db,
      principal,
      def,
      id,
      { secret: c.env.SESSION_SECRET, baseUrl: resolveBaseUrl(c.env, settings, c.req.url) },
      now,
    );

    // `?rev=N` frames a past revision — only for someone who may update (the
    // frame read enforces the same gate). Anything else shows the current one.
    const asked = Number(c.req.query('rev') ?? 0);
    const viewing = canUpdate && Number.isInteger(asked) && asked > 0 && asked < doc.revision ? asked : doc.revision;
    const past = viewing !== doc.revision;
    const versions = canUpdate ? await listRevisionMeta(db, principal, slug, id, now) : [];
    const open = (drawer: string) => `document.getElementById('${drawer}').showModal()`;

    // Comments (D55): `?review=1` docks the review panel beside the frame, for
    // a principal who may take part. Only on the current version — anchors are
    // located against the live text.
    const field = pageFieldOf(def);
    const view = `/admin/c/${slug}/${id}/view`;
    let panel: unknown = null;
    if (!past && field && c.req.query('review') != null) {
      try {
        panel = await principalPanel(db, principal, slug, id, now);
      } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
      }
    }
    const canReview =
      !past && field && (panel !== null || (await canAuthorize(db, principal, 'comment', resource, now)));

    return c.render(
      <ViewerShell
        title={title}
        frameSrc={await mintFrameSrc(c.env.SESSION_SECRET, principal, doc.id, now, past ? viewing : 0)}
        home={{ href: `/admin/c/${slug}`, label: `Back to ${def.name}` }}
        visibility={effectiveVisibility(def, doc)}
        actions={
          <>
            {canSeeSharing(overview) ? (
              <Button variant="secondary" size="sm" aria-haspopup="dialog" data-on:click={open(SHARE_DRAWER_ID)}>
                Share
              </Button>
            ) : null}
            {canReview ? (
              <Button href={panel ? view : `${view}?review=1`} variant="ghost" size="sm">
                {panel ? 'Hide comments' : 'Comments'}
              </Button>
            ) : null}
            {versions.length > 1 ? (
              <Button variant="ghost" size="sm" aria-haspopup="dialog" data-on:click={open(VERSIONS_DRAWER_ID)}>
                Versions
              </Button>
            ) : null}
            <Button
              href={`/admin/c/${slug}/${id}/download${past ? `?rev=${viewing}` : ''}`}
              variant="ghost"
              size="sm"
            >
              Download
            </Button>
            {canUpdate ? (
              <Button href={`/admin/c/${slug}/${id}`} variant="ghost" size="sm">
                Edit
              </Button>
            ) : null}
          </>
        }
        notice={
          past ? (
            <div
              role="status"
              class="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-warning-soft px-4 py-2 text-sm text-warning"
            >
              <span>
                Version {viewing} of {doc.revision}. This is not the current page.
              </span>
              <span class="flex items-center gap-2">
                <Button href={`/admin/c/${slug}/${id}/view`} variant="ghost" size="sm">
                  Back to current
                </Button>
                <RestoreForm slug={slug} id={id} revision={viewing} variant="secondary" />
              </span>
            </div>
          ) : undefined
        }
        review={panel && field ? { panel, field } : undefined}
      >
        {panel ? <Script src="/src/client/review.ts" /> : null}
        {canSeeSharing(overview) ? (
          <ShareDrawer
            slug={slug}
            id={id}
            def={def}
            doc={doc}
            overview={overview}
            settings={settings}
            surface="viewer"
          />
        ) : null}
        {versions.length > 1 ? (
          <VersionsDrawer slug={slug} id={id} versions={versions} current={doc.revision} viewing={viewing} />
        ) : null}
      </ViewerShell>,
      { title, bare: true, noindex: true },
    );
  }

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
