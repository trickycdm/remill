/**
 * OAuth 2.1 queries (D48) — clients, grants, codes, device codes, and the
 * grant-scoped access-token operations. The grant row is the durable human
 * consent: `createGrantWithPrincipal` materializes it atomically (principal +
 * role assignment + grant + first auth code in one batch, mirroring
 * `createUserPrincipal`), and deleting it cascades every derived credential.
 *
 * These queries are witness-free by design (like events/trash maintenance):
 * the AUTHORIZATION for a grant mutation is the consent-approval `authorize()`
 * call in src/services/oauth — token exchanges only re-derive credentials
 * inside an existing grant and never touch roles or scope.
 */

import { eq, and, lt, isNotNull, notInArray } from 'drizzle-orm';
import type { Database } from '@/db/client';
import {
  oauthClients,
  oauthGrants,
  oauthCodes,
  oauthDeviceCodes,
  apiTokens,
  principals,
  principalRoles,
} from '@/db/schema';
import { newId } from '@/lib/id';

// ---------------------------------------------------------------------------
// Clients (DCR)
// ---------------------------------------------------------------------------

export interface OAuthClientRecord {
  readonly id: string;
  readonly name: string;
  readonly redirectUris: string[];
  readonly createdAt: string;
}

export async function insertClient(
  db: Database,
  input: { name: string; redirectUris: string[]; metadata?: Record<string, unknown> },
  now: string,
): Promise<string> {
  const id = newId('oauthClient');
  await db.insert(oauthClients).values({
    id,
    name: input.name,
    redirectUrisJson: JSON.stringify(input.redirectUris),
    tokenEndpointAuthMethod: 'none',
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt: now,
  });
  return id;
}

export async function getClient(db: Database, id: string): Promise<OAuthClientRecord | null> {
  const rows = await db.select().from(oauthClients).where(eq(oauthClients.id, id)).limit(1);
  const c = rows[0];
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    redirectUris: JSON.parse(c.redirectUrisJson) as string[],
    createdAt: c.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export interface OAuthGrantRecord {
  readonly id: string;
  readonly clientId: string;
  readonly principalId: string;
  readonly grantedBy: string;
  readonly role: string;
  readonly resource: string | null;
  readonly refreshTokenHash: string | null;
  readonly prevRefreshTokenHash: string | null;
  readonly refreshExpiresAt: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

function mapGrant(g: typeof oauthGrants.$inferSelect): OAuthGrantRecord {
  return {
    id: g.id,
    clientId: g.clientId,
    principalId: g.principalId,
    grantedBy: g.grantedBy,
    role: g.role,
    resource: g.resource,
    refreshTokenHash: g.refreshTokenHash,
    prevRefreshTokenHash: g.prevRefreshTokenHash,
    refreshExpiresAt: g.refreshExpiresAt,
    createdAt: g.createdAt,
    lastUsedAt: g.lastUsedAt,
  };
}

async function grantWhere(db: Database, cond: ReturnType<typeof eq>): Promise<OAuthGrantRecord | null> {
  const rows = await db.select().from(oauthGrants).where(cond).limit(1);
  return rows[0] ? mapGrant(rows[0]) : null;
}

export const getGrant = (db: Database, id: string) => grantWhere(db, eq(oauthGrants.id, id));
export const getGrantByClient = (db: Database, clientId: string) =>
  grantWhere(db, eq(oauthGrants.clientId, clientId));
export const getGrantByRefreshHash = (db: Database, hash: string) =>
  grantWhere(db, eq(oauthGrants.refreshTokenHash, hash));
export const getGrantByPrevRefreshHash = (db: Database, hash: string) =>
  grantWhere(db, eq(oauthGrants.prevRefreshTokenHash, hash));

/** Map principalId → clientName for "via OAuth" provenance badges (one query). */
export async function grantClientNamesByPrincipal(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({ principalId: oauthGrants.principalId, name: oauthClients.name })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id));
  return new Map(rows.map((r) => [r.principalId, r.name]));
}

/**
 * Materialize a first-time consent atomically: the agent principal, its single
 * role assignment, the grant row, and the first authorization code. The chosen
 * role is recorded on the grant AND assigned via principal_roles (the latter is
 * the authority authorize() reads).
 */
export async function createGrantWithPrincipal(
  db: Database,
  input: {
    clientId: string;
    principalName: string;
    grantedBy: string;
    role: string;
    resource: string | null;
    code: { codeHash: string; redirectUri: string; codeChallenge: string; expiresAt: string } | null;
  },
  now: string,
): Promise<{ grantId: string; principalId: string }> {
  const principalId = newId('principal');
  const grantId = newId('oauthGrant');
  await db.batch([
    db.insert(principals).values({
      id: principalId,
      kind: 'agent',
      subtype: 'agent',
      name: input.principalName,
      disabled: 0,
      createdAt: now,
    }),
    db.insert(principalRoles).values({
      id: newId('principalRole'),
      principalId,
      role: input.role,
      collection: '*',
    }),
    db.insert(oauthGrants).values({
      id: grantId,
      clientId: input.clientId,
      principalId,
      grantedBy: input.grantedBy,
      role: input.role,
      resource: input.resource,
      createdAt: now,
    }),
    ...(input.code
      ? [
          db.insert(oauthCodes).values({
            id: newId('oauthCode'),
            codeHash: input.code.codeHash,
            grantId,
            redirectUri: input.code.redirectUri,
            codeChallenge: input.code.codeChallenge,
            codeChallengeMethod: 'S256',
            resource: input.resource,
            expiresAt: input.code.expiresAt,
            createdAt: now,
          }),
        ]
      : []),
  ]);
  return { grantId, principalId };
}

/**
 * Re-consent for an existing grant (same client_id reconnecting): the consent
 * screen is authoritative for OAuth agents, so the principal's role rows are
 * REPLACED with the newly chosen role; the old refresh chain dies (hashes
 * nulled) and a fresh auth code is issued. One batch.
 */
export async function reconsentGrant(
  db: Database,
  input: {
    grantId: string;
    principalId: string;
    grantedBy: string;
    role: string;
    resource: string | null;
    code: { codeHash: string; redirectUri: string; codeChallenge: string; expiresAt: string } | null;
  },
  now: string,
): Promise<void> {
  await db.batch([
    db
      .update(oauthGrants)
      .set({
        role: input.role,
        grantedBy: input.grantedBy,
        resource: input.resource,
        refreshTokenHash: null,
        prevRefreshTokenHash: null,
        refreshExpiresAt: null,
      })
      .where(eq(oauthGrants.id, input.grantId)),
    db.delete(principalRoles).where(eq(principalRoles.principalId, input.principalId)),
    db.insert(principalRoles).values({
      id: newId('principalRole'),
      principalId: input.principalId,
      role: input.role,
      collection: '*',
    }),
    ...(input.code
      ? [
          db.insert(oauthCodes).values({
            id: newId('oauthCode'),
            codeHash: input.code.codeHash,
            grantId: input.grantId,
            redirectUri: input.code.redirectUri,
            codeChallenge: input.code.codeChallenge,
            codeChallengeMethod: 'S256',
            resource: input.resource,
            expiresAt: input.code.expiresAt,
            createdAt: now,
          }),
        ]
      : []),
  ]);
}

/** Rotate the refresh token: current hash slides into the one-slot memory. */
export async function rotateRefreshToken(
  db: Database,
  grantId: string,
  input: { newHash: string; prevHash: string | null; expiresAt: string },
  now: string,
): Promise<void> {
  await db
    .update(oauthGrants)
    .set({
      refreshTokenHash: input.newHash,
      prevRefreshTokenHash: input.prevHash,
      refreshExpiresAt: input.expiresAt,
      lastUsedAt: now,
    })
    .where(eq(oauthGrants.id, grantId));
}

/** Kill a refresh chain (reuse detected / re-consent): hashes null, tokens gone. */
export async function killRefreshChain(db: Database, grantId: string): Promise<void> {
  await db.batch([
    db
      .update(oauthGrants)
      .set({ refreshTokenHash: null, prevRefreshTokenHash: null, refreshExpiresAt: null })
      .where(eq(oauthGrants.id, grantId)),
    db.delete(apiTokens).where(eq(apiTokens.grantId, grantId)),
  ]);
}

/** Revoke a grant entirely — FK cascade deletes its codes and access tokens. */
export async function deleteGrant(db: Database, grantId: string): Promise<void> {
  await db.delete(oauthGrants).where(eq(oauthGrants.id, grantId));
}

/** Delete a grant's live access tokens (each issuance replaces the last). */
export async function deleteTokensForGrant(db: Database, grantId: string): Promise<void> {
  await db.delete(apiTokens).where(eq(apiTokens.grantId, grantId));
}

/** RFC 7009 revocation of a single access token, addressed by its hash. */
export async function deleteTokenByHash(db: Database, tokenHash: string): Promise<void> {
  await db.delete(apiTokens).where(eq(apiTokens.tokenHash, tokenHash));
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

export interface OAuthCodeRecord {
  readonly id: string;
  readonly grantId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string | null;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

export async function insertCode(
  db: Database,
  input: {
    grantId: string;
    codeHash: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string | null;
    expiresAt: string;
  },
  now: string,
): Promise<void> {
  await db.insert(oauthCodes).values({
    id: newId('oauthCode'),
    codeHash: input.codeHash,
    grantId: input.grantId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: 'S256',
    resource: input.resource,
    expiresAt: input.expiresAt,
    createdAt: now,
  });
}

export async function findCodeByHash(db: Database, codeHash: string): Promise<OAuthCodeRecord | null> {
  const rows = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, codeHash)).limit(1);
  const c = rows[0];
  if (!c) return null;
  return {
    id: c.id,
    grantId: c.grantId,
    redirectUri: c.redirectUri,
    codeChallenge: c.codeChallenge,
    resource: c.resource,
    expiresAt: c.expiresAt,
    consumedAt: c.consumedAt,
  };
}

/** Mark a code consumed (kept, not deleted, so replay is detectable). */
export async function consumeCode(db: Database, id: string, now: string): Promise<void> {
  await db.update(oauthCodes).set({ consumedAt: now }).where(eq(oauthCodes.id, id));
}

// ---------------------------------------------------------------------------
// Device codes (RFC 8628)
// ---------------------------------------------------------------------------

export interface OAuthDeviceRecord {
  readonly id: string;
  readonly clientId: string;
  readonly resource: string | null;
  readonly grantId: string | null;
  readonly deniedAt: string | null;
  readonly lastPolledAt: string | null;
  readonly expiresAt: string;
}

export async function insertDeviceCode(
  db: Database,
  input: {
    deviceCodeHash: string;
    userCodeHash: string;
    clientId: string;
    resource: string | null;
    expiresAt: string;
  },
  now: string,
): Promise<string> {
  const id = newId('oauthDevice');
  await db.insert(oauthDeviceCodes).values({
    id,
    deviceCodeHash: input.deviceCodeHash,
    userCodeHash: input.userCodeHash,
    clientId: input.clientId,
    resource: input.resource,
    expiresAt: input.expiresAt,
    createdAt: now,
  });
  return id;
}

function mapDevice(d: typeof oauthDeviceCodes.$inferSelect): OAuthDeviceRecord {
  return {
    id: d.id,
    clientId: d.clientId,
    resource: d.resource,
    grantId: d.grantId,
    deniedAt: d.deniedAt,
    lastPolledAt: d.lastPolledAt,
    expiresAt: d.expiresAt,
  };
}

export async function findDeviceByDeviceHash(db: Database, hash: string): Promise<OAuthDeviceRecord | null> {
  const rows = await db
    .select()
    .from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.deviceCodeHash, hash))
    .limit(1);
  return rows[0] ? mapDevice(rows[0]) : null;
}

export async function findDeviceById(db: Database, id: string): Promise<OAuthDeviceRecord | null> {
  const rows = await db.select().from(oauthDeviceCodes).where(eq(oauthDeviceCodes.id, id)).limit(1);
  return rows[0] ? mapDevice(rows[0]) : null;
}

export async function findDeviceByUserHash(db: Database, hash: string): Promise<OAuthDeviceRecord | null> {
  const rows = await db
    .select()
    .from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.userCodeHash, hash))
    .limit(1);
  return rows[0] ? mapDevice(rows[0]) : null;
}

export async function approveDevice(db: Database, id: string, grantId: string): Promise<void> {
  await db.update(oauthDeviceCodes).set({ grantId }).where(eq(oauthDeviceCodes.id, id));
}

export async function denyDevice(db: Database, id: string, now: string): Promise<void> {
  await db.update(oauthDeviceCodes).set({ deniedAt: now }).where(eq(oauthDeviceCodes.id, id));
}

export async function stampDevicePolled(db: Database, id: string, now: string): Promise<void> {
  await db.update(oauthDeviceCodes).set({ lastPolledAt: now }).where(eq(oauthDeviceCodes.id, id));
}

/** A finished pairing's row is deleted once tokens are handed over. */
export async function deleteDevice(db: Database, id: string): Promise<void> {
  await db.delete(oauthDeviceCodes).where(eq(oauthDeviceCodes.id, id));
}

// ---------------------------------------------------------------------------
// Maintenance (daily cron, witness-free — like pruneEventRows)
// ---------------------------------------------------------------------------

/**
 * Purge expired/derelict OAuth artifacts. `now` is the ISO cutoff clock;
 * `unconsentedClientCutoff` and `deadGrantCutoff` are pre-computed ISO
 * timestamps (service owns the window arithmetic). Returns row counts for the
 * cron log.
 */
export async function purgeOAuthRows(
  db: Database,
  input: { now: string; unconsentedClientCutoff: string; deadGrantCutoff: string },
): Promise<{ codes: number; devices: number; tokens: number; clients: number; grants: number }> {
  const codes = await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, input.now)).returning({ id: oauthCodes.id });
  const devices = await db
    .delete(oauthDeviceCodes)
    .where(lt(oauthDeviceCodes.expiresAt, input.now))
    .returning({ id: oauthDeviceCodes.id });
  // Expired grant-derived access tokens (manual rmk_ tokens are untouched —
  // resolvePrincipal already rejects them, this is just hygiene).
  const tokens = await db
    .delete(apiTokens)
    .where(and(isNotNull(apiTokens.grantId), isNotNull(apiTokens.expiresAt), lt(apiTokens.expiresAt, input.now)))
    .returning({ id: apiTokens.id });
  // DCR registrations that never reached a grant (materialized anti-join —
  // the grants table is tiny on a single-tenant instance).
  const consented = (await db.select({ id: oauthGrants.clientId }).from(oauthGrants)).map((r) => r.id);
  const clients = await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.createdAt, input.unconsentedClientCutoff),
        consented.length ? notInArray(oauthClients.id, consented) : undefined,
      ),
    )
    .returning({ id: oauthClients.id });
  // Dead connections: refresh expired long ago → grant (and cascades) go; the
  // agent principal survives for the admin to inspect/disable/delete.
  const grants = await db
    .delete(oauthGrants)
    .where(and(isNotNull(oauthGrants.refreshExpiresAt), lt(oauthGrants.refreshExpiresAt, input.deadGrantCutoff)))
    .returning({ id: oauthGrants.id });
  return {
    codes: codes.length,
    devices: devices.length,
    tokens: tokens.length,
    clients: clients.length,
    grants: grants.length,
  };
}
