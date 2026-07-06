/**
 * Transactional email templates (D20) — typed string builders returning
 * `{subject, html, text}`. Deliberately NOT JSX: email HTML is table-and-
 * inline-style land (clients strip <link>/<style>), so a renderer buys nothing.
 *
 * Every interpolation goes through `esc()` — team names and site names are
 * user-authored content. Colors echo the light-mode brand tokens from
 * src/tailwind.css `@theme` (email clients can't do light-dark()):
 * canvas #f2efe7 · card #fffdf8 · ink #1c1a16 · muted #56514a ·
 * border #e7e1d4 · accent #4b44a3 (white text).
 */

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SERIF = "Georgia, 'Iowan Old Style', Palatino, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The shared shell: canvas wash, serif masthead, white card, accent CTA. */
function emailLayout(opts: {
  siteName: string;
  title: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footNote: string;
}): string {
  const site = esc(opts.siteName);
  const url = esc(opts.ctaUrl);
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background-color:#f2efe7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2efe7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td style="padding:0 8px 16px;font-family:${SERIF};font-size:20px;font-weight:600;color:#1c1a16;">${site}</td></tr>
        <tr><td style="background-color:#fffdf8;border:1px solid #e7e1d4;border-radius:10px;padding:32px;">
          <h1 style="margin:0 0 12px;font-family:${SERIF};font-size:24px;font-weight:600;color:#1c1a16;">${esc(opts.title)}</h1>
          <div style="font-family:${SANS};font-size:15px;line-height:1.6;color:#56514a;">${opts.bodyHtml}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
            <tr><td style="border-radius:7px;background-color:#4b44a3;">
              <a href="${url}" style="display:inline-block;padding:10px 20px;font-family:${SANS};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(opts.ctaLabel)}</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:#6c665a;">
            Or copy this link: <span style="word-break:break-all;color:#4b44a3;">${url}</span>
          </p>
        </td></tr>
        <tr><td style="padding:16px 8px 0;font-family:${SANS};font-size:12px;color:#6c665a;">${esc(opts.footNote)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** "A document was shared with you" — sent alongside a minted share link. */
export function shareNotificationEmail(opts: { url: string; siteName?: string }): RenderedEmail {
  const siteName = opts.siteName || 'remill';
  return {
    subject: `A document was shared with you on ${siteName}`,
    html: emailLayout({
      siteName,
      title: 'A document was shared with you',
      bodyHtml: `<p style="margin:0;">You've been given read access to a document on <strong>${esc(siteName)}</strong>. No account is needed — the link below opens it directly.</p>`,
      ctaLabel: 'Open the document',
      ctaUrl: opts.url,
      footNote: 'This link may expire or be revoked by the sender.',
    }),
    text: `You've been given read access to a document on ${siteName}. Open it: ${opts.url}`,
  };
}

/** The set-password invitation for a person created by an admin. */
export function inviteEmail(opts: { link: string; siteName?: string }): RenderedEmail {
  const siteName = opts.siteName || 'remill';
  return {
    subject: `Your ${siteName} invitation`,
    html: emailLayout({
      siteName,
      title: `You're invited to ${siteName}`,
      bodyHtml: `<p style="margin:0;">An account has been created for you on <strong>${esc(siteName)}</strong>. Choose a password to activate it. This link is single-use and expires in 7 days.</p>`,
      ctaLabel: 'Set your password',
      ctaUrl: opts.link,
      footNote: "If you weren't expecting this invitation, you can ignore this email.",
    }),
    text: `You've been invited to ${siteName}. Set your password (single-use link, expires in 7 days): ${opts.link}`,
  };
}

/** The team-join invitation — registers a new account into a team (D24). */
export function teamJoinEmail(opts: { link: string; teamName: string; siteName?: string }): RenderedEmail {
  const siteName = opts.siteName || 'remill';
  return {
    subject: `Join ${opts.teamName} on ${siteName}`,
    html: emailLayout({
      siteName,
      title: `Join ${esc(opts.teamName)}`,
      bodyHtml: `<p style="margin:0;">You've been invited to join the <strong>${esc(opts.teamName)}</strong> team on <strong>${esc(siteName)}</strong>. Create your account with the link below — anything shared with the team will be waiting for you.</p>`,
      ctaLabel: 'Create your account',
      ctaUrl: opts.link,
      footNote: 'This invite link expires; ask the sender for a new one if it stops working.',
    }),
    text: `You've been invited to join ${opts.teamName} on ${siteName}. Create your account: ${opts.link}`,
  };
}
