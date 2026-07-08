import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { listAudit } from '@/services/access';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardHeader, CardTitle, CardContent, EmptyState, Badge } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /admin — the dashboard: getting-started links + a recent-activity feed
 * (the audit log's newest rows) for admins. Non-admins keep the empty state —
 * the role check is UI-hiding only; `listAudit` itself is manage_access-gated.
 */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const audit =
    user.role === 'admin'
      ? await listAudit(getDb(c.env.DB), requirePrincipal(c), nowIso(), 10)
      : [];

  return c.render(
    <AdminShell user={user} current="dashboard">
      <PageHeader title="Dashboard" description={`Welcome back, ${user.displayName}.`} />

      <div class="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
          </CardHeader>
          <CardContent>
            <ol class="ml-4 list-decimal space-y-2 text-sm text-ink-muted">
              <li>
                Define a content type in{' '}
                <a class="text-accent-text underline" href="/admin/collections">Collections</a>.
              </li>
              <li>
                Author and publish documents from{' '}
                <a class="text-accent-text underline" href="/admin/c">Content</a>.
              </li>
              <li>
                Invite an agent and scope its access under{' '}
                <a class="text-accent-text underline" href="/admin/access">Access</a>.
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState
                title="Nothing yet"
                description="Activity from you and your agents will appear here once content exists."
              />
            ) : (
              <>
                <ol class="divide-y divide-border text-sm">
                  {audit.map((a) => (
                    <li class="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                      <Badge tone={a.allowed ? 'success' : 'danger'}>{a.allowed ? 'allow' : 'deny'}</Badge>
                      <span class="text-ink">{a.action}</span>
                      <span class="min-w-0 flex-1 truncate font-mono text-xs text-ink-subtle">{a.resource}</span>
                      <span class="shrink-0 font-mono text-xs text-ink-subtle">
                        {a.createdAt.slice(5, 16).replace('T', ' ')}
                      </span>
                    </li>
                  ))}
                </ol>
                <a href="/admin/activity" class="mt-3 inline-block text-sm text-accent-text hover:underline">
                  All activity →
                </a>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminShell>,
  );
});
