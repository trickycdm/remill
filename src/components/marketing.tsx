/**
 * Marketing homepage sections (presentational, Hono JSX — precedent:
 * auth-shell.tsx). Composed by src/routes/index.tsx inside MarketingShell.
 *
 * Design notes (tasteskill v2 + DESIGN_SYSTEM.md): value-first copy, the
 * existing Ink & Paper tokens only, two mono-caps eyebrows on the whole page
 * (hero + quickstart), five distinct section layout families, and the product
 * preview is remill's own UI primitives rendering real markup — never a
 * div-built fake screenshot. Zero em-dashes in visible copy.
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { DatabaseIcon, ShieldCheck, Dashboard, FileText, Braces, Bot } from '@/components/ui/icon';
import { formatDate } from '@/lib/format-date';
import type { SiteSettings } from '@/services/settings';
import type { CollectionDefinition } from '@/fields/types';
import type { DiscoveryDoc } from '@/services/discovery';

const SECTION_H2 = 'font-serif text-display-sm sm:text-display font-semibold text-ink';
const LINK =
  'font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Centered editorial stack: eyebrow, headline, subtext, two CTAs. */
export function MarketingHero() {
  return (
    <section aria-label="Introduction" class="mx-auto w-full max-w-5xl px-6 pt-20 pb-24 sm:pt-24">
      <div class="rm-anim-rise mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
        <div class="flex items-center gap-3">
          <span aria-hidden="true" class="h-px w-8 bg-border-strong" />
          <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
            Content, milled
          </span>
          <span aria-hidden="true" class="h-px w-8 bg-border-strong" />
        </div>
        <h1 class="font-serif text-display sm:text-display-lg font-semibold text-balance text-ink">
          Content that works for humans, apps, and agents.
        </h1>
        <p class="max-w-xl text-lg leading-relaxed text-ink-muted">
          A calm admin for people, a clean JSON API for apps, and first-class, permissioned access
          for AI agents.
        </p>
        <div class="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button href="#connect" size="lg">
            Connect an agent
          </Button>
          <Button href="#writing" variant="secondary" size="lg">
            Browse the writing
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Asymmetric split: outcome copy beside a real component preview. The preview
 * is the product's own Table/Badge primitives rendering example rows (labelled
 * as an example in the caption) — real markup, so it is also axe-clean.
 */
export function CalmAdminSplit() {
  return (
    <section aria-labelledby="home-admin" class="border-y border-border bg-surface">
      <div class="mx-auto grid w-full max-w-5xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-5">
        <div class="flex flex-col gap-4 lg:col-span-2">
          <h2 id="home-admin" class={SECTION_H2}>
            A calm place to write
          </h2>
          <p class="leading-relaxed text-ink-muted">
            Markdown with live preview, revision history with diffs, full-text search, scheduled
            publishing, and a trash that brings things back.
          </p>
        </div>
        <div class="rounded-xl border border-border bg-canvas p-4 shadow-sm lg:col-span-3">
          <Table caption="Example: the list view remill generates for an Essays collection">
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
      </div>
    </section>
  );
}

const OUTCOMES: { lead: string; body: string }[] = [
  {
    lead: 'An API you can build on.',
    body: 'Every collection is a JSON REST endpoint with bearer tokens, filter operators, and full-text search. The OpenAPI spec ships with it.',
  },
  {
    lead: 'Agents you can trust.',
    body: 'Each agent has its own identity, scoped token, and least-privilege role. An agent can draft all day without ever being able to publish.',
  },
  {
    lead: 'Publishing built in.',
    body: 'Public pages, RSS, sitemaps, and expiring share links come with every collection. Schedule a post and the platform publishes it for you.',
  },
  {
    lead: 'Locked down by default.',
    body: 'Every write, human or agent, passes through one validated, authorized pipeline. Nothing is granted implicitly, and everything lands in the audit log.',
  },
];

/** Editorial ledger: full-width rows separated by hairlines, scroll-revealed. */
export function OutcomesLedger() {
  return (
    <section aria-labelledby="home-outcomes" class="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
      <h2 id="home-outcomes" class={SECTION_H2}>
        What you get
      </h2>
      <ul class="mt-8 divide-y divide-border border-t border-border">
        {OUTCOMES.map((o) => (
          <li class="rm-scroll-rise grid gap-2 py-8 sm:grid-cols-[1fr_2fr] sm:gap-8">
            <h3 class="font-serif text-xl font-semibold tracking-tight text-ink">{o.lead}</h3>
            <p class="leading-relaxed text-ink-muted">{o.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SURFACES: { icon: unknown; label: string }[] = [
  { icon: <DatabaseIcon class="size-5" />, label: 'Storage' },
  { icon: <ShieldCheck class="size-5" />, label: 'Validation' },
  { icon: <Dashboard class="size-5" />, label: 'Admin list' },
  { icon: <FileText class="size-5" />, label: 'Edit form' },
  { icon: <Braces class="size-5" />, label: 'REST API' },
  { icon: <Bot class="size-5" />, label: 'MCP tools' },
];

/** Asymmetric two-column proof point: a real definition fans out to six surfaces. */
export function SixSurfaces() {
  return (
    <section aria-labelledby="home-surfaces" class="border-t border-border">
      <div class="mx-auto grid w-full max-w-5xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2">
        {/* Scrollable code panels must be keyboard-operable (WCAG 2.1.1, same
            treatment as the Table primitive): tabindex + role=region + name. */}
        <pre
          tabindex={0}
          role="region"
          aria-label="Example collection definition"
          class="overflow-x-auto rounded-lg border border-border bg-surface p-5 font-mono text-sm leading-relaxed text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        ><code>{`{
  "slug": "essays",
  "name": "Essays",
  "fields": [
    { "key": "title", "type": "text",
      "required": true },
    { "key": "slug", "type": "slug" },
    { "key": "body", "type": "markdown" }
  ],
  "workflow": { "draftPublish": true }
}`}</code></pre>
        <div class="flex flex-col gap-4">
          <h2 id="home-surfaces" class={SECTION_H2}>
            One definition. Six surfaces.
          </h2>
          <p class="leading-relaxed text-ink-muted">
            Define a collection once, in the admin or over MCP, and remill generates the rest. No
            deploy, no migrations.
          </p>
          <ul class="mt-2 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {SURFACES.map((s) => (
              <li class="flex items-center gap-2.5 text-sm font-medium text-ink">
                <span class="text-accent-text">{s.icon}</span>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// Scrollable code panels are keyboard-operable regions (WCAG 2.1.1, mirrors Table).
const CODE_BLOCK =
  'overflow-x-auto rounded-lg border border-border bg-canvas p-4 font-mono text-[13px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Numbered steps + working code panels. The page's conversion target. */
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
    <section id="connect" aria-labelledby="home-connect" class="border-y border-border bg-surface">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-20 sm:py-24">
        <div class="flex flex-col gap-3">
          <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
            For agents
          </span>
          <h2 id="home-connect" class={SECTION_H2}>
            Connect an agent
          </h2>
        </div>
        <ol class="flex flex-col gap-8">
          <li class="flex flex-col gap-2">
            <h3 class="font-serif text-xl font-semibold tracking-tight text-ink">
              <span aria-hidden="true" class="mr-2 font-mono text-base font-medium text-accent-text">
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
              <span aria-hidden="true" class="mr-2 font-mono text-base font-medium text-accent-text">
                2
              </span>
              Add remill to your MCP client
            </h3>
            <p class="leading-relaxed text-ink-muted">
              remill speaks streamable HTTP JSON-RPC. Point any MCP client at the endpoint:
            </p>
            <pre tabindex={0} role="region" aria-label="MCP client configuration" class={CODE_BLOCK}><code>{mcpConfig}</code></pre>
          </li>
          <li class="flex flex-col gap-3">
            <h3 class="font-serif text-xl font-semibold tracking-tight text-ink">
              <span aria-hidden="true" class="mr-2 font-mono text-base font-medium text-accent-text">
                3
              </span>
              Or call it raw
            </h3>
            <p class="leading-relaxed text-ink-muted">No SDK required:</p>
            <pre tabindex={0} role="region" aria-label="curl example" class={CODE_BLOCK}><code>{curl}</code></pre>
          </li>
        </ol>
        <p class="border-t border-border pt-6 text-sm leading-relaxed text-ink-subtle">
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
    <section id="writing" aria-labelledby="home-writing" class="mx-auto w-full max-w-5xl px-6 py-20 sm:py-24">
      <h2 id="home-writing" class={SECTION_H2}>
        Latest writing
      </h2>
      {sections.length ? (
        <div class="mt-8 flex flex-col gap-10">
          {sections.map(({ def, docs }) => (
            <section aria-labelledby={`home-${def.slug}`}>
              <h3 id={`home-${def.slug}`} class="font-serif text-2xl font-semibold tracking-tight text-ink">
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
