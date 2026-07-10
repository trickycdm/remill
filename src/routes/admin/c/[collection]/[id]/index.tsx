import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { getDocument, updateDocument, listRevisions, getBacklinks } from '@/services/documents';
import { getSettings } from '@/services/settings';
import {
  getPrincipalPermissions,
  listItemGrants,
  listPrincipals,
  listRoles,
  listTeams,
} from '@/services/access';
import { coerceAdminForm } from '@/lib/admin-form';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Button } from '@/components/ui';
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

  // Share panel: only for principals with install-wide manage_access (matches what
  // listPrincipals/listRoles require). getPrincipalPermissions is un-gated (no audit).
  const perms = await getPrincipalPermissions(db, principal.id);
  const canShare = perms.some((p) => p.action === 'manage_access' && p.collection === '*');
  const share = canShare
    ? {
        grants: await listItemGrants(db, principal, slug, id, now),
        principals: await listPrincipals(db, principal, now),
        roles: await listRoles(db),
        teams: await listTeams(db),
      }
    : null;

  // Title the page by the document's primary display value (its first list field),
  // falling back to a generic edit label for an untitled doc.
  const titleField = def.fields.find((f) => f.admin?.showInList) ?? def.fields[0];
  const rawTitle = titleField ? doc.data[titleField.key] : undefined;
  const docTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : `Edit ${def.name}`;

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
        actions={
          <Button href={`/admin/c/${slug}/${id}/view`} variant="ghost" size="sm">
            View
          </Button>
        }
      />

      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="max-w-2xl">
          <GeneratedForm
            def={def}
            doc={doc}
            action={`/admin/c/${slug}/${id}`}
            submitLabel="Save changes"
            id="editor-form"
            renderActions={false}
          />
        </div>

        <EditorSidebar
          mode="edit"
          formId="editor-form"
          submitLabel="Save changes"
          cancelHref={`/admin/c/${slug}`}
          def={def}
          slug={slug}
          id={id}
          doc={doc}
          revisions={revisions}
          settings={settings}
        />
      </div>

      <BacklinksPanel backlinks={backlinks} />

      {share && (
        <SharePanel
          slug={slug}
          id={id}
          grants={share.grants}
          principals={share.principals}
          roles={share.roles}
          teams={share.teams}
        />
      )}
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
