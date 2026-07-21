/**
 * The content-pack registry — packs are CODE (this closed registry, the
 * template-registry grain); installing one is DATA (collection rows created
 * through the standard validated pipeline). A pack bundles a reading template
 * with the collection definition(s) co-designed for it, so "start a blog"
 * needs zero presentation config on any surface: the admin Marketplace, the
 * MCP `install_pack` tool, and `POST /api/packs/:key/install` all call the
 * same `installPack` service, which loops the ordinary `createCollection`
 * (authorize + validateDefinition + outbox event — nothing bespoke).
 *
 * Import-safe for services (like keys.ts): plain data + types, no JSX. The
 * exhaustive `Record<PackKey, Pack>` means adding a key here fails the build
 * until the pack is defined.
 */

import type { CollectionDefinition } from '@/fields/types';
import type { TemplateKey } from '@/templates/keys';

export const PACK_KEYS = ['blog', 'changelog', 'portfolio', 'docs', 'prompts', 'collab'] as const;
export type PackKey = (typeof PACK_KEYS)[number];

export function isPackKey(key: string): key is PackKey {
  return (PACK_KEYS as readonly string[]).includes(key);
}

export interface Pack {
  readonly key: PackKey;
  /** Human label (Marketplace card title). */
  readonly name: string;
  /** One-sentence pitch shown on every discovery surface (admin + MCP + REST). */
  readonly description: string;
  /** The reading template the pack's collections are co-designed for. */
  readonly template: TemplateKey;
  /** The collection definition(s) an install creates, in order. An ARRAY from
   *  day one — a docs-style pack may bundle several related collections. */
  readonly collections: readonly CollectionDefinition[];
}

/** The blog scaffold: co-designed for `resolveConventionLayout` — `title`→H1,
 *  `hero` (first media)→lead image, `excerpt` (first non-title text)→standfirst,
 *  `body` (markdown)→prose, `tags`→meta. Convention resolves cleanly with zero
 *  presentation config. */
export const blogCollectionScaffold: CollectionDefinition = {
  slug: 'articles',
  name: 'Articles',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    {
      key: 'hero',
      type: 'media',
      admin: { help: 'Lead image, shown full-width at the top of the article.' },
    },
    {
      key: 'excerpt',
      type: 'text',
      admin: { help: 'A one-line standfirst shown under the title.' },
    },
    { key: 'body', type: 'markdown' },
    { key: 'tags', type: 'tags', index: true },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'article',
};

/** Changelog scaffold: version leads (the title heuristic — first text field),
 *  slug derives from it, first datetime → the release date, first select → the
 *  change-type badge (both bound bespoke by the changelog template). */
export const changelogCollectionScaffold: CollectionDefinition = {
  slug: 'changelog',
  name: 'Changelog',
  shape: 'collection',
  fields: [
    {
      key: 'version',
      type: 'text',
      required: true,
      index: true,
      admin: {
        showInList: true,
        help: 'The release name or version, e.g. 2.4.1 or "June update".',
      },
    },
    { key: 'slug', type: 'slug', config: { from: 'version' }, unique: true, index: true },
    { key: 'date', type: 'datetime', required: true, index: true },
    {
      key: 'type',
      type: 'select',
      index: true,
      config: {
        options: [
          { value: 'added', label: 'Added' },
          { value: 'changed', label: 'Changed' },
          { value: 'fixed', label: 'Fixed' },
          { value: 'security', label: 'Security' },
          { value: 'deprecated', label: 'Deprecated' },
          { value: 'removed', label: 'Removed' },
        ],
      },
    },
    { key: 'body', type: 'markdown', required: true },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'changelog',
};

/** Portfolio scaffold: cover (first media) → the full-width lead, summary
 *  (first non-title text) → the one-liner, `link` (text, pack convention) →
 *  the prominent project link-out. */
export const portfolioCollectionScaffold: CollectionDefinition = {
  slug: 'projects',
  name: 'Projects',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    {
      key: 'cover',
      type: 'media',
      admin: { help: 'Cover image, shown full-width at the top of the project page.' },
    },
    { key: 'summary', type: 'text', admin: { help: 'A one-line pitch shown under the title.' } },
    {
      key: 'link',
      type: 'text',
      admin: { help: 'The live project URL (https://…) — rendered as the link-out button.' },
    },
    { key: 'body', type: 'markdown' },
    { key: 'tags', type: 'tags', index: true },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'portfolio',
};

/** Docs scaffold: title/body plus the graph — a self-referential `related`
 *  relation (indexed, so backlinks resolve) and a section select for grouping.
 *  Prev/next ordering deliberately deferred. */
export const docsCollectionScaffold: CollectionDefinition = {
  slug: 'docs',
  name: 'Docs',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    {
      key: 'section',
      type: 'select',
      index: true,
      config: {
        options: [
          { value: 'guide', label: 'Guide' },
          { value: 'reference', label: 'Reference' },
          { value: 'concept', label: 'Concept' },
          { value: 'note', label: 'Note' },
        ],
      },
      admin: { help: 'Which part of the documentation this page belongs to.' },
    },
    { key: 'body', type: 'markdown', required: true },
    {
      key: 'related',
      type: 'relation',
      index: true,
      config: { collection: 'docs', multiple: true },
      admin: { help: 'Other doc pages this one relates to — powers Related + Referenced by.' },
    },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'docs',
};

/** Prompt-library scaffold: PRIVATE by default — the explicit `access.private`
 *  pin (D46), unlike every other pack. Prompts are working material, not
 *  published pages; the collection is hidden from discovery for anyone without
 *  read access, and its items reach readers via admin, authorized tokens, or
 *  explicit share links. The owner can switch visibility later in the builder.
 *  The `variables` tags field declares the `{{placeholder}}` names used in the
 *  body (advisory — the body scan is the truth; see lib/prompt-shape.ts). */
export const promptsCollectionScaffold: CollectionDefinition = {
  slug: 'prompts',
  name: 'Prompts',
  shape: 'collection',
  access: { private: true },
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    {
      key: 'body',
      type: 'markdown',
      required: true,
      admin: { help: 'The prompt text. Use {{variable}} placeholders for the parts that vary.' },
    },
    {
      key: 'variables',
      type: 'tags',
      admin: {
        help: 'Placeholder names used in the body, e.g. topic, audience — become MCP prompt arguments.',
      },
    },
    {
      key: 'model',
      type: 'select',
      index: true,
      config: {
        options: [
          { value: 'any', label: 'Any model' },
          { value: 'claude', label: 'Claude' },
          { value: 'gpt', label: 'GPT' },
          { value: 'gemini', label: 'Gemini' },
          { value: 'other', label: 'Other' },
        ],
      },
      admin: { help: 'Which model family this prompt is tuned for.' },
    },
    { key: 'tags', type: 'tags', index: true },
    { key: 'notes', type: 'markdown', admin: { help: 'When and how to use this prompt.' } },
    { key: 'example_output', type: 'markdown', admin: { help: 'A sample of good output.' } },
  ],
  workflow: { draftPublish: true },
  template: 'prompt',
};

/** The collab pack (D47) — remill as a multi-model context bus. Three PRIVATE,
 *  lifecycle-free collections whose required fields ARE the handover protocol:
 *  a lazy warp (no state, no open questions, no next action) is rejected at
 *  write time, not discovered by the next model. `tasks` carries the CURRENT
 *  rollup (stage + open questions — update it when you warp out) and renders
 *  the share-link status page; `warps` are immutable session snapshots (and
 *  the text-render surface, renders.ts); `decisions` is the append-only log
 *  both of them link. Record-like working data: no slugs (id-addressed), no
 *  draft ceremony, never world-readable. */
export const collabTasksCollectionScaffold: CollectionDefinition = {
  slug: 'tasks',
  name: 'Tasks',
  shape: 'collection',
  access: { private: true },
  workflow: { lifecycle: 'none' },
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    {
      key: 'goal',
      type: 'markdown',
      required: true,
      admin: { help: 'What done looks like — the job statement every agent reads first.' },
    },
    { key: 'repo', type: 'text', admin: { help: 'Repository the work lives in.' } },
    { key: 'branch', type: 'text', admin: { help: 'Working branch, if one exists yet.' } },
    {
      key: 'stage',
      type: 'select',
      index: true,
      config: {
        options: [
          { value: 'exploring', label: 'Exploring' },
          { value: 'building', label: 'Building' },
          { value: 'in-review', label: 'In review' },
          { value: 'changes-requested', label: 'Changes requested' },
          { value: 'done', label: 'Done' },
        ],
      },
      admin: { showInList: true, help: 'Where the work stands right now.' },
    },
    {
      key: 'open_questions',
      type: 'markdown',
      label: 'Needs a human',
      admin: {
        help: 'Current unresolved questions needing a human — update when you warp out.',
      },
    },
  ],
  template: 'status',
};

export const collabDecisionsCollectionScaffold: CollectionDefinition = {
  slug: 'decisions',
  name: 'Decisions',
  shape: 'collection',
  access: { private: true },
  workflow: { lifecycle: 'none' },
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'body', type: 'markdown', admin: { help: 'The decision and its why.' } },
    {
      key: 'task',
      type: 'relation',
      index: true,
      config: { collection: 'tasks' },
      admin: { help: 'The task this decision belongs to.' },
    },
    {
      key: 'verdict',
      type: 'select',
      index: true,
      config: {
        options: [
          { value: 'note', label: 'Note' },
          { value: 'recommended', label: 'Recommended' },
          { value: 'blocking', label: 'Blocking' },
        ],
      },
      admin: { showInList: true, help: 'Blocking verdicts must be resolved before ship.' },
    },
  ],
  template: 'docs',
};

export const collabWarpsCollectionScaffold: CollectionDefinition = {
  slug: 'warps',
  name: 'Warps',
  shape: 'collection',
  access: { private: true },
  workflow: { lifecycle: 'none' },
  fields: [
    {
      key: 'title',
      type: 'text',
      required: true,
      index: true,
      admin: { showInList: true, help: 'Name the session, e.g. "Session 3 — auth wiring".' },
    },
    {
      key: 'task',
      type: 'relation',
      required: true,
      index: true,
      config: { collection: 'tasks' },
      admin: { help: 'The task this handover belongs to.' },
    },
    {
      key: 'written_as',
      type: 'select',
      config: {
        options: [
          { value: 'implementer', label: 'Implementer' },
          { value: 'reviewer', label: 'Reviewer' },
          { value: 'planner', label: 'Planner' },
        ],
      },
      admin: { help: 'The mode this session worked in.' },
    },
    {
      key: 'state',
      type: 'markdown',
      required: true,
      admin: { help: 'Where the work stands — what a fresh session must know.' },
    },
    {
      key: 'decisions',
      type: 'relation',
      index: true,
      config: { collection: 'decisions', multiple: true },
      admin: { help: 'Decisions made or relied on this session.' },
    },
    {
      key: 'open_questions',
      type: 'markdown',
      required: true,
      admin: { help: 'Unresolved questions, one bullet each — required: a warp without open questions is a warp the next model cannot trust.' },
    },
    {
      key: 'next_action',
      type: 'text',
      required: true,
      admin: { help: 'The single next concrete step.' },
    },
    {
      key: 'code',
      type: 'json',
      admin: { help: 'Code pointers — branch, head SHA, diffstat. Pointers, never patches.' },
    },
  ],
  template: 'warp',
};

export const PACKS: Record<PackKey, Pack> = {
  blog: {
    key: 'blog',
    name: 'Blog',
    description:
      'Public articles with a designed reading page: hero image, standfirst, markdown body, ' +
      'tags, share bar, and RSS out of the box.',
    template: 'article',
    collections: [blogCollectionScaffold],
  },
  changelog: {
    key: 'changelog',
    name: 'Changelog',
    description:
      'Public release notes: version, release date, a change-type badge (added/changed/fixed/…), ' +
      'and a markdown body — compact dated entries, no blog furniture.',
    template: 'changelog',
    collections: [changelogCollectionScaffold],
  },
  portfolio: {
    key: 'portfolio',
    name: 'Portfolio',
    description:
      'Project showcase: a full-width cover image, one-line summary, a prominent link to the ' +
      'live project, markdown body, and tags.',
    template: 'portfolio',
    collections: [portfolioCollectionScaffold],
  },
  docs: {
    key: 'docs',
    name: 'Docs',
    description:
      'Documentation pages with the knowledge graph built in: sections, markdown body, and ' +
      'self-referential related links that power backlinks both ways.',
    template: 'docs',
    collections: [docsCollectionScaffold],
  },
  prompts: {
    key: 'prompts',
    name: 'Prompt library',
    description:
      'A private-by-default prompt library: versioned prompt text with {{variable}} ' +
      'placeholders, model hints, usage notes, and example output. Publish to your team, ' +
      'not the web — share via tokens or share links.',
    template: 'prompt',
    collections: [promptsCollectionScaffold],
  },
  collab: {
    key: 'collab',
    name: 'Collab',
    description:
      'A multi-model context bus: tasks with a live status page, session-handover warps with ' +
      'role-tailored text renders, and a decision log — private, built for agent-to-agent ' +
      'handoffs over MCP.',
    template: 'warp',
    collections: [
      collabTasksCollectionScaffold,
      collabDecisionsCollectionScaffold,
      collabWarpsCollectionScaffold,
    ],
  },
};

export function resolvePack(key: string): Pack | undefined {
  return isPackKey(key) ? PACKS[key] : undefined;
}
