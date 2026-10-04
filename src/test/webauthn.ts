/**
 * A software passkey for tests (D58) — the authenticator + browser half of
 * WebAuthn, producing the same JSON a real `credential.toJSON()` would, signed
 * with a real ES256 key. Lets the passkey service be tested end to end against
 * the real verification library, with knobs for the failure cases (wrong origin,
 * no user verification).
 */

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

// --- the few CBOR shapes an attestation needs --------------------------------
function cborHead(major: number, len: number): Uint8Array {
  if (len < 24) return Uint8Array.of((major << 5) | len);
  if (len < 256) return Uint8Array.of((major << 5) | 24, len);
  return Uint8Array.of((major << 5) | 25, len >> 8, len & 0xff);
}
const cborBytes = (b: Uint8Array) => concat(cborHead(2, b.length), b);
const cborText = (s: string) => concat(cborHead(3, s.length), enc.encode(s));

/** ECDSA r||s (WebCrypto) → ASN.1 DER (what WebAuthn carries). */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (v: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const trimmed = v.subarray(i);
    const body = trimmed[0]! & 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed;
    return concat(Uint8Array.of(0x02, body.length), body);
  };
  const body = concat(int(raw.subarray(0, 32)), int(raw.subarray(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

export interface CeremonyOpts {
  /** Did the authenticator verify the person (biometric/PIN)? Default true. */
  readonly userVerified?: boolean;
}

export interface TestAuthenticator {
  readonly credentialId: string;
  register(
    options: { challenge: string; rp: { id?: string } },
    origin: string,
    opts?: CeremonyOpts,
  ): Promise<Record<string, unknown>>;
  authenticate(
    options: { challenge: string; rpId?: string },
    origin: string,
    opts?: CeremonyOpts,
  ): Promise<Record<string, unknown>>;
}

export async function createTestAuthenticator(): Promise<TestAuthenticator> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
  const x = new Uint8Array(Buffer.from(jwk.x!, 'base64url'));
  const y = new Uint8Array(Buffer.from(jwk.y!, 'base64url'));
  const rawId = crypto.getRandomValues(new Uint8Array(16));
  const credentialId = b64url(rawId);
  let counter = 0;

  const clientData = (type: string, challenge: string, origin: string) =>
    enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  const authData = async (rpId: string, uv: boolean, attested?: Uint8Array) => {
    const flags = 0x01 | (uv ? 0x04 : 0) | (attested ? 0x40 : 0);
    counter += 1;
    const count = Uint8Array.of(counter >>> 24, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff);
    return concat(await sha256(enc.encode(rpId)), Uint8Array.of(flags), count, attested ?? new Uint8Array());
  };

  const base = { id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {} };

  return {
    credentialId,

    async register(options, origin, opts = {}) {
      // COSE EC2 key: {1: 2, 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
      const coseKey = concat(
        Uint8Array.of(0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21),
        cborBytes(x),
        Uint8Array.of(0x22),
        cborBytes(y),
      );
      const attested = concat(new Uint8Array(16), Uint8Array.of(0, rawId.length), rawId, coseKey);
      const data = await authData(options.rp.id ?? '', opts.userVerified ?? true, attested);
      const attestationObject = concat(
        Uint8Array.of(0xa3),
        cborText('fmt'),
        cborText('none'),
        cborText('attStmt'),
        Uint8Array.of(0xa0),
        cborText('authData'),
        cborBytes(data),
      );
      return {
        ...base,
        response: {
          clientDataJSON: b64url(clientData('webauthn.create', options.challenge, origin)),
          attestationObject: b64url(attestationObject),
          transports: ['internal'],
        },
      };
    },

    async authenticate(options, origin, opts = {}) {
      const data = await authData(options.rpId ?? '', opts.userVerified ?? true);
      const client = clientData('webauthn.get', options.challenge, origin);
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          concat(data, await sha256(client)) as BufferSource,
        ),
      );
      return {
        ...base,
        response: {
          clientDataJSON: b64url(client),
          authenticatorData: b64url(data),
          signature: b64url(rawToDer(signature)),
        },
      };
    },
  };
}
