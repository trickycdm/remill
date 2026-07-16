import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { collectionIndex } from '@/services/discovery';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { formatDate } from '@/lib/format-date';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';
import { PublicShell, PublicNotFound } from '@/components/layouts/public-shell';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /:collection — the PUBLIC collection index (the archive page document
 * pages link back to). Reuses the discovery service's anonymous gated pipeline
 * (publicRead + lifecycle collections, published docs only, newest first, one
 * bounded page — INDEX_CAP). A collection that isn't publicly advertised
 * renders the same indistinguishable 404 as a missing one. Static top-level
 * routes can't be shadowed: their segments are RESERVED_COLLECTION_SLUGS, and
 * the router registers static routes (e.g. /media/:id) ahead of this param
 * route anyway.
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const settings = await getSettings(db);
  const slug = pathParam(c, 'collection');

  try {
    const { def, docs } = await collectionIndex(db, nowIso(), slug);
    const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
    const siteName = settings.siteName?.trim() || 'remill';

    return c.render(
      <PublicShell settings={settings}>
        <section class="flex flex-col gap-8">
          <header class="flex flex-col gap-2">
            <h1 class="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">
              {def.name}
            </h1>
            <p class="text-sm text-ink-muted">
              {docs.length === 1 ? '1 published entry' : `${docs.length} published entries`}
            </p>
          </header>
          {docs.length ? (
            <ul class="flex flex-col gap-6">
              {docs.map((d) => (
                <li class="flex flex-col gap-1">
                  <a
                    href={d.path}
                    class="font-display text-xl font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                  >
                    {d.title}
                  </a>
                  {d.publishedAt ? (
                    <time datetime={d.publishedAt} class="text-sm text-ink-subtle">
                      {formatDate(d.publishedAt, settings)}
                    </time>
                  ) : null}
                  {d.excerpt ? <p class="text-sm text-ink-muted">{d.excerpt}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p class="text-ink-muted">Nothing published here yet.</p>
          )}
        </section>
      </PublicShell>,
      {
        title: `${def.name} — ${siteName}`,
        canonical: `${baseUrl}/${def.slug}`,
        feedUrl: `/rss.xml?collection=${encodeURIComponent(def.slug)}`,
      },
    );
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) {
      c.status(404);
      return c.render(
        <PublicShell settings={settings}>
          <PublicNotFound />
        </PublicShell>,
      );
    }
    throw e;
  }
});
