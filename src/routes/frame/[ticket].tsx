import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { readFramedDocument } from '@/services/frame';
import { FRAME_NOT_FOUND_HTML } from '@/lib/frame/document';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /frame/:ticket — the CONTENT of a framed page (D60): the author's html,
 * served to the viewer shell's sandboxed iframe. The ticket names the viewer;
 * the read re-runs `authorize()` as that viewer (services/frame). The response
 * headers — the frame CSP with its `sandbox` directive, no-store, noindex —
 * come from the security-headers middleware's `/frame/` branch, so even a
 * refusal is sandboxed. No session is read or written here (main.tsx skips the
 * session middleware for this prefix): the framed document is cookieless.
 *
 * Every refusal — bad, tampered or expired ticket, revoked link, lost role,
 * missing page — is ONE indistinguishable 404.
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  try {
    const html = await readFramedDocument(
      getDb(c.env.DB),
      c.env.SESSION_SECRET,
      pathParam(c, 'ticket'),
      nowIso(),
    );
    return c.html(html);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError)
      return c.html(FRAME_NOT_FOUND_HTML, 404);
    throw e;
  }
});
