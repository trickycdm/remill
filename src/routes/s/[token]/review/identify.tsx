import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { identifyReviewer } from '@/services/comments';
import { rateLimit, REVIEW_POST_RATE_LIMIT } from '@/middleware/rate-limit';
import { consumeReviewPost, reviewerPanel, reviewerRequest, setReviewerCookie, withFlash } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /s/:token/review/identify — a reviewer on an OPEN review link names
 *  themselves (D55); the id rides a signed cookie scoped to this link. */
export const onRequestPost = factory.createHandlers(rateLimit('review-post', REVIEW_POST_RATE_LIMIT), async (c) => {
  const req = await reviewerRequest(c);
  await consumeReviewPost(c, req.token);
  const form = await c.req.parseBody();
  let viewer = req.viewer;
  const flash = await withFlash(async () => {
    viewer = await identifyReviewer(req.db, req.grant, String(form.name ?? ''), req.now);
    await setReviewerCookie(c, req, viewer.reviewer.id);
  }, 'Thanks — you can comment now.');
  return c.html(await reviewerPanel(req, viewer, flash));
});
