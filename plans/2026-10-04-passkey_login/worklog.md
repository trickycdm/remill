# Worklog — 2026-10-04-passkey_login

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-10-04 06:40 | plan approved | Scope: alongside passwords, one-tap + autofill sign-in, enrol on account page only, same session |
| 2026-10-04 06:45 | workspace | Worktree `.claude/worktrees/passkey-login`, branch `feat/passkey-login` off main (keeps the uncommitted D57 visibility work separate) |
| 2026-10-04 06:47 | dependency | Added `@simplewebauthn/server@14.0.3`; `bun audit` reports nothing for it or its dependencies (67 pre-existing advisories, all in dev tooling) |
| 2026-10-04 06:50 | schema | `passkeys` + `webauthn_challenges`, migration `0018`; hand-added CHECK on `purpose` |
| 2026-10-04 06:55 | queries + service | `src/db/queries/passkeys.ts`, `getUserByPrincipalId`, `src/lib/relying-party.ts`, `src/services/passkeys/`, daily purge job |
| 2026-10-04 07:00 | routes + island + UI | 4 JSON routes, rename/delete routes, `src/client/passkey.ts`, login button + autofill hint, account Passkeys card |
| 2026-10-04 07:08 | unit tests | Software authenticator `src/test/webauthn.ts`; 23 service tests + 4 relying-party tests pass |
| 2026-10-04 07:10 | route tests | 6 route tests pass (enrol → sign in, CSRF, auth required, rate limit) |
| 2026-10-04 07:12 | decision | Login button reads "Use a passkey" and the enrol field "Confirm with your password", so existing e2e selectors (`/sign in/i`, `Current password`) stay unambiguous |
| 2026-10-04 07:20 | RE-PLAN | Options and verify moved to separate rate-limit buckets: the login page requests options on every load (autofill), which was eating the sign-in budget |
| 2026-10-04 07:25 | RE-PLAN | Failed sign-in answers 403, not 401: a 401 to a POST with a body is a fetch-spec network error, surfaced as a 500 by the local Workers proxy |
| 2026-10-04 07:28 | e2e | `e2e/passkeys.spec.ts` passes with Chromium's virtual authenticator on `http://localhost:3100` |
| 2026-10-04 07:35 | e2e full | 93 passed, 1 flaky (pre-existing markdown-editor click in admin-content, passed on retry) |
| 2026-10-04 07:45 | review | Independent security review: no bypass; fixed per-person rate limit on the enrol password check, `safeRedirect` backslash/control-char bypass (pre-existing, also on password login), in-dialog rename/remove errors, visible error for a refused autofill pick, cap re-check + duplicate handling at finish |
| 2026-10-04 07:45 | open decision | Passkeys survive a password change/reset — documented as a known gap in SECURITY_STANDARDS §4, needs Colin's call |
| 2026-10-04 07:30 | docs | D58 in TECH_DECISIONS; SECURITY_STANDARDS §4, ACCESS_CONTROL, DATABASE_STANDARDS, CLAUDE.md |
