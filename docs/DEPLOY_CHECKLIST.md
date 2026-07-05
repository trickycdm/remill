# Deploy Checklist

> **Status: LOCAL-ONLY.** remill has never been deployed. This is the running list of everything that
> must be done for a first (and subsequent) production deploy. Add to it whenever a change introduces a
> deploy-time step. Keep items actionable and grouped.

## First-deploy prerequisites (Cloudflare resources)

- [ ] **D1 database** — `wrangler d1 create remill`, then paste the real `database_id` into
      `wrangler.jsonc` (both the main binding and the `preview` env). Currently a placeholder.
- [ ] **R2 bucket** — create the `MEDIA` bucket (`wrangler r2 bucket create …`) and confirm the binding.
- [ ] **KV namespace for rate limiting (SEC-2)** — `wrangler kv namespace create RATE_LIMIT`, paste the
      returned id into `wrangler.jsonc` (main + `preview`). Currently a placeholder `0000…`. Without a
      real namespace the limiter no-ops (fails open).
- [ ] **`SESSION_SECRET`** — set as a Worker secret (`wrangler secret put SESSION_SECRET`), ≥32 chars,
      generated with `openssl rand -hex 32`. Not in `wrangler.jsonc`; read at runtime by the session
      middleware.

## Database migration + seed

- [ ] **Apply migrations remotely** — `bun run db:migrate:remote`. Includes `0003` (DB-backed `unique`
      enforcement: `unique_key` column + partial unique indexes), `0004` (`principals.subtype` persona
      column + backfill), and `0005` (`invite_tokens` — single-use, expiring set-password links).
- [ ] **Seed system data** — `bun run db:seed:remote` (roles/permissions + protected `settings`/`media`
      collections). Contains NO credentials (safe for prod, C1).
- [ ] **Bootstrap the first admin (C1)** — out of band, NOT via the seed:
      `ADMIN_BOOTSTRAP_EMAIL=you@site.com ADMIN_BOOTSTRAP_PASSWORD='…≥16 chars…' bun run db:bootstrap:remote`
      (omit the password to auto-generate + print one once). The script refuses weak/known passwords
      against `--remote`. Force a password change on first login.
- [ ] **Re-apply the expanded `settings` singleton on an ALREADY-seeded DB (Phase 4)** — `seed.sql` uses
      `INSERT OR IGNORE`, so a DB seeded before the settings expansion keeps its old 3-field, unlabeled
      `settings` definition; a plain re-run will NOT update it. To pick up the new fields/labels
      (`siteUrl`, `timezone`, `dateFormat`, `defaultPageSize`, `logo` + labels), run a one-off UPDATE with
      the current `fields_json` from `src/db/seed.sql`:
      `wrangler d1 execute remill --remote --command "UPDATE collections SET fields_json='…' WHERE slug='settings';"`
      (or, on a throwaway DB, re-seed). No migration is involved — settings are schema-as-data, and the
      account surface reuses existing `users`/`principals` columns. Existing saved settings documents are
      unaffected; unset new fields simply read as their defaults.

## Security posture to confirm before go-live

- [ ] **CSP includes `script-src 'unsafe-eval'`** — required because Datastar v1 compiles `data-*`
      expressions via the `Function` constructor (documented in SECURITY_STANDARDS §8). Confirm the
      deployed CSP still allows the admin to function; tighten other directives if possible.
- [ ] **Rate-limit tiers** (login 10 / token 20 / upload 30 / global 1000 per 60s, keyed on
      `CF-Connecting-IP`) — confirm they suit real traffic. Note: behind Cloudflare `CF-Connecting-IP`
      is always set; direct-to-origin requests fall back to a shared `local` bucket, so ensure the
      origin isn't publicly reachable outside Cloudflare.
- [ ] **Media serving** — `/media` responses set `nosniff` + `Content-Disposition: inline` and are
      cross-origin-embeddable (publicRead). Confirm this is the intended exposure.

## Consumer-facing contract notes (for API/MCP clients)

- `GET /api/collections[/:slug]` and MCP `list_collections` return a **public-safe projection** (no
  `access`/`workflow`) for callers without `manage_schema`. Authenticated schema managers see the full
  definition.
- MCP `list_media` uses `cursor`/`pageSize` (+ `nextCursor`), not `page`.
- Document listing supports opt-in `cursor`/`nextCursor` pagination; `offset` remains for compatibility.

## Housekeeping (not blocking, but do it)

- [ ] Activate `.claude/settings.json` by renaming `.claude/settings.json.example` (Phase 0 allowlist;
      user's call — grants Bash permissions).
- [ ] Decide whether `bun run deploy` should run `db:migrate:remote` first (currently just builds +
      `wrangler deploy`).

---
_Last updated: 2026-07-05 (after the 29-finding review remediation)._
