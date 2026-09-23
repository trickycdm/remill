import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { createDocument } from '@/services/documents';
import { coerceAdminForm } from '@/lib/admin-form';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader } from '@/components/ui';
import { GeneratedForm } from '@/components/admin/generated';
import { EditorSidebar } from '@/components/admin/editor-sidebar';
import { renderSaveError } from '@/lib/save-error';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c/:collection/new — the generated create form. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const slug = pathParam(c, 'collection');
  const def = await getCollectionOrThrow(getDb(c.env.DB), slug);

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
          { label: `New ${def.name}` },
        ]}
        title={`New ${def.name}`}
      />
      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="max-w-2xl">
          <GeneratedForm
            def={def}
            action={`/admin/c/${slug}/new`}
            submitLabel={`Create ${def.name}`}
            id="editor-form"
            renderActions={false}
          />
        </div>
        <EditorSidebar mode="create" formId="editor-form" submitLabel={`Create ${def.name}`} def={def} />
      </div>
    </AdminShell>,
  );
});

/** POST /admin/c/:collection/new — validate + create, then redirect to the editor. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const def = await getCollectionOrThrow(db, slug);

  // all: true so a <select multiple> posts repeated keys as an array (COR-4).
  const body = await c.req.parseBody({ all: true });
  const input = coerceAdminForm(def, body);
  try {
    const doc = await createDocument(db, requirePrincipal(c), slug, input, nowIso());
    return dsRedirect(c, `/admin/c/${slug}/${doc.id}`);
  } catch (err) {
    return renderSaveError(c, err);
  }
});
