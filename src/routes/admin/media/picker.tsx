import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { listMedia, uploadMedia } from '@/services/media';
import { rateLimit, UPLOAD_RATE_LIMIT } from '@/middleware/rate-limit';
import { AppError, BadRequestError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** Tiles per fragment page — a dialog-sized window into the library. */
const PICKER_PAGE = 24;

/**
 * GET /admin/media/picker — the media-picker FRAGMENT (D38): a bare HTML
 * partial the media-picker island fetches into its dialog. No AdminShell, no
 * RootLayout. CRITICAL CONSTRAINTS: no <form> (the dialog nests inside
 * #editor-form) and every button type="button" (a bare button would submit
 * the editor form).
 */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const cursor = c.req.query('cursor') || null;
  const { rows, nextCursor } = await listMedia(
    db,
    requirePrincipal(c),
    { limit: PICKER_PAGE, cursor },
    nowIso(),
  );

  return c.html(
    <div class="flex flex-col gap-4">
      <p data-picker-error role="alert" class="hidden text-sm text-danger"></p>

      {/* Upload row — BARE inputs; the island builds the FormData. */}
      <div class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3">
        <label class="flex-1 text-sm text-ink">
          <span class="sr-only">Upload a file</span>
          <input
            data-picker-file
            type="file"
            class="block w-full rounded-md text-sm text-ink file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-fg hover:file:bg-accent-hover"
          />
        </label>
        <label class="flex items-center gap-2 text-sm text-ink">
          <span class="sr-only">Alt text (required for images)</span>
          <input
            data-picker-alt
            type="text"
            placeholder="Alt text (required for images)"
            class="h-8 w-56 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        <button
          type="button"
          data-picker-upload
          class="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Upload &amp; use
        </button>
      </div>

      {rows.length === 0 ? (
        <p class="py-6 text-center text-sm text-ink-muted">No media yet — upload a file above.</p>
      ) : (
        <ul
          class="grid list-none grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
          aria-label="Media assets"
        >
          {rows.map((m) => (
            <li>
              <button
                type="button"
                data-media-id={m.id}
                aria-label={`Select ${m.filename}`}
                class="flex w-full flex-col overflow-hidden rounded-md border border-border bg-surface text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span class="flex aspect-video items-center justify-center overflow-hidden bg-hover">
                  {m.mime.startsWith('image/') ? (
                    <img
                      src={`/media/${m.id}`}
                      alt=""
                      class="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span class="font-mono text-xs text-ink-subtle uppercase">
                      {m.mime.split('/')[1]}
                    </span>
                  )}
                </span>
                <span class="truncate px-2 py-1.5 text-xs text-ink" title={m.filename}>
                  {m.filename}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div class="flex justify-center">
          <button
            type="button"
            data-picker-more
            data-cursor={nextCursor}
            class="rounded-md px-3 py-1.5 text-sm text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Show more
          </button>
        </div>
      ) : null}
    </div>,
  );
});

/**
 * POST /admin/media/picker — the island's in-dialog upload (D38). Session-authed
 * (never /api/media, which is token-authed), same 'upload' rate bucket, same
 * uploadMedia service (MIME sniff, 25 MiB cap, alt-required). Returns JSON so
 * the island can select the new asset; errors come back as JSON too (the
 * island renders them into the fragment's alert slot).
 */
export const onRequestPost = factory.createHandlers(
  requireAuth(),
  rateLimit('upload', UPLOAD_RATE_LIMIT),
  async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new BadRequestError('No file provided.');
    const alt = typeof body.alt === 'string' && body.alt.trim() ? body.alt.trim() : undefined;
    try {
      const rec = await uploadMedia(
        getDb(c.env.DB),
        c.env.MEDIA,
        requirePrincipal(c),
        { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), alt },
        nowIso(),
      );
      return c.json({ id: rec.id, url: `/media/${rec.id}`, alt: rec.alt, filename: rec.filename });
    } catch (e) {
      // The island consumes JSON — map AppErrors here instead of onError's
      // HTML/redirect paths (this is neither a machine /api route nor Datastar).
      if (e instanceof AppError) return c.json({ error: e.friendlyMessage }, e.status as 400);
      throw e;
    }
  },
);
