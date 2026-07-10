import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { listDocuments } from '@/services/documents';
import { getSettings } from '@/services/settings';
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
  const settings = await getSettings(db);
  const page = Number(c.req.query('page') ?? '1') || 1;
  // Site-configured page size (falls back to the service default when unset).
  const { rows, total, pageSize } = await listDocuments(
    db,
    principal,
    slug,
    { page, pageSize: settings.defaultPageSize },
    nowIso(),
  );
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Bulk-result flash (D39): ?bulk=ok:<n>,failed:<m> from the bulk POST.
  const bulk = c.req.query('bulk');
  const bulkMatch = bulk?.match(/^ok:(\d+),failed:(\d+)$/);
  const flash =
    bulk === 'none'
      ? { tone: 'warning' as const, text: 'Nothing selected — tick at least one row first.' }
      : bulkMatch
        ? {
            tone: Number(bulkMatch[2]) > 0 ? ('warning' as const) : ('success' as const),
            text: `Bulk action: ${bulkMatch[1]} done${Number(bulkMatch[2]) > 0 ? `, ${bulkMatch[2]} failed` : ''}.`,
          }
        : null;

  return c.render(
    <AdminShell user={user} current="content">
      <PageHeader
        breadcrumb={[{ label: 'Content', href: '/admin/c' }, { label: def.name }]}
        title={def.name}
        description={`${total} ${total === 1 ? 'item' : 'items'}`}
        actions={
          <div class="flex items-center gap-2">
            <Button href={`/admin/c/${slug}/export`} variant="ghost" size="sm">
              Export
            </Button>
            <Button href={`/admin/c/${slug}/import`} variant="ghost" size="sm">
              Import
            </Button>
            <Button href={`/admin/c/${slug}/new`}>New {def.name}</Button>
          </div>
        }
      />
      {flash ? (
        <p
          role="status"
          class={`mb-4 rounded-md border px-3 py-2 text-sm font-medium ${
            flash.tone === 'success'
              ? 'border-border bg-success-soft text-success'
              : 'border-border bg-warning-soft text-warning'
          }`}
        >
          {flash.text}
        </p>
      ) : null}
      <GeneratedTable def={def} rows={rows} settings={settings} selectable />
      {pages > 1 && (
        <nav aria-label="Pagination" class="mt-6 flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <a
              class="rounded-md px-3 py-1.5 text-ink-muted hover:bg-hover hover:text-ink"
              href={`?page=${page - 1}`}
            >
              Previous
            </a>
          )}
          <span class="font-mono text-xs text-ink-subtle">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <a
              class="rounded-md px-3 py-1.5 text-ink-muted hover:bg-hover hover:text-ink"
              href={`?page=${page + 1}`}
            >
              Next
            </a>
          )}
        </nav>
      )}
    </AdminShell>,
  );
});
