/**
 * Email transport — a thin seam so remill can deliver transactional mail (invites,
 * later: password resets, share-by-email) without binding to a provider yet.
 *
 * STATUS: stubbed. `ConsoleEmailTransport` is the only implementation and it does
 * NOT send — it records a redacted, PII-safe log line that a send was requested.
 * Integrating a real provider (Resend / MailChannels / SES) is later work: add an
 * implementation and select it from env in `getEmailTransport`. Callers depend only
 * on the `EmailTransport` interface, so nothing above this file changes then.
 *
 * PII discipline (logger.ts): never log the recipient address, the subject body, or
 * any token/link. Local flows surface the actionable link on-screen to the
 * authenticated admin instead of via logs.
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
  send(msg: EmailMessage): Promise<void>;
}

/** The stub: logs a redacted record (no address, no body) and returns. */
export class ConsoleEmailTransport implements EmailTransport {
  private readonly log = getLogger('email');

  async send(msg: EmailMessage): Promise<void> {
    // Redact the recipient to its domain only — enough to debug routing, no PII.
    const domain = msg.to.includes('@') ? msg.to.slice(msg.to.indexOf('@')) : 'unknown';
    this.log.info({ toDomain: domain, subject: msg.subject, transport: 'console-stub' }, 'email send (stubbed — not delivered)');
  }
}

/**
 * Resolve the active transport for this environment. Stubbed to the console
 * transport today; a real provider is selected here later (e.g. by `env.EMAIL_PROVIDER`).
 * `_env` is accepted now so call sites are already provider-ready.
 */
export function getEmailTransport(_env?: unknown): EmailTransport {
  return new ConsoleEmailTransport();
}
