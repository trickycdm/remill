# Media Standards

> **STATUS: IMPLEMENTED (Phase 5).** Built from scratch (dpt-platform had no media infra). Code:
> `src/services/media/`, `src/lib/mime.ts` (magic-number sniffing), `src/lib/image-size.ts`,
> `src/lib/media-serve.ts` (range serving), `src/db/queries/media.ts`, routes under
> `src/routes/admin/media/` and `src/routes/media/[id]/`. The `media` field type is in
> `src/fields/media.tsx`.
>
> **Divergence from the original design, decided in Phase 5:** media uses a **dedicated `media`
> table**, not the documents/schema-engine pipeline — it carries binary + fixed metadata columns
> (r2_key, mime, dimensions) that don't fit `data_json`. It still obeys the engine's principles:
> authorization goes through `authorize()` on the `media` collection (upload = `create`, serve =
> `read`, so `publicRead` applies), and alt-text-required is enforced like any validation rule.

## Model: media rides the schema engine

Media metadata is a **built-in, protected collection** (`media`), so it reuses the whole schema
engine — validation, list view, REST, MCP — for free. The bytes live in R2; the row in D1's `media`
table holds `r2_key`, `filename`, `mime`, `size`, `width`/`height`/`duration`, `alt`, `variants_json`.
The `media` field type stores a reference to a `media` document id, not the bytes.

Upload is a **`create` on the `media` collection** — it goes through `authorize()` like any write.
There is no parallel media permission system.

## Upload pipeline

- Client uploads are **native multipart** → Worker route → R2, from three doors: the Media library
  form (`/admin/media/upload`), the editor's media-picker island (`POST /admin/media/picker`,
  D38 — **superseded D12/Uppy**; no upload framework exists or is planned), and REST
  `POST /api/media` (token-authed; MCP `upload_media` rides it as base64, D34). All call the ONE
  `uploadMedia` service.
- **Never fully buffer** large files in the Worker. Stream request body → R2. For files above the
  multipart threshold, use **R2 multipart upload** driven from the client (video/audio can be large).
- **Single-request upload cap: 25 MB** (`MAX_UPLOAD_BYTES` in `src/services/media/`), well under the
  Worker request-body limit. Larger media (video/audio) MUST use **client-driven R2 multipart** —
  that path remains a backlog item; every current uploader is native multipart under the cap.

## MIME handling — never trust the extension

- Sniff the actual bytes (magic-number check) on upload. The stored `mime` is the **sniffed** type,
  not the client-declared one or the filename extension.
- Enforce an **allowlist** of accepted MIME types (images, audio, video, documents as configured).
  Reject anything not on the list with a structured 400. A file whose sniffed type disagrees with
  its declared type or extension is rejected — this is a security boundary (see SECURITY_STANDARDS.md).
- Never derive behavior (rendering, `Content-Type` on serve) from the untrusted filename.

## R2 key scheme

- Keys are opaque and content-addressed-ish: `media/<nanoid>/<sanitized-filename>` — the nanoid
  segment prevents collisions and enumeration; the filename tail aids debugging only.
- Never place user-controlled strings at the key root without sanitization. Never let a key escape
  the `media/` prefix.
- `variants_json` reserves keys for future derived assets under `media/<id>/variants/<name>`.

## Serving: `/media/:id[/:variant]`

- Route resolves the `media` row, streams the R2 object with **range-request support** (HTTP 206 for
  `Range` headers) so video/audio seeking works. Honor `If-None-Match`/ETag.
- Set **immutable cache headers** (`Cache-Control: public, max-age=31536000, immutable`) — media ids
  are stable and content never changes under a given id.
- Set `Content-Type` from the **stored sniffed mime**, never from the request.
- `:variant` is reserved (decision D11). In v1 every variant resolves to the original (transforms
  stubbed). The URL scheme shields consumers so Cloudflare Image Transformations can slot in later
  without a URL change.
- Access: serving authorizes `read` on the `media` collection (with `status: 'published'`), so the
  seeded `media` collection's `publicRead` lets anonymous clients fetch assets. No separate ACL —
  it's the same `authorize()` pipeline (`src/lib/media-serve.ts`).

## Accessibility

- **Alt text is required for images.** The `media` collection's validation rejects an image document
  saved without `alt`. This is a hard WCAG 2.1 AA gate (see A11Y_STANDARDS.md), not a soft warning.
- Audio/video should carry captions/transcripts where provided; not blocking in v1 but the fields
  exist.

## Deletion semantics

- **Policy: block.** Deleting media is refused with a `409 ConflictError` while any document
  references it (`countMediaReferences` — a JSON scan of `documents.data_json` for the media id,
  fine at lightweight scale). The referrers must be updated first. This never silently breaks a
  document's `media` field.
- Deleting a media document deletes its R2 object(s) only after the D1 row delete succeeds; never
  orphan bytes in R2 or dangling rows in D1 — do both in a way that can't half-complete
  (delete R2 after the row, tolerate a re-run).

## Non-goals (v1)

Image transforms/resizing (URL scheme reserved), video transcoding (Cloudflare Stream later),
focal-point cropping beyond storing the point, EXIF scrubbing beyond what sniffing needs.
