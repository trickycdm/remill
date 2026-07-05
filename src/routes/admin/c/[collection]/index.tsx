import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { listDocuments } from '@/services/documents';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Button } from '@/components/ui';
import { GeneratedTable } from '@/components/admin/generated';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c/:collection — the generated list view for a collection. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const def = await getCollectionOrThrow(db, slug);

  const principal = requirePrincipal(c);
  const page = Number(c.req.query('page') ?? '1') || 1;
  const { rows, total, pageSize } = await listDocuments(db, principal, slug, { page }, nowIso());
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return c.render(
    <AdminShell user={user} current="content">
      <PageHeader
        breadcrumb={[{ label: 'Content', href: '/admin/c' }, { label: def.name }]}
        title={def.name}
        description={`${total} ${total === 1 ? 'item' : 'items'}`}
        actions={<Button href={`/admin/c/${slug}/new`}>New {def.name}</Button>}
      />
      <GeneratedTable def={def} rows={rows} />
      {pages > 1 && (
        <nav aria-label="Pagination" class="mt-6 flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <a class="rounded-md px-3 py-1.5 text-ink-muted hover:bg-hover hover:text-ink" href={`?page=${page - 1}`}>
              Previous
            </a>
          )}
          <span class="font-mono text-xs text-ink-subtle">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <a class="rounded-md px-3 py-1.5 text-ink-muted hover:bg-hover hover:text-ink" href={`?page=${page + 1}`}>
              Next
            </a>
          )}
        </nav>
      )}
    </AdminShell>,
  );
});
