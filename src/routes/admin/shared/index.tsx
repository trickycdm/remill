import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { listSharedWithMe } from '@/services/documents';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardContent,
  Badge,
  EmptyState,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /admin/shared — the documents item-granted to the signed-in principal
 * (directly, via a role, or via a team). Identity-scoped: every authenticated
 * member sees their own list; content itself still reads through the gated
 * pipeline inside listSharedWithMe.
 */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const rows = await listSharedWithMe(db, principal, nowIso());

  return c.render(
    <AdminShell user={user} current="shared">
      <PageHeader
        title="Shared with me"
        description="Documents someone granted to you — directly, through a role, or through one of your teams."
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing shared yet" description="When someone shares a document with you or one of your teams, it appears here." />
      ) : (
        <Card>
          <CardContent class="pt-4">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Document</TableHeaderCell>
                  <TableHeaderCell>Collection</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>You can</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow>
                    <TableCell>
                      <a href={`/admin/c/${r.collection}/${r.id}/view`} class="font-medium text-accent-text hover:underline">
                        {r.title ?? r.id}
                      </a>
                    </TableCell>
                    <TableCell class="font-mono text-xs">{r.collection}</TableCell>
                    <TableCell>
                      <Badge tone={r.status === 'published' ? 'accent' : 'neutral'}>{r.status}</Badge>
                    </TableCell>
                    <TableCell class="text-sm text-ink-muted">{r.actions.join(', ')}</TableCell>
                    <TableCell class="text-sm text-ink-subtle">
                      {r.expiresAt ? r.expiresAt.slice(0, 16).replace('T', ' ') : 'never'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AdminShell>,
  );
});
