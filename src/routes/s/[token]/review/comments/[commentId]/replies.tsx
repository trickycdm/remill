import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { replyToThread } from '@/services/comments';
import { rateLimit, REVIEW_POST_RATE_LIMIT } from '@/middleware/rate-limit';
import { consumeReviewPost, requireReviewer, reviewerPanel, reviewerRequest, withFlash } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /s/:token/review/comments/:commentId/replies — a reviewer replies to a
 *  thread they can see (D55). */
export const onRequestPost = factory.createHandlers(rateLimit('review-post', REVIEW_POST_RATE_LIMIT), async (c) => {
  const req = await reviewerRequest(c);
  await consumeReviewPost(c, req.token);
  const form = await c.req.parseBody();
  const flash = await withFlash(
    () =>
      replyToThread(
        req.db,
        requireReviewer(req),
        req.collection,
        req.grant.documentId,
        pathParam(c, 'commentId'),
        { body: String(form.body ?? '') },
        req.now,
      ),
    'Reply added.',
  );
  return c.html(await reviewerPanel(req, req.viewer, flash));
});
