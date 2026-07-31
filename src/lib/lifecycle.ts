/**
 * Lifecycle helper (B4). `workflow.lifecycle: 'none'` opts a collection OUT of
 * the draft/publish lifecycle's AFFORDANCES: docs are born `published`, and the
 * status column/filter/publish controls and tools are suppressed on every
 * surface. It is a VISIBILITY opt-out, not a status removal — `documents.status`
 * stays load-bearing in the access layer (the `published` condition, publicRead
 * sugar), which is exactly why a lifecycle-none doc must be born published.
 */

import type { CollectionDefinition } from '@/fields/types';

/** Whether a collection participates in the draft/publish lifecycle. */
export function hasLifecycle(def: CollectionDefinition): boolean {
  return def.workflow?.lifecycle !== 'none';
}
