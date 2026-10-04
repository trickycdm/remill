/**
 * REST plumbing for `/api/pages` (D62) — turn a request into `publishPage`'s
 * input. Two body forms, one result:
 *
 *  - `Content-Type: text/html` — the body IS the page (`curl --data-binary
 *    @page.html`); `title`, `description` and `tags` (comma-separated) ride the
 *    query string. No `share` here: a link password must never be in a URL —
 *    mint the link with the share-links endpoint, or use the JSON form.
 *  - `application/json` — the same object the MCP `publish_page` tool takes.
 */

import type { Context } from 'hono';
import type { Env } from '@/types';
import { MAX_PAGE_BODY_BYTES, textBody } from '@/lib/api';
import { BadRequestError } from '@/lib/errors';
import type { PublishPageInput } from '@/services/pages';

export async function pageInputFrom(
  c: Context<{ Bindings: Env }>,
): Promise<Omit<PublishPageInput, 'id'>> {
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const body = await textBody(c, MAX_PAGE_BODY_BYTES);

  if (type === 'text/html') {
    const tags = c.req.query('tags');
    return {
      html: body,
      title: c.req.query('title'),
      description: c.req.query('description'),
      tags:
        tags === undefined
          ? undefined
          : tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
    };
  }
  if (type === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new BadRequestError('Request body must be valid JSON.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BadRequestError('Request body must be a JSON object.');
    }
    const { html, title, description, tags, expectedRevision, share } = parsed as Record<
      string,
      unknown
    >;
    return { html, title, description, tags, expectedRevision, share };
  }
  throw new BadRequestError(
    'Send the page as text/html, or as application/json with an `html` property.',
  );
}
