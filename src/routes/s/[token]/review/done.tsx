import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { setReviewerDone } from '@/services/comments';
import { rateLimit, REVIEW_POST_RATE_LIMIT } from '@/middleware/rate-limit';
import { requireReviewer, reviewerPanel, reviewerRequest, withFlash } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /s/:token/review/done — a reviewer marks their review complete, or
 *  reopens it (`done=0`) (D55). The panel re-reads the reviewer afterwards. */
export const onRequestPost = factory.createHandlers(rateLimit('review-post', REVIEW_POST_RATE_LIMIT), async (c) => {
  const req = await reviewerRequest(c);
  const done = String((await c.req.parseBody()).done ?? '1') !== '0';
  const flash = await withFlash(
    () => setReviewerDone(req.db, requireReviewer(req), req.collection, done, req.now),
    done ? 'Marked as done — thank you.' : 'Review reopened.',
  );
  const fresh = await reviewerRequest(c);
  return c.html(await reviewerPanel(fresh, fresh.viewer, flash));
});
