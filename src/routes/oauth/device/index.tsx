import { createFactory } from 'hono/factory';
import type { Context } from 'hono';
import type { Env } from '@/types';
import { getDb, type Database } from '@/db/client';
import { nowIso } from '@/lib/now';
import { getSessionUser } from '@/lib/auth';
import { principalFromSession } from '@/access';
import {
  findPendingDevicePairing,
  approveDeviceCode,
  denyDeviceCode,
  CONSENT_EXCLUDED_ROLES,
  CONSENT_DEFAULT_ROLE,
} from '@/services/oauth';
import { listRoles, getPrincipalPermissions } from '@/services/access';
import { rateLimit, OAUTH_DEVICE_ENTRY_RATE_LIMIT } from '@/middleware/rate-limit';
import { ForbiddenError, InputValidationError } from '@/lib/errors';
import { AuthShell } from '@/components/auth-shell';
import { Button, FormField, Input, Stamp } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * /oauth/device — the human half of RFC 8628 pairing (D48): enter the short
 * code shown in a headless terminal, then the same consent decision as
 * /oauth/authorize (approval requires manage_access; the service enforces it).
 * Session-authenticated, Datastar-free (native forms; nothing here redirects
 * off-origin, but the auth-critical surface stays zero-JS like the consent
 * screen). The user-code POST is the low-entropy brute-force surface →
 * login-tight rate limit, and invalid/expired/used codes are indistinguishable.
 */

function loginRedirectHref(c: Context<{ Bindings: Env }>): string {
  const url = new URL(c.req.url);
  return `/admin/login?redirect=${encodeURIComponent(url.pathname + url.search)}`;
}

function codeEntryPage(prefill: string, notice?: string) {
  return (
    <AuthShell>
      <form method="post" action="/oauth/device" class="flex flex-col gap-5">
        <div class="flex flex-col gap-2 text-center">
          <span class="font-mono text-xs uppercase tracking-widest text-ink-subtle">
            Device pairing
          </span>
          <h1 class="font-display text-xl font-semibold">Enter the code from your terminal</h1>
        </div>
        {notice ? (
          <div role="alert" class="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {notice}
          </div>
        ) : null}
        <input type="hidden" name="op" value="lookup" />
        <FormField fieldId="device-code" label="Pairing code">
          <Input
            id="device-code"
            name="code"
            value={prefill}
            required
            autocomplete="off"
            placeholder="XXXX-XXXX"
            class="text-center font-mono uppercase tracking-widest"
          />
        </FormField>
        <Button type="submit" variant="primary">
          Continue
        </Button>
      </form>
    </AuthShell>
  );
}

function askAdminCard(loginHref: string) {
  return (
    <AuthShell>
      <div class="flex flex-col gap-4 text-center">
        <h1 class="font-display text-xl font-semibold">An administrator must approve this</h1>
        <p class="text-sm text-ink-muted">
          Pairing a device creates a new agent identity and access token, and only an administrator
          can approve that.
        </p>
        <Button href={loginHref} variant="secondary">
          Sign in with a different account
        </Button>
      </div>
    </AuthShell>
  );
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

function deviceConsentPage(input: { clientName: string; deviceId: string; roles: ConsentRole[] }) {
  return (
    <AuthShell>
      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-2 text-center">
          <span class="font-mono text-xs uppercase tracking-widest text-ink-subtle">
            Device pairing
          </span>
          <h1 class="font-display text-xl font-semibold">
            <span class="font-semibold">{input.clientName}</span> wants to access your remill
          </h1>
        </div>
        <form method="post" action="/oauth/device" class="flex flex-col gap-5">
          <input type="hidden" name="op" value="decide" />
          <input type="hidden" name="device_id" value={input.deviceId} />
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
              Approve — pair {input.clientName}
            </Button>
            <Button type="submit" name="decision" value="deny" variant="ghost">
              Deny
            </Button>
          </div>
        </form>
      </div>
    </AuthShell>
  );
}

function donePage(approved: boolean) {
  return (
    <AuthShell>
      <div class="flex flex-col items-center gap-4 text-center">
        <Stamp tone={approved ? 'affirm' : 'refuse'}>{approved ? 'paired' : 'denied'}</Stamp>
        <p class="text-sm text-ink-muted">
          {approved
            ? 'Return to your terminal — the client will finish connecting on its next poll.'
            : 'The pairing was denied. You can close this page.'}
        </p>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// GET /oauth/device — code entry (prefilled from ?code=)
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers(async (c) => {
  const user = getSessionUser(c);
  if (!user) return c.redirect(loginRedirectHref(c), 302);
  return c.render(codeEntryPage(c.req.query('code') ?? ''));
});

// ---------------------------------------------------------------------------
// POST /oauth/device — op=lookup (validate the code) | op=decide (approve/deny)
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(
  rateLimit('oauth-device-entry', OAUTH_DEVICE_ENTRY_RATE_LIMIT),
  async (c) => {
    const user = getSessionUser(c);
    if (!user) return c.redirect('/admin/login?redirect=%2Foauth%2Fdevice', 302);

    const db = getDb(c.env.DB);
    const now = nowIso();
    const form = await c.req.parseBody();
    const field = (key: string): string => (typeof form[key] === 'string' ? (form[key] as string) : '');

    if (field('op') === 'lookup') {
      const pending = await findPendingDevicePairing(db, field('code'), now);
      if (!pending) {
        return c.render(codeEntryPage('', 'That code is not valid. Check your terminal and try again.'));
      }
      const perms = await getPrincipalPermissions(db, user.id);
      if (!perms.some((p) => p.action === 'manage_access')) {
        return c.render(askAdminCard(loginRedirectHref(c)));
      }
      return c.render(
        deviceConsentPage({ clientName: pending.clientName, deviceId: pending.deviceId, roles: await consentRoles(db) }),
      );
    }

    // op=decide
    if (field('decision') !== 'approve') {
      await denyDeviceCode(db, field('device_id'), now);
      return c.render(donePage(false));
    }
    try {
      await approveDeviceCode(db, principalFromSession(user), { deviceId: field('device_id'), role: field('role') }, now);
      return c.render(donePage(true));
    } catch (err) {
      if (err instanceof ForbiddenError) return c.render(askAdminCard(loginRedirectHref(c)));
      if (err instanceof InputValidationError) {
        return c.render(codeEntryPage('', 'This pairing request is no longer valid — start again from your terminal.'));
      }
      throw err;
    }
  },
);
