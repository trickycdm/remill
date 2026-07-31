# Production deploy: remill.org on the new Cloudflare account

**Status: COMPLETE — 2026-07-09.** remill is live at https://remill.org (Worker version
`9ee1b799`, D1 in WEUR, both crons registered, admin login verified against the live site).
All five phases DONE; see the Revision Log for the four mid-flight corrections the first
deploy surfaced (all fixed on main, PRs #1–#6).

## Context

remill is code-complete (all roadmaps merged to main, `0d3afce`) but has **never been deployed**.
Colin just bought `remill.org` directly on a **brand-new Cloudflare account** — so the zone already
exists and is active on that account. My only Cloudflare access is the existing GitHub Actions
pipeline (`.github/workflows/ci.yml` + `preview-cleanup.yml`), which is fully wired but dormant:
the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `SESSION_SECRET` repo secrets don't exist
yet, and `wrangler.jsonc` still has placeholder resource IDs.

Gaps between "code on main" and "live at https://remill.org":

1. **Account linking** — no API token, no Account ID, no repo secrets. *(Colin chose: I drive his
   logged-in Chrome session to create these.)*
2. **No resources on the account** — D1 `remill`, R2 `remill-media`, KV rate-limit namespace must be
   created; their real IDs committed to `wrangler.jsonc` (placeholders now: `wrangler.jsonc:36,51`).
3. **No production config** — `BASE_URL` points at localhost, no custom-domain route, and
   `logpush: true` will fail on a free-plan account (Workers Paid feature).
4. **Deploy job gaps** — `deploy-production` (ci.yml:174) applies migrations + deploys but never
   pushes Worker secrets, never seeds system data, never bootstraps the first admin.
   `scripts/bootstrap-admin.ts` (secure first-admin provisioning, C1) exists but nothing invokes it
   remotely.
5. **Preview env latent bugs** (fix in passing): preview KV id is never injected by the per-PR sed
   (ci.yml:106 only replaces the D1 placeholder), and preview `BASE_URL`
   (`https://remill-preview.workers.dev`) is a wrong guess — `resolveBaseUrl` falls back to request
   origin cleanly if the var is simply absent (`src/lib/base-url.ts`).

## Phase 1 — Link the account (Chrome, driven by me) — **DONE**

Using claude-in-chrome against Colin's logged-in dashboard:

1. Grab the **Account ID** (Workers & Pages overview sidebar).
2. **Register the workers.dev subdomain** if unset (one click; PR previews need it).
3. **Check R2 enablement** — new accounts must click through R2 pricing (requires a payment method
   on file). If a card needs entering, Colin does that step himself; I pause and resume after.
4. **Create a custom API token** scoped exactly:
   - Account / Workers Scripts / **Edit**
   - Account / D1 / **Edit**
   - Account / Workers KV Storage / **Edit**
   - Account / Workers R2 Storage / **Edit**
   - Account / Account Settings / **Read**
   - Zone / Workers Routes / **Edit** — zone `remill.org`
   - Zone / DNS / **Edit** — zone `remill.org`
   - Zone / Zone / **Read** — zone `remill.org`
5. Set GitHub repo secrets via `gh secret set` (repo `trickycdm/remill`):
   - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (from the dashboard)
   - `SESSION_SECRET` — I generate (`openssl rand -hex 32`)
   - `ADMIN_BOOTSTRAP_PASSWORD` — I generate strong; masked in Action logs; reported to Colin once
     at the end (change after first login)
   - `RESEND_API_KEY` — **deferred** (email falls back to the console stub). Follow-up: create a
     fresh key at Resend (the old dev key should be rotated anyway), verify remill.org there, set
     the secret, re-run the secret-push step.

## Phase 2 — Repo changes (committed to main; CI/config only) — **DONE** (via PRs #1–#2, not direct pushes)

**New `.github/workflows/setup-production.yml`** — `workflow_dispatch` with input
`phase: provision | finalize` (+ `admin_email`, operator-supplied):

- **provision**: idempotently create D1 `remill`, KV `remill-rate-limit` + `remill-rate-limit-preview`,
  R2 `remill-media` + `remill-media-preview`; print all resulting IDs (`wrangler d1 info remill --json`,
  `wrangler kv namespace list`) so I can read them from the run log.
- **finalize** (after real IDs are committed): migrations (`wrangler d1 migrations apply remill
  --remote`, 0000–0011) → seed system data (`wrangler d1 execute remill --remote --file
  src/db/seed.sql` — credential-free by design) → `bun run deploy` (attaches the remill.org custom
  domain) → `wrangler secret bulk` (SESSION_SECRET; RESEND_API_KEY only if the secret exists) →
  first-admin bootstrap (`bun run db:bootstrap:remote`, env from secrets/input; idempotent
  INSERT OR IGNORE) → smoke check `curl -sf https://remill.org/`.

**`wrangler.jsonc`** (top level = production, matching the existing deploy job):
- Real D1 + KV IDs (from provision run).
- `vars.BASE_URL` → `https://remill.org`.
- Add `"routes": [{ "pattern": "remill.org", "custom_domain": true }]` and `"workers_dev": false`
  (apex only, per Colin; no duplicate serving on workers.dev).
- **Remove `logpush: true`** (Workers-Paid-only; would fail the first deploy — the `observability`
  block already gives full invocation logs). Re-add if/when the account upgrades.
- `env.preview`: real preview KV id; drop the wrong `BASE_URL` (request-origin fallback is correct
  for per-PR hosts).

**`.github/workflows/ci.yml`** — add a "push Worker secrets" step to `deploy-production` (mirrors
the preview job's `wrangler secret bulk`, ci.yml:142) so future rotations flow through normal tag
deploys.

**`.dev.vars`** (local, gitignored) — add `BASE_URL=http://127.0.0.1:3100` so local dev links keep
working once the committed var points at production.

## Phase 3 — Provision run — **DONE** (ran twice: second run recreated D1 in WEUR)

`gh workflow run setup-production.yml -f phase=provision` → `gh run watch` → read the IDs from the
log → commit them into `wrangler.jsonc` (IDs are not secrets; hardcoding is standard wrangler
practice and matches the file's own TODO comments).

## Phase 4 — Finalize run (first deploy) — **DONE** (third attempt green; see Revision Log)

`gh workflow run setup-production.yml -f phase=finalize` → watch logs. Expected result: Worker
`remill` live, custom domain `remill.org` attached, D1 migrated + seeded, secrets set, admin
bootstrapped, smoke check green.

## Phase 5 — Verify end-to-end — **DONE** (login verified via live POST instead of browser — credential-entry stays with Colin)

- `curl` https://remill.org/ (homepage 200), `/rss.xml`, `/robots.txt`, `/sitemap.xml` (discovery pack).
- Via Chrome: load `https://remill.org/admin` → log in with the bootstrapped admin → dashboard
  renders. Then Colin changes the password (I'll remind with the credentials, shown once).
- Check the dash (Chrome) that both cron triggers registered (`* * * * *`, `0 3 * * *`).
- Report: what's live, the admin credential handoff, and the Resend follow-up.

## Contingencies

- **R2 not enabled / needs card** → Colin clicks through billing; provision re-runs cleanly (idempotent).
- **Custom-domain attach 403** → token is missing a zone permission; I fix the token scope in the
  dash (Chrome) and re-run finalize.
- **Free-plan friction** (logpush already removed; per-minute cron is allowed on free) → if anything
  else trips a paid-plan wall, surface it and let Colin decide on Workers Paid ($5/mo).
- Future releases stay tag-driven: push a `v*` tag → migrations + deploy + secret push.

## Verification

Phase 5 *is* the verification: live URL checks (public pages + discovery endpoints), a real admin
login through the browser, cron registration confirmed in the dash, and the Actions run logs for
migrations/seed/bootstrap. Local `bun run dev` still works afterwards (BASE_URL override in
`.dev.vars`); `bun run type-check` guards the config edits (wrangler.jsonc is schema-checked on
deploy).

## Revision Log

- 2026-07-09: Direct pushes to main were classifier-blocked → all repo changes went through
  PRs (#1–#6) with per-merge (then session-scoped) user authorization.
- 2026-07-09: The unhinted `d1 create` from a US GitHub runner pinned the database to WNAM →
  added a guarded, opt-in provision step (refuses if any user tables exist) and recreated in
  WEUR with `--location weur`. New id `6baea339-…` committed (PR #3).
- 2026-07-09: First finalize failed its own placeholder guard — env.preview's D1 placeholder is
  by design (per-PR sed) → guard narrowed to the top-level (production) section only (PR #4).
- 2026-07-09: Second finalize deployed the Worker + domain but the cron schedules PUT failed →
  root cause: four zombie preview Workers (cleanup raced in-flight preview deploys; `|| echo`
  swallowed the "does not exist" miss) held 8 cron triggers against the free plan's
  5-per-account cap. Fixed: race-aware retrying teardown + `workflow_dispatch` manual mode,
  and previews get an explicit empty cron list (PR #5).
- 2026-07-09: remill-pr-5's preview deploy **inherited production's `routes`** and stole the
  remill.org custom domain (`routes` is an inheritable wrangler key) → env.preview now carries
  an explicit `"routes": []` (PR #6). Teardown of pr-5 + third finalize re-attached the domain;
  everything green.
