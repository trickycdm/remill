# Worklog — visibility, link passwords, SEO head

| When | Action | Detail |
|---|---|---|
| 2026-09-23 | START | Build begun. Waves: (1) migration+types → (2) access/visibility ‖ SEO head → (3) share links → (4) docs |
| 2026-09-23 | DONE 1a/1b/2a | Migration 0015_handy_electro (documents/trash visibility + CHECK; item_grants password_hash, label); types + mapping + transfer + trash; 534 tests pass |
| 2026-09-23 | DONE 1c/1d/1e | decide()/compileReadFilter visibility split; setVisibility service; publicUrlOf doc_ URL for non-public; admin sidebar + list Stamp, REST + OpenAPI, MCP visibility_<slug> (gated publicRead ∧ could-publish); truth-table + every-list-surface tests; 580 pass |
| 2026-09-23 | DONE 1f/3a-3d | seo.ts buildDocumentHead + serializeJsonLd; PageHead/RootLayout rich tags; article/index/home routes wired; unlisted X-Robots-Tag; SEO pack fields; 580 pass |
| 2026-09-23 | RE-PLAN | SEO convention keys are snake_case (seo_title/meta_description/social_image) — schema engine KEY_RE rejects camelCase; plan edited in place. No locale setting → og:locale 'en'; no collection description or author convention → settings fallbacks |
| 2026-09-23 | DONE step 5 (docs) | TECH_DECISIONS D50–D52; ACCESS_CONTROL, SECURITY_STANDARDS (+media limitation, robots fix), API_AND_MCP, SCHEMA_ENGINE, DATABASE_STANDARDS; CLAUDE.md status; BACKLOG email + media gating |
| 2026-09-23 | DONE 2b–2f | share-unlock HMAC lib; openShareLink/unlockShareLink/listShareLinks/revokeShareLink; /s lock page + rate-limited POST; panel split (share_link vs manage_access), copy button, email decoupled; REST share-links + MCP password/label; robots /s/ allowed; layouts: description '' also suppresses og/twitter title; 611 unit pass, build ok |
| 2026-09-23 | DONE e2e | New e2e/visibility-and-share-links.spec.ts; updated admin-schema-access (panel heading), public-discovery (robots, og:title bare), platform-graph-publish (revoke locator); fix: listItemGrants excludes link grants (were duplicated in People & roles) |
| 2026-09-23 | FIX | Wrong-password POST re-render now 200 (login convention) — a 401 answering a POST broke the local dev relay (undici auth-retry); e2e wrong-password step restored |
| 2026-09-23 | VERIFIED | type-check, lint, 611 unit, build, e2e 83 passed / 1 pre-existing flaky (admin-content) on a fresh local D1 |
| 2026-09-23 | REVIEW | review.md: 4 HIGH, 14 MEDIUM, 9 LOW, 1 needs-decision, 5 deferred, 7 dropped (of 49 raw) |
| 2026-09-23 | FIX (review) | All 4 HIGH, 14 MEDIUM, 9 LOW fixed by two workers + orchestrator: cross-collection authorize check, emailShareLink gate+rate limit, expiresAt validate/clamp, SEO_FIELD_KEYS excluded from layout+search, raw-mode noindex, /s no-store before early returns, PageHead.bare, template layoutOptions for head, view.tsx publicUrlOf, no password trim, unlock cookie exp+prefix, canAuthorize probe, anonymous visibility, per-link unlock bucket, lib/visibility.ts single source, transfer/setVisibility fixes; 'review finding N' comments removed; docs drift fixed. Relation-link-to-unlisted left for decision |
| 2026-09-23 | VERIFIED | Post-fix: type-check, lint, 633 unit, build, e2e 83 passed / 1 flaky (admin-content) |
