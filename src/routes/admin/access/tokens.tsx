import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { issueToken, revokeToken } from '@/services/access';
import type { Action } from '@/access';
import { rateLimit, TOKEN_RATE_LIMIT } from '@/middleware/rate-limit';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardContent, Button } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** Build a narrowing scope mask from the issue form: the chosen collection (or '*')
 *  crossed with the checked actions. No actions checked → undefined (full, no
 *  narrowing). The service validates the actions against the closed vocabulary. */
function parseScope(collection: string, actions: string[]): { collection: string; action: Action }[] | undefined {
  if (actions.length === 0) return undefined;
  const col = collection || '*';
  return actions.map((a) => ({ collection: col, action: a as Action }));
}

/** Coerce a possibly-repeated form field (Hono `{ all: true }`) into a string[]. */
function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** POST /admin/access/tokens — issue (renders the plaintext once) or revoke. */
export const onRequestPost = factory.createHandlers(rateLimit('token', TOKEN_RATE_LIMIT), requireAuth(), async (c) => {
  const body = await c.req.parseBody({ all: true });
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
      scope: parseScope(String(body.scopeCollection ?? '*'), asArray(body.scopeAction as string | string[] | undefined)),
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
