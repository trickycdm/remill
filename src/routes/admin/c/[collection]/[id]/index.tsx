import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { getDocument, updateDocument, listRevisions, getBacklinks, getAuthorName } from '@/services/documents';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { publicUrlOf } from '@/lib/def-helpers';
import { hasLifecycle } from '@/lib/lifecycle';
import {
  getPrincipalPermissions,
  listItemGrants,
  listPrincipals,
  listRoles,
  listTeams,
  listShareLinks,
} from '@/services/access';
import { canAuthorize } from '@/access';
import { coerceAdminForm } from '@/lib/admin-form';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Button, Badge } from '@/components/ui';
import { GeneratedForm } from '@/components/admin/generated';
import { EditorSidebar } from '@/components/admin/editor-sidebar';
import { SharePanel } from '@/components/admin/share-panel';
import { BacklinksPanel } from '@/components/admin/backlinks-panel';
import { renderSaveError } from '@/lib/save-error';

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

  // Share panel: two independently-gated sections (D51). People & roles needs
  // install-wide manage_access (matches what listPrincipals/listRoles
  // require); Share links only needs `share_link` on this document — editors
  // can mint links without any access-management power. Both probed without
  // throwing (getPrincipalPermissions is un-gated, no audit).
  const perms = await getPrincipalPermissions(db, principal.id);
  const canShare = perms.some((p) => p.action === 'manage_access' && p.collection === '*');
  // A non-throwing, non-auditing probe through the real decision pipeline, so
  // conditions (`own`) and item grants count exactly as listShareLinks' own
  // authorize() will — the section shows iff the list call can succeed.
  const canShareLink = await canAuthorize(db, principal, 'share_link', { collection: slug, documentId: id }, now);
  const share = canShare
    ? {
        grants: await listItemGrants(db, principal, slug, id, now),
        principals: await listPrincipals(db, principal, now),
        roles: await listRoles(db),
        teams: await listTeams(db),
      }
    : null;
  const shareLinks = canShareLink
    ? await listShareLinks(db, principal, slug, id, c.env.SESSION_SECRET, resolveBaseUrl(c.env, settings, c.req.url), now)
    : null;

  // Title the page by the document's primary display value (its first list field),
  // falling back to a generic edit label for an untitled doc.
  const titleField = def.fields.find((f) => f.admin?.showInList) ?? def.fields[0];
  const rawTitle = titleField ? doc.data[titleField.key] : undefined;
  const docTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : `Edit ${def.name}`;

  // Header action: publicRead collections get exactly one — "View live ↗" once
  // published and not private, else "Preview ↗" (D49: works for drafts AND
  // published, through the session principal). publicUrlOf already resolves the
  // unlisted/private doc_ id URL, so this single href works for every
  // visibility (D50). Non-publicRead collections fall back to the internal View.
  const publicHref = def.access?.publicRead ? publicUrlOf(def, doc, '') : undefined;
  const isLive = doc.status === 'published' && (doc.visibility ?? 'public') !== 'private';
  const headerAction = publicHref
    ? {
        href: isLive ? publicHref : `${publicHref}?preview=1`,
        label: isLive ? 'View live ↗' : 'Preview ↗',
        ariaLabel: isLive ? 'View the live public page (opens in new tab)' : 'Preview public page (opens in new tab)',
      }
    : { href: `/admin/c/${slug}/${id}/view`, label: 'View', ariaLabel: undefined };

  const authorName = doc.createdBy
    ? doc.createdBy === principal.id
      ? 'You'
      : await getAuthorName(db, doc.createdBy)
    : '—';

  return c.render(
    <AdminShell user={user} current="content">
      {/* Editor islands (D38) — Scripts live in ROUTE files (vite-ssr-components
          only discovers them here + layouts.tsx, never in shared components). */}
      <Script src="/src/client/markdown-editor.ts" />
      <Script src="/src/client/media-picker.ts" />
      <PageHeader
        breadcrumb={[
          { label: 'Content', href: '/admin/c' },
          { label: def.name, href: `/admin/c/${slug}` },
          { label: docTitle },
        ]}
        title={docTitle}
        description={
          // Status/visibility read at a glance under the title; lifecycle-none
          // collections and always-public docs render nothing here.
          (hasLifecycle(def) || (def.access?.publicRead && (doc.visibility ?? 'public') !== 'public')) ? (
            <span class="inline-flex flex-wrap items-center gap-2">
              {hasLifecycle(def) ? (
                <Badge tone={doc.status === 'published' ? 'success' : doc.publishAt ? 'warning' : 'neutral'}>
                  {doc.status === 'published' ? 'Published' : doc.publishAt ? 'Scheduled' : 'Draft'}
                </Badge>
              ) : null}
              {def.access?.publicRead && (doc.visibility ?? 'public') !== 'public' ? (
                <Badge tone={doc.visibility === 'private' ? 'warning' : 'accent'}>
                  {doc.visibility === 'private' ? 'Private' : 'Unlisted'}
                </Badge>
              ) : null}
            </span>
          ) : undefined
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
            target={publicHref ? '_blank' : undefined}
            rel={publicHref ? 'noopener' : undefined}
            aria-label={headerAction.ariaLabel}
          >
            {headerAction.label}
          </Button>
        }
      />

      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="max-w-2xl">
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
          baseUrl={resolveBaseUrl(c.env, settings, c.req.url)}
          shareSlot={
            share || shareLinks ? (
              <SharePanel
                slug={slug}
                id={id}
                grants={share?.grants}
                principals={share?.principals}
                roles={share?.roles}
                teams={share?.teams}
                def={shareLinks ? def : undefined}
                doc={shareLinks ? doc : undefined}
                links={shareLinks ?? undefined}
                baseUrl={shareLinks ? resolveBaseUrl(c.env, settings, c.req.url) : undefined}
                settings={settings}
              />
            ) : undefined
          }
        />
      </div>
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
    await updateDocument(db, requirePrincipal(c), slug, id, input, nowIso());
    return dsRedirect(c, `/admin/c/${slug}/${id}`);
  } catch (err) {
    return renderSaveError(c, err);
  }
});
