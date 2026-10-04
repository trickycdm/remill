import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { authenticateUser } from '@/services/auth';
import { setSessionUser, getSessionUser } from '@/lib/auth';
import { dsRedirect } from '@/lib/datastar-response';
import { safeRedirect } from '@/lib/safe-redirect';
import { rateLimit, LOGIN_RATE_LIMIT } from '@/middleware/rate-limit';
import { AuthShell } from '@/components/auth-shell';
import { Button, FormField, Input } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /admin/login — render the login form (or bounce if already signed in)
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers((c) => {
  if (getSessionUser(c)) return c.redirect('/admin');
  const redirect = c.req.query('redirect') ?? '';

  return c.render(
    <AuthShell>
      <form
        class="flex flex-col gap-5"
        data-on:submit="@post('/admin/login', {contentType: 'form'})"
      >
        <input type="hidden" name="redirect" value={redirect} />
        <FormField fieldId="email" label="Email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autocomplete="username webauthn"
            placeholder="you@example.com"
          />
        </FormField>
        <FormField fieldId="password" label="Password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="Your password"
          />
        </FormField>
        {/* Morph target for the invalid-credentials fragment (200, #login-result). */}
        <div id="login-result" />
        <Button type="submit" variant="primary">
          Sign in
        </Button>
      </form>
      {/* Passkey sign-in (D58). Hidden until the island confirms the browser
          supports it; the email box above also offers saved passkeys in autofill. */}
      <div data-passkey-login data-passkey-redirect={redirect} class="mt-5 hidden flex-col gap-3">
        <div class="flex items-center gap-3 text-xs text-ink-subtle" aria-hidden="true">
          <span class="h-px flex-1 bg-border" />
          or
          <span class="h-px flex-1 bg-border" />
        </div>
        <Button type="button" variant="secondary" data-passkey-signin>
          Use a passkey
        </Button>
        <div data-passkey-status role="alert" class="text-sm font-medium text-danger empty:hidden" />
      </div>
      <Script src="/src/client/passkey.ts" />
    </AuthShell>,
  );
});

// ---------------------------------------------------------------------------
// POST /admin/login — verify credentials, start the session
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(
  rateLimit('login', LOGIN_RATE_LIMIT),
  async (c) => {
    const form = await c.req.parseBody();
    const email = String(form.email ?? '');
    const password = String(form.password ?? '');
    const redirect = safeRedirect(String(form.redirect ?? ''));

    const user = await authenticateUser(getDb(c.env.DB), email, password);
    if (!user) {
      // Invalid credentials — return an inline error fragment (Datastar morphs
      // #login-result by id; must be 200, DATASTAR_PATTERNS.md).
      return c.html(
        <div
          id="login-result"
          role="alert"
          class="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          Incorrect email or password.
        </div>,
      );
    }

    setSessionUser(c, user);
    return dsRedirect(c, redirect);
  },
);
