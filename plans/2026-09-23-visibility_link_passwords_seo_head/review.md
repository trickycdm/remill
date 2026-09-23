# Review — visibility (D50), password share links (D51), SEO head (D52)

**Date:** 2026-09-23. **Reviewers:** code-reviewer, tech-debt-reviewer, security-reviewer (parallel), triaged by the orchestrator.
**Raw findings:** 49 across the three reports (≈15 duplicated between reviewers). **Dropped:** 7 (listed at the end). **Deferred:** 5 structural refactors.

**Verdict:** not mergeable as-is. 4 HIGH issues, all small fixes. No criticals. The core access change, `decide()` / `compileReadFilter`, was independently confirmed correct by all three reviewers.

## HIGH

1. **`authorize()` never checks that a document belongs to the collection in the URL.** Verified: `getDocumentMetaForAuth` looks documents up by ID only.
   - Exploit: a principal holding `share_link` on collection A can mint a link to a private or draft document in collection B, via `POST /api/c/A/<B-doc>/share-links` or `share_link_A`. The same trick lets it list and revoke B's links.
   - The gap already existed in `createShareLink` and `grantItem`; this round adds new entry points.
   - Fix: return the collection from the meta lookup and throw NotFound on mismatch in `authorize()`.
2. **`op=email_link` sends email for any logged-in user** (`share.tsx:132-175`).
   - It only requires login: no `authorize`, no rate limit, and a loose `startsWith` check on the URL.
   - It becomes a spam or phishing relay once Resend is configured.
   - Fix: a service that authorizes `share_link` on the document, a strict `/s/rms_…` URL pattern, and a rate limit.
3. **REST share-link `expiresAt` is not validated or capped.**
   - Steering requires the same rules as MCP: required, and clamped to 30 days.
   - Expiry is compared as a string, so a junk value (e.g. `"9999"`) makes a link that never expires.
   - Fix: parse and validate in `createShareLink`, clamp at the REST and MCP entry points, and echo back the normalized value.
4. **SEO fields render on the public page.**
   - `seo_title`, `meta_description` and `social_image` fall into the template's `meta` rows, so the SEO title shows on the article and the social image renders as an extra picture.
   - In the docs pack, the head's lead resolves to `seo_title`.
   - The pack tests assert this broken behaviour.
   - Fix: one `SEO_FIELD_KEYS` set, excluded from hero, lead and meta, and from search text.

## MEDIUM

5. **Unlisted raw-mode pages (D27) get no `noindex`.** The raw early return comes before the `X-Robots-Tag` header is set.
6. **`/s/` password-protected JSON and raw responses have no `Cache-Control: private, no-store`.** The header is set after both early returns.
7. **`description: ''` has two meanings.**
   - When `siteDescription` is unset, a document with no text produces `''`.
   - That silently strips `og:title`, `og:url` and `twitter:title` from normal articles.
   - Fix: an explicit `bare` flag on PageHead for the locked page, and fall back to `undefined` instead of `''`.
8. **The head's lead ignores the template's layout options.** Docs, changelog and prompt templates opt out of a lead, so an arbitrary text field becomes the meta description. The lead is also not cut down to excerpt length.
9. **Share-panel "already readable" warning ignores `publicRead`.** It fires falsely on private collections (prompts, collab, and any collection with lifecycle `none`).
10. **The admin "Public page ↗" link (`view.tsx`) builds the slug URL by hand.** It 404s for unlisted and private documents; it should use `publicUrlOf` / preview.
11. **Password trimming is inconsistent.** Admin trims the password on create, but unlock and the REST/MCP paths don't, so a password with leading or trailing spaces can't be unlocked. Never trim passwords.
12. **The unlock cookie proof never expires on the server.** It is deterministic `HMAC(grantId:hash)`; the 24h `Max-Age` is only a hint to the browser. It also reuses `SESSION_SECRET` with no purpose prefix. Fix: sign `v1:share-unlock:…:exp`.
13. **The `canShareLink` check in the admin edit page is hand-rolled.**
    - It ignores permission conditions and item grants.
    - So an `own`-conditioned role can crash the edit page (`listShareLinks` throws), and item-grant holders never see the panel.
    - Fix: a non-throwing authorize probe.
14. **An `anonymous` role holding a `published` read permission bypasses visibility.** The role is seeded and editable, and would then see or read unlisted and private documents. Fix: apply the visibility restriction whenever the principal is anonymous.
15. **Extra D1 query per item action.** `authorize()` now fetches metadata whenever `visibility` is undefined, even for non-read actions. Fix: only require it for `read`.
16. **The admin visibility route treats a missing value as `'public'`,** so a malformed POST makes a private document public. Fix: reject missing values.
17. **The unlock rate limit is per-IP only.** A distributed guesser isn't limited per link. Fix: add a second bucket keyed by link.
18. **Docs drift.**
    - Plan 2c and the verification section still say a wrong password returns 401 (it's 200 now, following the login convention); D51 should record why.
    - `ACCESS_CONTROL.md` still says the Share panel is "managers only".
    - `API_AND_MCP_STANDARDS.md` omits `label` and the GET list endpoint.
    - The PageHead docblock is inaccurate.
    - `seo.ts` says "when Part 4 lands"; the article route has a stale og:image comment.
    - Two comments narrate history, contrary to CLAUDE.md.

## LOW

19. `listShareLinks` and `listItemGrants` filter `subjectKind` in memory, against the convention of filtering in SQL, and show expired links.
20. `openShareLink` fails open when `hasPassword` is true but the hash lookup returns nothing. It should fail closed.
21. Flaky tamper test: `slice(0,-1)+'0'` leaves the value unchanged 1 time in 16. The "revoked and re-minted" test never re-mints.
22. The copy button interpolates the URL into inline JS, and the `$copied` signal isn't initialized.
23. The visibility union is declared in 6 places. Make one `src/lib/visibility.ts`, and have routes import the type from the service rather than the queries layer.
24. The visibility stamp is hidden on lifecycle-`none` collections.
25. Transfer import: `visibility` is ignored on updates, and the publish gate is skipped for collections with lifecycle `none`.
26. `timingSafeEqualHex` is duplicated in `share-unlock.ts` and `password.ts`.
27. `setVisibility` bumps `updatedAt`, which feeds `dateModified` and sitemap `lastmod`, and emits an event even when nothing changes. Fix: skip the no-op.

## Needs a decision (not fixed)

- **Relation links to unlisted documents.** A public document that relates to an unlisted one renders `<a href="/c/doc_…">doc_…</a>`, and the REST JSON contains the ID. That publishes the unlisted URL.
  - Options: (a) accept it — linking from a public document reveals the target; or (b) render unreadable relation targets as plain text or omit them on public pages.
  - IDs in the REST `data` would stay either way. Recommend (b) for the HTML page.

## Deferred (valid, structural; not blocking)

- Split share-link functions out of `src/services/access/index.ts` (788 lines) into `share-links.ts`, with a single query that returns grant plus hash.
- Narrow the `buildDocumentHead` input: derive canonical inside the builder, rename `publicUrl` to `currentUrl`, and use a context enum in place of `indexable`.
- Dispatch the admin `share.tsx` ops through a map, and extract a `ShareResultPage` component.
- Group the `SharePanel` props, and extract a People & roles section component.
- Add a copy button for the unlisted URL in the sidebar (it currently selects on focus only).

## Dropped (7)

- Timing difference between unknown token and wrong password on POST (conf 25). Tokens have high entropy, and GET already distinguishes them.
- Media is public (conf 20). Already recorded as a known limitation in SECURITY_STANDARDS and the backlog.
- Revision history is readable for unlisted documents by ID (conf 40). Consistent with the design that unlisted means "readable by anyone holding the ID"; public documents behave the same.
- CHECK constraint lives only in raw SQL. DATABASE_STANDARDS requires exactly this.
- Nested ternary in `seo.ts`. Style only.
- Date-format duplication. Pre-existing codebase-wide pattern, not introduced here.
- Hard-coded `<html lang>`. Correct today; no locale setting exists.

## Outcome (2026-09-23)
All HIGH (1–4), MEDIUM (5–18) and LOW (19–27) findings fixed. Verified: type-check, lint, 633 unit tests, build, e2e 83 passed / 1 flaky (admin-content, which also flaked in earlier runs; not yet checked against main). One deliberate deviation from finding 1's suggested fix: a document id with **no** `documents` row is not treated as a mismatch, because media ids flow through `authorize()` too. Share-link grants can't target non-documents (foreign key to documents), so the exploit stays closed. Still open: the needs-decision item (relation links to unlisted docs) and the 5 deferred refactors.
