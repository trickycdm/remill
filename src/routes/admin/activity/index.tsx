/**
 * GET /admin/activity — the queryable audit trail (Phase 4 of the completion
 * roadmap). Every allow/deny authorize() ever wrote, filterable by principal /
 * action / collection / result / surface, keyset-paginated. The read is
 * manage_access-gated in the service; the nav shows this to admins.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { listAuditPage } from '@/services/access';
import { ACTIONS } from '@/access';
import type { AuditFilters } from '@/db/queries/audit';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardContent,
  Badge,
  Button,
  Input,
  Select,
  EmptyState,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

const SURFACES = ['admin', 'rest', 'mcp', 'system'] as const;

function parseFilters(q: Record<string, string>): AuditFilters {
  return {
    principalId: q.principal?.trim() || undefined,
    action: (ACTIONS as readonly string[]).includes(q.action) ? q.action : undefined,
    collection: q.collection?.trim() || undefined,
    allowed: q.result === 'allow' ? true : q.result === 'deny' ? false : undefined,
    surface: (SURFACES as readonly string[]).includes(q.surface) ? q.surface : undefined,
  };
}

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const q = c.req.query();
  const filters = parseFilters(q);
  const page = await listAuditPage(
    getDb(c.env.DB),
    requirePrincipal(c),
    { filters, cursor: q.cursor || undefined, limit: 50 },
    nowIso(),
  );

  const nextHref = page.nextCursor
    ? (() => {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(q)) if (v && k !== 'cursor') p.set(k, v);
        p.set('cursor', page.nextCursor);
        return `/admin/activity?${p.toString()}`;
      })()
    : undefined;

  return c.render(
    <AdminShell user={user} current="activity">
      <PageHeader
        title="Activity"
        description="Every authorization decision — allow and deny — across the admin, REST, and MCP, attributed to its principal and token."
      />

      <Card class="mb-6">
        <CardContent class="pt-4">
          <form method="get" action="/admin/activity" class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <Input name="principal" size="sm" placeholder="Principal id" aria-label="Filter by principal id" value={q.principal ?? ''} />
            <Input name="collection" size="sm" placeholder="Collection" aria-label="Filter by collection" value={q.collection ?? ''} />
            <Select name="action" size="sm" aria-label="Filter by action">
              <option value="">Any action</option>
              {ACTIONS.map((a) => (
                <option value={a} selected={q.action === a}>
                  {a}
                </option>
              ))}
            </Select>
            <Select name="result" size="sm" aria-label="Filter by result">
              <option value="">Allow + deny</option>
              <option value="allow" selected={q.result === 'allow'}>
                allow
              </option>
              <option value="deny" selected={q.result === 'deny'}>
                deny
              </option>
            </Select>
            <Select name="surface" size="sm" aria-label="Filter by surface">
              <option value="">Any surface</option>
              {SURFACES.map((s) => (
                <option value={s} selected={q.surface === s}>
                  {s}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {page.rows.length === 0 ? (
        <EmptyState title="No matching activity" description="Adjust the filters — every authorize() decision is recorded here." />
      ) : (
        <Card>
          <CardContent class="pt-4">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Principal</TableHeaderCell>
                  <TableHeaderCell>Surface</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Collection</TableHeaderCell>
                  <TableHeaderCell>Resource</TableHeaderCell>
                  <TableHeaderCell>Result</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {page.rows.map((a) => (
                  <TableRow>
                    <TableCell>
                      <span class="font-mono text-xs text-ink-subtle">{a.createdAt.slice(0, 19).replace('T', ' ')}</span>
                    </TableCell>
                    <TableCell>
                      <span class="font-mono text-xs">{a.principalId}</span>
                    </TableCell>
                    <TableCell>{a.surface}</TableCell>
                    <TableCell>{a.action}</TableCell>
                    <TableCell class="font-mono text-xs">{a.collection ?? '—'}</TableCell>
                    <TableCell>
                      <span class="font-mono text-xs">{a.resource}</span>
                    </TableCell>
                    <TableCell>
                      <Badge tone={a.allowed ? 'success' : 'danger'}>{a.allowed ? 'allow' : 'deny'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {nextHref ? (
        <nav aria-label="Activity pages" class="mt-6 flex justify-end">
          <Button href={nextHref} variant="secondary" size="sm">
            Older →
          </Button>
        </nav>
      ) : null}
    </AdminShell>,
  );
});
