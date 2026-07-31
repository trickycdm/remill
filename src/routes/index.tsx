import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { getSettings } from '@/services/settings';
import { publicOverview } from '@/services/discovery';
import { resolveBaseUrl } from '@/lib/base-url';
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
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const [sections, settings] = await Promise.all([publicOverview(db, nowIso()), getSettings(db)]);
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);

  // Narrative (the poster cut): promise → who it's for → the job ticket →
  // the setlist → the stamped guarantee → wire the agent → the dogfood index
  // → the dark closing act (get your own), which flows into the footer.
  return c.render(
    <MarketingShell>
      <MarketingHero />
      <WhoItsFor />
      <EverySurface />
      <UseCases />
      <TrustBento />
      <AgentQuickstart baseUrl={baseUrl} />
      <PublishedIndex sections={sections} settings={settings} />
      <RunYourOwnMill />
    </MarketingShell>,
    {
      title: 'remill: content, milled',
      description:
        settings.siteDescription?.trim() ||
        'A lightweight, agent-native CMS: a GUI for people, a JSON API for apps, and permissioned MCP for AI agents.',
      canonical: `${baseUrl}/`,
      ogType: 'website',
      feedUrl: '/rss.xml',
    },
  );
});
