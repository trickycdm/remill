# Redesign the admin Content home (`/admin/c`)

**Status: COMPLETE — 2026-07-10** (merged as PR #22, released as v1.4.0, live on remill.org)

## Context

The Content page (`src/routes/admin/c/index.tsx`) is the plainest page in the admin and predates the newer house patterns (marketplace, D42). Each collection card shows only schema-centric meta ("Collection · 6 fields") that's useless to an author, there are no document counts, no freshness signal, no quick actions, the grid is bare `<a>`s in a `<div>` (not a semantic list), and the empty state doesn't mention the Marketplace. The user asked to improve its form, function, and style (screenshot was the mobile view of remill.org).

**Direction:** author-centric cards in the "Ink & Paper" system, following the marketplace card anatomy. Replace "6 fields" with what an author cares about: "12 published · 3 drafts", "Updated 2h ago", and a per-card "New {name}" quick action. Zero client JS — pure SSR links.

Counts must respect access (default-deny, D17: compiled in-query, never post-filtered). The trash service (`src/services/trash/index.ts:62-85`) is the exact precedent: `collectionsWithAction` pre-check (no deny-audit spray) → per-collection `authorize()` for `Grant` witnesses → scopes compiled into one query. For read semantics we reuse `compileReadFilter` (`src/access/authorize.ts:173`) — the same predicate `listDocuments` uses — so card counts always agree with the list page totals (handles publicRead + item grants for free).

## Card design (mobile-first, calm)

```
┌─────────────────────────────────────┐
│ Articles                 [Singleton]│  ← serif CardTitle = the link (stretched
│ 12 published · 3 drafts             │    over the card); Badge only on singletons
│ ─────────────────────────────────── │  ← CardFooter hairline
│ Updated 2h ago        [New Articles]│  ← mono meta · secondary sm Button
└─────────────────────────────────────┘
```

- Grid: `<ul class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">`, `<li class="relative flex">` (marketplace parity).
- Stretched link: `<a href=/admin/c/:slug class="after:absolute after:inset-0 after:rounded-lg">` inside CardTitle; footer Button gets `class="relative"` to stack above the overlay. Whole card stays tappable (mobile), focus ring comes from the global `:focus-visible` rule.
- Max one Badge per card, no icons, counts as prose (house style: no stat tiles), tokens only via utilities (light/dark free via `light-dark()`).
- PageHeader gains admin-only actions: ghost sm "Marketplace" (`/admin/marketplace`) + secondary sm "New collection" (`/admin/collections/new`). Role check `user.role === 'admin'` is UI-hiding only (dashboard precedent).
- EmptyState: admin → "Browse the marketplace" (primary) + "New collection" (secondary); non-admin → "Ask an administrator…" text, no action.

## Steps

### 1. Query: `countDocumentsByCollection` — `src/db/queries/documents.ts` — DONE

Mirror `listTrash`'s shape (`src/db/queries/trash.ts:150-180`) but take pre-compiled filters (existing `accessFilter?: SQL` plumbing, see line 188):

```ts
export interface DocCountScope {
  readonly collection: string;
  /** Compiled read predicate from compileReadFilter; undefined = unrestricted. */
  readonly accessFilter?: SQL;
}
export interface DocCountRow {
  readonly collection: string;
  readonly status: 'draft' | 'published';
  readonly n: number;
  readonly latest: string | null; // MAX(updated_at), ISO text
}
export async function countDocumentsByCollection(
  db: Database, scopes: readonly DocCountScope[], _grants: readonly Grant[],
): Promise<DocCountRow[]>
```

One `SELECT collection, status, COUNT(*), MAX(updated_at) … WHERE or(scope preds) GROUP BY collection, status`; pred = `and(eq(documents.collection, s.collection), s.accessFilter)` when filtered. Uses `documents_collection_status_idx`. Returns `[]` for empty scopes.

### 2. Service: `contentOverview` — `src/services/documents/index.ts` — DONE

```ts
export interface ContentOverviewItem {
  readonly def: CollectionDefinition;
  /** Present only when the caller can read the collection (counts reflect their read filter). */
  readonly counts?: { readonly published: number; readonly draft: number };
  readonly lastUpdatedAt?: string; // MAX(updated_at) among caller-visible docs
}
export async function contentOverview(db, principal, now): Promise<ContentOverviewItem[]>
```

Flow (trash-listing pattern):
1. `defs = await listCollectionDefs(db)` (slug order — keep).
2. `readable = await collectionsWithAction(db, principal, 'read')` (import from `@/services/access`, as trash does); readable defs get counts, others get def-only items.
3. `perms = await getPrincipalPermissions(db, principal.id)` once; per readable def build `resolved: ResolvedAccess = { permissions: perms, publicRead: def.access?.publicRead === true }`, then `authorize(db, principal, 'read', { collection: def.slug }, now, resolved)` → Grant, and `compileReadFilter(db, principal, def.slug, now, resolved)` → scope filter.
4. One `countDocumentsByCollection` call; fold rows into `{published, draft}` (missing status rows → 0) + `lastUpdatedAt = max(latest)`.

### 3. Helper: `src/lib/relative-time.ts` (new) + test — DONE

No relative-time helper exists (`format-date.ts` is absolute-only). Pure, deterministic (`formatDate` precedent — takes `now` explicitly, no clock):

```ts
/** "just now", "5m ago", "3h ago", "6d ago"; >30d → date portion (ts.slice(0,10));
 *  future/skew clamps to "just now"; invalid input → ''. */
export function relativeTime(ts: string, nowIso: string): string
```

### 4. Route rewrite: `src/routes/admin/c/index.tsx` — DONE

Stays thin: `contentOverview(getDb(c.env.DB), requirePrincipal(c), nowIso())`, filter out `media`, render. Route-local pure `metaLine(it)`:
- unreadable (no counts) → fall back to `${fields.length} fields`
- singleton: 0 docs → "Not created yet"; else "Published"/"Draft" (when `hasLifecycle(def)`, from `@/lib/lifecycle`) or "Created"
- collection: 0 → "No documents yet"; no lifecycle → "N documents"; else "N published · M drafts" (segments only when > 0)

Footer: left = `<span class="font-mono text-xs text-ink-subtle">Updated {relativeTime(...)}</span>` (when known); right = `Button variant="secondary" size="sm" class="relative"` → "New {name}" for collections, "Create {name}" for an *empty* singleton only (a populated singleton gets no create button — `/new` would mint a second doc; there's no server-side singleton guard). Omit `CardFooter` entirely when it'd be empty (no orphan hairline). `CardHeader class="pb-5"` since there's no CardContent.

Imports to add: `requirePrincipal` (`@/lib/principal`), `nowIso` (`@/lib/now`), `contentOverview`, `hasLifecycle`, `relativeTime`, `Badge`, `CardFooter`.

### 5. Tests — DONE

- `src/services/documents/content-overview.test.ts` (new; mirror `documents.test.ts` setup — `createTestD1`, `seedRoles`, `makePrincipal`):
  - admin sees `{published: 2, draft: 1}` + correct `lastUpdatedAt`
  - **count-leak property**: a `published`-conditioned reader gets `draft: 0` and `lastUpdatedAt` never reflects a draft-only update
  - `own`-conditioned author counts own drafts, not another's
  - no-read principal → item present, `counts` undefined, no deny-audit rows
  - empty readable collection → `{published: 0, draft: 0}`
- `src/db/queries/witness.compile.test.ts`: add `@ts-expect-error` fixture — `countDocumentsByCollection` without grants must not compile.
- `src/lib/relative-time.test.ts`: unit boundaries (60s/60m/24h/30d), future clamp, invalid → `''`.
- `e2e/admin-content.spec.ts`: tighten line 19 to `getByRole('link', { name: 'Posts', exact: true })` ("New Posts" substring-matches otherwise); add one test: Posts card shows a counts/meta line and its "New Posts" action lands on `/admin/c/posts/new`. Axe sweeps of `/admin/c` already exist (this spec + `admin-smoke.spec.ts`) — no changes.

## Verification — DONE

1. `bun run type-check && bun run lint` — clean.
2. `bun run test:run` — 404/404 across 53 files (incl. the count-leak property, witness fixture, relative-time boundaries).
3. e2e `admin-content.spec.ts` + `admin-smoke.spec.ts` — 11/11, both axe WCAG 2.1 AA sweeps of `/admin/c` clean.
4. Visual: production build served locally, screenshots at 390px/1280px in both themes against the e2e seed (all card states exercised: counts, drafts split, Singleton badge, populated singleton without create, freshness lines). Post-deploy: remill.org smoke-checked (/ 200, /admin/c → login).

## Risks

- **Audit volume**: one allow-audit row per readable collection per page view — same accepted cost as the trash listing (ACCESS_CONTROL capability pre-check pattern).
- **E2E substring matching**: mitigated by `exact: true`; title anchor precedes footer in DOM order so even untouched specs stay green.
- **D1 cost**: one grouped query for all counts (no N+1); `compileReadFilter` short-circuits to zero extra queries for unconditional readers (admin/editor common case).
- **publicRead-only readers**: a principal with no explicit read perm on a publicRead collection is excluded by the `collectionsWithAction` pre-check → card shows without counts. Edge case, consistent with trash's simplification; document in JSDoc.

## Revision Log

- 2026-07-10: Planning refinement — dropped the originally sketched hand-rolled `readScopeFor` (a `deleteScopeFor` mirror) in favour of reusing `compileReadFilter` verbatim; it already handles publicRead + item grants and guarantees card counts agree with list-page totals.
- 2026-07-10: Implementation addition — `ContentOverviewItem.canCreate` (from `collectionsWithAction(…, 'create')`) so the per-card "New {name}" action only renders for principals who can actually create there; UI-hiding only, the create pipeline stays the enforcement.
