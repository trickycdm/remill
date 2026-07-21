import { describe, it, expect } from 'vitest';
import { rendersFor, renderDocument, applyBudget } from '@/templates/renders';
import { collabWarpsCollectionScaffold } from '@/templates/packs';
import { InputValidationError } from '@/lib/errors';
import { APPROX_CHARS_PER_TOKEN } from '@/config/constants';
import type { ExpandedDocument } from '@/services/documents';

const warpDoc = (overrides: Record<string, unknown> = {}): ExpandedDocument =>
  ({
    id: 'doc_warp1',
    collection: 'warps',
    data: {
      title: 'Session 1 — streaming export',
      task: 'doc_task1',
      written_as: 'implementer',
      state:
        'Streaming export works end-to-end on the happy path. Quoting handles embedded ' +
        'commas; memo fields with newlines are untested.',
      decisions: ['doc_dec1', 'doc_dec2'],
      open_questions: '- Number formatting — locale of viewer or invoice?\n- 1M-row exports?',
      next_action: 'Review streaming + quoting before the UI button gets wired.',
      code: { branch: 'feat/csv-export', head: 'b1902fe', diff: '+412 −38' },
      ...overrides,
    },
    relations: {
      task: { id: 'doc_task1', title: 'CSV export', collection: 'tasks' },
      decisions: [
        { id: 'doc_dec1', title: 'Stream rows, never buffer', collection: 'decisions' },
        { id: 'doc_dec2', title: null, collection: 'decisions' },
      ],
    },
  }) as unknown as ExpandedDocument;

describe('rendersFor', () => {
  it('declares reviewer + implementer for warp; nothing for other templates', () => {
    expect(rendersFor('warp')).toEqual(['reviewer', 'implementer']);
    expect(rendersFor('article')).toEqual([]);
    expect(rendersFor(undefined)).toEqual([]);
  });
});

describe('the warp renders', () => {
  it('reviewer: decisions lead, state is compressed, task is framed', () => {
    const md = renderDocument(collabWarpsCollectionScaffold, warpDoc(), [], {
      render: 'reviewer',
    });
    expect(md).toContain('# Session 1 — streaming export');
    expect(md).toContain("review, don't build");
    expect(md).toContain('CSV export (doc_task1)');
    expect(md).toContain('- Stream rows, never buffer (doc_dec1)');
    expect(md).toContain('- doc_dec2 (doc_dec2)'); // null title falls back to id
    expect(md.indexOf('Decisions to hold me to')).toBeLessThan(md.indexOf('Open questions'));
    expect(md.indexOf('Open questions')).toBeLessThan(md.indexOf('State (compressed)'));
    expect(md).toContain('- branch: feat/csv-export');
  });

  it('implementer: the next action comes first', () => {
    const md = renderDocument(collabWarpsCollectionScaffold, warpDoc(), [], {
      render: 'implementer',
    });
    expect(md.indexOf('## Next action')).toBeLessThan(md.indexOf('## Open questions'));
    expect(md.indexOf('## Open questions')).toBeLessThan(md.indexOf('## State'));
    expect(md).toContain('Review streaming + quoting before the UI button gets wired.');
  });

  it('returns literal markdown — real newlines, no JSON quoting', () => {
    const md = renderDocument(collabWarpsCollectionScaffold, warpDoc(), [], {
      render: 'implementer',
    });
    expect(md).toContain('\n');
    expect(md.startsWith('"')).toBe(false);
  });

  it('unknown render throws the standard 422 listing what IS available', () => {
    try {
      renderDocument(collabWarpsCollectionScaffold, warpDoc(), [], { render: 'bogus' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InputValidationError);
      const details = (e as InputValidationError).details ?? [];
      expect(JSON.stringify(details)).toContain('reviewer, implementer');
    }
  });
});

describe('applyBudget', () => {
  const sections = [
    { priority: 0, text: '# Header' },
    { priority: 3, text: `## Low ${'x'.repeat(400)}` },
    { priority: 1, text: '## Critical section' },
  ];

  it('no budget → everything, in display order', () => {
    const out = applyBudget(sections);
    expect(out.indexOf('# Header')).toBeLessThan(out.indexOf('## Low'));
    expect(out.indexOf('## Low')).toBeLessThan(out.indexOf('## Critical section'));
  });

  it('a tight budget keeps high-priority sections whole and clips the low one', () => {
    const budget = 20; // ≈80 chars — header + critical fit whole; the 400-char low is clipped
    const out = applyBudget(sections, budget);
    expect(out).toContain('# Header');
    expect(out).toContain('## Critical section');
    expect(out).toContain('…'); // the low-priority tail was word-safe clipped
    expect(out.length).toBeLessThanOrEqual(budget * APPROX_CHARS_PER_TOKEN + 10);
    // display order is preserved even though priority drove the allocation
    expect(out.indexOf('## Low')).toBeLessThan(out.indexOf('## Critical section'));
  });

  it('budget cuts the whole render to roughly the token cap', () => {
    const md = renderDocument(collabWarpsCollectionScaffold, warpDoc(), [], {
      render: 'implementer',
      budget: 40,
    });
    expect(md.length).toBeLessThanOrEqual(40 * APPROX_CHARS_PER_TOKEN + 10);
    expect(md).toContain('# Session 1'); // the header always survives
  });
});
