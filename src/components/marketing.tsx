/**
 * Marketing homepage sections (presentational, Hono JSX — precedent:
 * auth-shell.tsx). Composed by src/routes/index.tsx inside MarketingShell.
 *
 * Design notes (DESIGN_SYSTEM.md, "Overprint"): the POSTER cut — the mock's
 * structure, not just its skin. Sections separated by full-bleed perforation
 * rules (rm-perf dashed working-ink), no tonal banding: promise (oversized
 * overprint hero + activity vignette) -> manifesto (who it's for, offset
 * second voice) -> the JOB TICKET (hairline panels, PROOF -> SIGN-OFF
 * stamps, the six pressings as pills, the live surfaces tabs) -> the SETLIST
 * (jobs as a numbered bill) -> the stamped audit ledger (the trust act) ->
 * the COUPON quickstart -> the dogfood index -> the DARK CLOSING ACT: the
 * #run band flips color-scheme via rm-dark-act and flows into the footer,
 * signing the page off in the gig-poster register in both themes. The two
 * code panels that earn their place stay (REST wire response, MCP client
 * config). Motion is CSS-only (entrance stagger, scroll-rise),
 * reduced-motion-safe. Exactly two mono-caps eyebrows page-wide (hero +
 * quickstart); zero em-dashes in visible copy. The primary CTA is "Run your
 * own mill" — remill.org is a single-tenant instance, so a cold visitor's
 * conversion is deploying their own, never signing in here.
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stamp } from '@/components/ui/stamp';
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ArrowRight,
  Bot,
  Boxes,
  Braces,
  CircleCheck,
  DatabaseIcon,
  FileText,
  Globe,
  Image,
  PenNib,
  ShieldCheck,
} from '@/components/ui/icon';
import { formatDate } from '@/lib/format-date';
import { mcpJsonConfig } from '@/lib/connect-snippets';
import type { SiteSettings } from '@/services/settings';
import type { CollectionDefinition } from '@/fields/types';
import type { DiscoveryDoc } from '@/services/discovery';

const SECTION_H2 = 'font-display text-display-sm sm:text-display font-semibold text-ink';
const LINK =
  'font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

// Hero CTAs sit on the plain stock (the band hero is gone), so the standard
// ring token just works. Primary is the working ink with the pop offset
// shadow (the one print flourish a CTA gets); secondary is a hairline.
const HERO_CTA_BASE =
  'inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px';
const HERO_CTA_PRIMARY = `${HERO_CTA_BASE} rm-offset-shadow bg-accent text-accent-fg hover:bg-accent-hover`;
const HERO_CTA_SECONDARY = `${HERO_CTA_BASE} border-[1.5px] border-accent-text text-accent-text hover:bg-accent-soft`;

/**
 * The mark at display size: two passes, pop ink under, working ink over,
 * misregistered by ~1.5px (DESIGN_SYSTEM.md: overprint at >=40px only; below
 * 24px the mark is always single-ink overlap violet, see Wordmark).
 */
function OverprintNib({ class: cls = 'size-10' }: { class?: string }) {
  return (
    <span aria-hidden="true" class="relative inline-block">
      <PenNib class={`${cls} absolute top-[1.5px] left-[1.5px] text-pop`} />
      <PenNib class={`${cls} relative text-accent-text`} />
    </span>
  );
}

/** One vignette row: icon + event + mono meta, the audit trail as hero art. */
function VignetteRow({
  icon,
  title,
  meta,
  badge,
}: {
  icon: unknown;
  title: string;
  meta: string;
  badge?: unknown;
}) {
  return (
    <li class="flex items-center gap-3 py-3">
      <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text">
        {icon}
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-ink">{title}</p>
        <p class="font-mono text-xs text-ink-subtle">{meta}</p>
      </div>
      {badge}
    </li>
  );
}

/**
 * Asymmetric split hero ON the stock (no colour band): overprint title, pink
 * halftone corner texture behind the vignette, both print devices from
 * tailwind.css. Left: the promise, staggered in. Right: the product told as
 * a story — an agent drafts overnight, a person presses publish — rendered
 * with remill's real primitives, backed by a misregistered second-pass panel.
 */
export function MarketingHero() {
  return (
    <section aria-label="Introduction" class="relative overflow-hidden">
      <div
        aria-hidden="true"
        class="rm-halftone -top-24 -right-24 hidden size-[26rem] lg:block"
      />
      <div class="rm-stagger relative mx-auto grid w-full max-w-6xl gap-12 px-6 pt-16 pb-16 sm:pt-20 sm:pb-24 lg:grid-cols-[1.2fr_minmax(0,24rem)] lg:items-center lg:gap-16">
        <div class="flex flex-col items-start gap-6">
          <div class="flex items-center gap-3">
            <span aria-hidden="true" class="h-px w-8 bg-border-strong" />
            <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-accent-text uppercase">
              Content, milled
            </span>
          </div>
          <h1 class="rm-overprint-title max-w-3xl font-display text-display sm:text-display-lg font-bold text-balance lg:text-7xl lg:leading-[1.02] lg:tracking-[-0.035em]">
            Content that works for humans, apps, and agents.
          </h1>
          <p class="max-w-xl text-lg leading-relaxed text-ink-muted">
            A calm GUI for people, a clean API for apps, and permissioned MCP for agents.
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <a href="#run" class={HERO_CTA_PRIMARY}>
              Run your own mill
            </a>
            <a href="#connect" class={HERO_CTA_SECONDARY}>
              Connect an agent
            </a>
          </div>
        </div>

        <figure aria-label="A draft moving through remill" class="relative w-full max-w-md">
          <div
            aria-hidden="true"
            class="border-pop/50 bg-pop-soft/50 absolute -inset-3 hidden rounded-2xl border-[1.5px] lg:block lg:-rotate-2"
          />
          <span class="absolute -top-5 -right-2 z-10 hidden rotate-6 lg:inline-block">
            <OverprintNib class="size-11" />
          </span>
          <div class="border-accent/60 relative rounded-xl border-[1.5px] bg-surface-raised p-5 shadow-sm lg:rotate-1">
            <ul class="rm-stagger flex flex-col divide-y divide-border">
              <VignetteRow
                icon={<Bot class="size-4" />}
                title="Autumn release notes"
                meta="create_essays · 02:14"
                badge={<Badge tone="neutral">Draft</Badge>}
              />
              <VignetteRow
                icon={<PenNib class="size-4" />}
                title="You tightened the standfirst"
                meta="edited · 09:12"
              />
              <VignetteRow
                icon={<CircleCheck class="size-4" />}
                title="You pressed publish"
                meta="published · 09:31"
                badge={<Badge tone="success">Published</Badge>}
              />
            </ul>
            <figcaption class="flex items-center gap-2 border-t border-border pt-3 font-mono text-xs text-ink-subtle">
              <Globe class="size-3.5 shrink-0" />
              <span class="truncate">/essays/autumn-release-notes</span>
            </figcaption>
          </div>
        </figure>
      </div>
    </section>
  );
}

/**
 * The who/why beat as a poster manifesto between perforation rules: the
 * sentence gets the full display scale, the two supporting paragraphs sit
 * offset to the right (the asymmetric second voice under the statement).
 */
export function WhoItsFor() {
  return (
    <section aria-labelledby="home-who" class="rm-perf">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-20 sm:py-28">
        <h2
          id="home-who"
          class="rm-scroll-rise max-w-4xl font-display text-display sm:text-display-lg font-bold text-balance text-ink lg:text-6xl lg:leading-[1.05]"
        >
          A backend where the AI is a citizen, not a shared key.
        </h2>
        <div class="grid max-w-2xl gap-5 leading-relaxed text-ink-muted lg:ml-[30%]">
          <p>
            remill is for builders who let agents write. An agent here is a principal: its own
            identity, a scoped token, a least-privilege role, and an audit trail.
          </p>
          <p>
            People get a calm GUI. Apps get a clean REST API. Agents get MCP tools. Every write
            goes through the same validated, authorized pipeline.
          </p>
        </div>
      </div>
    </section>
  );
}

// The one code panel in the proof section: keyboard-operable region
// (WCAG 2.1.1, same treatment as the Table primitive). Job-ticket hairline.
const PANEL =
  'overflow-x-auto rounded-lg border-[1.5px] border-accent/60 bg-surface p-5 font-mono text-[13px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Mono type chip for the job ticket (field types, flags) — thin outline in
 *  the working ink, per the Overprint chip language. */
function TypeChip({ children }: { children?: unknown }) {
  return (
    <span class="border-accent-text/50 text-accent-text rounded-sm border-[1.5px] px-1.5 py-0.5 font-mono text-xs font-medium">
      {children}
    </span>
  );
}

const SCHEMA_FIELDS: { label: string; chips: string[] }[] = [
  { label: 'Title', chips: ['text', 'required'] },
  { label: 'Slug', chips: ['slug'] },
  { label: 'Body', chips: ['markdown'] },
];

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
 * The centrepiece: the collection definition rendered as a schema CARD (the
 * product's own visual language, not raw JSON), and a Datastar segmented
 * control that swaps between the three audience-facing surfaces remill
 * generates from it: the real admin list, the REST wire response (the one
 * code panel this section keeps), and the MCP call as a tool-call card.
 * Pure client-side signal (no SSE); all three panels render server-side, so
 * it is axe-clean and degrades to the admin panel with no JS. Datastar idioms
 * per DATASTAR_PATTERNS.md (a): inline signal, string ternary for the
 * always-present aria-selected, display:none on hidden panels.
 */
export function EverySurface() {
  // The REST snippet mirrors the real wire shape (flat page/pageSize/total
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

  return (
    <section aria-labelledby="home-surfaces" class="rm-perf">
      <div class="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
      <div class="flex max-w-2xl flex-col gap-4">
        <h2 id="home-surfaces" class={SECTION_H2}>
          Define it once. It ships six ways.
        </h2>
        <p class="leading-relaxed text-ink-muted">
          One collection definition, written in the admin or over MCP, generates storage,
          validation, the admin list and editor, the REST API, and MCP tools. No deploy, no
          migrations.
        </p>
      </div>

      <div class="mt-12 grid gap-10 lg:grid-cols-[minmax(0,21rem)_1fr] lg:gap-12">
        {/* The one definition, as a JOB TICKET (hairline working-ink panel;
            the workflow gate is stamped: a draft is a PROOF, publishing is
            the SIGN-OFF — the same grantable permission the trust section
            talks about). */}
        <div class="rm-scroll-rise flex flex-col gap-3">
          <span class="text-sm font-medium text-ink-muted">One definition</span>
          <div class="border-accent/60 rounded-xl border-[1.5px] bg-surface">
            <div class="border-accent/60 flex items-baseline justify-between gap-3 border-b-[1.5px] px-5 py-4">
              <span class="font-display text-lg font-semibold tracking-tight text-ink">
                Job &middot; Essays
              </span>
              <span class="font-mono text-xs text-ink-subtle">collection</span>
            </div>
            <ul class="flex flex-col divide-y divide-border px-5">
              {SCHEMA_FIELDS.map((f) => (
                <li class="flex items-center justify-between gap-3 py-3.5">
                  <span class="text-sm font-medium text-ink">{f.label}</span>
                  <span class="flex gap-1.5">
                    {f.chips.map((chip) => (
                      <TypeChip>{chip}</TypeChip>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <div class="flex items-center gap-2 border-t border-border px-5 py-4">
              <Stamp>Proof</Stamp>
              <ArrowRight aria-hidden="true" class="size-3.5 text-ink-subtle" />
              <Stamp tone="event">Sign-off</Stamp>
              <span class="ml-auto font-mono text-xs text-ink-subtle">workflow</span>
            </div>
            {/* The six pressings: what this one ticket runs onto. */}
            <div class="border-pop/40 bg-pop-soft/30 flex flex-wrap gap-1.5 border-t-[1.5px] px-5 py-3.5">
              {['storage', 'validation', 'admin list', 'edit form', 'REST API', 'MCP tools'].map(
                (out) => (
                  <span class="border-pop-text/50 text-pop-text rounded-full border-[1.5px] px-2.5 py-0.5 font-mono text-xs font-medium">
                    {out}
                  </span>
                ),
              )}
            </div>
          </div>
          <p class="text-sm leading-relaxed text-ink-muted">
            Written in the admin, or by an agent over MCP. Drafts are proofs; publishing is the
            sign-off, a permission you grant.
          </p>
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
              '[data-rm-tab][aria-selected=true]{background:var(--color-surface-raised);color:var(--color-ink);font-weight:600;box-shadow:var(--shadow-xs);}'
            }
          </style>
          <span class="text-sm font-medium text-ink-muted">Every surface</span>
          <div
            role="tablist"
            aria-label="Preview the generated surface"
            class="inline-flex w-fit gap-1 rounded-lg border border-border bg-canvas p-1"
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
                class="rounded-md px-3.5 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
            class="border-accent/60 rounded-xl border-[1.5px] bg-surface p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

          {/* Agents: the same collection as an MCP tool call, told as a card. */}
          <div
            id="surface-panel-agents"
            role="tabpanel"
            aria-labelledby="surface-tab-agents"
            data-show="$tab === 'agents'"
            style="display:none"
          >
            <div class="border-accent/60 flex flex-col gap-4 rounded-xl border-[1.5px] bg-surface p-5">
              <div class="flex items-center gap-2 border-b border-border pb-3">
                <Bot class="size-4 text-accent-text" />
                <code class="font-mono text-sm font-semibold text-ink">create_essays</code>
                <span class="ml-auto font-mono text-xs text-ink-subtle">tools/call</span>
              </div>
              <dl class="flex flex-col gap-2 font-mono text-[13px] leading-relaxed">
                <div class="flex gap-4">
                  <dt class="w-10 shrink-0 text-ink-subtle">title</dt>
                  <dd class="min-w-0 text-ink">"Autumn release notes"</dd>
                </div>
                <div class="flex gap-4">
                  <dt class="w-10 shrink-0 text-ink-subtle">body</dt>
                  <dd class="min-w-0 truncate text-ink">"## What shipped ..."</dd>
                </div>
              </dl>
              <div class="flex items-center gap-3 border-t border-border pt-3">
                <Badge tone="neutral">Draft</Badge>
                <code class="font-mono text-xs text-ink-subtle">doc_b7Kp0dXr93Fh</code>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}

/** The jobs the platform is genuinely best at, told as second-person stories —
 *  scenarios, deliberately NOT dressed up as testimonials (no invented names). */
const USE_CASES: { icon: unknown; title: string; story: string }[] = [
  {
    icon: <Bot class="size-5" />,
    title: 'Agent drafts, human publishes',
    story:
      'Your agent turns the changelog into release-note drafts overnight. You read them over ' +
      'coffee and press publish, a permission you kept for yourself.',
  },
  {
    icon: <Braces class="size-5" />,
    title: 'A backend for agent products',
    story:
      'Give a support agent a token scoped to one collection. It files drafts over MCP; your ' +
      'app reads the same data over REST. Nothing else is exposed.',
  },
  {
    icon: <PenNib class="size-5" />,
    title: 'Publishing you own',
    story:
      'Write on your own Worker. Public pages, RSS, scheduled posts, and expiring draft links ' +
      'ship with every collection. No third party holds your content.',
  },
];

/** Use cases as the SETLIST (the gig-poster device): numbered bill rows with
 *  display-scale titles and the story as the tail, dashed rules between —
 *  the perforation echo at row scale. */
export function UseCases() {
  return (
    <section aria-labelledby="home-jobs" class="rm-perf">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-20 sm:py-24">
        <h2 id="home-jobs" class={SECTION_H2}>
          What the mill is for
        </h2>
        <ol class="flex flex-col">
          {USE_CASES.map((u, i) => (
            <li class="rm-scroll-rise grid items-baseline gap-2 border-t-[1.5px] border-dashed border-border-strong py-8 first:border-t-0 first:pt-2 last:pb-0 sm:grid-cols-[3rem_1fr_minmax(0,26rem)] sm:gap-6">
              <span aria-hidden="true" class="text-pop-text font-mono text-sm font-bold">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                {u.title}
              </h3>
              <p class="leading-relaxed text-ink-muted">{u.story}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const TRUST: { icon: unknown; lead: string; body: string }[] = [
  {
    icon: <Braces class="size-6" />,
    lead: 'An API you can build on.',
    body: 'Every collection is a JSON REST endpoint with bearer tokens, filter operators, and full-text search.',
  },
  {
    icon: <FileText class="size-6" />,
    lead: 'Publishing built in.',
    body: 'Public pages, RSS, sitemaps, and expiring share links ship with every collection. Schedule a post and remill publishes it.',
  },
  {
    icon: <ShieldCheck class="size-6" />,
    lead: 'Locked down by default.',
    body: 'Default-deny access, additive-only grants. Fields that were never declared are rejected before they reach storage.',
  },
];

/** One large audit decision, stamped: mono ledger line + the Stamp at poster
 *  scale. The falsifiable claim shown, not asserted. */
function AuditLine({
  line,
  stamp,
  tone,
  tilt,
}: {
  line: string;
  stamp: string;
  tone?: 'affirm' | 'event' | 'refuse';
  tilt?: 'none' | 'up' | 'down';
}) {
  return (
    <li class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t-[1.5px] border-dashed border-border-strong py-5 first:border-t-0 first:pt-0 last:pb-0">
      <span class="min-w-0 flex-1 truncate font-mono text-sm text-ink-muted">{line}</span>
      <Stamp tone={tone} tilt={tilt} class="px-3 py-1 text-sm">
        {stamp}
      </Stamp>
    </li>
  );
}

/** The trust act: the falsifiable claim as the headline, the audit ledger
 *  stamped at poster scale (the mock's floating-stamps moment, grounded in
 *  real decisions), then the three remaining guarantees as one ticket row. */
export function TrustBento() {
  return (
    <section aria-labelledby="home-trust" class="rm-perf">
      <div class="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <h2 id="home-trust" class={`${SECTION_H2} max-w-3xl lg:text-5xl lg:leading-[1.1]`}>
          Your agent can draft all night. Whether it publishes is up to you.
        </h2>
        <p class="mt-4 max-w-2xl leading-relaxed text-ink-muted">
          Access starts at deny: an agent holds exactly the permissions you grant, publish
          included. Every write, human or agent, runs through one authorized pipeline and lands in
          the audit log under its own token. Even a denial is recorded, attributed to the exact
          token that asked.
        </p>
        <ul class="mt-10 max-w-3xl">
          <AuditLine line="02:14 · create_essays · claude-code" stamp="Allowed" />
          <AuditLine
            line="02:15 · publish_essays · claude-code"
            stamp="Denied"
            tone="refuse"
            tilt="down"
          />
          <AuditLine line="09:31 · publish · you" stamp="Signed off" tone="event" />
        </ul>
        <ul class="mt-12 grid gap-4 sm:grid-cols-3">
          {TRUST.map((c) => (
            <li class="rm-scroll-rise flex flex-col gap-3 rounded-xl border-[1.5px] border-border bg-surface p-6">
              <span class="text-accent-text">{c.icon}</span>
              <h3 class="font-display text-xl font-semibold tracking-tight text-ink">{c.lead}</h3>
              <p class="leading-relaxed text-ink-muted">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The pieces a mill is made of — concrete, not marketing abstractions. */
const MILL_PIECES: { icon: unknown; label: string; body: string }[] = [
  {
    icon: <Boxes class="size-5" />,
    label: 'One Worker',
    body: 'The whole platform: admin, API, MCP, public pages.',
  },
  {
    icon: <DatabaseIcon class="size-5" />,
    label: 'One D1 database',
    body: 'Schema as data; content, index, and audit trail.',
  },
  {
    icon: <Image class="size-5" />,
    label: 'One R2 bucket',
    body: 'Media originals, streamed with range support.',
  },
  {
    icon: <Globe class="size-5" />,
    label: 'Your domain',
    body: 'Feeds, OG cards, and share links mint from it.',
  },
];

/**
 * The real conversion story (the funnel bug the review named): remill.org is
 * the author's single-tenant instance, so a cold visitor's path is DEPLOY YOUR
 * OWN, not sign-in. Honest about availability: the repo is private while it is
 * readied for release, so the CTA-grade artifact here is the open API
 * reference, and the section earns trust by being concrete about the pieces.
 * TODO(release): add the repository link + license line here and in the footer
 * when the source goes public.
 */
export function RunYourOwnMill() {
  return (
    <section
      id="run"
      aria-labelledby="home-run"
      class="rm-dark-act scroll-mt-20 bg-canvas text-ink"
    >
      <div class="mx-auto grid w-full max-w-6xl gap-10 px-6 py-20 sm:py-28 lg:grid-cols-[1fr_24rem] lg:gap-16">
        <div class="flex flex-col gap-4">
          <h2 id="home-run" class={`${SECTION_H2} lg:text-6xl lg:leading-[1.05]`}>
            Run your own mill.
          </h2>
          <p class="max-w-2xl leading-relaxed text-ink-muted">
            remill is single-tenant on purpose: one Worker, one database, one bucket, all yours. A
            styled CMS on your own Cloudflare URL in under ten minutes, deployed from your own
            repository by GitHub Actions.
          </p>
          <p class="max-w-2xl leading-relaxed text-ink-muted">
            remill.org runs this exact code as the author's own mill. The source is being readied
            for a public release; the live API is open to read today.
          </p>
          <p class="mt-2">
            <a href="/api/openapi.json" class={LINK}>
              Browse the live API reference
            </a>
          </p>
        </div>
        <ul class="grid grid-cols-2 gap-4 self-start">
          {MILL_PIECES.map((p) => (
            <li class="rm-scroll-rise flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
              <span class="text-accent-text">{p.icon}</span>
              <span class="font-mono text-sm font-medium text-ink">{p.label}</span>
              <span class="text-sm leading-relaxed text-ink-muted">{p.body}</span>
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

/** The tools a connected agent gets for an example collection — shown as
 *  chips, not another code block. */
const EXAMPLE_TOOLS = [
  'list_essays',
  'create_essays',
  'search_essays',
  'share_link_essays',
  'publish_essays',
] as const;

/** One coupon of the quickstart strip: pop numeral, display heading, body. */
function Coupon({ n, title, children }: { n: string; title: string; children?: unknown }) {
  return (
    <li class="relative flex flex-col gap-2 border-b-[1.5px] border-dashed border-border-strong p-6 last:border-b-0 sm:border-r-[1.5px] sm:border-b-0 sm:last:border-r-0">
      <span aria-hidden="true" class="text-pop-text absolute top-4 right-5 font-mono text-lg font-bold">
        {n}
      </span>
      <h3 class="pr-8 font-display text-xl font-semibold tracking-tight text-ink">{title}</h3>
      {children}
    </li>
  );
}

/**
 * Coupon-strip quickstart on the ink-washed band: three perforated coupons
 * in one ticket (dashed rules = the perforation), ONE code artifact (the MCP
 * client config, with a copy button), and the generated tools shown as chips
 * instead of a curl dump. Conversion target.
 */
export function AgentQuickstart({ baseUrl }: { baseUrl: string }) {
  // Shared builder (D48) — the wizard's .mcp.json card renders the same shape.
  const mcpConfig = mcpJsonConfig(baseUrl, '<token>');

  return (
    <section id="connect" aria-labelledby="home-connect" class="rm-perf scroll-mt-20">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-20 sm:py-24">
        <div class="flex flex-col gap-3">
          <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-muted uppercase">
            For agents
          </span>
          <h2 id="home-connect" class={SECTION_H2}>
            Connect an agent
          </h2>
        </div>
        <ol class="border-accent/60 grid overflow-hidden rounded-xl border-[1.5px] bg-surface sm:grid-cols-[1fr_1.7fr_1fr]">
          <Coupon n="1" title="Connect by URL">
            <p class="text-sm leading-relaxed text-ink-muted">
              Paste <code class="font-mono text-xs">{baseUrl || 'https://your.remill'}/mcp</code>{' '}
              into any MCP client and approve it in your browser — remill speaks OAuth, so
              claude.ai, ChatGPT, and Claude Code connect by URL alone. Or sign in and use the
              one-step connect wizard for a token with a paste-ready config.
            </p>
          </Coupon>
          <Coupon n="2" title="Or configure it by hand">
            <p class="text-sm leading-relaxed text-ink-muted">
              remill speaks streamable HTTP JSON-RPC. Point any MCP client at the endpoint, or
              call it raw; no SDK required.
            </p>
            <div class="relative" data-signals="{copied: false}">
              <pre
                id="mcp-config-src"
                tabindex={0}
                role="region"
                aria-label="MCP client configuration"
                class={CODE_BLOCK}
              >
                <code>{mcpConfig}</code>
              </pre>
              <button
                type="button"
                class="absolute top-2 right-2 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted shadow-xs transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                data-on:click="navigator.clipboard.writeText(document.getElementById('mcp-config-src').textContent); $copied = true; setTimeout(() => $copied = false, 1600)"
              >
                <span data-show="!$copied">Copy</span>
                <span data-show="$copied" style="display:none">
                  Copied
                </span>
              </button>
            </div>
          </Coupon>
          <Coupon n="3" title="Put it to work">
            <p class="text-sm leading-relaxed text-ink-muted">
              Every collection the token can see becomes a set of tools, gated by its grants:
            </p>
            <ul aria-label="Generated MCP tools" class="flex flex-wrap gap-2">
              {EXAMPLE_TOOLS.map((t) => (
                <li class="rounded-md border border-border bg-canvas px-2.5 py-1 font-mono text-xs text-ink">
                  {t}
                </li>
              ))}
            </ul>
          </Coupon>
        </ol>
        <p class="text-sm leading-relaxed text-ink-muted">
          remill is single-tenant and self-hosted on Cloudflare Workers. Deploy your own mill and
          the same steps apply.
        </p>
      </div>
    </section>
  );
}

/** The live instance's published content, reframed as dogfood proof: this page
 *  IS the product. Empty collections are hidden (an empty state is an admin's
 *  affordance, not a visitor's); a fresh install still gets the whole-page
 *  EmptyState below. */
export function PublishedIndex({
  sections,
  settings,
}: {
  sections: { def: CollectionDefinition; docs: DiscoveryDoc[] }[];
  settings: SiteSettings;
}) {
  const populated = sections.filter(({ docs }) => docs.length > 0);
  return (
    <section id="writing" aria-labelledby="home-writing" class="rm-perf scroll-mt-20">
      <div class="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <h2 id="home-writing" class={SECTION_H2}>
        This site is a remill
      </h2>
      {populated.length ? (
        <p class="mt-4 max-w-2xl leading-relaxed text-ink-muted">
          You're reading the product. This page, the writing below, its feeds, and the open API are
          all served by one instance.
        </p>
      ) : null}
      {populated.length ? (
        <div class="mt-8 flex flex-col gap-10">
          {populated.map(({ def, docs }) => (
            <section aria-labelledby={`home-${def.slug}`}>
              <h3
                id={`home-${def.slug}`}
                class="font-display text-2xl font-semibold tracking-tight text-ink"
              >
                {def.name}
              </h3>
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
      </div>
    </section>
  );
}
