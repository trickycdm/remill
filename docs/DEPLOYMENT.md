# Deployment — remill to production

> **Canonical runbook for the remill production environment.** All Cloudflare access (D1, R2, KV, Worker deployment) is mediated through GitHub Actions using repo secrets — no local `wrangler auth`. This documents the model live since 2026-07-09 (WEUR D1; on remill.org until 2026-07-31, now remill.me with the old domain 301-redirecting).

## Overview

Three workflows handle deployments:

- **`setup-production.yml`** — One-time account bootstrap (provision phase: create D1/KV/R2, print IDs for commit; finalize phase: migrate, seed, deploy, bootstrap admin, smoke-check). Idempotent; manually dispatched.
- **`ci.yml` deploy-production job** — Release path (tag `v*` → migrations → build + deploy → push secrets). Automatically triggered.
- **`ci.yml` preview job + `preview-cleanup.yml`** — Per-PR workers (one `remill-pr-<N>` per open PR, auto-deleted on PR close).

## Prerequisites

**Cloudflare account setup** (one-time, manual, in the Cloudflare dashboard):
- Register a `.workers.dev` subdomain (where PR previews live).
- Activate R2 ($0 due; requires a payment method on file).
- Have the production domain (e.g., `remill.me`) as an active zone on the same account.
- Create a custom API token with these scopes:
  - **Account**:
    - Workers Scripts: Edit
    - D1: Edit
    - Workers KV Storage: Edit
    - Workers R2 Storage: Edit
    - Account Settings: Read
  - **Zone** (production zone only):
    - Workers Routes: Edit
    - DNS: Edit
    - Zone: Read
  - **Account Resources**: The one account.
  - **Zone Resources**: The specific production zone only.

**Repository secrets** (GitHub Actions, set via `gh secret set` or dashboard):
- `CLOUDFLARE_API_TOKEN` — The custom token from above.
- `CLOUDFLARE_ACCOUNT_ID` — Account UUID (visible in Cloudflare dash or `wrangler whoami`).
- `SESSION_SECRET` — ≥32 random chars for encrypted cookies: `openssl rand -hex 32`.
- `ADMIN_BOOTSTRAP_PASSWORD` — ≥16 chars (or omit to auto-generate on first finalize; it will be printed once).
- `RESEND_API_KEY` — Optional; email falls back to console stub without it.

## First-time bootstrap

**Phase 1: Provision** (`setup-production.yml`, `phase=provision` input)

Creates Cloudflare resources and prints their IDs:

```bash
# Trigger in GitHub Actions (Actions > Setup production > Run workflow > provision)
# or via GitHub CLI:
gh workflow run setup-production.yml -F phase=provision
```

The job creates (or tolerates existing):
- **D1 database** (`remill`) in WEUR (UK-operated accounts need `--location weur` to avoid US placement).
- **KV namespaces** — `RATE_LIMIT` (prod), `RATE_LIMIT--preview` (for all PR previews).
- **R2 buckets** — `remill-media`, `remill-media-preview`.

Check the job log for output like:

```
=== D1 databases ===
[{ "name": "remill", "uuid": "6baea339-…", … }]
=== KV namespaces ===
… id: d560b68e… title: RATE_LIMIT …
… id: 1346fc2… title: preview-RATE_LIMIT …
=== R2 buckets ===
remill-media
remill-media-preview
```

Copy these IDs into `wrangler.jsonc`:
- Top-level `d1_databases[].database_id` ← D1 uuid.
- Top-level `kv_namespaces[].id` ← prod RATE_LIMIT id.
- `env.preview.kv_namespaces[].id` ← preview RATE_LIMIT id.
- (D1 for preview stays `00000000-0000-0000-0000-000000000000`; the preview job injects the real id per PR.)

Commit these changes to main.

**Phase 2: Finalize** (`setup-production.yml`, `phase=finalize` input)

```bash
gh workflow run setup-production.yml \
  -F phase=finalize \
  -F admin_email=your@domain.com
```

- Validates that top-level D1/KV/R2 IDs are not placeholders (production requires real IDs).
- Applies D1 migrations (0000–0011).
- Seeds system data (`src/db/seed.sql` — credential-free, safe for prod).
- Builds and deploys to remill.me (attaches the custom domain).
- Pushes Worker secrets (`SESSION_SECRET`, optionally `RESEND_API_KEY`).
- Bootstraps the first admin (`scripts/bootstrap-admin.ts`, idempotent, `INSERT OR IGNORE`).
  - If no `ADMIN_BOOTSTRAP_PASSWORD` secret is set, a strong password is generated and printed once — **save it immediately** and change it after first login.
- Smoke-checks `https://remill.me/robots.txt` (retries up to 10×; custom-domain DNS and cert can lag by a few minutes).

On success: remill.me is live.

## Releases (tag-driven)

Push a release tag from main:

```bash
git tag v0.1.0
git push origin v0.1.0
```

`ci.yml` deploy-production job triggers automatically:

1. Applies D1 migrations (`bunx wrangler d1 migrations apply remill --remote`).
2. Builds and deploys the Worker.
3. Re-pushes repo secrets (`SESSION_SECRET` + `RESEND_API_KEY` if set).

Any new or rotated secrets take effect on the next release. To rotate a secret immediately:

```bash
gh secret set RESEND_API_KEY
git tag v0.1.1
git push origin v0.1.1
```

## PR previews

Each PR automatically gets:
- A unique Worker named `remill-pr-<number>` on `workers.dev`.
- An isolated D1 database (created, migrated, seeded by the preview job).
- Separate R2 and KV namespaces (prefixed `-preview`).

`ci.yml` posts a preview URL comment on the PR. When the PR closes, `preview-cleanup.yml` tears down the Worker and D1.

Manual cleanup for missed/zombie previews:

```bash
gh workflow run preview-cleanup.yml -F pr_number=5
```

## Secret rotation

Rotate a secret and deploy the change:

```bash
# Update the secret in Actions settings
gh secret set NAME_OF_SECRET

# Trigger a release (creates a new version and re-pushes all secrets)
git tag v0.1.x
git push origin v0.1.x
```

(For production-critical secrets, coordinate with team members; `wrangler secret` changes don't roll back to prior versions — secrets are point-in-time updates to the live Worker.)

## Domain & BASE_URL

- **Top-level `wrangler.jsonc`** has `"workers_dev": false` and routes production to the remill.me custom domain apex only (no `workers.dev` subdomain).
- **`BASE_URL` var** (`vars.BASE_URL: "https://remill.me"`) is hardcoded to production; minted share/invite/email links use this origin.
- **Local dev** overrides `BASE_URL` via `.dev.vars` (gitignored): `BASE_URL=http://127.0.0.1:3100`.
- **PR previews** don't set `BASE_URL`; the Worker falls back to `request.url` origin, which is always correct (e.g., `https://remill-pr-5.workers.dev`).

If links are minting wrong origins: check `BASE_URL` in env vars and `settings.siteUrl` (admin Settings) — the resolution order is `env.BASE_URL` > `settings.siteUrl` > request origin.

## Email (Resend, D20)

The system can send email (invite links, password reset) if `RESEND_API_KEY` is configured.

**Enable email:**
1. Create a Resend account and API key (https://resend.com).
2. Add a verified sender domain in Resend (must be a domain you control; takes minutes).
3. Set the repo secret: `gh secret set RESEND_API_KEY`.
4. Trigger a release (push a tag) or re-run `setup-production` finalize.

**Configure the sender**:
- Default: `EMAIL_FROM` env var (not set by default, falls back to `noreply@localhost` in the console stub).
- Override: `settings.emailFrom` (admin Settings panel) — must be a Resend-verified sender.

Without `RESEND_API_KEY`, the console stub logs all emails; the product still shows links on-screen.

## Troubleshooting

**`wrangler d1 execute <name>` fails with "database not found"**

`d1 execute` resolves names through `wrangler.jsonc` first. If the config has a placeholder id (`00000000-…`), it breaks. Use `wrangler d1 list` (config-independent) or temporarily move `wrangler.jsonc` aside.

**PR preview claims remill.me (custom domain hijack)**

The top-level `wrangler.jsonc` sets `routes` (production custom domain). Without an explicit `routes: []` override in `env.preview`, subornate envs inherit the parent's routes — every PR preview would then claim remill.me. The fix is already in place (`env.preview` has `"routes": []`); confirm it's still there after any rebase.

**PR previews exhaust the free cron cap (5 per account)**

Production uses exactly 2 crons (per-minute scheduled-publish drain, daily 03:00 maintenance). The free plan caps total crons at 5 per account. Per-PR crons must be disabled (`env.preview` has `"triggers": { "crons": [] }`); without that, multiple previews starve production's schedules. Confirm this is set after any rebase.

**Preview D1 migrations hang or fail**

The per-PR preview job creates a D1 with a fresh name (`remill-pr-<N>`). If the creation fails silently, `wrangler d1 info` will fail or return an empty id. The job exits with an error; check the Actions log for the actual error (permission, quota, network). Manually delete a stuck preview: `gh workflow run preview-cleanup.yml -F pr_number=<N>`.

**`logpush` in wrangler.jsonc fails on deploy**

`logpush: true` requires Workers Paid plan. The config was removed for the free account (it was causing deploy failures). Re-add only after upgrading the account to Paid.

**Custom domain cert not issued; remill.me not yet reachable**

DNS and certificate issuance can take up to 5 minutes after the first deploy. The finalize job smoke-checks with retries (up to 10×, 30s apart, ~5 minutes total). If it times out, wait a bit and re-run finalize or trigger a test deploy. Check the Cloudflare dashboard (Workers > Custom Domains) to confirm the cert status.

**RESEND_API_KEY not taking effect**

Worker secrets are updated on deploy. If the key was added but emails still use the console stub:
1. Confirm the secret is set: `gh secret list | grep RESEND`.
2. Confirm a deploy happened after the secret was set (check Actions log).
3. Confirm `settings.emailFrom` is set in admin Settings to a Resend-verified sender.

## Current live state (as of 2026-07-09)

| Resource | Value |
|----------|-------|
| Origin | https://remill.me (apex, no www) |
| D1 id | `6baea339-ac8c-44da-8fb2-ac3ead5309a2` (WEUR) |
| KV RATE_LIMIT (prod) | `d560b68edc67494aa6f45862554e0237` |
| KV RATE_LIMIT (preview) | `1346fc21ef8d4fdca77f1c7c774a0bdd` |
| R2 media (prod) | `remill-media` |
| R2 media (preview) | `remill-media-preview` |
| Crons (production) | 2: per-minute (scheduled publish drain), daily 03:00 (maintenance) |
| `RESEND_API_KEY` | Not configured (console stub active) |

Set email: `gh secret set RESEND_API_KEY`, then push a tag or re-run setup-production finalize.
