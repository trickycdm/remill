/**
 * Marketing homepage sections (presentational, Hono JSX — precedent:
 * auth-shell.tsx). Composed by src/routes/index.tsx inside MarketingShell.
 *
 * Design notes (tasteskill v2 + DESIGN_SYSTEM.md): product-showcase-led,
 * narrative promise -> proof -> trust -> connect -> writing. The one iris
 * accent is used with confidence as a real colour field (the hero band, the
 * quickstart band, tinted bento cells) — the "push it bold" direction, still
 * 100% on-token. Exactly two mono-caps eyebrows page-wide (hero + quickstart);
 * five distinct section layout families; every preview is remill's own UI
 * primitives rendering real markup, never a div-built fake screenshot. Zero
 * em-dashes in visible copy.
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Bot, Braces, FileText, ShieldCheck } from '@/components/ui/icon';
import { formatDate } from '@/lib/format-date';
import type { SiteSettings } from '@/services/settings';
import type { CollectionDefinition } from '@/fields/types';
import type { DiscoveryDoc } from '@/services/discovery';

const SECTION_H2 = 'font-serif text-display-sm sm:text-display font-semibold text-ink';
const LINK =
  'font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

// Hero CTAs sit on the solid accent band, so the normal accent-fill Button is
// invisible here: primary inverts to a paper button with iris-ink label, and
// the focus ring is forced white so it stays visible on iris.
// (outline-accent-fg only — adding outline-ring too would lose: Tailwind emits
// .outline-ring AFTER .outline-accent-fg, and in light mode --color-ring equals
// the band's --color-accent, making the ring invisible. DESIGN_SYSTEM.md.)
const HERO_CTA_BASE =
  'inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg active:translate-y-px';
const HERO_CTA_PRIMARY = `${HERO_CTA_BASE} bg-surface-raised text-accent-text shadow-sm hover:bg-surface`;
const HERO_CTA_SECONDARY = `${HERO_CTA_BASE} border border-accent-fg/50 text-accent-fg hover:bg-accent-fg/10`;

/**
 * Editorial-manifesto hero on a full-bleed iris band. Left-aligned (no centre
 * bias); type is the visual (no external images — CSP). All copy is full white
 * on accent for guaranteed AA (white on accent is ~7.9:1 light / ~5.7:1 dark);
 * hierarchy comes from size and weight, never opacity.
 */
export function MarketingHero() {
  return (
    <section aria-label="Introduction" class="bg-accent text-accent-fg">
      <div class="rm-anim-rise mx-auto flex w-full max-w-5xl flex-col items-start gap-6 px-6 pt-20 pb-20 sm:pt-24 sm:pb-28">
        <div class="flex items-center gap-3">
          <span aria-hidden="true" class="h-px w-8 bg-accent-fg/40" />
          <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-accent-fg uppercase">
            Content, milled
          </span>
        </div>
        <h1 class="max-w-3xl font-serif text-display sm:text-display-lg font-semibold text-balance text-accent-fg">
          Content that works for humans, apps, and agents.
        </h1>
        <p class="max-w-xl text-lg leading-relaxed text-accent-fg">
          A calm admin for people, a clean API for apps, and first-class, permissioned access for
          agents.
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <a href="#connect" class={HERO_CTA_PRIMARY}>
            Connect an agent
          </a>
          <a href="#writing" class={HERO_CTA_SECONDARY}>
            Browse the writing
          </a>
        </div>
      </div>
    </section>
  );
}

// Code / preview panels: real markup lifted off the canvas on a bordered
// surface, keyboard-operable (WCAG 2.1.1, same treatment as the Table primitive).
const PANEL =
  'overflow-x-auto rounded-lg border border-border bg-surface p-5 font-mono text-[13px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const SURFACE_TABS = [
  { key: 'admin', label: 'Admin' },
  { key: 'rest', label: 'REST API' },
  { key: 'agents', label: 'Agents' },
] as const;

// APG tabs keyboard support (A11Y_STANDARDS: custom tabs take Arrow keys).
// Roving tabindex, selection follows focus (automatic activation) — one
// bubbling keydown on the tablist; Datastar expression, ;-separated statements.
const TABLIST_KEYDOWN = [
  `const keys = ['${SURFACE_TABS.map((t) => t.key).join("','")}']`,
  'const i = keys.indexOf($tab)',
  "let next = ''",
  "if (evt.key === 'ArrowRight') next = keys[(i + 1) % keys.length]",
  "else if (evt.key === 'ArrowLeft') next = keys[(i + keys.length - 1) % keys.length]",
  "else if (evt.key === 'Home') next = keys[0]",
  "else if (evt.key === 'End') next = keys[keys.length - 1]",
  "if (next) { evt.preventDefault(); $tab = next; document.getElementById('surface-tab-' + next).focus() }",
].join('; ');

/**
 * The centrepiece: one real collection definition on the left, and a Datastar
 * segmented control on the right that swaps between the three audience-facing
 * surfaces remill generates from it (the admin list, the REST response, an MCP
 * tool call). Proves the six-surfaces idea AND the humans/apps/agents promise
 * in one interactive family. Pure client-side signal (no SSE); all three panels
 * render server-side, so it is axe-clean and degrades to the admin panel with
 * no JS. Datastar idioms per DATASTAR_PATTERNS.md (a): inline signal, string
 * ternary for the always-present aria-selected, display:none on hidden panels.
 */
export function EverySurface() {
  // Both snippets mirror the real wire shapes (flat page/pageSize/total
  // envelope from the list handler; doc_-prefixed nanoid ids) — the section's
  // promise is real markup, never a fake.
  const restResponse = `GET /api/c/essays?status=published

{
  "data": [
    { "id": "doc_aF9x2qWn41Kd",
      "title": "Why we rebuilt the docs",
      "status": "published" }
  ],
  "page": 1, "pageSize": 20, "total": 1
}`;
  const mcpCall = `tools/call  create_essays
{
  "title": "Autumn release notes",
  "body": "## What shipped\\n..."
}

reply  { "id": "doc_b7Kp0dXr93Fh", "status": "draft" }`;

  return (
    <section aria-labelledby="home-surfaces" class="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
      <div class="flex max-w-2xl flex-col gap-4">
        <h2 id="home-surfaces" class={SECTION_H2}>
          One definition works for humans, apps, and agents.
        </h2>
        <p class="leading-relaxed text-ink-muted">
          Define a collection once, in the admin or over MCP, and remill generates all six surfaces:
          storage, validation, the admin list and editor, the REST API, and MCP tools. No deploy, no
          migrations.
        </p>
      </div>

      <div class="mt-10 grid gap-8 lg:grid-cols-2 lg:items-start">
        {/* The one definition. */}
        <div class="flex flex-col gap-3">
          <span class="text-sm font-medium text-ink-muted">One definition</span>
          <pre tabindex={0} role="region" aria-label="Example collection definition" class={PANEL}>
            <code>{`{
  "slug": "essays",
  "name": "Essays",
  "fields": [
    { "key": "title", "type": "text",
      "required": true },
    { "key": "slug", "type": "slug" },
    { "key": "body", "type": "markdown" }
  ],
  "workflow": { "draftPublish": true }
}`}</code>
          </pre>
        </div>

        {/* Every surface — the Datastar segmented preview. */}
        <div class="flex flex-col gap-3" data-signals="{tab: 'admin'}">
          {/* Selected-tab styling keys off aria-selected (the reactive source of
              truth via data-attr) — data-class:* toggles can't be trusted here:
              Tailwind only emits utilities it sees as literal classes, and a
              dynamically-added class loses same-property cascades to the
              always-present base (text-ink vs text-ink-muted). Scoped-style
              idiom per AdminShell's #rm-sidebar rule. */}
          {/* Unquoted attr value on purpose: Hono JSX escapes quotes inside
              <style> to &quot;, which kills the rule; `true` is a CSS ident. */}
          <style>
            {
              '[data-rm-tab][aria-selected=true]{border-color:var(--color-accent);color:var(--color-ink);font-weight:600;}'
            }
          </style>
          <span class="text-sm font-medium text-ink-muted">Every surface</span>
          <div
            role="tablist"
            aria-label="Preview the generated surface"
            class="flex gap-1 border-b border-border"
            data-on:keydown={TABLIST_KEYDOWN}
          >
            {SURFACE_TABS.map((t) => (
              <button
                type="button"
                role="tab"
                id={`surface-tab-${t.key}`}
                data-rm-tab
                aria-controls={`surface-panel-${t.key}`}
                aria-selected={t.key === 'admin' ? 'true' : 'false'}
                tabindex={t.key === 'admin' ? 0 : -1}
                data-attr:aria-selected={`$tab === '${t.key}' ? 'true' : 'false'`}
                data-attr:tabindex={`$tab === '${t.key}' ? '0' : '-1'`}
                data-on:click={`$tab = '${t.key}'`}
                class="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Admin: the real list view remill generates (real Table + Badge). */}
          <div
            id="surface-panel-admin"
            role="tabpanel"
            tabindex={0}
            aria-labelledby="surface-tab-admin"
            data-show="$tab === 'admin'"
            class="rounded-lg border border-border bg-surface p-4 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Table caption="The admin list view remill generates for an Essays collection">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell class="text-right">Updated</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell class="font-medium">Why we rebuilt the docs</TableCell>
                  <TableCell>
                    <Badge tone="success">Published</Badge>
                  </TableCell>
                  <TableCell class="text-right text-ink-subtle">2 Jul 2026</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Autumn release notes</TableCell>
                  <TableCell>
                    <Badge tone="info">Scheduled</Badge>
                  </TableCell>
                  <TableCell class="text-right text-ink-subtle">9 Jul 2026</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Interviews from the print archive</TableCell>
                  <TableCell>
                    <Badge tone="neutral">Draft</Badge>
                  </TableCell>
                  <TableCell class="text-right text-ink-subtle">8 Jul 2026</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* REST API: the same collection as a JSON endpoint. */}
          <div
            id="surface-panel-rest"
            role="tabpanel"
            aria-labelledby="surface-tab-rest"
            data-show="$tab === 'rest'"
            style="display:none"
          >
            <pre tabindex={0} role="region" aria-label="REST API response" class={PANEL}>
              <code>{restResponse}</code>
            </pre>
          </div>

          {/* Agents: the same collection as MCP tools. */}
          <div
            id="surface-panel-agents"
            role="tabpanel"
            aria-labelledby="surface-tab-agents"
            data-show="$tab === 'agents'"
            style="display:none"
          >
            <pre tabindex={0} role="region" aria-label="MCP tool call" class={PANEL}>
              <code>{mcpCall}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

const TRUST: { icon: unknown; lead: string; body: string; wide: boolean }[] = [
  {
    icon: <Bot class="size-6" />,
    lead: 'Agents you can trust.',
    body: 'Every agent gets its own identity, a scoped token, and a least-privilege role. It can draft all day without ever being able to publish.',
    wide: true,
  },
  {
    icon: <Braces class="size-6" />,
    lead: 'An API you can build on.',
    body: 'Every collection is a JSON REST endpoint with bearer tokens, filter operators, and full-text search.',
    wide: false,
  },
  {
    icon: <FileText class="size-6" />,
    lead: 'Publishing built in.',
    body: 'Public pages, RSS, sitemaps, and expiring share links ship with every collection. Schedule a post and remill publishes it.',
    wide: false,
  },
  {
    icon: <ShieldCheck class="size-6" />,
    lead: 'Locked down by default.',
    body: 'Every write, human or agent, runs through one validated, authorized pipeline, and everything lands in the audit log.',
    wide: true,
  },
];

/** Bento grid: four cells, asymmetric spans for rhythm, iris-washed lead cells. */
export function TrustBento() {
  return (
    <section aria-labelledby="home-trust" class="border-t border-border">
      <div class="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
        <h2 id="home-trust" class={SECTION_H2}>
          Built for trust
        </h2>
        <ul class="mt-8 grid gap-4 sm:grid-cols-3">
          {TRUST.map((c) => (
            <li
              class={`rm-scroll-rise flex flex-col gap-3 rounded-xl border border-border p-6 ${
                c.wide ? 'bg-accent-soft sm:col-span-2' : 'bg-surface shadow-sm sm:col-span-1'
              }`}
            >
              <span class="text-accent-text">{c.icon}</span>
              <h3 class="font-serif text-xl font-semibold tracking-tight text-ink">{c.lead}</h3>
              <p class="leading-relaxed text-ink-muted">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Scrollable code panels are keyboard-operable regions (WCAG 2.1.1, mirrors Table).
const CODE_BLOCK =
  'overflow-x-auto rounded-lg border border-border bg-surface-raised p-4 font-mono text-[13px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Numbered steps + working code panels on an iris-washed band. Conversion target. */
export function AgentQuickstart({ baseUrl }: { baseUrl: string }) {
  const mcpConfig = `{
  "mcpServers": {
    "remill": {
      "type": "http",
      "url": "${baseUrl}/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}`;
  const curl = `curl -X POST ${baseUrl}/mcp \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <section
      id="connect"
      aria-labelledby="home-connect"
      class="border-y border-border bg-accent-soft"
    >
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-24">
        <div class="flex flex-col gap-3">
          {/* ink-muted, not ink-subtle: ink-subtle is only AA on canvas/surface,
              and dips below 4.5:1 on the accent-soft band in dark mode. */}
          <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-muted uppercase">
            For agents
          </span>
          <h2 id="home-connect" class={SECTION_H2}>
            Connect an agent
          </h2>
        </div>
        <ol class="flex flex-col gap-8">
          <li class="flex flex-col gap-2">
            <h3 class="font-serif text-xl font-semibold tracking-tight text-ink">
              <span
                aria-hidden="true"
                class="mr-2 font-mono text-base font-medium text-accent-text"
              >
                1
              </span>
              Mint a token
            </h3>
            <p class="leading-relaxed text-ink-muted">
              Sign in and create a bearer token under Access. Scope it to just the collections your
              agent should touch.
            </p>
          </li>
          <li class="flex flex-col gap-3">
            <h3 class="font-serif text-xl font-semibold tracking-tight text-ink">
              <span
                aria-hidden="true"
                class="mr-2 font-mono text-base font-medium text-accent-text"
              >
                2
              </span>
              Add remill to your MCP client
            </h3>
            <p class="leading-relaxed text-ink-muted">
              remill speaks streamable HTTP JSON-RPC. Point any MCP client at the endpoint:
            </p>
            <pre
              tabindex={0}
              role="region"
              aria-label="MCP client configuration"
              class={CODE_BLOCK}
            >
              <code>{mcpConfig}</code>
            </pre>
          </li>
          <li class="flex flex-col gap-3">
            <h3 class="font-serif text-xl font-semibold tracking-tight text-ink">
              <span
                aria-hidden="true"
                class="mr-2 font-mono text-base font-medium text-accent-text"
              >
                3
              </span>
              Or call it raw
            </h3>
            <p class="leading-relaxed text-ink-muted">No SDK required:</p>
            <pre tabindex={0} role="region" aria-label="curl example" class={CODE_BLOCK}>
              <code>{curl}</code>
            </pre>
          </li>
        </ol>
        <p class="border-t border-border pt-6 text-sm leading-relaxed text-ink-muted">
          remill is single-tenant and self-hosted on Cloudflare Workers. Deploy your own mill and
          the same steps apply.
        </p>
      </div>
    </section>
  );
}

/** The live instance's published content: the discovery index, one level down. */
export function PublishedIndex({
  sections,
  settings,
}: {
  sections: { def: CollectionDefinition; docs: DiscoveryDoc[] }[];
  settings: SiteSettings;
}) {
  return (
    <section
      id="writing"
      aria-labelledby="home-writing"
      class="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24"
    >
      <h2 id="home-writing" class={SECTION_H2}>
        Latest writing
      </h2>
      {sections.length ? (
        <div class="mt-8 flex flex-col gap-10">
          {sections.map(({ def, docs }) => (
            <section aria-labelledby={`home-${def.slug}`}>
              <h3
                id={`home-${def.slug}`}
                class="font-serif text-2xl font-semibold tracking-tight text-ink"
              >
                {def.name}
              </h3>
              {docs.length ? (
                <ul class="mt-4 flex flex-col gap-3">
                  {docs.map((d) => (
                    <li class="flex items-baseline justify-between gap-4">
                      <a href={d.path} class={LINK}>
                        {d.title}
                      </a>
                      {d.publishedAt ? (
                        <span class="shrink-0 text-sm text-ink-subtle">
                          {formatDate(d.publishedAt, settings)}
                        </span>
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
      ) : (
        <EmptyState
          class="mt-8"
          title="Nothing published yet"
          description="Sign in to create a collection and publish the first piece."
          action={
            <Button href="/admin" variant="secondary">
              Sign in
            </Button>
          }
        />
      )}
    </section>
  );
}
