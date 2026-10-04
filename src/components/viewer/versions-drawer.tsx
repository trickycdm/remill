/**
 * VersionsDrawer — the framed viewer's history (D60): every saved revision,
 * newest first, each viewable in the frame (`?rev=N`) and restorable. History
 * is append-only, so a restore is a NEW save that copies the old content — it
 * never deletes what came after.
 *
 * Rendered only for a principal who may `update`: past revisions can hold text
 * an editor deliberately removed (the frame read enforces the same gate).
 * Restore is a native form post — no Datastar state to carry.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { Button, Drawer } from '@/components/ui';

export const VERSIONS_DRAWER_ID = 'rm-versions';

export interface VersionRow {
  readonly revision: number;
  readonly savedAt: string;
}

export function VersionsDrawer({
  slug,
  id,
  versions,
  current,
  viewing,
}: {
  slug: string;
  id: string;
  /** Newest first. */
  versions: readonly VersionRow[];
  /** The live revision number. */
  current: number;
  /** The revision in the frame right now. */
  viewing: number;
}): JSX.Element {
  const view = `/admin/c/${slug}/${id}/view`;
  return (
    <Drawer
      id={VERSIONS_DRAWER_ID}
      title="Versions"
      description="Every save is kept. Restoring a version saves it again as the newest one."
    >
      <ol class="flex flex-col divide-y divide-border rounded-md border border-border">
        {versions.map((v) => (
          <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
            <span class="flex items-baseline gap-2">
              <span class="font-mono text-xs text-ink-subtle">#{v.revision}</span>
              <span class="text-sm text-ink">{v.savedAt.slice(0, 16).replace('T', ' ')}</span>
              {v.revision === current ? (
                <span class="text-xs font-medium text-ink-subtle">Current</span>
              ) : null}
            </span>
            <span class="flex items-center gap-2">
              {v.revision === viewing ? (
                <span class="text-xs font-medium text-ink-subtle">Showing</span>
              ) : (
                <Button
                  href={v.revision === current ? view : `${view}?rev=${v.revision}`}
                  variant="ghost"
                  size="sm"
                  aria-label={`View version ${v.revision}`}
                >
                  View
                </Button>
              )}
              {v.revision === current ? null : (
                <RestoreForm slug={slug} id={id} revision={v.revision} />
              )}
            </span>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}

/** Restore one revision and land back on the viewer. */
export function RestoreForm({
  slug,
  id,
  revision,
  variant = 'ghost',
}: {
  slug: string;
  id: string;
  revision: number;
  variant?: 'ghost' | 'secondary';
}): JSX.Element {
  return (
    <form method="post" action={`/admin/c/${slug}/${id}/restore`} class="contents">
      <input type="hidden" name="revision" value={String(revision)} />
      <input type="hidden" name="return" value="view" />
      <Button type="submit" variant={variant} size="sm" aria-label={`Restore version ${revision}`}>
        Restore
      </Button>
    </form>
  );
}
