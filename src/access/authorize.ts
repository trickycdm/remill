/**
 * The single authorization decision point (steering/ACCESS_CONTROL.md, D17).
 * Admin, REST, and MCP all pass through `authorize()` — one pipeline, three doors.
 *
 * Phase 3: the full model. `authorize()` resolves the principal's permissions
 * (principal_roles × role_permissions, scope-folded), the applicable per-document
 * item grants, and the collection's publicRead flag, then calls the pure
 * `decide()`. Every allow and every deny writes an audit row. Returns a Grant
 * witness on allow; throws a structured ForbiddenError on deny.
 */

import { sql, inArray, type SQL } from 'drizzle-orm';
import { documents } from '@/db/schema';
import type { Database } from '@/db/client';
import { Grant } from '@/access/grant';
import type { Action, Principal, Resource, Surface } from '@/access/types';
import { resourceKey } from '@/access/types';
import { decide, scopeMatches } from '@/access/permissions';
import { appendAudit } from '@/db/queries/audit';
import { getPrincipalPermissions, getPrincipalRoleSlugs, type EffectivePermission } from '@/db/queries/roles';
import { getApplicableGrants, getGrantedDocumentIds } from '@/db/queries/grants';
import { getPrincipalTeamIds } from '@/db/queries/teams';
import { getCollection } from '@/db/queries/collections';
import { getDocumentMetaForAuth } from '@/db/queries/documents';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import type { SessionUser } from '@/lib/auth-constants';

export { Grant } from '@/access/grant';
export type { Action, Principal, Resource, Condition, Surface } from '@/access/types';
export { ACTIONS, resourceKey } from '@/access/types';

/** Build a Principal from an authenticated admin session (surface = 'admin', no
 *  token scope). Its permissions are resolved from principal_roles by authorize. */
export function principalFromSession(user: SessionUser): Principal {
  return { id: user.id, kind: 'user', surface: 'admin' };
}

/** The unauthenticated principal for a given `surface`. It carries no token and no
 *  scope; its permissions still resolve from principal_roles (anonymous holds none
 *  by default), so it is default-denied everywhere except explicit publicRead. One
 *  factory (TD-5) so the REST, media, and MCP doors can't drift on its shape — the
 *  caller passes the surface it arrived on so audit attribution stays correct. */
export function anonymousPrincipal(surface: Surface): Principal {
  return { id: 'anonymous', kind: 'user', surface };
}

/** The platform acting from cron (D30) — e.g. the scheduled-publish drain. No
 *  principals row, no permissions: `authorize()` allows it BY KIND but still
 *  writes the audit row (surface 'system'), so every scheduled action stays
 *  attributed and visible in /admin/activity. Never construct one in a request
 *  handler — requests always have a real (or anonymous) principal. */
export function systemPrincipal(): Principal {
  return { id: 'system', kind: 'system', surface: 'system' };
}

async function collectionPublicRead(db: Database, slug: string): Promise<boolean> {
  const def = await getCollection(db, slug);
  return def?.access?.publicRead === true;
}

/** The per-request access inputs shared by `authorize` and `compileReadFilter`:
 *  the principal's effective permissions and the collection's publicRead flag. */
export interface ResolvedAccess {
  readonly permissions: readonly EffectivePermission[];
  readonly publicRead: boolean;
}

/**
 * Resolve `{permissions, publicRead}` for a principal + collection ONCE, so a read
 * path (listDocuments) that calls both `authorize` and `compileReadFilter` doesn't
 * resolve them twice (TD-3). Pass the result into both.
 */
export async function resolveAccess(
  db: Database,
  principalId: string,
  collection: string,
): Promise<ResolvedAccess> {
  const [permissions, publicRead] = await Promise.all([
    getPrincipalPermissions(db, principalId),
    collectionPublicRead(db, collection),
  ]);
  return { permissions, publicRead };
}

/** Resolve `resource` for a decision — the document lookup shared by
 *  `authorize()` (which also audits) and `canAuthorize()` (which doesn't).
 *  `ok: false` means a DIFFERENT collection actually owns this document id —
 *  the cross-collection check (a principal must not act on a document by
 *  claiming a collection it doesn't live in); the caller
 *  turns that into a 404. See `authorize()` below for the full reasoning on
 *  what's filled and when. */
async function resolveResourceForDecision(
  db: Database,
  action: Action,
  resource: Resource,
): Promise<{ ok: true; resolved: Resource } | { ok: false }> {
  if (!resource.documentId) return { ok: true, resolved: resource };
  const meta = await getDocumentMetaForAuth(db, resource.documentId);
  if (meta && meta.collection !== resource.collection) return { ok: false };
  if (!meta) return { ok: true, resolved: resource };
  return {
    ok: true,
    resolved: {
      ...resource,
      status: resource.status ?? meta.status,
      createdBy: resource.createdBy ?? meta.createdBy ?? undefined,
      visibility: action === 'read' ? (resource.visibility ?? meta.visibility) : resource.visibility,
    },
  };
}

/** The applicable item grants for a resolved item resource — shared by
 *  `authorize()` and `canAuthorize()`. Empty for a collection-level resource. */
async function grantsForDecision(
  db: Database,
  principal: Principal,
  resolved: Resource,
  now: string,
): Promise<Awaited<ReturnType<typeof getApplicableGrants>>> {
  if (!resolved.documentId) return [];
  // Roles and teams are both subject-resolution inputs (D24) — resolve together.
  const [roleSlugs, teamIds] = await Promise.all([
    getPrincipalRoleSlugs(db, principal.id),
    getPrincipalTeamIds(db, principal.id),
  ]);
  return getApplicableGrants(db, resolved.documentId, principal.id, roleSlugs, now, principal.linkId, teamIds);
}

/**
 * Authorize `principal` to perform `action` on `resource`. Writes an audit row
 * either way. Returns a Grant witness on allow; throws ForbiddenError on deny.
 * Pass `preResolved` to reuse already-resolved permissions/publicRead (TD-3); it
 * must be for `resource.collection`.
 */
export async function authorize(
  db: Database,
  principal: Principal,
  action: Action,
  resource: Resource,
  now: string,
  preResolved?: ResolvedAccess,
): Promise<Grant> {
  // The system actor (D30) is the platform itself, acting from cron — there are
  // no permission rows to resolve and no conditions to evaluate. It is allowed
  // by kind, but the audit row is NOT skipped: "authorize() is the only audit
  // writer" survives, and every scheduled action stays attributed.
  if (principal.kind === 'system') {
    await appendAudit(db, {
      principalId: principal.id,
      tokenId: undefined,
      surface: principal.surface,
      action,
      resource: resourceKey(resource),
      collection: resource.collection,
      allowed: true,
      now,
    });
    return Grant.__mint(principal.id, action, resource);
  }

  const permissions = preResolved?.permissions ?? (await getPrincipalPermissions(db, principal.id));
  const publicRead = preResolved?.publicRead ?? (await collectionPublicRead(db, resource.collection));

  // For an item-level decision, ALWAYS look the document up once — never trust
  // the caller's `resource.collection` on its own: a principal holding
  // `share_link` (or any item action) on collection A must not be able to reach a
  // document that actually lives in collection B by naming A in the URL and B's
  // document id (the cross-collection exploit this check closes). A document
  // found under a DIFFERENT collection is a 404, not a 403 — it writes a deny
  // audit row first, so "every allow and every deny is recorded" still holds.
  //
  // A `documentId` with no matching `documents` row is NOT treated as a
  // mismatch: media (D-media, its own table, not the documents pipeline) and
  // any other id space authorize() is asked about that isn't in `documents`
  // legitimately look up empty here — only content in the documents pipeline
  // can be impersonated cross-collection, so only a found-but-wrong-collection
  // row is fatal. The normal `decide()` deny path (or the resource's
  // caller-supplied fields) still applies when nothing is found.
  //
  // `status`/`createdBy` are filled whenever the caller didn't supply them
  // (needed for `own`/`published`/publicRead conditions on any action).
  // `visibility` is only filled for `read` — no other action's decision depends
  // on it, so non-read callers don't pay for a field they don't use.
  const step = await resolveResourceForDecision(db, action, resource);
  if (!step.ok) {
    await appendAudit(db, {
      principalId: principal.id,
      tokenId: principal.tokenId,
      surface: principal.surface,
      action,
      resource: resourceKey(resource),
      collection: resource.collection,
      allowed: false,
      now,
    });
    throw new NotFoundError('Document');
  }
  const resolved = step.resolved;

  const grants = await grantsForDecision(db, principal, resolved, now);

  const allowed = decide({ principal, action, resource: resolved, permissions, grants, publicRead, tokenScope: principal.tokenScope });

  await appendAudit(db, {
    principalId: principal.id,
    tokenId: principal.tokenId,
    surface: principal.surface,
    action,
    resource: resourceKey(resolved),
    collection: resolved.collection,
    allowed,
    now,
  });

  if (!allowed) {
    throw new ForbiddenError(`Not permitted to ${action} in '${resolved.collection}'`, {
      action,
      collection: resolved.collection,
    });
  }
  return Grant.__mint(principal.id, action, resolved);
}

/**
 * Non-throwing, NON-AUDITING probe: would `authorize()` allow this? For
 * UI-visibility decisions only (e.g. "show the Share links section") — never
 * as a substitute for the real gate on an actual read/write, which must still
 * call `authorize()` and hold its Grant witness. Deliberately skips
 * `appendAudit` entirely (not "catch and swallow a deny row") so idly
 * rendering a page doesn't spam the audit log with checks nobody attempted
 * — evaluates the same `resolveResourceForDecision` +
 * `decide()` pipeline authorize() does, just without the audit write or the
 * throw.
 */
export async function canAuthorize(
  db: Database,
  principal: Principal,
  action: Action,
  resource: Resource,
  now: string,
  preResolved?: ResolvedAccess,
): Promise<boolean> {
  if (principal.kind === 'system') return true;

  const permissions = preResolved?.permissions ?? (await getPrincipalPermissions(db, principal.id));
  const publicRead = preResolved?.publicRead ?? (await collectionPublicRead(db, resource.collection));

  const step = await resolveResourceForDecision(db, action, resource);
  if (!step.ok) return false;
  const resolved = step.resolved;

  const grants = await grantsForDecision(db, principal, resolved, now);
  return decide({ principal, action, resource: resolved, permissions, grants, publicRead, tokenScope: principal.tokenScope });
}

/**
 * Compile the principal's READ permissions for a collection into a SQL predicate
 * applied INSIDE the list query — never post-filter in memory (D17). Returns
 * undefined for an unrestricted reader (no predicate), or `1=0` when nothing is
 * readable. OR-combines: published (role condition, all visibilities), publicRead
 * (published AND public only — D50), own, and item-granted ids.
 */
export async function compileReadFilter(
  db: Database,
  principal: Principal,
  collection: string,
  now: string,
  resolved?: ResolvedAccess,
): Promise<SQL | undefined> {
  const permissions = resolved?.permissions ?? (await getPrincipalPermissions(db, principal.id));
  const scope = principal.tokenScope;
  const scopeAllowsRead = !scope || scopeMatches(scope, 'read', collection);
  if (!scopeAllowsRead) return sql`1 = 0`; // token can't read this collection at all

  const readPerms = permissions.filter(
    (p) => p.action === 'read' && (p.collection === '*' || p.collection === collection),
  );

  // Any unconditional read → no restriction.
  if (readPerms.some((p) => p.condition === null)) return undefined;

  const clauses: SQL[] = [];
  const publicRead = resolved?.publicRead ?? (await collectionPublicRead(db, collection));
  const hasPublishedCondition = readPerms.some((p) => p.condition === 'published');
  if (hasPublishedCondition && principal.id === 'anonymous') {
    // Anonymous never bypasses visibility via a role's `published` condition
    // either (D50) — same restricted clause as the publicRead-only
    // branch below.
    clauses.push(sql`${documents.status} = 'published' AND ${documents.visibility} = 'public'`);
  } else if (hasPublishedCondition) {
    // A role's `published` condition sees every visibility — unlisted/private
    // only hide documents from the PUBLIC, not from readers a role already grants.
    clauses.push(sql`${documents.status} = 'published'`);
  } else if (publicRead) {
    // publicRead sugar ALONE (no role condition backing it): published AND
    // public only (D50) — unlisted/private documents drop out of every
    // anonymous list (homepage, index, RSS, sitemap, REST list, search, backlinks).
    clauses.push(sql`${documents.status} = 'published' AND ${documents.visibility} = 'public'`);
  }
  if (readPerms.some((p) => p.condition === 'own')) {
    clauses.push(sql`${documents.createdBy} = ${principal.id}`);
  }

  const [roleSlugs, teamIds] = await Promise.all([
    getPrincipalRoleSlugs(db, principal.id),
    getPrincipalTeamIds(db, principal.id),
  ]);
  const granted = await getGrantedDocumentIds(db, principal.id, roleSlugs, now, principal.linkId, teamIds);
  const readableIds = granted.filter((g) => g.actions.includes('read')).map((g) => g.documentId);
  if (readableIds.length) clauses.push(inArray(documents.id, readableIds));

  if (clauses.length === 0) return sql`1 = 0`; // nothing readable
  return clauses.length === 1 ? clauses[0] : sql`(${sql.join(clauses, sql` OR `)})`;
}
