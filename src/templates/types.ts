/**
 * The render-template contract (D-render). Templates are CODE (this registry);
 * a collection selects one by name via its `template` key (data) — the same
 * "types are code, instances pick them by name" grain the field registry uses.
 * A template is a pure presentational component: it receives an already-loaded
 * document (with relation + media expansion), its backlinks, and a small derived
 * render context, and returns the reading composition. It does NO I/O — the route
 * loads everything and wraps the output in PublicShell.
 */

import type { FC } from 'hono/jsx';
import type { CollectionDefinition } from '@/fields/types';
import type { ExpandedDocument, Backlink } from '@/services/documents';
import type { SiteSettings } from '@/services/settings';

/** Per-render derived context handed to a template (computed once in the route). */
export interface TemplateContext {
  readonly settings: SiteSettings;
  readonly baseUrl: string;
  /** Whole-minute reading estimate for the body (0 ⇒ hide the affordance). */
  readonly readingMinutes: number;
  /** Absolute canonical URL for reader-share; omitted on private share-link
   *  pages, where advertising a public share would be wrong. */
  readonly shareUrl?: string;
}

export interface RenderTemplate {
  /** Registry discriminator, unique — see keys.ts (TEMPLATE_KEYS). */
  readonly key: string;
  /** Human label (for a future admin template picker). */
  readonly name: string;
  /** Capability flags: which derived context/affordances this template actually
   *  renders. The ROUTE keys work off these — the reading-time computation and
   *  the reader-share island load are per-template capabilities, not implied by
   *  "a template resolved" (a changelog wants neither). Absent flag ⇒ false. */
  readonly wants?: { readonly readingTime?: boolean; readonly shareBar?: boolean };
  readonly Component: FC<{
    def: CollectionDefinition;
    doc: ExpandedDocument;
    backlinks: Backlink[];
    ctx: TemplateContext;
  }>;
}
