import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { deleteComment } from '@/services/comments';
import { rateLimit, REVIEW_POST_RATE_LIMIT } from '@/middleware/rate-limit';
import { requireReviewer, reviewerPanel, reviewerRequest, withFlash } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /s/:token/review/comments/:commentId/delete — a reviewer deletes their
 *  own comment (D55). */
export const onRequestPost = factory.createHandlers(rateLimit('review-post', REVIEW_POST_RATE_LIMIT), async (c) => {
  const req = await reviewerRequest(c);
  const flash = await withFlash(
    () =>
      deleteComment(req.db, requireReviewer(req), req.collection, req.grant.documentId, pathParam(c, 'commentId'), req.now),
    'Comment deleted.',
  );
  return c.html(await reviewerPanel(req, req.viewer, flash));
});
