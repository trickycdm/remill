import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardHeader, CardTitle, CardContent, EmptyState } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /admin — the dashboard. Phase 1 renders the styled shell + a welcome and
 * "getting started" surface. Live activity/stats arrive with the generated admin
 * (Phase 4) once documents exist to count.
 */
export const onRequestGet = factory.createHandlers(requireAuth(), (c) => {
  const user = getUser(c);

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
            <EmptyState
              title="Nothing yet"
              description="Activity from you and your agents will appear here once content exists."
            />
          </CardContent>
        </Card>
      </div>
    </AdminShell>,
  );
});
