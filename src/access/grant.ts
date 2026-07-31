/**
 * The Grant witness (steering/ACCESS_CONTROL.md, decision D17).
 *
 * Query functions that read or mutate documents require a `Grant` parameter, and
 * a `Grant` can only be produced by `authorize()` (or the single sanctioned
 * `grantForTest()` helper). Because the constructor is private, no service can
 * fabricate one with `new Grant(...)` — so a code path that skips `authorize()`
 * fails to type-check. This is compile-time enforcement, not convention: the
 * point is to make "forgot to authorize" a build error, catching honest mistakes.
 */

import type { Action, Resource } from '@/access/types';

declare const WITNESS: unique symbol;

export class Grant {
  // Nominal brand: makes Grant un-forgeable structurally (a plain object with the
  // same fields is NOT a Grant). `declare` = type-only, so it isn't emitted or
  // flagged as unused.
  declare private readonly [WITNESS]: true;

  private constructor(
    readonly principalId: string,
    readonly action: Action,
    readonly resource: Resource,
  ) {}

  /**
   * Mint a Grant. INTERNAL to the access module — do not call from services.
   * `authorize()` calls this after a positive decision; `grantForTest()` calls it
   * for tests. Exported only so those two callers (same module) can reach it; it
   * is intentionally NOT re-exported from `src/access/index.ts`.
   * @internal
   */
  static __mint(principalId: string, action: Action, resource: Resource): Grant {
    return new Grant(principalId, action, resource);
  }
}
