import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { grantItem, revokeItem, createShareLink } from '@/services/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { getEmailTransport } from '@/lib/email';
import { shareNotificationEmail } from '@/lib/email/templates';
import type { Action } from '@/access';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardContent, Input, Button } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** POST /admin/c/:collection/:id/share — grant/revoke item-level access, or
 *  create a share link (op=link; optionally delivered by the stubbed email). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const collection = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const back = `/admin/c/${collection}/${id}`;

  if (String(body.op) === 'revoke') {
    await revokeItem(db, principal, String(body.grantId ?? ''), collection, id, now);
    return c.redirect(back, 303);
  }

  if (String(body.op) === 'link') {
    const rawExpiry = String(body.expiresAt ?? '').trim();
    const { token } = await createShareLink(
      db,
      principal,
      {
        collection,
        documentId: id,
        actions: ['read'],
        expiresAt: rawExpiry ? new Date(rawExpiry).toISOString() : undefined,
      },
      now,
    );
    const settings = await getSettings(db);
    const url = `${resolveBaseUrl(c.env, settings, c.req.url)}/s/${token}`;
    const email = String(body.email ?? '').trim();
    const transport = getEmailTransport(c.env, settings);
    if (email) {
      await transport.send({
        to: email,
        ...shareNotificationEmail({ url, siteName: settings.siteName }),
      });
    }
    // The plaintext token exists only in THIS response (its hash is what's
    // stored), so render the link once — a redirect would lose it.
    return c.render(
      <AdminShell user={getUser(c)} current="content">
        <PageHeader
          breadcrumb={[{ label: 'Content', href: '/admin/c' }, { label: 'Share link' }]}
          title="Share link created"
        />
        <Card class="max-w-2xl">
          <CardContent class="flex flex-col gap-4 pt-6">
            <p class="text-sm text-ink-muted">
              Copy it now — this link is shown <strong>only once</strong>. Anyone holding it can
              read this document until it expires or the grant is revoked from the Share panel.
            </p>
            <Input
              type="text"
              value={url}
              readonly
              aria-label="Share link URL"
              data-on:focus="evt.target.select()"
            />
            {email ? (
              transport.kind === 'resend' ? (
                <p class="text-sm text-ink-muted">
                  An email with this link was sent to <strong>{email}</strong>.
                </p>
              ) : (
                <p class="text-sm text-ink-muted">
                  An email to <strong>{email}</strong> was handed to the transport — currently the
                  console stub, which logs instead of sending. Share the link above directly.
                </p>
              )
            ) : null}
            <div>
              <Button href={back} variant="secondary" size="sm">
                Back to document
              </Button>
            </div>
          </CardContent>
        </Card>
      </AdminShell>,
    );
  }

  // subject is encoded "principal:<id>" | "role:<slug>" | "team:<id>" so one
  // <select> covers all three.
  const [kind, ...rest] = String(body.subject ?? '').split(':');
  const subjectId = rest.join(':');
  const rawExpiry = String(body.expiresAt ?? '').trim();
  // datetime-local (local time, no zone) → normalized ISO-8601 for lexicographic compare.
  const expiresAt = rawExpiry ? new Date(rawExpiry).toISOString() : undefined;

  await grantItem(
    db,
    principal,
    {
      subjectKind: kind === 'role' ? 'role' : kind === 'team' ? 'team' : 'principal',
      subjectId,
      documentId: id,
      collection,
      actions: asArray(body.action as string | string[] | undefined) as Action[],
      expiresAt,
    },
    now,
  );
  return c.redirect(back, 303);
});
