import { describe, it, expect } from 'vitest';
import {
  collabTasksCollectionScaffold,
  collabDecisionsCollectionScaffold,
  collabWarpsCollectionScaffold,
  PACKS,
} from '@/templates/packs';
import { validateDefinition } from '@/services/collections';
import { resolveTemplate } from '@/templates/registry';
import { warpTemplate } from '@/templates/warp';
import { statusTemplate } from '@/templates/status';
import type { RenderTemplate } from '@/templates/types';
import type { ExpandedDocument, Backlink } from '@/services/documents';
import type { CollectionDefinition } from '@/fields/types';

const CTX = {
  settings: { siteName: 'remill' },
  baseUrl: 'https://example.org',
  readingMinutes: 0,
} as Parameters<RenderTemplate['Component']>[0]['ctx'];

const docOf = (
  collection: string,
  data: Record<string, unknown>,
  relations?: Record<string, unknown>,
): ExpandedDocument =>
  ({
    id: `doc_${collection}1`,
    collection,
    data,
    relations,
    status: 'published',
    createdBy: 'prn_x',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    publishedAt: '2026-07-20T00:00:00.000Z',
    publishAt: null,
  }) as unknown as ExpandedDocument;

const render = (
  tpl: RenderTemplate,
  def: CollectionDefinition,
  doc: ExpandedDocument,
  backlinks: Backlink[] = [],
): string => String(tpl.Component({ def, doc, backlinks, ctx: CTX }));

describe('collab pack scaffolds (D47)', () => {
  const all = [
    collabTasksCollectionScaffold,
    collabDecisionsCollectionScaffold,
    collabWarpsCollectionScaffold,
  ];

  it('all three pass the standard pipeline and resolve registered templates', () => {
    for (const scaffold of all) {
      const def = validateDefinition(scaffold);
      expect(resolveTemplate(def.template)).toBeDefined();
    }
    expect(PACKS.collab.collections).toHaveLength(3);
  });

  it('working material: private, lifecycle-free, never publicRead', () => {
    for (const scaffold of all) {
      expect(scaffold.access?.private).toBe(true);
      expect(scaffold.access?.publicRead).toBeFalsy();
      expect(scaffold.workflow?.lifecycle).toBe('none');
    }
  });

  it('the handover protocol is enforced by required fields on warps', () => {
    const required = collabWarpsCollectionScaffold.fields
      .filter((f) => f.required)
      .map((f) => f.key);
    expect(required).toEqual(
      expect.arrayContaining(['title', 'task', 'state', 'open_questions', 'next_action']),
    );
  });
});

describe('the warp template', () => {
  const warpDoc = docOf(
    'warps',
    {
      title: 'Session 1 — streaming export',
      task: 'doc_task1',
      written_as: 'implementer',
      state: 'Streaming export works end-to-end on the happy path.',
      decisions: ['doc_dec1'],
      open_questions: '- Number formatting — locale of viewer or invoice?',
      next_action: 'Review quoting before the UI button gets wired.',
      code: { branch: 'feat/csv-export', head: 'b1902fe' },
    },
    {
      task: { id: 'doc_task1', title: 'CSV export', collection: 'tasks' },
      decisions: [{ id: 'doc_dec1', title: 'Stream rows, never buffer', collection: 'decisions' }],
    },
  );

  it('renders the brief: role badge, owning task, next-action panel, sections', () => {
    const html = render(warpTemplate, collabWarpsCollectionScaffold, warpDoc);
    expect(html).toContain('Session 1 — streaming export');
    expect(html).toContain('Implementer'); // select option LABEL, not value
    expect(html).toContain('CSV export'); // expanded task relation title
    expect(html).toContain('Review quoting before the UI button gets wired.');
    expect(html).toContain('Stream rows, never buffer'); // expanded decision title
    expect(html).toContain('Streaming export works');
  });

  it('escapes user content (JSX auto-escaping carries every field)', () => {
    const hostile = docOf('warps', {
      title: '<script>alert(1)</script>',
      state: 'x',
      open_questions: 'y',
      next_action: 'z',
    });
    const html = render(warpTemplate, collabWarpsCollectionScaffold, hostile);
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders bare without optional fields or relations', () => {
    const bare = docOf('warps', {
      title: 'Bare',
      state: 'Some state.',
      open_questions: '- q',
      next_action: 'Do the thing',
    });
    expect(render(warpTemplate, collabWarpsCollectionScaffold, bare)).toContain('Bare');
  });
});

describe('the status template', () => {
  const taskDoc = docOf('tasks', {
    title: 'CSV export for invoice line-items',
    goal: 'Accountants can download any invoice list as CSV.',
    repo: 'github.com/trickycdm/luupdin',
    stage: 'in-review',
    open_questions: '- Number formatting — viewer locale or invoice locale?',
  });
  const backlinks: Backlink[] = [
    {
      id: 'doc_warp1',
      collection: 'warps',
      title: 'Session 1',
      status: 'published',
      updatedAt: '2026-07-20T10:00:00.000Z',
    },
    {
      id: 'doc_dec1',
      collection: 'decisions',
      title: 'Escape formula injection',
      status: 'published',
      updatedAt: '2026-07-20T11:00:00.000Z',
    },
    {
      id: 'doc_dec2',
      collection: 'decisions',
      title: 'Stream rows, never buffer',
      status: 'published',
      updatedAt: '2026-07-20T09:00:00.000Z',
    },
  ];

  it('renders title, the stage STAMP label, goal, and the rollup callout', () => {
    const html = render(statusTemplate, collabTasksCollectionScaffold, taskDoc, backlinks);
    expect(html).toContain('CSV export for invoice line-items');
    expect(html).toContain('In review'); // option label, never the raw value
    expect(html).toContain('Accountants can download');
    expect(html).toContain('Needs a human'); // the pack's label on open_questions
    expect(html).toContain('viewer locale or invoice locale');
  });

  it('groups linked work by source collection, newest first', () => {
    const html = render(statusTemplate, collabTasksCollectionScaffold, taskDoc, backlinks);
    expect(html).toContain('Session 1');
    expect(html).toContain('Escape formula injection');
    // decisions group ordered newest-first: injection (11:00) before stream (09:00)
    expect(html.indexOf('Escape formula injection')).toBeLessThan(
      html.indexOf('Stream rows, never buffer'),
    );
  });

  it('omits the rollup callout when open_questions is empty, and renders bare', () => {
    const quiet = docOf('tasks', { title: 'Quiet task', goal: 'Ship it.' });
    const html = render(statusTemplate, collabTasksCollectionScaffold, quiet);
    expect(html).toContain('Quiet task');
    expect(html).not.toContain('Needs a human');
  });
});
