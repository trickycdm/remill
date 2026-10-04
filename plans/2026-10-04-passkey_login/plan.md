# Passkey login (WebAuthn) — proposed decision D58

## Context

remill's human sign-in is email + password only (scrypt hash in `users.password_hash`, encrypted
cookie session via hono-sessions). This adds **passkeys** — phishing-resistant, device-bound
credentials (Touch ID, Windows Hello, a phone, a security key) — as a second way to sign in.

Scope agreed with Colin:

- **Alongside passwords.** Passwords keep working; nobody can be locked out by losing a device.
- **One-tap sign-in, no email typed.** A "Sign in with a passkey" button plus browser autofill on
  the email box (discoverable credentials).
- **Enrolment on the account page only** (`/admin/account`): add, rename, remove.
- **Same session as a password login**, so the agent-connect consent screens (`/oauth/authorize`,
  `/oauth/device`) work unchanged.

Explicitly out of scope: passwordless accounts, passkey at invite acceptance, post-login nudges,
passkey as a second factor, re-prompting on sensitive actions, and writing auth events to
`audit_log` (no auth event is audited today; this follows the existing structured-log precedent).

## Design in one paragraph

Two new fixed tables (`passkeys`, `webauthn_challenges`), one new service
(`src/services/passkeys/`), one query module, four small JSON routes, one browser island, and a
"Passkeys" card on the account page. Verification is delegated to `@simplewebauthn/server` (the
standard audited library, runs on Workers via Web Crypto) rather than hand-rolled. A successful
passkey sign-in calls the **existing** `setSessionUser`, so everything downstream of login is
untouched.

## Key decisions

1. **Library: `@simplewebauthn/server` (v14.0.3 confirmed on npm), server side only.** Parsing
   CBOR/COSE and verifying signatures by hand is exactly the kind of protocol code that should not
   be bespoke in a security-first project. Run `bun audit` before adding (CODING_CONVENTIONS
   dependency hygiene). No client library: the island uses the browser-native
   `PublicKeyCredential.parseCreationOptionsFromJSON` / `parseRequestOptionsFromJSON` /
   `credential.toJSON()` and hides passkey controls when they are unavailable.
2. **Challenges are single-use DB rows, not a cookie.** The repo's precedent for single-use values
   is a DB row (invite tokens, OAuth codes); signed cookies here are expiring but replayable.
   A `webauthn_challenges` row is consumed atomically with `DELETE … WHERE challenge = ? AND
   expires_at > ? RETURNING` — one statement, so no find-then-consume race. The server reads the
   challenge out of the response's `clientDataJSON`, consumes the row, then verifies. 5-minute
   lifetime; expired rows purged by the existing daily cron.
3. **Relying party = the server's own origin.** New pure helper
   `resolveRelyingParty(env, reqUrl)` → `{ rpId, origin }`: uses `BASE_URL` when set, otherwise the
   request origin (per-PR preview Workers have no `BASE_URL`). It deliberately **ignores**
   `settings.siteUrl` — an admin-editable value must not be able to break or redirect sign-in.
   Consequence worth knowing: passkeys are bound to the hostname, so each preview Worker has its
   own, and a future domain change would orphan them (passwords remain the fallback).
4. **User verification required.** A passkey replaces the password outright, so the authenticator
   must verify the person (biometric/PIN): `userVerification: 'required'`,
   `residentKey: 'required'`, `attestation: 'none'`.
5. **Adding a passkey requires the current password.** Sessions cannot be revoked server-side, so
   a stolen session must not be able to mint a permanent credential. Mirrors the existing
   "password change verifies the current password" rule (SECURITY_STANDARDS §4). Removing or
   renaming needs no re-entry.
6. **Identity-scoped, no `authorize()`.** Passkey management acts strictly on `getUser(c).id`,
   never a body-supplied principal id — the same documented exemption `/admin/account` already
   uses (ACCESS_CONTROL.md "Identity-scoped self-service edits").
7. **Disabled accounts cannot sign in**, same check as `authenticateUser`.

## Steps

### 0. Workspace
The current branch `feat/visibility-safe-public-enable` has uncommitted work (D57). Do this in a
separate git worktree on a new branch `feat/passkey-login` cut from `main`, so the two don't mix.
Move this plan to `plans/2026-10-04-passkey_login/plan.md` and start `worklog.md` beside it.

### 1. Schema + migration `0018`
`src/db/schema.ts`, then `bun run db:generate`, hand-review the SQL, `bun run db:migrate`.

- `passkeys`: `id` (`pky_…`, add entity to `src/lib/id.ts`), `principal_id` → principals
  (cascade), `credential_id` (base64url, **unique index**), `public_key` (base64url COSE),
  `counter` int, `transports_json`, `device_type`, `backed_up` 0/1, `name`, `created_at`,
  `last_used_at`; index on `principal_id`.
- `webauthn_challenges`: `challenge` (PK, base64url), `purpose` (`'register' | 'authenticate'`,
  CHECK added by hand), `principal_id` nullable → principals (cascade; set for `register`),
  `expires_at`, `created_at`.

### 2. Queries — `src/db/queries/passkeys.ts` (new)
`insertPasskey`, `listPasskeysByPrincipal`, `findPasskeyByCredentialId`, `updatePasskeyUsage`
(counter + `last_used_at`), `renamePasskey`, `deletePasskey` (both scoped by `principal_id`),
`insertChallenge`, `consumeChallenge` (the atomic delete-returning), `purgeExpiredChallenges`.
Also add `getUserByPrincipalId` to `src/db/queries/users.ts` (only `getUserByEmail` exists).

### 3. Relying-party helper — `src/lib/relying-party.ts` (new) + test
Pure function described in decision 3. For local work it accepts `localhost` but browsers reject
IP addresses as an RP ID, which matters for step 8.

### 4. Service — `src/services/passkeys/index.ts` (new)
- `beginRegistration(db, rp, user, currentPassword)` — verify the password with the existing
  `verifyPassword` (`src/lib/password.ts`), build options (existing credentials in
  `excludeCredentials`, user handle = principal id), store the challenge.
- `finishRegistration(db, rp, user, response, name)` — consume challenge (must be `register` and
  owned by this principal), `verifyRegistrationResponse`, insert the passkey. Cap at 10 per person.
- `beginAuthentication(db, rp)` — options with empty `allowCredentials`, store the challenge.
- `finishAuthentication(db, rp, response)` → `SessionUser | null` — consume challenge, look up the
  passkey by credential id, `verifyAuthenticationResponse`, check `disabled`, bump the counter,
  resolve the role with the existing `getPrimaryRole` (`src/db/queries/roles.ts`). Every failure
  returns `null` with one generic message, plus a `log.warn` like `authenticateUser` does.
- `listPasskeys`, `renamePasskey`, `removePasskey`.
- Wire `purgeExpiredChallenges` into the daily job next to `purgeOAuthArtifacts`
  (`src/jobs/index.ts`).

### 5. Routes (file-based; `bun run routes` regenerates `src/router.ts`)
- `src/routes/admin/login/passkey/options.tsx` and `verify.tsx` — POST, JSON, each behind the
  existing limiter on its own named bucket (`passkey-options`, `passkey-verify`) ~~one shared
  `passkey` bucket~~ — see Revision Log. A failed sign-in answers **403** ~~401~~. `verify` calls `setSessionUser` and returns `{ redirect }` through the login page's
  existing `safeRedirect` (extract it to `src/lib/` so both use one copy).
- `src/routes/admin/account/passkeys/options.tsx` and `index.tsx` (POST = finish registration) —
  `requireAuth()`.
- `src/routes/admin/account/passkeys/[id]/rename.tsx`, `[id]/delete.tsx` — `requireAuth()`,
  ordinary Datastar form posts with `dsRedirect`, errors via `renderSaveError`.
- The four JSON endpoints are JS `fetch` calls, not Datastar posts, so each does an explicit
  CSRF check (SECURITY_STANDARDS §8): `Origin` header must equal the relying-party origin.
  Bodies validated with Zod.

### 6. Browser island — `src/client/passkey.ts` (new)
One small script for both pages, loaded with `<Script>` from the login route and the account
route (both are inside the Vite scan globs, so the island reaches the production build).
Feature-detects WebAuthn and reveals the controls only when supported. On the login page it also
starts conditional mediation (autofill) when available. Errors are written into the existing
`role="alert"` result regions; a cancelled browser prompt is silent.

### 7. UI
- `src/routes/admin/login/index.tsx`: a secondary "Use a passkey" button (~~"Sign in with a passkey"~~) under the
  password form (hidden until the island confirms support), and
  `autocomplete="username webauthn"` on the email input. Carries the hidden `redirect` value.
- `src/routes/admin/account/index.tsx`: a "Passkeys" card under Security — a list (name, created,
  last used, "synced" badge when backed up) with rename/remove, and an "Add a passkey" form
  (name + current password). Built from the existing `@/components/ui` pieces; follow
  DESIGN_SYSTEM and A11Y_STANDARDS (labelled controls, focus management, live-region errors).

### 8. Tests
- **Unit** (Vitest, in-memory D1 from `src/test/d1.ts`): a small software-authenticator test
  helper in `src/test/` (Web Crypto ES256) producing real registration and sign-in responses.
  Cover: happy paths; challenge is single-use (replay fails); expired challenge; wrong origin;
  wrong RP; register challenge cannot be used to sign in and vice versa; another person's
  register challenge is rejected; wrong current password blocks enrolment; disabled account
  cannot sign in; removed passkey cannot sign in; remove/rename are scoped to the owner.
- **Route**: 429 on the `passkey` bucket; `Origin` mismatch rejected; account endpoints 401
  without a session.
- **E2E** `e2e/passkeys.spec.ts`: Chromium's virtual authenticator (CDP
  `WebAuthn.addVirtualAuthenticator`) — sign in with password, add a passkey, sign out, sign in
  with the passkey, remove it; plus an axe sweep of both pages. **Known wrinkle:** e2e runs on
  `http://127.0.0.1:3100` and WebAuthn refuses IP hosts, so this spec uses
  `http://localhost:3100`; if the preview server does not answer on `localhost`, adjust its bind
  host. Own `CF-Connecting-IP` per E2E_TESTING.

### 9. Docs
`docs/TECH_DECISIONS.md` (D58), `steering/SECURITY_STANDARDS.md` §4 (passkey rules: single-use
challenge, UV required, password re-entry to enrol, RP resolution), `steering/ACCESS_CONTROL.md`
(passkey management under the identity-scoped exemption), `steering/DATABASE_STANDARDS.md` (two
new fixed tables), `CLAUDE.md` build-status entry.

## Verification

1. `bun run type-check && bun run lint && bun run test:run` — all green.
2. `bun run e2e` — the new spec and the existing auth specs pass (password login unchanged).
3. Manual, in a real browser at `http://localhost:<port>` via `bun run dev`: add a passkey with
   Touch ID, sign out, sign in with one tap and via email-box autofill, confirm the OAuth consent
   page works from a passkey session, remove the passkey and confirm it no longer signs in.
4. Push the branch and repeat the manual check on the PR's preview Worker (real HTTPS hostname).
5. `/review` (code, tech-debt, security reviewers) before the PR.

## Revision Log

- 2026-10-04: Options and verify use separate rate-limit buckets. The login page requests options on
  every load to offer passkeys in autofill; on one shared bucket those page views used up the
  sign-in attempts.
- 2026-10-04: A failed passkey sign-in answers 403, not 401. Under the fetch spec a 401 to a POST
  with a body is a network error; the local Workers proxy enforces that and turned it into a 500.
- 2026-10-04: Wording — the login button is "Use a passkey" and the enrol field is "Confirm with
  your password", so the existing e2e selectors (`/sign in/i`, `Current password`) stay unambiguous.
