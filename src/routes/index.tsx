import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { getSettings } from '@/services/settings';
import { publicOverview } from '@/services/discovery';
import { resolveBaseUrl } from '@/lib/base-url';
import { getSessionUser } from '@/lib/auth';
import { DEFAULT_LOCALE } from '@/lib/seo';
import { nowIso } from '@/lib/now';
import { MarketingShell } from '@/components/layouts/marketing-shell';
import {
  MarketingHero,
  WhoItsFor,
  EverySurface,
  UseCases,
  TrustBento,
  RunYourOwnMill,
  AgentQuickstart,
  PublishedIndex,
} from '@/components/marketing';

const factory = createFactory<{ Bindings: Env }>();

/**
 * `/` — the product homepage. Every remill instance markets the platform it
 * runs on (value sections, the six-surfaces proof point, the agent quickstart)
 * and then indexes its own published content, read through the same anonymous
 * gated pipeline as every public page (D35). The old headless posture
 * (redirect to /admin when nothing is public) is gone: the page always
 * renders, and a fresh install simply shows an empty writing index with a
 * sign-in path.
 *
 * A visitor holding a session sees "Open admin" where others see "Sign in", so
 * that variant is marked private: a shared cache must never hand one reader's
 * signed-in chrome to the next.
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const [sections, settings] = await Promise.all([publicOverview(db, nowIso()), getSettings(db)]);
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
  const signedIn = getSessionUser(c) !== null;
  if (signedIn) c.header('Cache-Control', 'private, no-store');
  const siteName = settings.siteName?.trim() || 'remill';
  const description =
    settings.siteDescription?.trim() ||
    'A lightweight, agent-native CMS: a GUI for people, an API for apps, and MCP for agents.';

  // Narrative (the poster cut): promise → who it's for → the job ticket →
  // the setlist → the stamped guarantee → wire the agent → the dogfood index
  // → the dark closing act (get your own), which flows into the footer.
  return c.render(
    <MarketingShell signedIn={signedIn}>
      <MarketingHero />
      <WhoItsFor />
      <EverySurface />
      <UseCases />
      <TrustBento />
      <AgentQuickstart baseUrl={baseUrl} />
      <PublishedIndex sections={sections} settings={settings} signedIn={signedIn} />
      <RunYourOwnMill />
    </MarketingShell>,
    {
      title: 'remill: content, milled',
      description,
      canonical: `${baseUrl}/`,
      ogType: 'website',
      siteName,
      locale: DEFAULT_LOCALE,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteName,
        url: `${baseUrl}/`,
        description,
      },
      feedUrl: '/rss.xml',
    },
  );
});
