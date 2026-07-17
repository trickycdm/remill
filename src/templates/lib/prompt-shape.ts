/**
 * Prompt-shape helpers — the shared contract for "what makes a collection a
 * prompt" (the `prompt` template, the MCP prompts primitive, and their tests
 * all consume THESE, never their own heuristics). Pure, type-only dependency
 * on the field contract — the `conventions.ts` grain.
 *
 * A prompt item's body is plain text with `{{variable}}` placeholders. The
 * declared `variables` tags field is advisory; the body scan is the truth —
 * `promptVariables` returns the union so a forgotten declaration still
 * surfaces as an argument.
 */

import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';

/** `{{ name }}` — names are word-ish (letters/digits/underscore, then ._- too). */
export const PROMPT_VAR_RE = /\{\{\s*([A-Za-z0-9_][\w.-]*)\s*\}\}/g;

/** The prompt text field: first markdown field (the changelog "first datetime"
 *  by-type grain). */
export function promptBodyFieldOf(def: CollectionDefinition): FieldDescriptor | undefined {
  return def.fields.find((f) => f.type === 'markdown');
}

/** The declared-variables field: the tags field keyed `variables`, if present. */
export function promptVariablesFieldOf(def: CollectionDefinition): FieldDescriptor | undefined {
  return def.fields.find((f) => f.type === 'tags' && f.key === 'variables');
}

/** One token of a tokenized prompt body. `var` tokens carry the placeholder
 *  name in `value` and the exact source text (braces, spacing) in `raw`. */
export interface PromptToken {
  readonly kind: 'text' | 'var';
  readonly value: string;
  readonly raw?: string;
}

/** Tokenize a prompt body for safe rendering: alternating text/var tokens.
 *  Consumers render text tokens as plain (auto-escaped) JSX children and var
 *  tokens as highlighted elements — no HTML ever assembled from strings. */
export function splitPromptTokens(text: string): PromptToken[] {
  const tokens: PromptToken[] = [];
  let last = 0;
  for (const m of text.matchAll(PROMPT_VAR_RE)) {
    const at = m.index ?? 0;
    if (at > last) tokens.push({ kind: 'text', value: text.slice(last, at) });
    tokens.push({ kind: 'var', value: m[1], raw: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) });
  return tokens;
}

/** Variable names for a prompt item: declared (tags value) ∪ scanned from the
 *  body — deduped, declared order first. */
export function promptVariables(
  def: CollectionDefinition,
  data: Record<string, unknown>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  const declaredField = promptVariablesFieldOf(def);
  const declared = declaredField ? data[declaredField.key] : undefined;
  if (Array.isArray(declared)) {
    for (const v of declared) if (typeof v === 'string' && v.trim()) add(v.trim());
  }
  const bodyField = promptBodyFieldOf(def);
  const body = bodyField ? data[bodyField.key] : undefined;
  if (typeof body === 'string') {
    for (const t of splitPromptTokens(body)) if (t.kind === 'var') add(t.value);
  }
  return out;
}

/** Interpolate `{{name}}` placeholders with the supplied argument values.
 *  Token-based join — NEVER `String.replace`, whose `$&`-style patterns in a
 *  user-supplied value would corrupt the output. Missing arguments stay
 *  verbatim (all prompt arguments are optional). */
export function interpolatePrompt(text: string, args: Record<string, string>): string {
  return splitPromptTokens(text)
    .map((t) => {
      if (t.kind === 'text') return t.value;
      return Object.prototype.hasOwnProperty.call(args, t.value)
        ? args[t.value]
        : (t.raw ?? t.value);
    })
    .join('');
}
