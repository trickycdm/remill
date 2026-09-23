import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { grantItem, revokeItem, createShareLink, revokeShareLink, emailShareLink } from '@/services/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { getEmailTransport } from '@/lib/email';
import type { Action } from '@/access';
import { nowIso } from '@/lib/now';
import { rateLimit, SHARE_EMAIL_RATE_LIMIT } from '@/middleware/rate-limit';
import { jsonForScript } from '@/lib/json-for-script';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardContent, Input, Button } from '@/components/ui';
import { createReviewLink, previewReviewModeFlip, setReviewMode, type ReviewMode } from '@/services/comments';

const factory = createFactory<{ Bindings: Env }>();

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** POST /admin/c/:collection/:id/share — grant/revoke item-level access, or
 *  create a share link (op=link; optionally delivered by the stubbed email). */
export const onRequestPost = factory.createHandlers(requireAuth(), rateLimit('share-panel', SHARE_EMAIL_RATE_LIMIT), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const collection = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const back = `/admin/c/${collection}/${id}`;
  const action = `${back}/share`;

  if (String(body.op) === 'revoke') {
    await revokeItem(db, principal, String(body.grantId ?? ''), collection, id, now);
    return c.redirect(back, 303);
  }

  if (String(body.op) === 'revoke_link') {
    await revokeShareLink(db, principal, collection, id, String(body.grantId ?? ''), now);
    return c.redirect(back, 303);
  }

  // ── Review links (D55) ────────────────────────────────────────────────
  if (String(body.op) === 'review_link') {
    const rawExpiry = String(body.expiresAt ?? '').trim();
    const name = String(body.reviewerName ?? '').trim();
    const email = String(body.reviewerEmail ?? '').trim();
    const password = String(body.password ?? '');
    const { token } = await createReviewLink(
      db,
      principal,
      {
        collection,
        documentId: id,
        mode: String(body.mode) === 'individual' ? 'individual' : 'group',
        reviewer: name ? { name, email: email || undefined } : undefined,
        expiresAt: rawExpiry ? new Date(rawExpiry).toISOString() : undefined,
        password: password || undefined,
      },
      c.env.SESSION_SECRET,
      now,
    );
    // The link stays copyable from the Share card (D53); emailing it is an
    // optional convenience through the same gated service as share links.
    if (email) {
      const settings = await getSettings(db);
      const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
      await emailShareLink(
        db,
        principal,
        { collection, documentId: id, url: `${baseUrl}/s/${token}`, email, baseUrl },
        getEmailTransport(c.env, settings),
        settings.siteName,
        now,
      );
    }
    return c.redirect(back, 303);
  }

  if (String(body.op) === 'review_mode') {
    const mode: ReviewMode = String(body.mode) === 'individual' ? 'individual' : 'group';
    await setReviewMode(db, principal, collection, id, String(body.grantId ?? ''), mode, now);
    return c.redirect(back, 303);
  }

  // Flipping a mode re-scopes every PAST comment made through the link, so it
  // goes through a confirmation that says exactly what changes.
  if (String(body.op) === 'review_mode_preview') {
    const grantId = String(body.grantId ?? '');
    const flip = await previewReviewModeFlip(db, principal, collection, id, grantId, now);
    const people = `${flip.reviewers} reviewer${flip.reviewers === 1 ? '' : 's'}`;
    const things = `${flip.comments} comment${flip.comments === 1 ? '' : 's'}`;
    const warning =
      flip.to === 'group'
        ? `This will make ${things} from ${people} visible to everyone reviewing this document through a group link.`
        : `This will hide ${things} from ${people} from other reviewers. Only you (and people with accounts) will still see them.`;
    return c.render(
      <AdminShell user={getUser(c)} current="content">
        <PageHeader
          breadcrumb={[{ label: 'Content', href: '/admin/c' }, { label: 'Review link' }]}
          title={flip.to === 'group' ? 'Switch to group review?' : 'Switch to individual review?'}
        />
        <Card class="max-w-2xl">
          <CardContent class="flex flex-col gap-4 pt-6">
            <p role="alert" class="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
              {warning}
            </p>
            <p class="text-sm text-ink-muted">
              {flip.to === 'group'
                ? 'Reviewers on this link will also start seeing other group reviewers’ comments.'
                : 'Reviewers on this link will only see their own comments and your shared notes.'}
            </p>
            <div class="flex flex-wrap gap-2">
              <form method="post" action={action}>
                <input type="hidden" name="op" value="review_mode" />
                <input type="hidden" name="grantId" value={grantId} />
                <input type="hidden" name="mode" value={flip.to} />
                <Button type="submit" variant="primary" size="sm">
                  {flip.to === 'group' ? 'Switch to group' : 'Switch to individual'}
                </Button>
              </form>
              <Button href={back} variant="secondary" size="sm">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </AdminShell>,
    );
  }

  if (String(body.op) === 'link') {
    const rawExpiry = String(body.expiresAt ?? '').trim();
    // Never trim a password — only an EMPTY string means "no password"; a
    // password with meaningful leading/trailing spaces must round-trip
    // unchanged, or the human who set it can't unlock their own link.
    const password = String(body.password ?? '');
    const label = String(body.label ?? '').trim();
    const { token, hasPassword } = await createShareLink(
      db,
      principal,
      {
        collection,
        documentId: id,
        actions: ['read'],
        expiresAt: rawExpiry ? new Date(rawExpiry).toISOString() : undefined,
        password: password || undefined,
        label: label || undefined,
      },
      c.env.SESSION_SECRET,
      now,
    );
    const settings = await getSettings(db);
    const url = `${resolveBaseUrl(c.env, settings, c.req.url)}/s/${token}`;
    // The token is also stored encrypted (D53), so — unlike an API key — this
    // link isn't a show-once secret: it can be copied again later from the
    // Share card. Sending it by email is a SEPARATE, secondary action below
    // (op=email_link) — decoupled from creation so the panel doesn't read as
    // "email someone".
    return c.render(
      <AdminShell user={getUser(c)} current="content">
        <PageHeader
          breadcrumb={[{ label: 'Content', href: '/admin/c' }, { label: 'Share link' }]}
          title="Share link created"
        />
        <Card class="max-w-2xl">
          <CardContent class="flex flex-col gap-4 pt-6">
            <p class="text-sm text-ink-muted">
              Anyone holding this link can read this document until it expires or the grant is
              revoked from the Share panel. You can copy it again anytime from the Share card.
            </p>
            <div class="flex items-center gap-2" data-signals={jsonForScript({ copied: false })}>
              <Input
                type="text"
                value={url}
                readonly
                aria-label="Share link URL"
                data-on:focus="evt.target.select()"
                id="share-link-url"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-on:click="navigator.clipboard.writeText(document.getElementById('share-link-url').value); $copied = true; setTimeout(() => $copied = false, 2500)"
              >
                Copy
              </Button>
            </div>
            <p role="status" aria-live="polite" class="text-sm text-success" data-show="$copied">
              Copied
            </p>
            {hasPassword ? (
              <p class="text-sm text-ink-muted">
                Send the password separately — it isn't shown again.
              </p>
            ) : null}

            <form method="post" action={action} class="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-end">
              <input type="hidden" name="op" value="email_link" />
              <input type="hidden" name="url" value={url} />
              <div class="flex-1">
                <label for="share-link-email" class="mb-1 block text-sm font-medium text-ink">
                  Email this link (optional)
                </label>
                <Input id="share-link-email" name="email" type="email" placeholder="someone@example.com" />
              </div>
              <Button type="submit" variant="secondary" size="sm">
                Send
              </Button>
            </form>
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

  if (String(body.op) === 'email_link') {
    const url = String(body.url ?? '');
    const email = String(body.email ?? '').trim();
    const settings = await getSettings(db);
    const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
    const transport = getEmailTransport(c.env, settings);
    // The gating, URL-shape, and email-shape checks all live in the service
    // — `authorize('share_link', …)` so this
    // can't become a spam/phishing relay for any logged-in user, and a
    // strict `${baseUrl}/s/<token>` match rather than a loose `startsWith`.
    await emailShareLink(db, principal, { collection, documentId: id, url, email, baseUrl }, transport, settings.siteName, now);
    return c.render(
      <AdminShell user={getUser(c)} current="content">
        <PageHeader
          breadcrumb={[{ label: 'Content', href: '/admin/c' }, { label: 'Share link' }]}
          title="Share link"
        />
        <Card class="max-w-2xl">
          <CardContent class="flex flex-col gap-4 pt-6">
            {transport.kind === 'resend' ? (
              <p class="text-sm text-ink-muted">
                An email with this link was sent to <strong>{email}</strong>.
              </p>
            ) : (
              <p class="text-sm text-ink-muted">
                An email to <strong>{email}</strong> was handed to the transport — currently the
                console stub, which logs instead of sending. Share the link directly instead.
              </p>
            )}
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
