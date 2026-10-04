import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow, countExposableDocuments } from '@/services/collections';
import {
  getDocument,
  updateDocument,
  listRevisions,
  getBacklinks,
  getAuthorName,
  parseExpectedRevision,
} from '@/services/documents';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { readingPageOf, effectiveVisibility } from '@/lib/def-helpers';
import { hasLifecycle } from '@/lib/lifecycle';
import { getShareOverview, canSeeSharing } from '@/services/sharing';
import { canAuthorize } from '@/access';
import { coerceAdminForm } from '@/lib/admin-form';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { AdminShell, navKeyForCollection } from '@/components/layouts/admin-shell';
import { PageHeader, Button, Badge } from '@/components/ui';
import { formatDate } from '@/lib/format-date';
import { GeneratedForm } from '@/components/admin/generated';
import { EditorSidebar, MobileSaveBar } from '@/components/admin/editor-sidebar';
import { ShareDrawer, ShareSummary } from '@/components/admin/share-drawer';
import { VisibilityStamp } from '@/components/admin/visibility-stamp';
import { BacklinksPanel } from '@/components/admin/backlinks-panel';
import { renderSaveError } from '@/lib/save-error';
import { hasAnnotatableFields, listThreads } from '@/services/comments';
import { CommentsSection } from '@/components/admin/review-section';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c/:collection/:id — the generated edit form + publish + revisions. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const def = await getCollectionOrThrow(db, slug);

  const principal = requirePrincipal(c);
  const now = nowIso();
  const doc = await getDocument(db, principal, slug, id, now);
  const revisions = await listRevisions(db, principal, slug, id, now);
  const backlinks = await getBacklinks(db, principal, slug, id, now);
  const settings = await getSettings(db);

  // Sharing (D51/D55): one gated overview feeds both the rail summary and the
  // Share drawer — links need `share_link` on this document, People & roles
  // needs install-wide manage_access (src/services/sharing).
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
  const overview = await getShareOverview(db, principal, def, id, { secret: c.env.SESSION_SECRET, baseUrl }, now);
  const showSharing = canSeeSharing(overview);
  // The Comments section needs `comment`, on collections with something to annotate.
  const canComment =
    hasAnnotatableFields(def) && (await canAuthorize(db, principal, 'comment', { collection: slug, documentId: id }, now));
  const threads = canComment ? await listThreads(db, { kind: 'principal', principal }, slug, id, {}, now) : null;

  // Visibility on a collection without public pages (D57): may this viewer
  // turn them on, and how many OTHER documents would that switch to private?
  const canManageSchema =
    !def.access?.publicRead && (await canAuthorize(db, principal, 'manage_schema', { collection: slug }, now));
  const enablePublic = def.access?.publicRead
    ? undefined
    : {
        canManageSchema,
        otherCount: canManageSchema
          ? (await countExposableDocuments(db, principal, slug, now)) - (doc.visibility !== 'private' ? 1 : 0)
          : 0,
      };
  const audience = effectiveVisibility(def, doc);

  // Title the page by the document's primary display value (its first list field),
  // falling back to a generic edit label for an untitled doc.
  const titleField = def.fields.find((f) => f.admin?.showInList) ?? def.fields[0];
  const rawTitle = titleField ? doc.data[titleField.key] : undefined;
  const docTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : `Edit ${def.name}`;

  // Header action: a collection with a reading page gets exactly one — "View
  // live ↗" once an anonymous reader can open it, else "Preview ↗" (D49: the
  // session principal; covers drafts, private documents, and templated
  // non-publicRead collections). `readingPageOf` resolves the D50-aware URL.
  // Collections with no reading page fall back to the internal View.
  const readingPage = readingPageOf(def, doc);
  const headerAction = readingPage
    ? {
        href: readingPage.href,
        label: readingPage.live ? 'View live ↗' : 'Preview ↗',
        ariaLabel: readingPage.live
          ? 'View the live public page (opens in new tab)'
          : 'Preview public page (opens in new tab)',
      }
    : { href: `/admin/c/${slug}/${id}/view`, label: 'View', ariaLabel: undefined };

  const authorName = doc.createdBy
    ? doc.createdBy === principal.id
      ? 'You'
      : await getAuthorName(db, doc.createdBy)
    : '—';

  return c.render(
    <AdminShell user={user} current={navKeyForCollection(slug)}>
      {/* Editor islands (D38) — Scripts live in ROUTE files (vite-ssr-components
          only discovers them here + layouts.tsx, never in shared components). */}
      <Script src="/src/client/markdown-editor.ts" />
      <Script src="/src/client/media-picker.ts" />
      <Script src="/src/client/relation-picker.ts" />
      <PageHeader
        breadcrumb={[
          { label: 'Content', href: '/admin/c' },
          { label: def.name, href: `/admin/c/${slug}` },
          { label: docTitle },
        ]}
        title={docTitle}
        description={
          // Status, EFFECTIVE audience (D57 — a doc in a collection without
          // public pages reads "private" whatever its inert stored value says;
          // the same Stamp the list view uses), and when it was last saved.
          <span class="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {hasLifecycle(def) ? (
              <Badge tone={doc.status === 'published' ? 'success' : doc.publishAt ? 'warning' : 'neutral'}>
                {doc.status === 'published' ? 'Published' : doc.publishAt ? 'Scheduled' : 'Draft'}
              </Badge>
            ) : null}
            <VisibilityStamp visibility={audience} />
            <span class="font-mono text-xs text-ink-subtle">
              Saved <time dateTime={doc.updatedAt}>{formatDate(doc.updatedAt, settings)}</time> · rev {doc.revision}
            </span>
          </span>
        }
        actions={
          // Header = navigation/inspection; the sidebar keeps every mutation
          // (Save stays the page's only primary). Exactly one action: the live
          // page once published, a preview before then, or the internal View
          // for collections with no public surface at all.
          <Button
            href={headerAction.href}
            variant="secondary"
            size="sm"
            target={readingPage ? '_blank' : undefined}
            rel={readingPage ? 'noopener' : undefined}
            aria-label={headerAction.ariaLabel}
          >
            {headerAction.label}
          </Button>
        }
      />

      {/* The page is the ONLY scroller: the content column takes the room, the
          rail (20rem) flows beside it with a sticky Save card. */}
      <div class="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="min-w-0">
          <GeneratedForm
            def={def}
            doc={doc}
            action={`/admin/c/${slug}/${id}`}
            submitLabel="Save changes"
            id="editor-form"
            renderActions={false}
          />

          <BacklinksPanel backlinks={backlinks} />
        </div>

        <EditorSidebar
          mode="edit"
          formId="editor-form"
          submitLabel="Save changes"
          def={def}
          slug={slug}
          id={id}
          doc={doc}
          revisions={revisions}
          authorName={authorName}
          settings={settings}
          baseUrl={baseUrl}
          enablePublic={enablePublic}
          shareSlot={showSharing ? <ShareSummary def={def} doc={doc} overview={overview} /> : undefined}
          reviewSlot={threads ? <CommentsSection slug={slug} id={id} threads={threads} /> : undefined}
        />
      </div>
      <MobileSaveBar formId="editor-form" submitLabel="Save changes" />

      {/* Outside the grid AND outside #editor-form — the drawer carries forms. */}
      {showSharing ? (
        <ShareDrawer slug={slug} id={id} def={def} doc={doc} overview={overview} settings={settings} />
      ) : null}
    </AdminShell>,
  );
});

/** POST /admin/c/:collection/:id — validate + update. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const def = await getCollectionOrThrow(db, slug);

  // all: true so a <select multiple> posts repeated keys as an array (COR-4).
  const body = await c.req.parseBody({ all: true });
  const input = coerceAdminForm(def, body);
  try {
    await updateDocument(db, requirePrincipal(c), slug, id, input, nowIso(), {
      expectedRevision: parseExpectedRevision(body._revision),
    });
    return dsRedirect(c, `/admin/c/${slug}/${id}`);
  } catch (err) {
    return renderSaveError(c, err, 'form-result', {
      staleLinks: { reload: `/admin/c/${slug}/${id}`, compare: `/admin/c/${slug}/${id}/revisions` },
    });
  }
});
