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
import { getCollection } from '@/db/queries/collections';
import { getDocumentMetaForAuth } from '@/db/queries/documents';
import { ForbiddenError } from '@/lib/errors';
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
  const permissions = preResolved?.permissions ?? (await getPrincipalPermissions(db, principal.id));
  const publicRead = preResolved?.publicRead ?? (await collectionPublicRead(db, resource.collection));

  // For an item-level decision, resolve the document's status/owner if the caller
  // didn't supply them — otherwise the `own`/`published` conditions can't be
  // evaluated (e.g. a plain read of a document by id).
  let resolved = resource;
  if (resource.documentId && (resource.status === undefined || resource.createdBy === undefined)) {
    const meta = await getDocumentMetaForAuth(db, resource.documentId);
    if (meta) {
      resolved = {
        ...resource,
        status: resource.status ?? meta.status,
        createdBy: resource.createdBy ?? meta.createdBy ?? undefined,
      };
    }
  }

  const grants = resolved.documentId
    ? await getApplicableGrants(
        db,
        resolved.documentId,
        principal.id,
        await getPrincipalRoleSlugs(db, principal.id),
        now,
        principal.linkId,
      )
    : [];

  const allowed = decide({ principal, action, resource: resolved, permissions, grants, publicRead, tokenScope: principal.tokenScope });

  await appendAudit(db, {
    principalId: principal.id,
    tokenId: principal.tokenId,
    surface: principal.surface,
    action,
    resource: resourceKey(resolved),
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
 * Compile the principal's READ permissions for a collection into a SQL predicate
 * applied INSIDE the list query — never post-filter in memory (D17). Returns
 * undefined for an unrestricted reader (no predicate), or `1=0` when nothing is
 * readable. OR-combines: published, own, publicRead, and item-granted ids.
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
  if (publicRead || readPerms.some((p) => p.condition === 'published')) {
    clauses.push(sql`${documents.status} = 'published'`);
  }
  if (readPerms.some((p) => p.condition === 'own')) {
    clauses.push(sql`${documents.createdBy} = ${principal.id}`);
  }

  const roleSlugs = await getPrincipalRoleSlugs(db, principal.id);
  const granted = await getGrantedDocumentIds(db, principal.id, roleSlugs, now, principal.linkId);
  const readableIds = granted.filter((g) => g.actions.includes('read')).map((g) => g.documentId);
  if (readableIds.length) clauses.push(inArray(documents.id, readableIds));

  if (clauses.length === 0) return sql`1 = 0`; // nothing readable
  return clauses.length === 1 ? clauses[0] : sql`(${sql.join(clauses, sql` OR `)})`;
}
