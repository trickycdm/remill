import { describe, it, expect } from 'vitest';
import { promptsCollectionScaffold, PACKS } from '@/templates/packs';
import { validateDefinition } from '@/services/collections';
import { resolveTemplate } from '@/templates/registry';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { promptTemplate } from '@/templates/prompt';
import type { ExpandedDocument } from '@/services/documents';

const renderDoc = (data: Record<string, unknown>): string =>
  String(
    promptTemplate.Component({
      def: promptsCollectionScaffold,
      doc: {
        id: 'doc_prompt1',
        collection: 'prompts',
        data,
        status: 'published',
        createdBy: 'prn_x',
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
        publishedAt: '2026-07-17T00:00:00.000Z',
        publishAt: null,
      } as unknown as ExpandedDocument,
      backlinks: [],
      ctx: {
        settings: { siteName: 'remill' },
        baseUrl: 'https://example.org',
        readingMinutes: 1,
        shareUrl: 'https://example.org/prompts/release-notes-drafter',
      },
    }),
  );

describe('prompts pack scaffold', () => {
  it('is a valid collection definition that selects the prompt template', () => {
    const def = validateDefinition(promptsCollectionScaffold);
    expect(def.template).toBe('prompt');
    expect(resolveTemplate(def.template)).toBeDefined();
    expect(PACKS.prompts.template).toBe('prompt');
  });

  it('is PRIVATE by default — the one pack pinning access.private (D46 privacy pin)', () => {
    expect(promptsCollectionScaffold.access?.publicRead).toBeFalsy();
    expect(promptsCollectionScaffold.access?.private).toBe(true);
  });

  it('resolves title by convention; body fields are markdown; chips fields present', () => {
    const layout = resolveConventionLayout(promptsCollectionScaffold, {
      wantHero: false,
      wantLead: false,
    });
    expect(layout.titleField?.key).toBe('title');
    expect(layout.body.map((f) => f.key)).toEqual(['body', 'notes', 'example_output']);
  });

  it('renders the prompt panel with highlighted variables and escaped user content', () => {
    const html = renderDoc({
      title: 'Release-notes drafter',
      slug: 'release-notes-drafter',
      body: 'Draft release notes for {{version}}. Audience: {{audience}}. <script>alert(1)</script>',
      variables: ['version', 'audience'],
      model: 'claude',
      tags: ['writing'],
      notes: 'Use after tagging a release.',
    });

    expect(html).toContain('Release-notes drafter'); // H1
    expect(html).toContain('<mark'); // highlighted placeholder
    expect(html).toContain('{{version}}');
    expect(html).toContain('{{audience}}');
    expect(html).not.toContain('<script>alert(1)</script>'); // escaped, never raw
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Claude'); // model badge renders the option label
    expect(html).toContain('Use after tagging a release.'); // notes prose section
    expect(html).not.toContain('release-notes-drafter</'); // slug never reader content
  });

  it('renders without optional fields (no model, no variables, no notes)', () => {
    const html = renderDoc({
      title: 'Bare prompt',
      slug: 'bare-prompt',
      body: 'Just fixed text.',
    });
    expect(html).toContain('Bare prompt');
    expect(html).toContain('Just fixed text.');
    expect(html).not.toContain('<mark');
  });

  it('declares exactly the share-bar capability (no reading time)', () => {
    expect(promptTemplate.wants).toEqual({ shareBar: true });
  });
});
