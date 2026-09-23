import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { createThread } from '@/services/comments';
import { rateLimit, REVIEW_POST_RATE_LIMIT } from '@/middleware/rate-limit';
import {
  commentInputFromForm,
  consumeReviewPost,
  requireReviewer,
  reviewerPanel,
  reviewerRequest,
  withFlash,
} from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /s/:token/review/comments — a reviewer starts a thread (D55). */
export const onRequestPost = factory.createHandlers(rateLimit('review-post', REVIEW_POST_RATE_LIMIT), async (c) => {
  const req = await reviewerRequest(c);
  await consumeReviewPost(c, req.token);
  const input = commentInputFromForm(await c.req.parseBody());
  const flash = await withFlash(
    () => createThread(req.db, requireReviewer(req), req.collection, req.grant.documentId, input, req.now),
    'Comment added.',
  );
  return c.html(await reviewerPanel(req, req.viewer, flash));
});
