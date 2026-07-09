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
  CalmAdminSplit,
  OutcomesLedger,
  SixSurfaces,
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

  return c.render(
    <MarketingShell>
      <MarketingHero />
      <CalmAdminSplit />
      <OutcomesLedger />
      <SixSurfaces />
      <AgentQuickstart baseUrl={baseUrl} />
      <PublishedIndex sections={sections} settings={settings} />
    </MarketingShell>,
    {
      title: 'remill: content, milled',
      description:
        settings.siteDescription?.trim() ||
        'A lightweight, agent-native CMS: a calm admin for people, a JSON API for apps, and first-class access for AI agents.',
      canonical: `${baseUrl}/`,
      ogType: 'website',
      feedUrl: '/rss.xml',
    },
  );
});
