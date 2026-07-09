# Remove the site-wide KV rate limiter (conserve free-tier write budget)

## Context

Cloudflare emailed that the account hit 50% of the daily Workers KV **write** limit (free tier = 1,000 writes/day). Root cause: `src/main.tsx:37` applies the global rate limiter to **every** request:

```ts
app.use('*', rateLimit('global', GLOBAL_RATE_LIMIT));
```

The limiter does **1 KV read + 1 KV write per request** (`src/middleware/rate-limit.ts:76,88`). Static assets are served asset-first and skip the Worker, but every dynamic hit (pages, `/rss.xml`, `/sitemap.xml`, `/robots.txt`, `/api/*`, `/mcp`) writes to KV. With only 1,000 writes/day, the site trips the limit after ~1,000 dynamic requests — and the discovery pack we just shipped means crawlers on the new sitemap/RSS can generate that alone. So it is structural, not a one-time setup spike.

**Decision (user-chosen option 1):** remove the site-wide global limiter; keep the tight per-endpoint limiters (login, token, upload, import, join) which are low-volume and cover the genuinely abuse-prone paths. Cloudflare's edge DDoS + zone WAF is the volumetric backstop. Cost: $0. This removes the per-request `kv.put`, cutting the KV write rate to near-zero under normal read traffic.

The exploration confirmed the change is contained and **no tests break** (they rely on per-endpoint limiters and the header-fallback constant, not the global middleware).

## Changes

### 1. `src/main.tsx` — remove the global limiter
- Delete lines 36-37 (the `// Soft site-wide rate limit` comment + `app.use('*', rateLimit('global', GLOBAL_RATE_LIMIT));`).
- Delete the now-unused import on line 7 (`rateLimit` and `GLOBAL_RATE_LIMIT` are both unused in main.tsx after this).

### 2. Keep the header fallback (no behavior change to the API contract)
- **Keep** `GLOBAL_RATE_LIMIT` (`src/middleware/rate-limit.ts:31`) and the `apiJson` fallback (`src/lib/api.ts:112-113`). The `X-RateLimit-*` headers stay present; read endpoints without their own limiter now report the nominal `1000` (they already did in tests, via the `?? GLOBAL_RATE_LIMIT.limit` fallback). This matches the documented v1 posture (`steering/API_AND_MCP_STANDARDS.md:125` — "headers stubbed in v1, present, not enforced"). Endpoints with their own limiter (import, media upload) still report real decrementing counts.
- **Do not rename** `GLOBAL_RATE_LIMIT` — it stays as the nominal header default. Renaming would churn `api.ts` + tests for no functional gain (KISS).

### 3. Reword three comments for accuracy (the global tier no longer runs)
- `src/middleware/rate-limit.ts:27-30` — the "Tiers" doc-comment currently calls the global tier "a soft site-wide guard." Reword: it is the nominal default used only for the `X-RateLimit-*` header fallback, not an enforced tier.
- `src/lib/api.ts:104-109` — the `apiJson` doc-comment says the limiter "did not run (e.g. the KV binding is absent in tests)." Reword to "if no per-endpoint limiter ran, fall back to the nominal global tier."
- `src/types.ts` (RATE_LIMIT binding comment) — note the KV now backs only the per-endpoint limiters, not a per-request global counter. (Low priority; include for accuracy.)

### 4. Docs
- `docs/TECH_DECISIONS.md` — add **D40**: "Removed the in-app site-wide global rate limiter to conserve the Cloudflare free-tier 1,000-writes/day KV budget (it did a `kv.put` per dynamic request). Per-endpoint limiters (login/token/upload/import/join) retained; `GLOBAL_RATE_LIMIT` kept only as the `X-RateLimit-*` header-fallback tier; Cloudflare edge DDoS + zone WAF is the volumetric backstop." (D39 is the current last entry.)
- `steering/SECURITY_STANDARDS.md` §8 (rate-limit bullet, ~line 186) — the prose already scopes rate-limiting to per-endpoint limiters and claims no global cap, so it stays accurate. Add one clause: there is intentionally **no in-app site-wide tier** (KV-write cost on the free plan); rely on Cloudflare edge/WAF for volumetric abuse.

## What this does NOT change
- Per-endpoint limiters (login 10/min, token 20/min, upload 30/min, import 10/min, join 10/min) — unchanged; still KV-backed via `consumeRateLimit`.
- The `X-RateLimit-*` response headers — still emitted (nominal fallback).
- No migrations, no route files added → no `bun run routes` regen diff.

## Verification
```bash
bun run type-check && bun run lint && bun run test:run
```
- `src/middleware/security.test.ts` — all 6 pass unchanged (SEC-2 login-limiter 429 test uses the login tier; the "apiJson stamps X-RateLimit … falls back to the global tier without KV" test uses the retained fallback constant).
- `src/routes/api/api.test.ts:121` — `X-RateLimit-Limit == '1000'` still holds (fallback constant unchanged).
- Grep confirms no code writes the `rl:global:*` KV keys anymore: `grep -rn "'global'" src/` should return nothing rate-limit-related.
- Local sanity: `bun run dev`, then confirm a `GET /` and `GET /api/collections` succeed and — since neither route carries a per-endpoint limiter — no KV write path is invoked (the only `kv.put` calls now sit behind login/token/upload/import/join POST handlers).
- Optional: `bun run e2e` (unaffected — e2e per-file IP headers target the login limiter, which stays; removing the global tier only loosens ceilings).

## Release
Merge to `main`, then cut **`v1.0.1`** (tag-driven deploy per docs/DEPLOYMENT.md → migrate no-op + `bun run deploy`). This is the fix's whole point — it stops the KV write bleed in production — so deploy promptly after merge. Verify post-deploy that remill.org still serves 200s (a handful of curls); KV write volume should fall off over the following day.

## Optional follow-up (ops, not code; out of scope here)
If a belt-and-braces global cap is still wanted without KV cost, add a **Cloudflare native Rate Limiting rule** in the zone dashboard/WAF (no code, no KV). Noted for later; not part of this change. CF access is Actions-only per the account boundary, so this would be a manual dashboard step.
