import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { nowIso } from '@/lib/now';
import { teamInviteIsValid, acceptTeamInvite } from '@/services/access';
import { dsRedirect } from '@/lib/datastar-response';
import { ForbiddenError, InputValidationError, ConflictError } from '@/lib/errors';
import { rateLimit, LOGIN_RATE_LIMIT } from '@/middleware/rate-limit';
import { AuthShell } from '@/components/auth-shell';
import { Button, FormField, Input } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** A small inline error fragment Datastar morphs into #join-result (200). */
function inlineError(message: string) {
  return (
    <div id="join-result" role="alert" class="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
      {message}
    </div>
  );
}

function invalidLinkPage() {
  return (
    <AuthShell>
      <div class="flex flex-col gap-4 text-center">
        <p class="text-sm text-ink-muted">This invite link is invalid, revoked, used up, or has expired.</p>
        <Button href="/admin/login" variant="secondary">
          Go to sign in
        </Button>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// GET /auth/join/:token — the team-join registration form (token = the credential)
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers(async (c) => {
  const token = c.req.param('token') ?? '';
  if (!(await teamInviteIsValid(getDb(c.env.DB), token, nowIso()))) {
    return c.render(invalidLinkPage());
  }

  return c.render(
    <AuthShell>
      <form class="flex flex-col gap-5" data-on:submit={`@post('/auth/join/${token}', {contentType: 'form'})`}>
        <p class="text-sm text-ink-muted">You've been invited to a team. Create your account to join.</p>
        <FormField fieldId="name" label="Name">
          <Input id="name" name="name" type="text" required autocomplete="name" placeholder="Your name" />
        </FormField>
        <FormField fieldId="email" label="Email">
          <Input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" />
        </FormField>
        <FormField fieldId="password" label="Password">
          <Input id="password" name="password" type="password" required autocomplete="new-password" placeholder="At least 8 characters" />
        </FormField>
        <FormField fieldId="confirm" label="Confirm password">
          <Input id="confirm" name="confirm" type="password" required autocomplete="new-password" placeholder="Re-enter your password" />
        </FormField>
        <div id="join-result" />
        <Button type="submit" variant="primary">
          Create account & join
        </Button>
      </form>
    </AuthShell>,
  );
});

// ---------------------------------------------------------------------------
// POST /auth/join/:token — consume a use: create the person, assign the preset
// role, add team membership. Rate-limited like login (SEC-2) — this is an
// unauthenticated account-creating endpoint.
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(rateLimit('join', LOGIN_RATE_LIMIT), async (c) => {
  const token = c.req.param('token') ?? '';
  const form = await c.req.parseBody();
  const password = String(form.password ?? '');
  const confirm = String(form.confirm ?? '');

  if (password !== confirm) return c.html(inlineError('Passwords do not match.'));

  try {
    await acceptTeamInvite(
      getDb(c.env.DB),
      token,
      { name: String(form.name ?? ''), email: String(form.email ?? ''), password },
      nowIso(),
    );
  } catch (err) {
    if (err instanceof InputValidationError) return c.html(inlineError(err.details?.[0]?.message ?? 'Invalid details.'));
    if (err instanceof ConflictError) return c.html(inlineError(err.message));
    if (err instanceof ForbiddenError) return c.html(inlineError('This invite link is invalid or has expired.'));
    throw err;
  }

  // Account created + team joined — send them to sign in.
  return dsRedirect(c, '/admin/login');
});
