import { describe, it, expect } from 'vitest';
import { buildReviewBrief } from './review-brief';
import type { CommentRecord } from '@/db/queries/comments';

const root = (over: Partial<CommentRecord>): CommentRecord => ({
  id: 'cmt_x',
  documentId: 'doc_1',
  threadId: null,
  author: { kind: 'reviewer', reviewerId: 'rvw_a', name: 'Alice', grantId: 'grn_a', linkMode: 'group' },
  visibility: null,
  anchor: { kind: 'text', field: 'page', quote: 'grew 12%', prefix: 'Revenue ', suffix: ' in Q3', start: 8 },
  anchorRevision: 1,
  anchorStatus: 'anchored',
  body: 'Source?',
  intent: null,
  status: 'open',
  resolvedBy: null,
  resolvedRevision: null,
  resolvedAt: null,
  createdAt: '2026-09-23T12:00:00Z',
  ...over,
});

const input = {
  title: 'Q3 report',
  documentId: 'doc_1',
  collection: 'reports',
  revision: 3,
  reviewers: [],
};

describe('buildReviewBrief (D55)', () => {
  it('shows each quote in context, the thread id, replies, and outdated anchors', () => {
    const md = buildReviewBrief({
      ...input,
      threads: [
        {
          root: root({ id: 'cmt_1', intent: 'must_fix' }),
          replies: [root({ id: 'cmt_2', threadId: 'cmt_1', body: 'Finance deck\nslide 4', anchor: null })],
        },
        { root: root({ id: 'cmt_3', anchorStatus: 'outdated', anchorRevision: 2 }), replies: [] },
      ],
    });
    expect(md).toContain('> …Revenue {==grew 12%==} in Q3…');
    expect(md).toContain('open · must fix — Alice (reviewer)');
    expect(md).toContain('- **Alice (reviewer)**: Finance deck ⏎ slide 4');
    expect(md).toContain('`threadId: cmt_1`');
    expect(md).toContain('OUTDATED');
    expect(md).toContain('2 open thread(s), 1 outdated, 0 resolved.');
  });

  it('under a tight budget keeps the header and live must-fix feedback, dropping resolved history first', () => {
    const md = buildReviewBrief(
      {
        ...input,
        threads: [
          { root: root({ id: 'cmt_old', status: 'resolved', resolvedRevision: 2, body: 'old '.repeat(80) }), replies: [] },
          { root: root({ id: 'cmt_hot', intent: 'must_fix', body: 'Fix the total' }), replies: [] },
        ],
      },
      120,
    );
    expect(md).toContain('# Review: Q3 report');
    expect(md).toContain('cmt_hot');
    expect(md).not.toContain('cmt_old');
  });
});
