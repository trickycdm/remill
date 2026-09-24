import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { issueToken, revokeToken, updateTokenScope } from '@/services/access';
import type { Action } from '@/access';
import { rateLimit, TOKEN_RATE_LIMIT } from '@/middleware/rate-limit';
import { nowIso } from '@/lib/now';
import { SecretReveal } from '@/components/connect-cards';

const factory = createFactory<{ Bindings: Env }>();

/** Build a narrowing scope mask from the issue form: the chosen collection (or '*')
 *  crossed with the checked actions. No actions checked → undefined (full, no
 *  narrowing). The service validates the actions against the closed vocabulary. */
function parseScope(
  collection: string,
  actions: string[],
): { collection: string; action: Action }[] | undefined {
  if (actions.length === 0) return undefined;
  const col = collection || '*';
  return actions.map((a) => ({ collection: col, action: a as Action }));
}

/** Coerce a possibly-repeated form field (Hono `{ all: true }`) into a string[]. */
function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** POST /admin/access/tokens — issue (renders the plaintext once), revoke, or re-scope. */
export const onRequestPost = factory.createHandlers(
  rateLimit('token', TOKEN_RATE_LIMIT),
  requireAuth(),
  async (c) => {
    const body = await c.req.parseBody({ all: true });
    const db = getDb(c.env.DB);
    const principal = requirePrincipal(c);
    const now = nowIso();

    // Revoke stays a native form → Post/Redirect/Get back to the list.
    if (String(body.op) === 'revoke') {
      await revokeToken(db, principal, String(body.tokenId ?? ''), now);
      return c.redirect('/admin/access', 303);
    }

    // Re-scope an issued token in place — also a native form, same PRG.
    if (String(body.op) === 'scope') {
      await updateTokenScope(
        db,
        principal,
        String(body.tokenId ?? ''),
        parseScope(
          String(body.scopeCollection ?? '*'),
          asArray(body.scopeAction as string | string[] | undefined),
        ),
        now,
      );
      return c.redirect('/admin/access', 303);
    }

    const principalId = String(body.principalId ?? '');
    const { token } = await issueToken(
      db,
      principal,
      {
        principalId,
        name: String(body.name ?? ''),
        scope: parseScope(
          String(body.scopeCollection ?? '*'),
          asArray(body.scopeAction as string | string[] | undefined),
        ),
      },
      now,
    );

    // Datastar form action (@post, contentType:'form') → return a text/html fragment
    // that morphs into the card's `#token-reveal-<principalId>` slot in place. No
    // navigation means no dead POST-only URL and no refresh-re-mints-a-token bug.
    // The plaintext is rendered exactly once here — only its hash is ever stored.
    const sig = principalId.replace(/[^a-zA-Z0-9]/g, '');
    return c.html(
      <div id={`token-reveal-${principalId}`}>
        <div class="mt-3">
          <SecretReveal
            id={`tok-${sig}`}
            label="New token — copy it now"
            note="This is the only time it will be shown; only its hash is stored."
            value={token}
          />
        </div>
      </div>,
      200,
    );
  },
);
