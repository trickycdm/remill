import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { authenticateUser } from '@/services/auth';
import { setSessionUser, getSessionUser } from '@/lib/auth';
import { dsRedirect } from '@/lib/datastar-response';
import { AuthShell } from '@/components/auth-shell';
import { Button, FormField, Input } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** Only allow same-origin relative redirects (no protocol-relative or absolute). */
function safeRedirect(target: string | undefined): string {
  if (!target) return '/admin';
  if (!target.startsWith('/') || target.startsWith('//')) return '/admin';
  return target;
}

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
            autocomplete="email"
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
    </AuthShell>,
  );
});

// ---------------------------------------------------------------------------
// POST /admin/login — verify credentials, start the session
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(async (c) => {
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
});
