import { createFactory } from 'hono/factory';
import type { Context } from 'hono';
import type { Env } from '@/types';
import { getDb, type Database } from '@/db/client';
import { nowIso } from '@/lib/now';
import { getSessionUser } from '@/lib/auth';
import { principalFromSession } from '@/access';
import {
  validateAuthorizeRequest,
  approveAuthorization,
  denyAuthorization,
  CONSENT_EXCLUDED_ROLES,
  CONSENT_DEFAULT_ROLE,
  type AuthorizeParams,
} from '@/services/oauth';
import { listRoles, getPrincipalPermissions } from '@/services/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { ForbiddenError, InputValidationError } from '@/lib/errors';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * /oauth/authorize — the OAuth consent screen (D48): the ONE privilege
 * decision in the whole flow. Session-authenticated; approval requires
 * `manage_access` (enforced by the service; pre-checked here only for
 * friendlier rendering). The page is deliberately Datastar-free — native
 * forms, zero JS — because its terminal redirect is CROSS-origin (the
 * client's callback), which dsRedirect does not model. `clientName` is
 * untrusted DCR input: rendered exclusively as JSX text children.
 */

function errorCard(title: string, message: string) {
  return (
    <AuthShell>
      <div class="flex flex-col gap-4 text-center">
        <h1 class="font-display text-xl font-semibold">{title}</h1>
        <p class="text-sm text-ink-muted">{message}</p>
        <Button href="/admin" variant="secondary">
          Go to remill
        </Button>
      </div>
    </AuthShell>
  );
}

const invalidRequestCard = () =>
  errorCard(
    'This connection request is invalid',
    'The request is malformed or has expired. Go back to your MCP client and start the connection again.',
  );

function askAdminCard(clientName: string, loginHref: string) {
  return (
    <AuthShell>
      <div class="flex flex-col gap-4 text-center">
        <h1 class="font-display text-xl font-semibold">
          <span class="font-semibold">{clientName}</span> wants to connect
        </h1>
        <p class="text-sm text-ink-muted">
          Connecting an agent creates a new identity and access token, and only an administrator can
          approve that. Ask your admin to open this link, or sign in as an administrator.
        </p>
        <Button href={loginHref} variant="secondary">
          Sign in with a different account
        </Button>
      </div>
    </AuthShell>
  );
}

/** The full current URL as a same-origin relative target for the login bounce
 *  (the global onError uses path only, which would DROP the OAuth query). */
function loginRedirectHref(c: Context<{ Bindings: Env }>): string {
  const url = new URL(c.req.url);
  return `/admin/login?redirect=${encodeURIComponent(url.pathname + url.search)}`;
}

async function userHoldsManageAccess(db: Database, principalId: string): Promise<boolean> {
  const perms = await getPrincipalPermissions(db, principalId);
  return perms.some((p) => p.action === 'manage_access');
}

interface ConsentRole {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

async function consentRoles(db: Database): Promise<ConsentRole[]> {
  const roles = await listRoles(db);
  return roles
    .filter((r) => !CONSENT_EXCLUDED_ROLES.has(r.slug))
    .map((r) => ({ slug: r.slug, name: r.name, description: r.description ?? null }));
}

function consentPage(input: {
  clientName: string;
  redirectHost: string;
  params: AuthorizeParams;
  roles: ConsentRole[];
  notice?: string;
}) {
  const { clientName, params } = input;
  return (
    <AuthShell>
      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-2 text-center">
          <span class="font-mono text-xs uppercase tracking-widest text-ink-subtle">
            Connection request
          </span>
          <h1 class="font-display text-xl font-semibold">
            <span class="font-semibold">{clientName}</span> wants to access your remill
          </h1>
          <p class="font-mono text-xs text-ink-subtle">will return you to {input.redirectHost}</p>
        </div>

        {input.notice ? (
          <div role="alert" class="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {input.notice}
          </div>
        ) : null}

        <form method="post" action="/oauth/authorize" class="flex flex-col gap-5">
          <input type="hidden" name="client_id" value={params.clientId} />
          <input type="hidden" name="redirect_uri" value={params.redirectUri} />
          <input type="hidden" name="response_type" value="code" />
          <input type="hidden" name="code_challenge" value={params.codeChallenge} />
          <input type="hidden" name="code_challenge_method" value="S256" />
          {params.state ? <input type="hidden" name="state" value={params.state} /> : null}
          {params.scope ? <input type="hidden" name="scope" value={params.scope} /> : null}
          {params.resource ? <input type="hidden" name="resource" value={params.resource} /> : null}

          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm font-medium text-ink">What may it do?</legend>
            {input.roles.map((role) => (
              <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 hover:bg-hover">
                <input
                  type="radio"
                  name="role"
                  value={role.slug}
                  checked={role.slug === CONSENT_DEFAULT_ROLE}
                  class="mt-1 accent-current"
                />
                <span class="flex flex-col">
                  <span class="text-sm font-medium text-ink">{role.name}</span>
                  {role.description ? (
                    <span class="text-xs text-ink-muted">{role.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>

          <div class="flex flex-col gap-2">
            <Button type="submit" name="decision" value="approve" variant="primary">
              Approve — connect {clientName}
            </Button>
            <Button type="submit" name="decision" value="deny" variant="ghost">
              Deny
            </Button>
          </div>
          <p class="text-center text-xs text-ink-subtle">
            Approving creates an agent named “{clientName}” under Access. You can revoke it there
            any time.
          </p>
        </form>
      </div>
    </AuthShell>
  );
}

function queryRecord(c: Context<{ Bindings: Env }>): Record<string, string | undefined> {
  const url = new URL(c.req.url);
  return Object.fromEntries(url.searchParams.entries());
}

// ---------------------------------------------------------------------------
// GET /oauth/authorize — validate, then render consent (or bounce/explain)
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers(async (c) => {
  const user = getSessionUser(c);
  if (!user) return c.redirect(loginRedirectHref(c), 302);

  const db = getDb(c.env.DB);
  const baseUrl = resolveBaseUrl(c.env, await getSettings(db), c.req.url);
  const validated = await validateAuthorizeRequest(db, queryRecord(c), baseUrl);
  if (validated.kind === 'invalid') return c.render(invalidRequestCard());
  if (validated.kind === 'redirect') return c.redirect(validated.redirectUrl, 302);

  if (!(await userHoldsManageAccess(db, user.id))) {
    return c.render(askAdminCard(validated.clientName, loginRedirectHref(c)));
  }

  return c.render(
    consentPage({
      clientName: validated.clientName,
      redirectHost: new URL(validated.params.redirectUri).host || validated.params.redirectUri,
      params: validated.params,
      roles: await consentRoles(db),
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /oauth/authorize — the decision. Native form; 303 to the client's
// callback (external — never dsRedirect).
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(async (c) => {
  const user = getSessionUser(c);
  const form = await c.req.parseBody();
  const field = (key: string): string | undefined =>
    typeof form[key] === 'string' && form[key] !== '' ? (form[key] as string) : undefined;

  if (!user) {
    // Session expired mid-consent: rebuild the GET URL from the posted params.
    const query = new URLSearchParams();
    for (const key of ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']) {
      const value = field(key);
      if (value) query.set(key, value);
    }
    return c.redirect(`/admin/login?redirect=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`, 302);
  }

  const db = getDb(c.env.DB);
  const baseUrl = resolveBaseUrl(c.env, await getSettings(db), c.req.url);
  // Re-validate everything server-side — hidden fields are still client input.
  const validated = await validateAuthorizeRequest(
    db,
    {
      client_id: field('client_id'),
      redirect_uri: field('redirect_uri'),
      response_type: field('response_type'),
      code_challenge: field('code_challenge'),
      code_challenge_method: field('code_challenge_method'),
      state: field('state'),
      scope: field('scope'),
      resource: field('resource'),
    },
    baseUrl,
  );
  if (validated.kind === 'invalid') return c.render(invalidRequestCard());
  if (validated.kind === 'redirect') return c.redirect(validated.redirectUrl, 303);

  if (field('decision') !== 'approve') {
    return c.redirect(denyAuthorization(validated.params).redirectUrl, 303);
  }

  try {
    const { redirectUrl } = await approveAuthorization(
      db,
      principalFromSession(user),
      { params: validated.params, role: field('role') ?? '' },
      nowIso(),
    );
    return c.redirect(redirectUrl, 303);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return c.render(askAdminCard(validated.clientName, loginRedirectHref(c)));
    }
    if (err instanceof InputValidationError) {
      return c.render(
        consentPage({
          clientName: validated.clientName,
          redirectHost: new URL(validated.params.redirectUri).host || validated.params.redirectUri,
          params: validated.params,
          roles: await consentRoles(db),
          notice: err.details?.[0]?.message ?? 'That role cannot be granted here.',
        }),
      );
    }
    throw err;
  }
});
