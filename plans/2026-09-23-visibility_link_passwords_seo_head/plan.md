# Visibility (public / unlisted / private), password-protected share links, rich SEO head

**Status: BUILT + REVIEWED — 2026-09-23 (all parts DONE; review findings fixed; see review.md)**

## Context

Sharing an article properly is awkward today:

1. **No unlisted mode.** A published article in a `publicRead` collection is in every list: the
   `/` homepage, the `/:collection` index, RSS, the sitemap, anonymous REST list and search, and
   backlinks. Its URL is the slug (`/blog/my-post-title`), which anyone can guess from the title.
   Colin wants YouTube-style **unlisted**: reachable by direct link only, not discoverable.
2. **No way to keep a finished article private except leaving it as a draft**, and no password
   protection anywhere.
3. **The share-link flow is tangled with email.** The admin "Share link" form
   (`src/components/admin/share-panel.tsx:145-164`) pairs "make a link" with an email box, so it
   reads as "email someone". Email delivery is broken in production (console stub / Resend not
   configured). **Fixing email is deferred to the next round**; this plan only removes the
   dependency on it.
4. **Shared links show remill's default description.** `/s/:token` calls `c.render` with no head
   props (`src/routes/s/[token]/index.tsx:82`), so `RootLayout` falls back to a hardcoded
   `'remill — a lightweight, agent-native CMS'` (`src/layouts.tsx:48`). Even the real article
   route's head is thin: the description is every text field joined and cut to 160 characters,
   `og:image` ignores `bind.hero`, there is no `og:site_name`, `article:*` or JSON-LD, and
   `robots.txt` `Disallow: /s/` stops some link unfurlers (e.g. X, LinkedIn) from fetching share
   links at all.

Decisions Colin made (2026-09-23):
- **Visibility is a document setting, separate from draft/published:** Public / Unlisted / Private.
- **Passwords belong to share links, not documents.** Each audience gets its own link, and each
  link can be revoked on its own.
- **A password-protected link leaks nothing.** Before unlock it shows a blanket "protected" page
  with no title, description, image or OG tags.
- **Email is left as is for this round.**
- **One plan covering all of it.**

### The model

| Status + Visibility | Public URL | Listed (index/RSS/sitemap/search/backlinks) | Via `/s/<token>` |
|---|---|---|---|
| Published + **Public** | `/blog/my-post` (slug) and `/blog/doc_…` | yes | yes |
| Published + **Unlisted** | `/blog/doc_…` only (slug URL → 404) | **no**, and `noindex` | yes |
| Published + **Private** | none (404) | no | yes, with optional password |
| Draft (any visibility) | none (404) | no | yes, with optional password |

The unlisted URL uses the document ID, which already exists: `doc_` + a 21-character nanoid
(`src/lib/id.ts:39`), about 126 bits of randomness, which can't be guessed. The public route already
accepts `doc_…` references (`src/routes/[collection]/[slug]/index.tsx`), so no new routing is needed.

### Why the access change is small

Every anonymous *list* surface already goes through one SQL predicate,
`compileReadFilter` (`src/access/authorize.ts:173-213`). Callers are:
- discovery's `publishedDocs` (homepage, collection index, RSS, sitemap)
- `listDocuments` (REST list, and `getDocumentBySlug`)
- `searchSite`
- `getBacklinks`
- `expandRelations`

Every anonymous *item* read goes through `decide()` (`src/access/permissions.ts:70-74`, the
"publicRead sugar" step). So:
- In **`compileReadFilter`**, the publicRead-only branch becomes
  `status='published' AND visibility='public'`. That drops unlisted and private documents from every
  anonymous list. Because `getDocumentBySlug` resolves through `listDocuments`, it also makes the
  slug URL 404 for them.
- In **`decide()`**, the publicRead item branch requires `visibility !== 'private'`. So an unlisted
  document still opens by `doc_` ID and a private one does not.

Role-based reads are unaffected. Principals whose read comes from a role, including the
`published` condition (editors, reader tokens, MCP agents), still see all visibilities; unlisted
only hides things from the public. Share links are item grants (`decide()` step 3), so they keep
working for private documents and drafts.

---

## Part 1: Visibility (D50)

### 1a. Migration `0015_*`: `documents.visibility`
- Drizzle `src/db/schema.ts` documents table:
  `visibility: text('visibility').notNull().default('public')`, commented
  `// 'public' | 'unlisted' | 'private' (D50)`.
- Run `bun run db:generate`. Hand-edit the SQL so the ALTER includes the default and a CHECK, per
  DATABASE_STANDARDS (enum CHECK constraints go in the raw migration; NOT NULL needs a DEFAULT in
  the same ALTER):
  `ALTER TABLE documents ADD COLUMN visibility text DEFAULT 'public' NOT NULL CHECK (visibility IN ('public','unlisted','private'));`
- Do the same for `document_trash` (`src/db/queries/trash.ts`), so restoring a deleted document
  keeps its visibility.
- Existing rows become `'public'`, so behaviour is unchanged until someone flips a document.

### 1b. Types and mapping
- `DocumentRecord` (`src/db/queries/documents.ts:21`) gains
  `visibility: 'public' | 'unlisted' | 'private'`. Export a `Visibility` type and a `VISIBILITIES`
  const.
- Update row↔domain mapping, `getDocumentMetaForAuth`, trash snapshot/restore, and `updateDocument`
  pass-through (never clobber it on data saves).
- `Resource` (`src/access/types.ts:57`) gains `visibility?`. Every place that builds an item
  `Resource` from document metadata passes it (grep `status: existing.status` / `getDocumentMetaForAuth`).
- Transfer (`src/services/transfer/index.ts`): exported lines carry `visibility`. On import it is
  optional (default `'public'`) and validated like `status` (:132). Setting a non-public visibility
  is a publish decision, so it falls under the same once-per-run `publish` authorization (:178).

### 1c. Access (`src/access/permissions.ts`, `src/access/authorize.ts`)
- `decide()` step 2: `if (resource.status === 'published' && resource.visibility !== 'private') return true;`
  (a missing `visibility` counts as public, so existing callers and tests keep working).
- `compileReadFilter`: split the combined branch. A role `published` condition pushes
  `status='published'`. The publicRead sugar alone pushes
  `status='published' AND visibility='public'`.
- Update the docblocks and `steering/ACCESS_CONTROL.md` (publicRead now means "published **and
  public**" for lists, and "published **and not private**" for item reads).

### 1d. Service: `setVisibility` (`src/services/documents/index.ts`)
Modelled on `scheduleDocument` (a narrow write: no data change, no revision, no index churn).
- `authorize(read)` → load, then `authorize('publish', { …, status, visibility })`. Changing
  visibility is a publication decision.
- Write the column and add an outbox event `document.visibility_changed` (extend the union in
  `src/db/queries/events.ts:23`).
- Returns the updated record. Rejects values outside `VISIBILITIES` with `InputValidationError`.
- Allowed on draft documents too: it is remembered and takes effect on publish. The scheduled
  publish drain leaves it untouched.

### 1e. Surfaces (the six-surface rule)
- **Admin:** `POST /admin/c/:collection/:id/visibility` (new route file beside `publish.tsx`, same
  shape). The editor sidebar (`src/components/admin/editor-sidebar.tsx`, next to publish/schedule)
  gets a Public / Unlisted / Private radio group with one-line helper text for each. It is shown
  only when `def.access?.publicRead`; without that everything is already private, so the control
  would do nothing.
  - For **Unlisted + published**, show the unlisted URL with a copy button.
  - When switching **Public → Unlisted**, the form's helper text warns that the old slug link stops
    working.
- **Admin list view:** a `Stamp` (the design system's state-marker component) for Unlisted and
  Private next to the status stamp.
- **REST:** `POST /api/c/:collection/:id/visibility` `{ visibility }` (new route beside
  `api/.../publish.tsx`). Document JSON in list/get responses includes `visibility`. Update OpenAPI.
- **MCP:** `visibility_<slug>` tool (args `id`, `visibility`), generated beside `schedule_<slug>` in
  `src/mcp/tools.ts`. Tool results include `visibility`.
- **`publicUrlOf`** (`src/lib/def-helpers.ts:45`): return the `doc_…` URL whenever the document is
  not public. Everything that builds public links (admin Preview, share bar, canonical, feeds)
  then does the right thing without a special case. `DocLike` gains an optional `visibility`.

### 1f. Public render (`src/routes/[collection]/[slug]/index.tsx`)
- Unlisted: `noindex` meta plus an `X-Robots-Tag: noindex` header. The share bar stays: unlisted
  articles are meant to be shared, and its URL comes from `publicUrlOf`, so it is the `doc_` URL.
- Preview (`?preview=1`) is unchanged.

---

## Part 2: Share links, reworked, with passwords (D51)

### 2a. Migration (same `0015_*`): `item_grants`
- `password_hash text` (nullable; only ever set when `subject_kind='link'`).
- `label text` (nullable; e.g. "Acme review", shown in the panel).
- Fix the stale `subjectKind` comment in `schema.ts:298` to list
  `'principal' | 'role' | 'team' | 'link'`.

### 2b. Service (`src/services/access/index.ts`)
- `createShareLink` input gains `password?: string` and `label?: string`:
  - Hash the password with `hashPassword` (`src/lib/password.ts:24`, scrypt), minimum 8 characters.
  - Label is trimmed and capped at 80 characters.
  - Never log or return the password.
- Replace the route's direct `resolveShareLink` use with
  **`openShareLink(db, token, unlockCookie, secret, now)`**, returning
  `{ state: 'open', grant } | { state: 'locked', grant } | null`. The route can then never forget
  the password check, because the grant only comes back as `open` after it passes.
- `unlockShareLink(db, token, password, now)` returns either
  `{ ok: true, cookieValue, maxAge } | { ok: false }` (runs `verifyPassword`).
  - **Unlock proof:** HMAC-SHA256 with `SESSION_SECRET` over `grantId + ':' + passwordHash`, using
    WebCrypto with a constant-time compare. Binding it to the current hash means any
    password change or revoke invalidates existing unlocks. Put this in a small pure helper
    `src/lib/share-unlock.ts` (sign/verify) with unit tests.
- `ItemGrantRecord` gains `label` and `hasPassword: boolean`. The hash never leaves the query layer,
  except through one internal query used by the unlock check.

### 2c. `/s/[token]` route
- **GET**, handled in this order:
  - `null` → the same indistinguishable 404 as today.
  - `locked` → the **blanket protected page**:
    - `PublicShell` with a neutral "This link is protected" card, a password field, and a submit
      button that POSTs back to the same URL.
    - Head is title "Protected link" only, `noindex`, **no** description or OG/Twitter tags. The
      layout's default description is suppressed with an explicit `description: ''` →
      omit-meta rule; see 3a.
    - Headers: `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.
    - `Accept: application/json` → `401 { error: 'Password required', code: 'LOCKED' }`.
  - `open` → render the document as today, plus the rich head from Part 3 (with `noindex`).
    Protected links get `Cache-Control: private, no-store`. Every `/s/` response gets
    `X-Robots-Tag: noindex`.
- **POST** (new `onRequestPost`, `rateLimit('share-unlock', SHARE_UNLOCK_RATE_LIMIT)`, a new tier of
  10 per 60 s in `src/middleware/rate-limit.ts`):
  - Success: set cookie `rm_unlock` (`Path=/s/<token>`, `HttpOnly; Secure; SameSite=Lax`,
    `Max-Age = min(24h, until link expiry)`), then `303` redirect to GET.
  - Failure: re-render the locked page with a generic error "That password didn't work." and
    status 200 (the `/admin/login` convention — a 401 answering a POST trips undici's auth-retry
    in the local dev relay). Same page for unknown tokens, so the response doesn't reveal whether the token is
    valid beyond what GET already does.
- Check that the global CSRF/origin middleware allows this anonymous form POST; follow the pattern
  of `src/routes/auth/join/[token].tsx`.

### 2d. Admin share panel, restructured (`share-panel.tsx`, `share.tsx` route)
The panel has two sections:
- **Share links**, shown to anyone holding `share_link` on the document (editors included; fixes
  the mismatch where only `manage_access` holders saw the panel):
  - Create form with Label (optional), Password (optional, with a show/hide toggle), and Expires
    (optional). **No email field.**
  - Result page:
    - The URL with a real copy button (reuse the clipboard behaviour from `src/client/share.ts`, or
      a tiny Datastar `@clipboard` equivalent).
    - A note: "Send the password separately; it can't be shown again."
    - The existing email-this-link form, moved there **unchanged** as a secondary action, so it is
      decoupled from creating the link. Its transport bugs are deferred (see Out of scope).
  - Link rows show label, a 🔒 "Password" badge, expiry, and revoke.
  - **Warning banner** when the document is published and Public or Unlisted: "This article is
    already readable at <url>. Links and passwords don't restrict that; set visibility to Private
    to require a link."
- **People & roles grants**: the existing grant form, still `manage_access` only.
- Gating in `src/routes/admin/c/[collection]/[id]/index.tsx:46-50`: probe both permissions without
  throwing (use the existing non-throwing `can`-style helper if there is one, else wrap `authorize`).
  List link grants for `share_link` holders; a new `listShareLinks` service, gated on `share_link`,
  returns link rows only.

### 2e. Parity
- **MCP** `share_link_<slug>` (`src/mcp/tools.ts:568-603`): optional `password` and `label` args;
  result includes `hasPassword`. The 30-day expiry cap stays.
- **REST:** new `POST /api/c/:collection/:id/share-links` `{ expiresAt?, password?, label? }` →
  `{ grantId, url, expiresAt, hasPassword }` (it's missing today). Plus
  `DELETE /api/c/:collection/:id/share-links/:grantId`. Update OpenAPI.

### 2f. robots.txt
Remove `Disallow: /s/` from `src/lib/feeds.ts:100`. Share links now carry `noindex` (meta plus
header), and a Disallow would stop crawlers from ever seeing it. It also blocks some link-preview
bots from unlocked links. Update the feeds test.

---

## Part 3: Rich SEO head (D52)

### 3a. `PageHead` + `RootLayout` (`src/layouts.tsx`)
- Extend `PageHead` with:
  - `ogTitle` (the title without the " — site" suffix)
  - `siteName`
  - `locale`
  - `imageAlt`, `imageWidth`, `imageHeight`
  - `publishedTime`, `modifiedTime`
  - `author`, `tags[]`
  - `jsonLd` (object)
- Emit these tags:
  - `og:site_name`, `og:locale`
  - `og:image:alt/width/height`
  - `twitter:title/description/image:alt`
  - `article:published_time/modified_time/author/tag` (only when `ogType==='article'`)
  - `meta name=author`
  - `<script type="application/ld+json">`, serialized with `<`, `>` and `&` escaped as `<`
    etc. (no `</script>` breakout). This is the one inline script and it is data-only; confirm the
    CSP allows `application/ld+json`, since it isn't executable, but check the header.
- Description fallback: `description === ''` means **omit** the meta tag (used by the locked page).
  Undefined keeps today's static fallback for admin pages. Public routes always pass one.

### 3b. `src/lib/seo.ts` (new, pure): `buildDocumentHead(...)`
Signature: `buildDocumentHead({ def, doc, settings, baseUrl, canonical, media, indexable })` →
`PageHead`. Used by **both** the article route and the `/s/` route (open state), so the two can't
drift apart.
- **Title:** `seo_title` field (convention key) → `titleOf`. Full `<title>` is
  `${t} — ${siteName}`; `og:title` is `t`.
- **Description:** `meta_description` field → the lead/dek resolved by
  `src/templates/lib/conventions.ts` (honours `bind.lead`, the same resolver the template uses) →
  `excerptFrom(buildSearchText body)` → `settings.siteDescription`. Never the hardcoded string.
- **Image:** `social_image` field → hero resolved by conventions (honours `bind.hero`) → first
  media field → `settings.logo`. Always an absolute URL. Alt, width and height come from the media
  record when it has them; the route loads it via the media service, and `buildDocumentHead` stays
  pure.
- **Dates:** `publishedAt`, `updatedAt`.
- **Author:** the author/byline the template already shows (same convention) →
  `settings.defaultAuthorName`.
- **Tags:** the `tags`-type field.
- **JSON-LD:** `BlogPosting` for article-shaped templates, `Article` otherwise, with headline,
  description, image, datePublished, dateModified, `author{@type:Person,name}`,
  `publisher{@type:Organization,name,logo}` and `mainEntityOfPage` (only when canonical is set).
- **Robots:** `noindex` when `!indexable`, meaning unlisted, private, preview, or any `/s/` render.
- **Canonical:** set only when the document is published **and public**. Unlisted gets
  `og:url` = its `doc_` URL but no canonical. Share links of public documents point canonical at
  the public URL. Share links of private or unlisted documents get no canonical, so the slug is
  never leaked.

### 3c. Other public routes
- Collection index `src/routes/[collection]/index.tsx`: description (the collection description,
  else `settings.siteDescription`), `ogType: 'website'`, `siteName`.
- Homepage `src/routes/index.tsx`: add `siteName`, locale, and a `WebSite` JSON-LD.
- 404s: `noindex`.

### 3d. Author-controlled SEO fields in packs (`src/templates/packs.ts`)
Add three optional fields, `seo_title` (text), `meta_description` (text, max 160) and `social_image`
(media), to the blog, docs and portfolio pack definitions, at the end in an "SEO" group if field
groups exist. They apply to **new installs**. Existing collections can add the same keys in the
collection builder, and the convention picks them up by key. Document the keys in
`steering/SCHEMA_ENGINE.md` under conventions.

---

## Out of scope (recorded)
- **Email delivery fixes.** Next round. The known bugs:
  - `ResendEmailTransport.send` swallows non-2xx responses and the UI says "sent".
  - A network throw loses the plaintext link.
  - Production has no `RESEND_API_KEY`/`EMAIL_FROM`, and the remill.me domain may not be verified.
  Add these to `plans/BACKLOG.md`.
- **Media on protected pages.** `/media/<id>` is served `public, immutable` without auth. Media
  IDs can't be guessed and only appear after unlock, but a leaked image URL works without the
  password. Record this in SECURITY_STANDARDS as a known limitation; gating media by the documents
  that reference it is a separate project.
- Per-document passwords (per-link was chosen) and a resized social-card image.

## Build order
1. Migration + types + mapping (1a, 1b, 2a). Unit tests compile.
2. Access change + `setVisibility` + its surfaces (1c–1f), with tests for the matrix and every
   list surface.
3. SEO head (3a–3d). Independent, so it can go in parallel with step 4.
4. Share-link service, `/s/` gate, panel rework, parity, robots (2b–2f).
5. Docs: `docs/TECH_DECISIONS.md` D50–D52; `steering/ACCESS_CONTROL.md`, `SECURITY_STANDARDS.md`
   (link passwords, unlock cookie, media limitation), `API_AND_MCP_STANDARDS.md` (new
   tools/endpoints), `SCHEMA_ENGINE.md` (SEO convention keys); CLAUDE.md status paragraph;
   BACKLOG email entry.

## Verification
- **Unit (Vitest):**
  - `decide()` / `compileReadFilter` truth table: anonymous vs role-`published` reader vs link
    principal × public/unlisted/private × draft/published.
  - Anonymous exclusion of unlisted and private on: `publicOverview`, `collectionIndex`,
    `recentPublishedDocs` (RSS), `allPublishedDocs` (sitemap), REST list, `?q=` search,
    `getBacklinks`, relation expansion.
  - Unlisted document: slug URL → 404, `doc_` URL → 200 with `noindex`. Private: both → 404.
  - `setVisibility` gating (editor ok, author/reader denied) plus its event; transfer round-trip
    keeps visibility; trash restore keeps visibility.
  - Share links:
    - A protected link GET contains **no** title, description, `og:` or JSON-LD, and has
      `no-store`.
    - Wrong password → 200 re-render with the error; right password → 303 with a cookie, then GET renders.
    - A tampered cookie stays locked. Changing the password or revoking invalidates the cookie.
    - JSON Accept on a locked link → 401 LOCKED.
    - Rate limiter wired.
  - `buildDocumentHead`: priority order for each slot, absolute image URLs, canonical rules,
    JSON-LD escaping (a title containing `</script>`).
  - robots.txt has no `/s/` Disallow.
- **E2E (Playwright + axe)**, new spec `e2e/visibility-and-share-links.spec.ts`:
  - Set Unlisted in the editor, then in an anonymous context: the slug 404s, the `doc_` URL renders,
    and the document is not on `/blog` or in `/rss.xml`.
  - Set Private, create a password link in the panel, then in an anonymous context: the lock page
    passes axe; a wrong password shows the error; the right password renders the article.
- **Gates:** `bun run type-check && bun run lint && bun run test:run && bun run e2e`, plus
  `bun run build`.
- **Manual:** `bun run dev`. Check the head of an article, an unlisted article and an unlocked share
  link with `curl -s … | grep -E 'og:|twitter:|ld\+json|robots'`, and paste one into an OG
  debugger after deploying to a preview.
