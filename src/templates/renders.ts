/**
 * Text renders (D47) — role-tailored, token-budgeted MARKDOWN views of a
 * document, produced server-side by pure functions (no LLM anywhere). The same
 * "types are code, instances pick them by name" grain as the reading templates:
 * renders are declared per TEMPLATE key (the semantic marker convention the
 * MCP prompts primitive established), so any collection selecting `warp` gets
 * `reviewer`/`implementer` renders — over MCP (`get_<slug>` `render` arg) and
 * REST (`?render=`) — with zero per-collection wiring.
 *
 * Tailoring is by ROLE and BUDGET only — never by model vendor: capability
 * facts belong in a budget number; prose-style personas would rot with every
 * model release. Field access is positional (first select → role, first
 * relation → task, markdown fields in definition order), mirroring the warp
 * template's claims, so hand-built handover collections participate.
 *
 * Import-light on purpose (the keys.ts posture): type-only imports of the
 * document shapes, value imports only from lib/def-helpers, lib/errors, and
 * config — so the documents SERVICE can call `renderDocument` without dragging
 * JSX or the component registry into its graph.
 */

import type { CollectionDefinition, ExpandedReference } from '@/fields/types';
import type { ExpandedDocument, Backlink } from '@/services/documents';
import type { TemplateKey } from '@/templates/keys';
import { excerptFrom, titleOf } from '@/lib/def-helpers';
import { InputValidationError } from '@/lib/errors';
import { APPROX_CHARS_PER_TOKEN } from '@/config/constants';

export interface TextRenderInput {
  readonly def: CollectionDefinition;
  readonly doc: ExpandedDocument;
  readonly backlinks: readonly Backlink[];
  readonly baseUrl?: string;
}

/** A render's output, section by section: `priority` (lower = survives a small
 *  budget longer) is the render's statement of what its consumer cannot do the
 *  job without; assembly order stays the declared display order. */
interface Section {
  readonly priority: number;
  readonly text: string;
}

export interface TextRender {
  /** One-line pitch, surfaced in the `get_<slug>` tool description. */
  readonly description: string;
  /** When true the service fetches backlinks before rendering (none of the
   *  warp renders need them; the flag exists so future renders can ask). */
  readonly needsBacklinks?: boolean;
  readonly sections: (input: TextRenderInput) => Section[];
}

/* ── Positional field access (the warp template's claims, shared) ─────────── */

const strOf = (doc: ExpandedDocument, key: string | undefined): string | undefined => {
  const raw = key ? doc.data[key] : undefined;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
};

/** Markdown fields in definition order: [0] = the state/body prose, [1…] =
 *  callout material (open questions). */
const markdownFields = (def: CollectionDefinition) =>
  def.fields.filter((f) => f.type === 'markdown');

/** Expanded titles of every relation field AFTER the first (the first relation
 *  is the owning-task claim) — for a warp, the linked decisions. */
function linkedDecisionLines(def: CollectionDefinition, doc: ExpandedDocument): string[] {
  const relationFields = def.fields.filter((f) => f.type === 'relation').slice(1);
  const lines: string[] = [];
  for (const f of relationFields) {
    const expanded = doc.relations?.[f.key];
    const refs: ExpandedReference[] = Array.isArray(expanded) ? expanded : expanded ? [expanded] : [];
    for (const ref of refs) lines.push(`- ${ref.title ?? ref.id} (${ref.id})`);
  }
  return lines;
}

/** The owning task as "<title> (<id>)", from the FIRST relation field. */
function owningTaskLine(def: CollectionDefinition, doc: ExpandedDocument): string | undefined {
  const taskField = def.fields.find((f) => f.type === 'relation');
  const expanded = taskField ? doc.relations?.[taskField.key] : undefined;
  const ref = Array.isArray(expanded) ? expanded[0] : expanded;
  return ref ? `${ref.title ?? ref.id} (${ref.id})` : undefined;
}

/** The code-pointers json field, compactly printed. */
function codePointers(def: CollectionDefinition, doc: ExpandedDocument): string | undefined {
  const jsonField = def.fields.find((f) => f.type === 'json');
  const value = jsonField ? doc.data[jsonField.key] : undefined;
  if (value == null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length) return entries.map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  }
  return JSON.stringify(value);
}

function headerSection(def: CollectionDefinition, doc: ExpandedDocument, frame: string): Section {
  return { priority: 0, text: `# ${titleOf(def, doc)}\n\n${frame}` };
}

function labelled(priority: number, heading: string, body: string | undefined): Section | undefined {
  return body ? { priority, text: `## ${heading}\n\n${body}` } : undefined;
}

const present = (sections: (Section | undefined)[]): Section[] =>
  sections.filter((s): s is Section => s !== undefined);

/* ── The warp renders ─────────────────────────────────────────────────────── */

/** Reviewer: decisions to hold the author to come first; the session narrative
 *  is deliberately COMPRESSED to a paragraph — a reviewer audits the claims,
 *  not the play-by-play. */
const warpReviewer: TextRender = {
  description: 'Review brief: decisions first, then open questions and code pointers; state compressed.',
  sections: ({ def, doc }) => {
    const md = markdownFields(def);
    const state = strOf(doc, md[0]?.key);
    const openQuestions = strOf(doc, md[1]?.key);
    const task = owningTaskLine(def, doc);
    const decisions = linkedDecisionLines(def, doc);
    const frame =
      `Your job: review, don't build. Post findings as decisions with a verdict.` +
      (task ? `\n\nTask: ${task}` : '');
    return present([
      headerSection(def, doc, frame),
      labelled(1, 'Decisions to hold me to', decisions.length ? decisions.join('\n') : undefined),
      labelled(2, 'Open questions', openQuestions),
      labelled(3, 'Code', codePointers(def, doc)),
      labelled(4, 'State (compressed)', state ? excerptFrom(state, 600) : undefined),
    ]);
  },
};

/** Implementer: the single next action leads — "what do I do first" outranks
 *  everything a fresh session reads. */
const warpImplementer: TextRender = {
  description: 'Pickup brief: the next action first, then open questions, full state, and code pointers.',
  sections: ({ def, doc }) => {
    const md = markdownFields(def);
    const titleKey = def.fields.find((f) => f.type === 'text')?.key;
    const nextAction = strOf(
      doc,
      def.fields.find((f) => f.type === 'text' && f.key !== titleKey)?.key,
    );
    const state = strOf(doc, md[0]?.key);
    const openQuestions = strOf(doc, md[1]?.key);
    const task = owningTaskLine(def, doc);
    const frame = `Pick the work up where the last session left it.` + (task ? `\n\nTask: ${task}` : '');
    return present([
      headerSection(def, doc, frame),
      labelled(1, 'Next action', nextAction),
      labelled(2, 'Open questions', openQuestions),
      labelled(3, 'State', state),
      labelled(4, 'Code', codePointers(def, doc)),
    ]);
  },
};

const TEXT_RENDERS: Partial<Record<TemplateKey, Readonly<Record<string, TextRender>>>> = {
  warp: { reviewer: warpReviewer, implementer: warpImplementer },
};

/* ── Public surface ───────────────────────────────────────────────────────── */

/** Render names a template declares (empty for templates without renders) —
 *  drives the `get_<slug>` inputSchema enum and the OpenAPI param. */
export function rendersFor(templateKey: string | undefined): readonly string[] {
  if (!templateKey) return [];
  const renders = TEXT_RENDERS[templateKey as TemplateKey];
  return renders ? Object.keys(renders) : [];
}

/** Look up one render (undefined when the template has none by that name). */
export function textRenderOf(
  templateKey: string | undefined,
  render: string,
): TextRender | undefined {
  return templateKey ? TEXT_RENDERS[templateKey as TemplateKey]?.[render] : undefined;
}

/** Newline-preserving word-safe clip (excerptFrom collapses whitespace — right
 *  for deliberate compression, wrong for budget cuts of structured markdown). */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max - 1));
  const lastBreak = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return `${cut.slice(0, lastBreak > max / 2 ? lastBreak : cut.length).trimEnd()}…`;
}

/** Fit sections to a token budget: allocate by priority (lowest number first),
 *  clip the last section that partially fits, drop the rest — then assemble in
 *  DISPLAY order, so a tight budget shortens the brief without reordering it.
 *  Exported for tests. */
export function applyBudget(sections: readonly Section[], budgetTokens?: number): string {
  if (!budgetTokens) return sections.map((s) => s.text).join('\n\n');
  let remaining = budgetTokens * APPROX_CHARS_PER_TOKEN;
  const kept = new Map<Section, string>();
  for (const section of [...sections].sort((a, b) => a.priority - b.priority)) {
    if (remaining <= 0) break;
    const text = section.text.length <= remaining ? section.text : clip(section.text, remaining);
    kept.set(section, text);
    remaining -= text.length;
  }
  return sections
    .filter((s) => kept.has(s))
    .map((s) => kept.get(s) as string)
    .join('\n\n');
}

/** Produce a named render of a document as markdown. Throws the standard 422
 *  when the render name isn't one the collection's template declares — the
 *  details list what IS available, so a mistyped agent call self-corrects. */
export function renderDocument(
  def: CollectionDefinition,
  doc: ExpandedDocument,
  backlinks: readonly Backlink[],
  opts: { readonly render: string; readonly budget?: number; readonly baseUrl?: string },
): string {
  const render = textRenderOf(def.template, opts.render);
  if (!render) {
    const available = rendersFor(def.template);
    throw new InputValidationError([
      {
        path: 'render',
        message: available.length
          ? `Unknown render '${opts.render}' — available: ${available.join(', ')}`
          : `Collection '${def.slug}' has no text renders`,
      },
    ]);
  }
  return applyBudget(render.sections({ def, doc, backlinks, baseUrl: opts.baseUrl }), opts.budget);
}
