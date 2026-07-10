import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { issueToken, revokeToken } from '@/services/access';
import type { Action } from '@/access';
import { rateLimit, TOKEN_RATE_LIMIT } from '@/middleware/rate-limit';
import { nowIso } from '@/lib/now';
import { jsonForScript } from '@/lib/json-for-script';
import { Button } from '@/components/ui';

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

/** POST /admin/access/tokens — issue (renders the plaintext once) or revoke. */
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
    const codeId = `tok-code-${sig}`;
    const copied = `tokCopied${sig}`;
    return c.html(
      <div id={`token-reveal-${principalId}`}>
        <div
          class="mt-3 rounded-md border border-accent/40 bg-accent/5 p-4"
          data-signals={jsonForScript({ [copied]: false })}
        >
          <p class="text-sm font-medium text-ink">New token — copy it now</p>
          <p class="mt-0.5 mb-3 text-[13px] text-ink-muted">
            This is the only time it will be shown; only its hash is stored.
          </p>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              id={codeId}
              class="min-w-0 flex-1 overflow-x-auto rounded-md bg-hover px-3 py-2 font-mono text-sm break-all"
            >
              {token}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Copy token to clipboard"
              data-on:click={`navigator.clipboard.writeText(document.getElementById('${codeId}').textContent.trim()); $${copied} = true`}
            >
              <span data-show={`!$${copied}`}>Copy</span>
              <span data-show={`$${copied}`} style="display:none">
                Copied!
              </span>
            </Button>
          </div>
        </div>
      </div>,
      200,
    );
  },
);
