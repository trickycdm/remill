# Sharing fabric v2: teams, agent share links, Resend email, HTML pages

> **STATUS: COMPLETE (2026-07-06).** All four tracks shipped on `feature/sharing-fabric-v2`
> (Phase 0 → Track 4 + docs: commits `958d7d2…9cef5ae` + this finalization; worklog.md has the
> step record).
> Verified: 0 type / 0 lint / **244 unit** / **36/36 e2e ×2 on fresh D1** / build clean, plus a
> live MCP round trip against the built preview (agent token → `create_posts` → `publish_posts` →
> `share_link_posts` with the 2036 expiry clamped to 30d → anonymous GET of the `/s/` URL renders
> the page) and a read-only Resend API check (key valid; **colmack.com verified, sending
> enabled**). Outstanding: ROTATE the Resend key (it transited chat); merge to main on request.

## Context

The MCP end-to-end validation (2026-07-06, post-roadmap merge `79838cb`) confirmed the publish
pipeline works agent-first, but "share it with Stu" falls short four ways. This plan closes all
four gaps so the target prompt — *"Create an overview document of the architecture research on
remill, share it with the tech team"* — works entirely from a Claude session over MCP:

1. **Teams/groups** — no way to group people. Add teams, team-join invite links, "share with the
   tech team" grants, and a "Shared with me" surface.
2. **Agent share-link capability** — agents can't mint anonymous `/s/:token` links
   (`createShareLink` refuses agents; no MCP tool). Make it an explicitly grantable/removable
   capability — never default.
3. **Real email** — `EmailTransport` is a console stub. Wire Resend + styled HTML templates.
   Realizes decision D20 (Resend explicitly anticipated).
4. **HTML pages** — markdown can't express charts/graphs. Add a trusted raw-`html` field type and
   full-page rendering.

## User decisions (2026-07-06)

- **HTML render:** BOTH — `html` field renders inline in the branded shell (like markdown), plus
  per-collection `renderMode: 'raw'` for full standalone pages.
- **Charts/CSP:** keep CSP strict; vendor Chart.js locally under `/vendor/`; add a main-settings
  toggle to allow CDN script hosts on public routes only, default OFF, with warning copy.
- **Email From:** `bot@colmack.com` for now — controllable in admin settings
  (`settings.emailFrom` > `env.EMAIL_FROM`).
- **Team invite links:** role picker at link creation, defaulting to `reader`.

**Secret handling:** the Resend API key was pasted into chat — it goes ONLY into `.dev.vars`
(gitignored) locally / `wrangler secret put RESEND_API_KEY` for prod, is NEVER committed or
written into this plan, and should be **rotated after wiring**.

## Ordering

**Phase 0 (shared plumbing) → Track 1 (teams) → Track 2 (share_link) → Track 3 (Resend) →
Track 4 (HTML pages).** One migration (0006) carries all structural DB change. Track 1's
join-link email ships against the existing stub with an inline body; Track 3 swaps all three
email call sites to styled templates. Track 2's `BASE_URL` threading (Phase 0 helper) is shared
with Track 1's join links and Track 3's email links.

---

## Phase 0 — Schema, migration 0006, shared helpers

- **`src/db/schema.ts`** — three new tables mirroring existing shapes (`roles`/`principal_roles`
  at :205-243, `invite_tokens` at :268-285):
  - `teams` (`tem_` id, name, description, createdAt)
  - `team_members` (`tmm_` id, teamId FK cascade, principalId FK cascade, addedBy, createdAt;
    unique (teamId, principalId); index on principalId)
  - `team_invites` (`tin_` id, teamId FK cascade, tokenHash unique, role FK→roles.slug default
    'reader', maxUses nullable, useCount default 0, **expiresAt NOT NULL**, revokedAt, createdBy,
    createdAt) — **dedicated table, not widened `invite_tokens`**: those are principal-bound
    (`principalId NOT NULL` — invitee exists first) and single-use (`consumedAt`); a join link's
    principal doesn't exist yet and it's multi-use. Same hash-at-rest/plaintext-once discipline.
  - `collections` gains `renderMode: text('render_mode')` nullable (Track 4).
- **`src/lib/id.ts`** — prefixes `team: 'tem'`, `teamMember: 'tmm'`, `teamInvite: 'tin'`.
- `bun run db:generate` → 0006; hand-add per DATABASE_STANDARDS: `CHECK (max_uses IS NULL OR
  max_uses > 0)`, `CHECK (use_count >= 0)`, and `CHECK (render_mode IN ('shell','raw'))` on the
  ADD COLUMN.
- **New `src/lib/base-url.ts`** — `resolveBaseUrl(env, settings, reqUrl?)`: precedence
  `env.BASE_URL > settings.siteUrl > new URL(reqUrl).origin`. Pure; unit test. Consumed by team
  join links, the MCP share-link tool (no request Context there), and email bodies.

## Track 1 — Teams

1. **Queries — new `src/db/queries/teams.ts`** (only Drizzle importer for the 3 tables):
   `createTeam/listTeams/getTeam/deleteTeam`, `addTeamMember` (onConflictDoNothing) /
   `removeTeamMember` / `listTeamMembers` (joins principals), **`getPrincipalTeamIds`**,
   `createTeamInviteRow` / `findValidTeamInviteByHash` (valid = not revoked, not expired,
   under maxUses; null otherwise — no oracle) / `incrementTeamInviteUse` / `listTeamInvites` /
   `revokeTeamInvite`.
2. **Grants fabric** — `src/db/queries/grants.ts`: `GrantSubjectKind` (:14) gains `'team'`
   (TS-only; no DB CHECK exists); `subjectMatchFor` (:42-50) gains a fourth OR branch
   `subjectKind='team' AND subjectId IN teamIds`; `getApplicableGrants` + `getGrantedDocumentIds`
   gain trailing `teamIds?: string[]`. **`src/access/authorize.ts`**: in `authorize()` (~:107-116)
   and `compileReadFilter()` (~:173-176), resolve `Promise.all([getPrincipalRoleSlugs,
   getPrincipalTeamIds])` and pass teamIds through. **`decide()` untouched** — teams are subject
   resolution, not decision logic; list views pick up team-shared docs via readableIds for free.
3. **Service — `src/services/access/index.ts`**: team CRUD + membership + `createTeamInvite`
   (role preset validated, must exist and !== 'anonymous'; expiresAt required, clamp ≤90d;
   plaintext token returned once) — all mutations `refuseAgentEscalation` +
   `authorize('manage_access', ROOT)` (the `createUser` pattern at :306-340).
   `acceptTeamInvite(db, token, {name,email,password}, now)` — un-gated (token IS the
   credential, `services/invites` precedent): validate → **existing email ⇒ ConflictError**
   (never silently attach an existing principal) → create principal → `roleQ.assignRole` (query
   fn — no acting principal) → `addTeamMember` → `incrementTeamInviteUse`.
   `grantItem` input union (:151) widens to `'principal' | 'role' | 'team'`.
   `listSharedWithMe(db, principal, now)` — un-gated identity-scoped read backed by
   `getGrantedDocumentIds` + a small doc-title batch query.
4. **Routes/UI** (run `bun run routes` after):
   - `src/routes/admin/access/teams/index.tsx` — pattern `roles/index.tsx`: create form + team
     cards (members with remove badges + assign select — `PrincipalCard` pattern; invite list
     with uses/expiry/revoke; invite-create form: role select default reader, expiry default
     +14d, optional maxUses/email). On create, show join URL **once**
     (`users.tsx:50-67` pattern) built via `resolveBaseUrl`; optional email via transport.
   - `src/routes/auth/join/[token].tsx` — pattern `set-password/[token].tsx`: GET one
     indistinguishable invalid page or AuthShell form (name/email/password/confirm); POST →
     `acceptTeamInvite` → `dsRedirect('/admin/login')`. Same SEC-2 rate-limit treatment as login.
   - `src/routes/admin/shared/index.tsx` — dedicated "Shared with me" page (audience = any
     authenticated member incl. readers), table of `listSharedWithMe` linking to
     `/admin/c/:collection/:id/view`. Nav link in `admin-shell.tsx`.
   - Share panel (`share-panel.tsx`): third optgroup `team:<id>` (+ `teams` prop from edit view);
     badge tone + team-name map. Share route (`share.tsx:93-103`): three-way subject decode.
     Matrix (`matrix/index.tsx:107-148`): team-name resolution + badge (ACCESS_CONTROL rule:
     every grant kind appears in the matrix).
5. **MCP** — `src/mcp/tools.ts:179`: `share_<slug>` subjectKind enum → `['principal','role','team']`;
   three-way mapping at :190.
6. **Tests** — access.test.ts: team CRUD agent-refused (SEC-8 pattern :114-125); team grant ⇒
   member allowed/non-member denied/expired excluded; compileReadFilter includes team docs;
   acceptTeamInvite happy/expired/revoked/maxed/duplicate-email. mcp.test.ts: team share grant.
   New `e2e/teams.spec.ts`: create team → share to team → member sees `/admin/shared`; join link
   register flow; maxUses exhaustion.

## Track 2 — Agent share-link capability

1. **Vocabulary (change together — drift trap):** `src/access/types.ts:8-16` ACTIONS +
   `src/access/policy.ts:23-31` ALL_ACTIONS + editor list (:44) gain `'share_link'`;
   `src/db/seed.sql` gains `rlp_admin_sharelink` + `rlp_editor_sharelink` rows.
   **Existing installs: idempotent re-seed** (seed is INSERT OR IGNORE; document `bun run
   db:seed` / `db:seed:remote` post-deploy in DEPLOY_CHECKLIST) — migration 0006 stays structural.
   **New drift-guard test** in `src/db/seed.test.ts`: every `SYSTEM_ROLES` permission has a
   matching seed.sql row.
2. **Re-gate `createShareLink`** (`access/index.ts:200-201`): drop `refuseAgentEscalation`;
   gate becomes `authorize('share_link', {collection, documentId})`. Humans keep working
   (admin/editor hold share_link). Emergent: a human can item-grant `share_link` on ONE document
   to an agent via the Share panel. `assignRole`/`issueToken`/`createUser`/`createAgent` keep
   refuseAgentEscalation — the manage_access non-negotiable is untouched.
3. **Thread baseUrl into MCP**: `src/routes/mcp.tsx` computes
   `resolveBaseUrl(c.env, await getSettings(db), c.req.url)` → `handleMcp(..., baseUrl)` →
   `buildToolsForPrincipal(db, principal, now, baseUrl)` (`handler.ts` both call sites).
4. **New MCP tool `share_link_<slug>`** (after the `share_<slug>` stanza, ~tools.ts:201): gated
   `couldDo(perms, principal, 'share_link', slug, false)`; input `{id, expiresAt}` both
   REQUIRED; expiry parsed + clamped to **30 days** (`SHARE_LINK_MAX_TTL_MS`, MCP surface only);
   calls `createShareLink` with hardcoded `actions:['read']`; returns
   `{grantId, url: `${baseUrl}/s/${token}`, expiresAt}` (effective, possibly clamped).
5. **Tests** — access.test.ts: agent with share_link role succeeds / without refused / audit row
   `mcp|share_link|allow`; item-grant path works. mcp.test.ts: tool visible iff share_link held
   (also add the missing `share_<slug>` visibility case); URL uses threaded base; bad expiry
   errors; clamp verified; minted link resolves via `resolveShareLink` + `getSharedDocument`.
6. **Decision-log entry D26** (closed-vocabulary extension is required to have one).

## Track 3 — Resend email + styled templates

1. **Env**: `src/types.ts` Env gains `RESEND_API_KEY?` (secret) + `EMAIL_FROM?` (var);
   `.dev.vars.tpl` documents both (never commit; rotate the in-chat key); `wrangler.jsonc`
   comment: `wrangler secret put RESEND_API_KEY`.
2. **Settings**: seed `fields_json` gains `emailFrom` (text) — and `allowCdnScripts` (boolean,
   Track 4) — via **guarded idempotent backfill** (`UPDATE ... json_insert ... WHERE fields_json
   NOT LIKE '%"emailFrom"%'`; INSERT OR IGNORE won't touch existing rows). `SiteSettings` in
   `src/services/settings/index.ts` gains `emailFrom?: string`, `allowCdnScripts?: boolean`.
3. **Transport** (`src/lib/email/index.ts`): `EmailTransport` gains `readonly kind:
   'console'|'resend'`. `ResendEmailTransport(apiKey, from)`: `fetch POST
   https://api.resend.com/emails` (Bearer; `{from, to:[to], subject, html, text?}`); non-2xx
   **logs status only and does not throw** (links are always also shown on-screen).
   `getEmailTransport(env?, settings?)`: from = `settings.emailFrom ?? env.EMAIL_FROM`; Resend
   iff key AND from present, else console stub (tests unaffected — no key set).
4. **Templates** — new `src/lib/email/templates.ts`: **typed string builders** (no JSX/
   renderToString — new pattern for zero gain in table-and-inline-style land). Private
   `escapeHtml` for ALL interpolations; shared `emailLayout` echoing light-mode brand tokens
   (canvas `#f2efe7`, card white, ink `#1c1a16`, serif masthead, accent `#4b44a3` CTA button).
   Builders returning `{subject, html, text}`: `shareNotificationEmail`, `inviteEmail`,
   `teamJoinEmail`.
5. **Callers**: `share.tsx:52-58` + `users.tsx:43-48` + the teams route switch to templates +
   `getEmailTransport(c.env, settings)`; stub-disclaimer copy (share.tsx:76-79, users.tsx:57-59,
   share-panel.tsx:128) branches on `transport.kind`. Links built via `resolveBaseUrl`.
6. **Tests** — new `src/lib/email/email.test.ts` (stub global fetch: URL/Bearer/payload; fallback
   without key; settings>env precedence; non-2xx doesn't throw) + `templates.test.ts` (escaping,
   links present in html+text).

## Track 4 — HTML pages

1. **`src/fields/html.tsx`** (mirror `markdown.tsx`): config `{maxLength?}`; value bounded
   (default 1,000,000 chars, SEC-4); `toIndex` = tag-stripped 200-char lead-in; Edit = mono
   Textarea rows=20; Cell = stripped 80-char slice; **ViewComponent renders verbatim via
   `dangerouslySetInnerHTML` into `<div class="rm-html">`** — the second sanctioned XSS
   exception (D25). Loud header comment: trust = collection-level write permission ONLY
   (FieldAccess reserved in v1); field auto-surfaces as a writable string on REST/MCP by design.
   Register in `src/fields/registry.ts:21-35`; round-trip test.
2. **`src/components/document-view.tsx:51`**: bare-render special case extends to
   `field.type === 'html'`.
3. **`renderMode`**: `CollectionDefinition` (`src/fields/types.ts:47-62`) gains
   `renderMode?: 'shell' | 'raw'`; mapped in `src/db/queries/collections.ts`; validated in
   `src/services/collections/index.ts` — `'raw'` requires ≥1 html field; **first html field is
   the page body**; empty value ⇒ shell fallback (never a blank page). Public routes
   (`[collection]/[slug]/index.tsx:39`, `s/[token]/index.tsx:55`) branch after doc resolution:
   raw ⇒ `return c.html(page)` (bypasses RootLayout — `save-error.tsx` precedent; middleware
   headers still apply); JSON arm on `/s/:token` stays first. Collection builder gets a
   shell|raw select; MCP/REST accept it via definition passthrough.
4. **CSP split + toggle** — new `src/middleware/security-headers.ts`: move the main.tsx:28-52
   options; three static `secureHeaders` instances: `strict` (today), `publicStrict` (identical
   today), `publicCdn` (script-src += `https://cdn.jsdelivr.net`, `https://unpkg.com` — exact
   hosts). Dispatch: `PROTECTED_PREFIXES = ['/admin','/api','/mcp','/auth','/media']` ⇒ strict;
   else one `getSettings` PK read ⇒ `allowCdnScripts ? publicCdn : publicStrict`. Comment loudly:
   new top-level routes outside the prefixes get the PUBLIC policy. `main.tsx` becomes
   `app.use('*', securityHeaders())`. Settings toggle help copy: *"WARNING: lets published HTML
   pages load scripts from cdn.jsdelivr.net and unpkg.com. Weakens the public-page CSP — leave
   OFF unless a page needs an external library. Admin pages are unaffected."*
5. **Vendored Chart.js**: `bun add -d chart.js`; copy `dist/chart.umd.js` →
   `public/vendor/chart.umd.js` (commit; version noted in header/README — Datastar precedent).
   Authors: `<script src="/vendor/chart.umd.js">` + inline init — **works with toggle OFF**
   ('unsafe-inline' already present for Datastar).
6. **Tests** — registry round-trip; field-view raw render + markdown-still-sanitized;
   collections renderMode validation; new `src/middleware/security-headers.test.ts` (admin
   always strict; public strict/CDN by toggle; `/s/…` classified public). New
   `e2e/html-pages.spec.ts`: raw `pages` collection via admin → doc embedding vendored Chart.js
   → publish → `/pages/:slug` full-bleed, `window.Chart` defined, no masthead; CSP header delta
   with toggle on/off.

## Decision-log entries (docs/TECH_DECISIONS.md, after D23)

- **D24** — `'team'` grant subject kind + `teams`/`team_members`/`team_invites` (multi-use
  expiring join links); subject-resolution only, `decide()` untouched. Rejected: teams-as-roles;
  widening invite_tokens.
- **D25** — `html` field renders raw via dangerouslySetInnerHTML — second sanctioned XSS
  exception (scoped reversal of D3's no-HTML-blobs); trust = collection write perms. Rejected:
  server-side sanitizer (no DOM on Workers; would strip the charts that motivate the feature).
- **D26** — new closed-vocabulary action `share_link`; createShareLink re-gated from
  manage_access+refuseAgentEscalation to authorize('share_link'); 30d MCP expiry clamp. Agents
  still never hold manage_access. Rejected: principal flag; token-scope-only (can't confer).
- **D27** — per-collection `renderMode` + public-routes-only CSP fork with admin-settable CDN
  allowlist toggle (default off). Rejected: global CSP widening; per-document flags.
- **D20** — annotate as realized (Resend; settings.emailFrom > env.EMAIL_FROM; stub remains
  keyless/test default).

## Doc updates

`CLAUDE.md` map (teams/join/shared routes, templates, security-headers middleware, html field);
`ACCESS_CONTROL.md` (team subject kind, share_link action, refined escalation wording);
`SECURITY_STANDARDS.md` (§7 second exception + trust model; §8 CSP split/toggle);
`SCHEMA_ENGINE.md` (html field, renderMode); `API_AND_MCP_STANDARDS.md` (share_link_<slug>, team
subjectKind, baseUrl threading); `DEPLOY_CHECKLIST.md` (re-seed step, RESEND secret + rotation,
request-origin caveat for links).

## Risks / gotchas

1. **Seed/policy drift** — ACTIONS/ALL_ACTIONS/seed.sql are hand-mirrored; ship the drift-guard
   test in the same commit as the vocabulary change.
2. **Existing-DB backfill** — two mechanisms: new role_permissions rows via idempotent re-seed;
   new settings FIELDS via guarded json_insert UPDATEs. Local devs run `bun run db:seed` once.
3. **CSP classifier** — prefix-based; future top-level routes silently get the public policy
   (loud comment). Raw-mode responses bypass RootLayout but NOT middleware (verify in test).
4. **Raw-mode edges** — empty html ⇒ shell fallback; multiple html fields ⇒ first wins
   (documented); JSON arm ordering on /s/:token; drafts still 404 via authorize before branching.
5. **authorize() query growth** — teams add one lookup per decision/compile; Promise.all with
   roleSlugs.
6. **Agent token exposure** — share-link plaintext URL enters agent context by design;
   mitigations: read-only actions, 30d clamp, matrix visibility, one-click revoke.
7. **Join safety** — ConflictError on existing email; indistinguishable invalid page for
   expired/revoked/maxed/unknown; SEC-2 rate limit on the join POST.
8. **e2e harness** — built preview on :3100, fresh D1, serial; unique slugs/emails per spec;
   login rate-limiter gotcha (E2E_TESTING.md); `bun run routes` or new routes 404.
9. **Resend** — from-address must be domain-verified or sends 403 (logged, non-fatal); never hit
   real network in tests; **rotate the key after wiring**.

## Verification

```bash
bun run type-check && bun run lint && bun run test:run   # unit incl. drift-guard, email, fields
bun run db:migrate && bun run db:seed                    # 0006 + settings-field backfill
bun run e2e                                              # teams.spec, html-pages.spec + suite
```

Manual/MCP end-to-end (the point of the whole plan):
1. **Teams**: create "tech team" → add member → share doc to `team:<id>` → member sees it at
   `/admin/shared` + in list views; matrix shows the grant. Join link (reader, 14d, 5 uses) →
   incognito register → member; exhaust maxUses → invalid page.
2. **Agent share link**: agent token WITHOUT share_link → `tools/list` lacks `share_link_<slug>`;
   grant role with share_link → tool appears; `create_<slug>` → `share_link_<slug>` →
   `{grantId, url, expiresAt}`; open url logged-out → renders; revoke in panel → 404; audit shows
   `mcp / share_link / allow`.
3. **Email**: no key → stub log + stub UI copy; key + `emailFrom=bot@colmack.com` in settings →
   share-by-email lands in a real inbox, styled template, correct links.
4. **HTML pages**: MCP `create_collection` (html field, renderMode raw, publicRead) →
   `create_<slug>` with Chart.js markup → publish → `/pages/<slug>` full-bleed with working
   chart (toggle OFF, vendored lib); `curl -I` CSP differs admin vs public and with toggle
   on/off.
5. Rotate the Resend key; update `.dev.vars`.
