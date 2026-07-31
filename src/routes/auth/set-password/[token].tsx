import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { nowIso } from '@/lib/now';
import { inviteIsValid, setPasswordWithInvite } from '@/services/invites';
import { dsRedirect } from '@/lib/datastar-response';
import { UnauthorizedError, InputValidationError } from '@/lib/errors';
import { AuthShell } from '@/components/auth-shell';
import { Button, FormField, Input } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** A small inline error fragment Datastar morphs into #set-result (200). */
function inlineError(message: string) {
  return (
    <div
      id="set-result"
      role="alert"
      class="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
    >
      {message}
    </div>
  );
}

function invalidLinkPage() {
  return (
    <AuthShell>
      <div class="flex flex-col gap-4 text-center">
        <p class="text-sm text-ink-muted">
          This invite link is invalid, already used, or has expired.
        </p>
        <Button href="/admin/login" variant="secondary">
          Go to sign in
        </Button>
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// GET /auth/set-password/:token — render the set-password form (token = the credential)
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers(async (c) => {
  const token = c.req.param('token') ?? '';
  if (!(await inviteIsValid(getDb(c.env.DB), token, nowIso()))) {
    return c.render(invalidLinkPage());
  }

  return c.render(
    <AuthShell>
      <form
        class="flex flex-col gap-5"
        data-on:submit={`@post('/auth/set-password/${token}', {contentType: 'form'})`}
      >
        <p class="text-sm text-ink-muted">Choose a password to activate your account.</p>
        <FormField fieldId="password" label="New password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            autocomplete="new-password"
            placeholder="At least 8 characters"
          />
        </FormField>
        <FormField fieldId="confirm" label="Confirm password">
          <Input
            id="confirm"
            name="confirm"
            type="password"
            required
            autocomplete="new-password"
            placeholder="Re-enter your password"
          />
        </FormField>
        <div id="set-result" />
        <Button type="submit" variant="primary">
          Set password
        </Button>
      </form>
    </AuthShell>,
  );
});

// ---------------------------------------------------------------------------
// POST /auth/set-password/:token — consume the token, set the password
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(async (c) => {
  const token = c.req.param('token') ?? '';
  const form = await c.req.parseBody();
  const password = String(form.password ?? '');
  const confirm = String(form.confirm ?? '');

  if (password !== confirm) return c.html(inlineError('Passwords do not match.'));

  try {
    await setPasswordWithInvite(getDb(c.env.DB), token, password, nowIso());
  } catch (err) {
    if (err instanceof InputValidationError)
      return c.html(inlineError(err.details?.[0]?.message ?? 'Invalid password.'));
    if (err instanceof UnauthorizedError)
      return c.html(inlineError('This invite link is invalid or has expired.'));
    throw err;
  }

  // Password set — send them to sign in.
  return dsRedirect(c, '/admin/login');
});
