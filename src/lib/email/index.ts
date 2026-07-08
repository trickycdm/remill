/**
 * Email transport — a thin seam so remill can deliver transactional mail (invites,
 * share links, team joins) without binding callers to a provider (D20).
 *
 * Two implementations:
 *  - `ResendEmailTransport` — real delivery via Resend's HTTPS API. Selected when
 *    BOTH a `RESEND_API_KEY` secret and a From address (settings.emailFrom over
 *    env.EMAIL_FROM) are configured.
 *  - `ConsoleEmailTransport` — the keyless/test default: records a redacted,
 *    PII-safe log line that a send was requested. (RATE_LIMIT? degrade precedent.)
 *
 * Send failures LOG and do not throw: every flow also surfaces its actionable
 * link on-screen to the authenticated admin, so delivery is best-effort.
 *
 * PII discipline (logger.ts): never log the recipient address, the subject body,
 * or any token/link — status codes and recipient domains only.
 */

import { getLogger } from '@/lib/logger';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Rendered HTML body. A `text` fallback is optional. */
  readonly html: string;
  readonly text?: string;
}

export interface EmailTransport {
  /** Which implementation is live — lets UI copy say "sent" vs "stubbed". */
  readonly kind: 'console' | 'resend';
  send(msg: EmailMessage): Promise<void>;
}

/** The stub: logs a redacted record (no address, no body) and returns. */
export class ConsoleEmailTransport implements EmailTransport {
  readonly kind = 'console';
  private readonly log = getLogger('email');

  async send(msg: EmailMessage): Promise<void> {
    // Redact the recipient to its domain only — enough to debug routing, no PII.
    const domain = msg.to.includes('@') ? msg.to.slice(msg.to.indexOf('@')) : 'unknown';
    this.log.info({ toDomain: domain, subject: msg.subject, transport: 'console-stub' }, 'email send (stubbed — not delivered)');
  }
}

/** Real delivery via Resend (https://resend.com) — a plain fetch to its HTTPS
 *  API; no SDK. The From address must be a Resend-verified sender or sends fail
 *  (logged with status only, never thrown). */
export class ResendEmailTransport implements EmailTransport {
  readonly kind = 'resend';
  private readonly log = getLogger('email');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
      }),
    });
    const domain = msg.to.includes('@') ? msg.to.slice(msg.to.indexOf('@')) : 'unknown';
    if (!res.ok) {
      this.log.error({ status: res.status, toDomain: domain, transport: 'resend' }, 'email send failed');
    } else {
      this.log.info({ toDomain: domain, transport: 'resend' }, 'email sent');
    }
  }
}

/**
 * Resolve the active transport. From-address precedence: `settings.emailFrom`
 * (admin-editable) over `env.EMAIL_FROM` (deploy-time default). A key without
 * any From — or no key — degrades to the console stub, so tests and unwired
 * local dev never hit the network.
 */
export function getEmailTransport(
  env?: { readonly RESEND_API_KEY?: string; readonly EMAIL_FROM?: string },
  settings?: { readonly emailFrom?: string },
): EmailTransport {
  const from = settings?.emailFrom?.trim() || env?.EMAIL_FROM?.trim();
  if (env?.RESEND_API_KEY && from) return new ResendEmailTransport(env.RESEND_API_KEY, from);
  return new ConsoleEmailTransport();
}
