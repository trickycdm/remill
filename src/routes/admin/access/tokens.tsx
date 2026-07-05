import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { issueToken, revokeToken } from '@/services/access';
import type { Action } from '@/access';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardContent, Button } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

function parseScope(raw: string): { collection: string; action: Action }[] | undefined {
  if (!raw) return undefined;
  return raw.split(',').map((a) => ({ collection: '*', action: a.trim() as Action }));
}

/** POST /admin/access/tokens — issue (renders the plaintext once) or revoke. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  if (String(body.op) === 'revoke') {
    await revokeToken(db, principal, String(body.tokenId ?? ''), now);
    return c.redirect('/admin/access', 303);
  }

  const { token } = await issueToken(
    db,
    principal,
    {
      principalId: String(body.principalId ?? ''),
      name: String(body.name ?? ''),
      scope: parseScope(String(body.scope ?? '')),
    },
    now,
  );

  // Show the plaintext exactly once — it is never stored, only its hash.
  const user = getUser(c);
  return c.render(
    <AdminShell user={user} current="access">
      <PageHeader title="Token issued" description="Copy it now — it will not be shown again." />
      <Card>
        <CardContent class="pt-6">
          <p class="mb-3 text-sm text-ink-muted">
            This is the only time you will see this token. Store it securely; only its hash is kept.
          </p>
          <code class="block overflow-x-auto rounded-md bg-hover px-4 py-3 font-mono text-sm break-all">
            {token}
          </code>
          <div class="mt-5">
            <Button href="/admin/access">Back to Access</Button>
          </div>
        </CardContent>
      </Card>
    </AdminShell>,
  );
});
