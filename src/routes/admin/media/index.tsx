import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { listMedia, MAX_UPLOAD_BYTES } from '@/services/media';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardContent,
  EmptyState,
  Badge,
  Input,
  Button,
  FormField,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** GET /admin/media — the media library: upload + grid with alt editing. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const cursor = c.req.query('cursor') || null;
  const { rows, total, nextCursor } = await listMedia(
    db,
    requirePrincipal(c),
    { cursor },
    nowIso(),
  );

  return c.render(
    <AdminShell user={user} current="media">
      <PageHeader title="Media" description={`${total} asset${total === 1 ? '' : 's'}`} />

      {/* Upload — native multipart; the pipeline is dependency-free by decision
          (D38 superseded D12/Uppy — the editor's media-picker island uploads
          through the same service). */}
      <Card class="mb-8">
        <CardContent class="pt-6">
          <form
            method="post"
            action="/admin/media/upload"
            enctype="multipart/form-data"
            class="flex flex-wrap items-end gap-4"
          >
            <FormField fieldId="file" label="Upload a file">
              <input
                id="file"
                name="file"
                type="file"
                required
                class="block h-10 w-full rounded-md border border-border-strong bg-surface text-sm text-ink shadow-xs file:mr-3 file:h-full file:cursor-pointer file:border-0 file:bg-accent file:px-3 file:text-sm file:font-medium file:text-accent-fg hover:file:bg-accent-hover"
              />
            </FormField>
            <FormField fieldId="alt" label="Alt text (required for images)">
              <Input id="alt" name="alt" type="text" placeholder="Describe the image" />
            </FormField>
            <Button type="submit">Upload</Button>
          </form>
          <p class="mt-2 font-mono text-xs text-ink-subtle">
            Max {MAX_UPLOAD_BYTES / 1024 / 1024}MB. Type is verified by content, not extension.
          </p>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No media yet" description="Upload images, audio, or video above." />
      ) : (
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((m) => (
            <Card>
              <div class="flex aspect-video items-center justify-center overflow-hidden rounded-t-lg bg-hover">
                {m.mime.startsWith('image/') ? (
                  <img
                    src={`/media/${m.id}`}
                    alt={m.alt ?? ''}
                    class="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span class="font-mono text-xs text-ink-subtle uppercase">
                    {m.mime.split('/')[1]}
                  </span>
                )}
              </div>
              <CardContent class="pt-3">
                <p class="truncate text-sm font-medium" title={m.filename}>
                  {m.filename}
                </p>
                <p class="mt-0.5 flex items-center gap-2 font-mono text-xs text-ink-subtle">
                  <Badge tone="neutral">{m.mime.split('/')[0]}</Badge>
                  {humanSize(m.size)}
                  {m.width && m.height ? `· ${m.width}×${m.height}` : ''}
                </p>
                <form
                  method="post"
                  action={`/admin/media/${m.id}/alt`}
                  class="mt-2 flex items-center gap-2"
                >
                  <Input
                    name="alt"
                    type="text"
                    size="sm"
                    value={m.alt ?? ''}
                    placeholder="Alt text"
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    Save
                  </Button>
                </form>
                <div class="mt-2 flex items-center justify-between">
                  <a
                    href={`/media/${m.id}`}
                    target="_blank"
                    rel="noopener"
                    class="font-mono text-xs text-ink-subtle hover:text-ink hover:underline"
                  >
                    open ↗
                  </a>
                  <form
                    method="post"
                    action={`/admin/media/${m.id}/delete`}
                    onsubmit="return confirm('Delete this media?')"
                  >
                    <button type="submit" class="text-xs text-danger hover:underline">
                      Delete
                    </button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {nextCursor && (
        <div class="mt-8 flex justify-center">
          <a
            href={`/admin/media?cursor=${encodeURIComponent(nextCursor)}`}
            class="text-sm text-accent-text hover:underline"
          >
            Show more
          </a>
        </div>
      )}
    </AdminShell>,
  );
});
