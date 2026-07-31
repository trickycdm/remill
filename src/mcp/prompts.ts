/**
 * The MCP `prompts` primitive (D44) — published items of PROMPT-SHAPED
 * collections (`def.template === 'prompt'`, the semantic marker; not a
 * hard-coded slug, so renamed installs and hand-built collections participate)
 * served as native MCP prompts. Any MCP client then shows the library in its
 * prompt picker, with typed arguments derived from the item's declared-and-
 * scanned `{{variables}}` (lib/prompt-shape.ts — the same contract the
 * `prompt` reading template renders).
 *
 * Same posture as tool generation: discovery is intersected with the
 * principal's effective permissions (`couldDo`, honoring the token scope
 * mask), and every read goes through the document SERVICES, which own
 * `authorize()` + the compiled read filter — one pipeline, three doors.
 *
 * Prompt names are `<collection>/<item-slug>` (slug charset is already
 * MCP-safe; collection slugs can never contain `/`), with a `doc_…` id
 * fallback for collections without an indexed slug field. If a hand-built
 * def has a non-unique slug field, first match wins — the scaffold's slug is
 * unique, so this only affects bespoke definitions.
 */

import type { Database } from '@/db/client';
import type { Principal } from '@/access';
import { getPrincipalPermissions } from '@/services/access';
import { listCollections } from '@/services/collections';
import { getDocument, getDocumentBySlug, listDocuments } from '@/services/documents';
import type { CollectionDefinition } from '@/fields/types';
import type { ExpandedDocument } from '@/services/documents';
import { couldDo } from '@/mcp/tools';
import {
  interpolatePrompt,
  promptBodyFieldOf,
  promptVariables,
} from '@/templates/lib/prompt-shape';
import { titleOf, excerptFrom } from '@/lib/def-helpers';
import { NotFoundError } from '@/lib/errors';

export interface McpPromptDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly arguments: { readonly name: string; readonly required: false }[];
}

export interface McpPromptResult {
  readonly description?: string;
  readonly messages: {
    readonly role: 'user';
    readonly content: { readonly type: 'text'; readonly text: string };
  }[];
}

function isPromptShaped(def: CollectionDefinition): boolean {
  return def.template === 'prompt';
}

function promptRefOf(def: CollectionDefinition, doc: ExpandedDocument): string {
  const slugField = def.fields.find((f) => f.type === 'slug' && f.index);
  const slugValue = slugField ? doc.data[slugField.key] : undefined;
  return typeof slugValue === 'string' && slugValue ? slugValue : doc.id;
}

function describe(def: CollectionDefinition, doc: ExpandedDocument): string {
  const title = titleOf(def, doc);
  const notes = typeof doc.data.notes === 'string' ? doc.data.notes : '';
  const bodyField = promptBodyFieldOf(def);
  const body = bodyField && typeof doc.data[bodyField.key] === 'string' ? (doc.data[bodyField.key] as string) : '';
  const excerpt = excerptFrom(notes || body);
  return excerpt ? `${title} — ${excerpt}` : title;
}

/** The permission-filtered prompt list (`prompts/list`). Published items only —
 *  the service list path enforces `authorize()` + the compiled read filter, so
 *  a principal without read on a prompt collection simply sees nothing. */
export async function listPromptsForPrincipal(
  db: Database,
  principal: Principal,
  now: () => string,
): Promise<McpPromptDescriptor[]> {
  const perms = await getPrincipalPermissions(db, principal.id);
  const defs = (await listCollections(db)).filter(isPromptShaped);
  const prompts: McpPromptDescriptor[] = [];
  for (const def of defs) {
    if (!couldDo(perms, principal, 'read', def.slug, def.access?.publicRead ?? false)) continue;
    const { rows } = await listDocuments(
      db,
      principal,
      def.slug,
      { status: 'published', pageSize: 100 },
      now(),
    );
    for (const doc of rows) {
      prompts.push({
        name: `${def.slug}/${promptRefOf(def, doc)}`,
        description: describe(def, doc),
        arguments: promptVariables(def, doc.data).map((name) => ({ name, required: false })),
      });
    }
  }
  return prompts;
}

/** Resolve one prompt (`prompts/get`) and interpolate the supplied arguments.
 *  Missing arguments stay verbatim (every argument is optional). Throws
 *  NotFoundError for anything that isn't a visible, published item of a
 *  prompt-shaped collection — the transport maps it to one indistinguishable
 *  -32602, no existence oracle. */
export async function getPromptForPrincipal(
  db: Database,
  principal: Principal,
  name: string,
  args: Record<string, string>,
  now: () => string,
): Promise<McpPromptResult> {
  const sep = name.indexOf('/');
  if (sep < 1 || sep === name.length - 1) throw new NotFoundError('Prompt');
  const collectionSlug = name.slice(0, sep);
  const ref = name.slice(sep + 1);

  const def = (await listCollections(db)).find((d) => d.slug === collectionSlug);
  if (!def || !isPromptShaped(def)) throw new NotFoundError('Prompt');

  const doc = ref.startsWith('doc_')
    ? await getDocument(db, principal, def.slug, ref, now())
    : await getDocumentBySlug(db, principal, def.slug, ref, now());
  if (doc.status !== 'published') throw new NotFoundError('Prompt');

  const bodyField = promptBodyFieldOf(def);
  const bodyRaw = bodyField ? doc.data[bodyField.key] : undefined;
  const body = typeof bodyRaw === 'string' ? bodyRaw : '';

  return {
    description: describe(def, doc),
    messages: [{ role: 'user', content: { type: 'text', text: interpolatePrompt(body, args) } }],
  };
}
