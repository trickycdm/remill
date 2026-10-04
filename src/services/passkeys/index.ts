/**
 * Passkey service (D58) — WebAuthn sign-in for humans, ALONGSIDE the password.
 *
 * Two ceremonies, each a begin/finish pair around a single-use challenge:
 *   • registration — a signed-in human adds a passkey to THEIR OWN account;
 *   • authentication — anyone presents a passkey and, if it verifies, gets the
 *     same SessionUser a password login would produce.
 *
 * Like the account service, management is identity-scoped: every function takes
 * the principal the route resolved from the session (`getUser(c).id`), never an id
 * from the request body, so no authorize()/Grant is involved (ACCESS_CONTROL.md —
 * the identity IS the authorization).
 *
 * Security rules (SECURITY_STANDARDS §4):
 *   • a challenge is consumed exactly once, atomically, before it is trusted;
 *   • the authenticator must verify the person (biometric/PIN) — a passkey
 *     stands in for the password outright;
 *   • adding a passkey re-checks the CURRENT password, because a session cannot
 *     be revoked server-side and must not be able to mint a permanent credential;
 *   • sign-in failures are indistinguishable to the caller (null).
 *
 * Protocol parsing and signature verification are delegated to
 * @simplewebauthn/server — never hand-rolled.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import type { Database } from '@/db/client';
import * as passkeyQ from '@/db/queries/passkeys';
import { getUserByPrincipalId } from '@/db/queries/users';
import { getPrimaryRole } from '@/db/queries/roles';
import { verifyPassword } from '@/lib/password';
import type { SessionUser, SystemRole } from '@/lib/auth-constants';
import type { RelyingParty } from '@/lib/relying-party';
import { ConflictError, InputValidationError, NotFoundError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

const log = getLogger('passkey-service');

const RP_NAME = 'remill';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS_PER_PERSON = 10;
const NAME_MAX_LENGTH = 60;

/** What the account page lists — never the key material. */
export interface PasskeySummary {
  readonly id: string;
  readonly name: string;
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

// The browser's `credential.toJSON()` output. Shape-checked at this boundary; the
// cryptographic checks are the library's.
const B64URL = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);
const CREDENTIAL_BASE = {
  id: B64URL,
  rawId: B64URL,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
};
const REGISTRATION_RESPONSE = z.object({
  ...CREDENTIAL_BASE,
  response: z
    .object({
      clientDataJSON: B64URL,
      attestationObject: z.string().min(1).max(16384).regex(/^[A-Za-z0-9_-]+$/),
      transports: z.array(z.string().max(32)).max(8).optional(),
    })
    .loose(),
});
const AUTHENTICATION_RESPONSE = z.object({
  ...CREDENTIAL_BASE,
  response: z
    .object({
      clientDataJSON: B64URL,
      authenticatorData: B64URL,
      signature: B64URL,
      userHandle: B64URL.nullish(),
    })
    .loose(),
});

function expiry(now: string): string {
  return new Date(new Date(now).getTime() + CHALLENGE_TTL_MS).toISOString();
}

function cleanName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new InputValidationError([{ message: 'Give the passkey a name.' }]);
  if (name.length > NAME_MAX_LENGTH) {
    throw new InputValidationError([{ message: `Passkey name must be at most ${NAME_MAX_LENGTH} characters.` }]);
  }
  return name;
}

function tooManyPasskeys(): ConflictError {
  return new ConflictError(`You can have at most ${MAX_PASSKEYS_PER_PERSON} passkeys — remove one first.`);
}

function registrationFailed(): InputValidationError {
  return new InputValidationError([{ message: 'That passkey could not be verified — please try again.' }]);
}

// ---------------------------------------------------------------------------
// Registration (signed-in human, own account)
// ---------------------------------------------------------------------------

/**
 * Start adding a passkey: re-check the current password, then issue the options
 * for `navigator.credentials.create()`. The person's existing passkeys are
 * excluded so the same authenticator is not registered twice.
 */
export async function beginRegistration(
  db: Database,
  rp: RelyingParty,
  principalId: string,
  input: { currentPassword: string; name: string },
  now: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  cleanName(input.name);
  const user = await getUserByPrincipalId(db, principalId);
  if (!user || !verifyPassword(input.currentPassword, user.passwordHash)) {
    throw new InputValidationError([{ message: 'Current password is incorrect.' }]);
  }
  const existing = await passkeyQ.listPasskeysByPrincipal(db, principalId);
  if (existing.length >= MAX_PASSKEYS_PER_PERSON) throw tooManyPasskeys();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpId,
    userID: isoUint8Array.fromUTF8String(principalId),
    userName: user.email,
    userDisplayName: user.displayName || user.email,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: [...p.transports] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await passkeyQ.insertChallenge(db, {
    challenge: options.challenge,
    purpose: 'register',
    principalId,
    expiresAt: expiry(now),
    now,
  });
  return options;
}

/**
 * Finish adding a passkey: the challenge must be an unused `register` challenge
 * issued to THIS principal, and the browser's response must verify against this
 * site's origin with user verification.
 */
export async function finishRegistration(
  db: Database,
  rp: RelyingParty,
  principalId: string,
  input: { response: unknown; name: string },
  now: string,
): Promise<PasskeySummary> {
  const name = cleanName(input.name);
  const parsed = REGISTRATION_RESPONSE.safeParse(input.response);
  if (!parsed.success) throw registrationFailed();

  let info;
  try {
    const result = await verifyRegistrationResponse({
      response: parsed.data as RegistrationResponseJSON,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      expectedChallenge: async (challenge) => {
        const issued = await passkeyQ.consumeChallenge(db, challenge, now);
        return issued?.purpose === 'register' && issued.principalId === principalId;
      },
    });
    if (!result.verified) throw registrationFailed();
    info = result.registrationInfo;
  } catch (err) {
    log.warn({ principalId, err: err instanceof Error ? err.message : String(err) }, 'passkey registration rejected');
    throw registrationFailed();
  }

  // Re-check the cap: several ceremonies may have been started before it was reached.
  if ((await passkeyQ.listPasskeysByPrincipal(db, principalId)).length >= MAX_PASSKEYS_PER_PERSON) {
    throw tooManyPasskeys();
  }
  const backedUp = info.credentialBackedUp;
  let id: string;
  try {
    id = await passkeyQ.insertPasskey(db, {
      principalId,
      credentialId: info.credential.id,
      publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp,
      name,
      now,
    });
  } catch (err) {
    // `passkeys_credential_unique` is the race-proof backstop.
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      throw new ConflictError('That passkey is already registered.');
    }
    throw err;
  }
  log.info({ principalId, passkeyId: id }, 'passkey registered');
  return { id, name, backedUp, createdAt: now, lastUsedAt: null };
}

// ---------------------------------------------------------------------------
// Authentication (anonymous → session)
// ---------------------------------------------------------------------------

/**
 * Start a passkey sign-in. No account is named: `allowCredentials` is empty, so
 * the browser offers whichever discoverable passkeys it holds for this site —
 * and the response reveals nothing about which accounts exist.
 */
export async function beginAuthentication(
  db: Database,
  rp: RelyingParty,
  now: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({ rpID: rp.rpId, userVerification: 'required' });
  await passkeyQ.insertChallenge(db, {
    challenge: options.challenge,
    purpose: 'authenticate',
    principalId: null,
    expiresAt: expiry(now),
    now,
  });
  return options;
}

/**
 * Verify a passkey sign-in and return the SessionUser to store, or null on ANY
 * failure (malformed response, unknown passkey, bad/used/expired challenge, bad
 * signature, disabled account). Callers must not reveal which it was.
 */
export async function finishAuthentication(
  db: Database,
  rp: RelyingParty,
  response: unknown,
  now: string,
): Promise<SessionUser | null> {
  const parsed = AUTHENTICATION_RESPONSE.safeParse(response);
  if (!parsed.success) return null;
  const passkey = await passkeyQ.findPasskeyByCredentialId(db, parsed.data.id);
  if (!passkey) return null;

  let info;
  try {
    const result = await verifyAuthenticationResponse({
      response: parsed.data as AuthenticationResponseJSON,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: [...passkey.transports],
      },
      expectedChallenge: async (challenge) => {
        const issued = await passkeyQ.consumeChallenge(db, challenge, now);
        return issued?.purpose === 'authenticate';
      },
    });
    if (!result.verified) throw new Error('not verified');
    info = result.authenticationInfo;
  } catch (err) {
    log.warn(
      { principalId: passkey.principalId, err: err instanceof Error ? err.message : String(err) },
      'failed passkey login',
    );
    return null;
  }

  const user = await getUserByPrincipalId(db, passkey.principalId);
  if (!user || user.disabled) return null;

  await passkeyQ.updatePasskeyUsage(db, passkey.id, {
    counter: info.newCounter,
    backedUp: info.credentialBackedUp,
    now,
  });
  return {
    id: user.principalId,
    email: user.email,
    displayName: user.displayName,
    role: (await getPrimaryRole(db, user.principalId)) as SystemRole,
  };
}

// ---------------------------------------------------------------------------
// Management (signed-in human, own passkeys)
// ---------------------------------------------------------------------------

export async function listPasskeys(db: Database, principalId: string): Promise<PasskeySummary[]> {
  const rows = await passkeyQ.listPasskeysByPrincipal(db, principalId);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    backedUp: p.backedUp,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  }));
}

export async function renamePasskey(db: Database, principalId: string, id: string, name: string): Promise<void> {
  if (!(await passkeyQ.renamePasskey(db, principalId, id, cleanName(name)))) {
    throw new NotFoundError('Passkey');
  }
}

export async function removePasskey(db: Database, principalId: string, id: string): Promise<void> {
  if (!(await passkeyQ.deletePasskey(db, principalId, id))) {
    throw new NotFoundError('Passkey');
  }
  log.info({ principalId, passkeyId: id }, 'passkey removed');
}

/** Daily maintenance (cron): drop challenges that expired without being used. */
export async function purgeExpiredChallenges(db: Database, now: string): Promise<void> {
  const purged = await passkeyQ.purgeExpiredChallenges(db, now);
  if (purged > 0) console.log(`[cron] purged ${purged} expired passkey challenges`);
}
