import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { createTestAuthenticator, type TestAuthenticator } from '@/test/webauthn';
import { getDb, type Database } from '@/db/client';
import { principals, users, webauthnChallenges } from '@/db/schema';
import { hashPassword } from '@/lib/password';
import { setPrincipalDisabled } from '@/db/queries/principals';
import type { RelyingParty } from '@/lib/relying-party';
import {
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
  listPasskeys,
  renamePasskey,
  removePasskey,
  purgeExpiredChallenges,
} from '@/services/passkeys';
import { ConflictError, InputValidationError, NotFoundError } from '@/lib/errors';

const NOW = '2026-10-04T12:00:00.000Z';
const LATER = '2026-10-04T12:06:00.000Z'; // past the 5-minute challenge lifetime
const RP: RelyingParty = { rpId: 'remill.test', origin: 'https://remill.test' };
const PASSWORD = 'origPass1';

async function seedHuman(db: Database, id: string, email: string): Promise<void> {
  await db.insert(principals).values({ id, kind: 'user', name: id, disabled: 0, createdAt: NOW });
  await db.insert(users).values({ principalId: id, email, passwordHash: hashPassword(PASSWORD), createdAt: NOW });
}

/** Run the whole "add a passkey" ceremony for `principalId`. */
async function enrol(db: Database, device: TestAuthenticator, principalId: string, name = 'Laptop') {
  const options = await beginRegistration(db, RP, principalId, { currentPassword: PASSWORD, name }, NOW);
  return finishRegistration(db, RP, principalId, { response: await device.register(options, RP.origin), name }, NOW);
}

/** Run the whole sign-in ceremony with `device`. */
async function signIn(db: Database, device: TestAuthenticator, now = NOW) {
  const options = await beginAuthentication(db, RP, now);
  return finishAuthentication(db, RP, await device.authenticate(options, RP.origin), now);
}

describe('passkey service', () => {
  let db: Database;
  let device: TestAuthenticator;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedHuman(db, 'prn_a', 'a@example.com');
    await seedHuman(db, 'prn_b', 'b@example.com');
    device = await createTestAuthenticator();
  });

  describe('registration', () => {
    it('adds a passkey on the happy path and lists it without key material', async () => {
      const added = await enrol(db, device, 'prn_a');
      expect(added.name).toBe('Laptop');
      const list = await listPasskeys(db, 'prn_a');
      expect(list).toHaveLength(1);
      expect(Object.keys(list[0]!).sort()).toEqual(['backedUp', 'createdAt', 'id', 'lastUsedAt', 'name']);
      expect(await listPasskeys(db, 'prn_b')).toHaveLength(0);
    });

    it('refuses to start without the correct current password', async () => {
      await expect(
        beginRegistration(db, RP, 'prn_a', { currentPassword: 'wrongpass', name: 'Laptop' }, NOW),
      ).rejects.toBeInstanceOf(InputValidationError);
      expect(await db.select().from(webauthnChallenges)).toHaveLength(0);
    });

    it('requires a name', async () => {
      await expect(
        beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: '  ' }, NOW),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('rejects a replayed registration response (challenge is single-use)', async () => {
      const options = await beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: 'Laptop' }, NOW);
      const response = await device.register(options, RP.origin);
      await finishRegistration(db, RP, 'prn_a', { response, name: 'Laptop' }, NOW);
      await expect(finishRegistration(db, RP, 'prn_a', { response, name: 'Again' }, NOW)).rejects.toBeInstanceOf(
        InputValidationError,
      );
      expect(await listPasskeys(db, 'prn_a')).toHaveLength(1);
    });

    it('rejects an expired challenge', async () => {
      const options = await beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: 'Laptop' }, NOW);
      const response = await device.register(options, RP.origin);
      await expect(finishRegistration(db, RP, 'prn_a', { response, name: 'Laptop' }, LATER)).rejects.toBeInstanceOf(
        InputValidationError,
      );
    });

    it("rejects a challenge issued to a different person", async () => {
      const options = await beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: 'Laptop' }, NOW);
      const response = await device.register(options, RP.origin);
      await expect(finishRegistration(db, RP, 'prn_b', { response, name: 'Laptop' }, NOW)).rejects.toBeInstanceOf(
        InputValidationError,
      );
      expect(await listPasskeys(db, 'prn_b')).toHaveLength(0);
    });

    it('rejects a sign-in challenge used for registration', async () => {
      const options = await beginAuthentication(db, RP, NOW);
      const response = await device.register({ challenge: options.challenge, rp: { id: RP.rpId } }, RP.origin);
      await expect(finishRegistration(db, RP, 'prn_a', { response, name: 'Laptop' }, NOW)).rejects.toBeInstanceOf(
        InputValidationError,
      );
    });

    it('rejects a response from another origin, another RP, or without user verification', async () => {
      const begin = () => beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: 'Laptop' }, NOW);
      const attempts = [
        device.register(await begin(), 'https://evil.example'),
        device.register({ ...(await begin()), rp: { id: 'evil.example' } }, RP.origin),
        device.register(await begin(), RP.origin, { userVerified: false }),
      ];
      for (const attempt of attempts) {
        await expect(
          finishRegistration(db, RP, 'prn_a', { response: await attempt, name: 'Laptop' }, NOW),
        ).rejects.toBeInstanceOf(InputValidationError);
      }
      expect(await listPasskeys(db, 'prn_a')).toHaveLength(0);
    });

    it('rejects a malformed response', async () => {
      await beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: 'Laptop' }, NOW);
      await expect(
        finishRegistration(db, RP, 'prn_a', { response: { id: 'x' }, name: 'Laptop' }, NOW),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('caps the number of passkeys per person', async () => {
      for (let i = 0; i < 10; i++) await enrol(db, await createTestAuthenticator(), 'prn_a', `Key ${i}`);
      await expect(
        beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: 'One more' }, NOW),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('authentication', () => {
    beforeEach(async () => {
      await enrol(db, device, 'prn_a');
    });

    it('signs the owner in and stamps last-used', async () => {
      const user = await signIn(db, device);
      expect(user).toMatchObject({ id: 'prn_a', email: 'a@example.com' });
      expect((await listPasskeys(db, 'prn_a'))[0]!.lastUsedAt).toBe(NOW);
    });

    it('rejects a replayed sign-in response (challenge is single-use)', async () => {
      const options = await beginAuthentication(db, RP, NOW);
      const response = await device.authenticate(options, RP.origin);
      expect(await finishAuthentication(db, RP, response, NOW)).not.toBeNull();
      expect(await finishAuthentication(db, RP, response, NOW)).toBeNull();
    });

    it('rejects an expired challenge', async () => {
      const options = await beginAuthentication(db, RP, NOW);
      const response = await device.authenticate(options, RP.origin);
      expect(await finishAuthentication(db, RP, response, LATER)).toBeNull();
    });

    it('rejects a challenge the server never issued', async () => {
      const response = await device.authenticate({ challenge: 'bm90LWlzc3VlZA', rpId: RP.rpId }, RP.origin);
      expect(await finishAuthentication(db, RP, response, NOW)).toBeNull();
    });

    it('rejects a registration challenge used for sign-in', async () => {
      const options = await beginRegistration(db, RP, 'prn_a', { currentPassword: PASSWORD, name: 'Other' }, NOW);
      const response = await device.authenticate({ challenge: options.challenge, rpId: RP.rpId }, RP.origin);
      expect(await finishAuthentication(db, RP, response, NOW)).toBeNull();
    });

    it('rejects a response from another origin, another RP, or without user verification', async () => {
      const begin = () => beginAuthentication(db, RP, NOW);
      expect(
        await finishAuthentication(db, RP, await device.authenticate(await begin(), 'https://evil.example'), NOW),
      ).toBeNull();
      expect(
        await finishAuthentication(
          db,
          RP,
          await device.authenticate({ ...(await begin()), rpId: 'evil.example' }, RP.origin),
          NOW,
        ),
      ).toBeNull();
      expect(
        await finishAuthentication(
          db,
          RP,
          await device.authenticate(await begin(), RP.origin, { userVerified: false }),
          NOW,
        ),
      ).toBeNull();
    });

    it('rejects a signature from a different key presenting the same credential id', async () => {
      const impostor = await createTestAuthenticator();
      const options = await beginAuthentication(db, RP, NOW);
      await impostor.authenticate(options, RP.origin); // advance its counter past the real one
      const forged = await impostor.authenticate(options, RP.origin);
      const response = { ...forged, id: device.credentialId, rawId: device.credentialId };
      expect(await finishAuthentication(db, RP, response, NOW)).toBeNull();
    });

    it('rejects an unknown passkey and a malformed response', async () => {
      expect(await signIn(db, await createTestAuthenticator())).toBeNull();
      expect(await finishAuthentication(db, RP, { nope: true }, NOW)).toBeNull();
      expect(await finishAuthentication(db, RP, null, NOW)).toBeNull();
    });

    it('refuses a disabled account', async () => {
      await setPrincipalDisabled(db, 'prn_a', true);
      expect(await signIn(db, device)).toBeNull();
    });

    it('stops working once the passkey is removed', async () => {
      const [passkey] = await listPasskeys(db, 'prn_a');
      await removePasskey(db, 'prn_a', passkey!.id);
      expect(await signIn(db, device)).toBeNull();
    });
  });

  describe('management', () => {
    it("cannot rename or remove another person's passkey", async () => {
      const { id } = await enrol(db, device, 'prn_a');
      await expect(renamePasskey(db, 'prn_b', id, 'Mine now')).rejects.toBeInstanceOf(NotFoundError);
      await expect(removePasskey(db, 'prn_b', id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await listPasskeys(db, 'prn_a'))[0]!.name).toBe('Laptop');
    });

    it('renames and removes its own passkey', async () => {
      const { id } = await enrol(db, device, 'prn_a');
      await renamePasskey(db, 'prn_a', id, '  Work laptop ');
      expect((await listPasskeys(db, 'prn_a'))[0]!.name).toBe('Work laptop');
      await expect(renamePasskey(db, 'prn_a', id, '')).rejects.toBeInstanceOf(InputValidationError);
      await removePasskey(db, 'prn_a', id);
      expect(await listPasskeys(db, 'prn_a')).toHaveLength(0);
    });

    it('purges only expired challenges', async () => {
      await beginAuthentication(db, RP, NOW);
      await purgeExpiredChallenges(db, NOW);
      expect(await db.select().from(webauthnChallenges)).toHaveLength(1);
      await purgeExpiredChallenges(db, LATER);
      expect(await db.select().from(webauthnChallenges)).toHaveLength(0);
    });
  });
});
