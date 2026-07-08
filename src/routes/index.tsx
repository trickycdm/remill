import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { getSettings } from '@/services/settings';
import { publicOverview } from '@/services/discovery';
import { resolveBaseUrl } from '@/lib/base-url';
import { nowIso } from '@/lib/now';
import { PublicShell } from '@/components/layouts/public-shell';
import { formatDate } from '@/lib/format-date';

const factory = createFactory<{ Bindings: Env }>();

/**
 * `/` — the public homepage (D35). When no collection is publicly readable the
 * install is headless (the original v1 posture) and the root still sends
 * visitors to the admin; the moment a publicRead + lifecycle collection
 * exists, `/` becomes a masthead + recent published documents per collection,
 * read through the same anonymous gated pipeline as every public page.
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const sections = await publicOverview(db, nowIso());
  if (!sections.length) return c.redirect('/admin');

  const settings = await getSettings(db);
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
  const siteName = settings.siteName?.trim() || 'remill';
  return c.render(
    <PublicShell settings={settings}>
      <div class="flex flex-col gap-10">
        {sections.map(({ def, docs }) => (
          <section aria-labelledby={`home-${def.slug}`}>
            <h2 id={`home-${def.slug}`} class="font-serif text-2xl font-semibold tracking-tight text-ink">
              {def.name}
            </h2>
            {docs.length ? (
              <ul class="mt-4 flex flex-col gap-3">
                {docs.map((d) => (
                  <li class="flex items-baseline justify-between gap-4">
                    <a
                      href={d.path}
                      class="font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {d.title}
                    </a>
                    {d.publishedAt ? (
                      <span class="shrink-0 text-sm text-ink-subtle">{formatDate(d.publishedAt, settings)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p class="mt-4 text-sm text-ink-muted">Nothing published yet.</p>
            )}
          </section>
        ))}
      </div>
    </PublicShell>,
    {
      title: siteName,
      description: settings.siteDescription,
      canonical: `${baseUrl}/`,
      ogType: 'website',
      feedUrl: '/rss.xml',
    },
  );
});
