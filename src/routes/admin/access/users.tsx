import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { createUser } from '@/services/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { getEmailTransport } from '@/lib/email';
import { inviteEmail } from '@/lib/email/templates';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardContent, Button } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /admin/access/users — create a Person. With a password → they can sign in
 * now. Without → an invite is issued: a single-use set-password link is "emailed"
 * (stubbed) and also shown once here so the admin can share it directly.
 */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const password = String(body.password ?? '');
  const { inviteToken } = await createUser(
    db,
    principal,
    {
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      role: String(body.role ?? 'reader'),
      password: password.length > 0 ? password : undefined,
    },
    now,
  );

  // Direct-password path: the person can sign in immediately.
  if (!inviteToken) return c.redirect('/admin/access', 303);

  // Invite path: build the set-password link, send it (real or stubbed by
  // config), and surface it once so the admin can hand it over directly.
  const settings = await getSettings(db);
  const link = `${resolveBaseUrl(c.env, settings, c.req.url)}/auth/set-password/${inviteToken}`;
  const transport = getEmailTransport(c.env, settings);
  await transport.send({ to: String(body.email ?? ''), ...inviteEmail({ link, siteName: settings.siteName }) });

  const user = getUser(c);
  return c.render(
    <AdminShell user={user} current="access">
      <PageHeader title="Invitation created" description="Share this set-password link — it will not be shown again." />
      <Card>
        <CardContent class="pt-6">
          <p class="mb-3 text-sm text-ink-muted">
            {transport.kind === 'resend'
              ? 'An invite email was sent. This single-use link expires in 7 days; copy it now if you also want to share it directly.'
              : 'An invite email was queued (delivery is stubbed in this build). This single-use link expires in 7 days; copy it now if you want to share it directly.'}
          </p>
          <code class="block overflow-x-auto rounded-md bg-hover px-4 py-3 font-mono text-sm break-all">{link}</code>
          <div class="mt-5">
            <Button href="/admin/access">Back to Access</Button>
          </div>
        </CardContent>
      </Card>
    </AdminShell>,
  );
});
