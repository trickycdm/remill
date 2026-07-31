/**
 * GET/POST /admin/trash — recoverable delete (D29). Lists trashed documents
 * across every collection the signed-in principal can `delete` (own/published
 * conditions applied in-query), with Restore and Delete-forever actions.
 * Classic native forms with an `op` dispatch, per the access-pages pattern.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { listTrash, restoreDocument, deleteForever, type TrashRecord } from '@/services/trash';
import { getCollection } from '@/services/collections';
import { TRASH_RETENTION_DAYS } from '@/config/retention';
import { formatDate } from '@/lib/format-date';
import { getSettings } from '@/services/settings';
import { AppError } from '@/lib/errors';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardContent,
  Badge,
  Button,
  EmptyState,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** Display title for a snapshot: the collection's first text/slug field value. */
async function titleOf(
  c: { env: Env },
  cache: Map<string, string | undefined>,
  row: TrashRecord,
): Promise<string> {
  if (!cache.has(row.collection)) {
    const def = await getCollection(getDb(c.env.DB), row.collection);
    cache.set(row.collection, def?.fields.find((f) => f.type === 'text' || f.type === 'slug')?.key);
  }
  const key = cache.get(row.collection);
  const raw = key ? row.data[key] : undefined;
  return typeof raw === 'string' && raw.length ? raw : row.documentId;
}

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const settings = await getSettings(db);
  const { rows } = await listTrash(db, principal, {}, nowIso());
  const titleCache = new Map<string, string | undefined>();
  const titles = new Map<string, string>();
  for (const row of rows) titles.set(row.id, await titleOf(c, titleCache, row));
  const flash = c.req.query('restored')
    ? { tone: 'ok' as const, text: 'Document restored.' }
    : c.req.query('destroyed')
      ? { tone: 'ok' as const, text: 'Deleted forever.' }
      : c.req.query('error')
        ? { tone: 'err' as const, text: c.req.query('error')! }
        : null;

  return c.render(
    <AdminShell user={user} current="trash">
      <PageHeader
        title="Trash"
        description={`Deleted documents stay restorable for ${TRASH_RETENTION_DAYS} days, then are purged automatically.`}
      />
      {flash ? (
        <p
          role="status"
          class={`mb-4 rounded-md border px-4 py-2.5 text-sm ${
            flash.tone === 'ok'
              ? 'border-border bg-surface-raised text-ink'
              : 'border-danger/40 bg-danger/10 text-ink'
          }`}
        >
          {flash.text}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title="Trash is empty"
          description="Deleting a document moves it here first — nothing is lost immediately."
        />
      ) : (
        <Card>
          <CardContent class="pt-4">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Document</TableHeaderCell>
                  <TableHeaderCell>Collection</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Deleted</TableHeaderCell>
                  <TableHeaderCell>
                    <span class="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const title = titles.get(row.id) ?? row.documentId;
                  return (
                    <TableRow>
                      <TableCell class="font-medium">{title}</TableCell>
                      <TableCell class="font-mono text-xs">{row.collection}</TableCell>
                      <TableCell>
                        <Badge tone={row.status === 'published' ? 'accent' : 'neutral'}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell class="text-sm text-ink-subtle">
                        {formatDate(row.deletedAt, settings)}
                      </TableCell>
                      <TableCell>
                        <div class="flex justify-end gap-2">
                          <form method="post" action="/admin/trash">
                            <input type="hidden" name="op" value="restore" />
                            <input type="hidden" name="id" value={row.id} />
                            <Button
                              type="submit"
                              variant="secondary"
                              size="sm"
                              aria-label={`Restore ${title}`}
                            >
                              Restore
                            </Button>
                          </form>
                          <form method="post" action="/admin/trash">
                            <input type="hidden" name="op" value="destroy" />
                            <input type="hidden" name="id" value={row.id} />
                            <Button
                              type="submit"
                              variant="danger"
                              size="sm"
                              aria-label={`Delete ${title} forever`}
                            >
                              Delete forever
                            </Button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AdminShell>,
  );
});

export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const body = await c.req.parseBody();
  const op = String(body.op ?? '');
  const id = String(body.id ?? '');
  try {
    if (op === 'restore') {
      await restoreDocument(db, principal, id, nowIso());
      return c.redirect('/admin/trash?restored=1', 303);
    }
    if (op === 'destroy') {
      await deleteForever(db, principal, id, nowIso());
      return c.redirect('/admin/trash?destroyed=1', 303);
    }
    return c.redirect('/admin/trash', 303);
  } catch (err) {
    // Conflict/permission errors surface as an inline flash, not a JSON page.
    if (err instanceof AppError && err.status !== 401) {
      return c.redirect(`/admin/trash?error=${encodeURIComponent(err.friendlyMessage)}`, 303);
    }
    throw err;
  }
});
