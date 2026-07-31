import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { createUser } from '@/services/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { getEmailTransport } from '@/lib/email';
import { inviteEmail } from '@/lib/email/templates';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { SecretReveal } from '@/components/connect-cards';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /admin/access/users — create a Person. With a password → they can sign in
 * now. Without → an invite is issued: a single-use set-password link is "emailed"
 * (stubbed) and also shown once here so the admin can share it directly.
 */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const password = String(body.password ?? '');
  const { inviteToken } = await createUser(
    db,
    principal,
    {
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      role: String(body.role ?? 'reader'),
      password: password.length > 0 ? password : undefined,
    },
    now,
  );

  // Direct-password path: the person can sign in immediately → navigate back to
  // the refreshed list. dsRedirect (text/javascript), NOT a 3xx — Datastar would
  // otherwise follow the redirect into HTML and morph it onto the current page.
  if (!inviteToken) return dsRedirect(c, '/admin/access');

  // Invite path: build the set-password link, send it (real or stubbed by config),
  // then morph it into the form's `#invite-reveal` slot once — with a copy button.
  // No navigation means no dead POST-only URL and no refresh re-issuing the invite.
  const settings = await getSettings(db);
  const link = `${resolveBaseUrl(c.env, settings, c.req.url)}/auth/set-password/${inviteToken}`;
  const transport = getEmailTransport(c.env, settings);
  await transport.send({
    to: String(body.email ?? ''),
    ...inviteEmail({ link, siteName: settings.siteName }),
  });

  return c.html(
    <div id="invite-reveal">
      <div class="mt-3">
        <SecretReveal
          id="invite-link"
          label="Invitation created — copy the link now"
          note={
            transport.kind === 'resend'
              ? 'An invite email was sent. This single-use link expires in 7 days; copy it if you also want to share it directly.'
              : 'An invite email was queued (delivery is stubbed in this build). This single-use link expires in 7 days; copy it to share directly.'
          }
          value={link}
        />
      </div>
    </div>,
    200,
  );
});
