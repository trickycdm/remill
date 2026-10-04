/**
 * Sharing in the editor — a short summary in the rail and a drawer that does
 * the managing.
 *
 *  - `ShareSummary` is the rail section: how many links and direct grants
 *    exist, and the button that opens the drawer. It stays three lines tall no
 *    matter how much is shared, which is what keeps the rail from needing its
 *    own scrollbar.
 *  - `ShareDrawer` wraps `ShareManager`: ONE "New link" form (read-only or
 *    can-comment — the same two service calls as before, chosen by a radio
 *    named `op`), ONE list of every link, and the People & roles grants
 *    (`manage_access` only).
 *
 * Every form posts with Datastar to the share handler, which answers with a
 * re-rendered `#share-manager` + `#share-summary` (morph-by-id,
 * DATASTAR_PATTERNS §d). Nothing navigates, so unsaved edits in the editor
 * behind the drawer survive, and a new link appears in place — highlighted,
 * with its Copy button — instead of on an interstitial page.
 *
 * Signals live on the drawer wrapper, OUTSIDE the morphed region, so a
 * re-render never resets them. Link ids are nanoids (invalid signal names), so
 * per-row state is native `<details>`.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import type { CollectionDefinition } from '@/fields/types';
import type { ShareLinkListItem } from '@/services/access';
import type { ReviewLinkListItem } from '@/services/comments';
import type { ShareOverview, SharePeople } from '@/services/sharing';
import type { SiteSettings } from '@/services/settings';
import type { Visibility } from '@/lib/visibility';
import { isAnonymouslyReadable } from '@/lib/def-helpers';
import { formatDate } from '@/lib/format-date';
import { personaOf, PERSONA_LABEL } from '@/lib/persona';
import { CopyField, RailSection } from '@/components/admin/editor-sidebar';
import {
  ACCESS_ACTION_LABELS,
  Badge,
  Button,
  Checkbox,
  ChevronRight,
  Drawer,
  FormField,
  Input,
  Plus,
  Select,
  cx,
} from '@/components/ui';

export const SHARE_DRAWER_ID = 'rm-share';

/** Actions meaningful to grant on a single document. */
const SHARE_ACTIONS = ['read', 'update', 'delete', 'publish'] as const;

/** The minimal document shape sharing needs — a structural subset so these
 *  stay presentational components. */
export interface ShareDoc {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly visibility?: Visibility;
}

/** What the last action did, rendered at the top of the manager. */
export interface ShareFlash {
  readonly tone: 'success' | 'danger';
  readonly message: string;
  /** The URL of a link minted by this request — its row is lifted to the top
   *  and highlighted. */
  readonly newUrl?: string;
  /** A pending review-mode flip awaiting confirmation, shown in that row. */
  readonly confirmFlip?: { readonly grantId: string; readonly to: 'group' | 'individual'; readonly warning: string };
}

/** Where the drawer is mounted. The handler answers the EDITOR with the rail
 *  summary beside the manager and falls back to the edit page; the framed
 *  VIEWER (D60) has no rail, and falls back to the view. */
export type ShareSurface = 'editor' | 'viewer';

interface ShareProps {
  slug: string;
  id: string;
  surface?: ShareSurface;
  def: CollectionDefinition;
  doc: ShareDoc;
  overview: ShareOverview;
  settings?: SiteSettings;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `@post` as a form submission — the Datastar form idiom (DATASTAR_PATTERNS
 *  §b). The response re-renders every form, so no busy signal is needed. */
function post(action: string): Record<string, string> {
  return { 'data-on:submit': `@post('${action}', {contentType: 'form'})` };
}

const SUMMARY_BASE =
  'inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-[13px] font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden';

function Chevron(): JSX.Element {
  return <ChevronRight class="size-3.5 transition-transform group-open:rotate-90" />;
}

function SectionHeading({ children, count }: { children: unknown; count?: number }): JSX.Element {
  return (
    <h3 class="flex items-baseline gap-2 font-display text-base font-semibold tracking-tight text-ink">
      {children}
      {count !== undefined ? <span class="font-mono text-xs font-normal text-ink-subtle">{count}</span> : null}
    </h3>
  );
}

// ── Rail summary ────────────────────────────────────────────────────────────

/** The rail's Share section (`#share-summary`): counts + the drawer trigger. */
export function ShareSummary({ def, doc, overview }: Pick<ShareProps, 'def' | 'doc' | 'overview'>): JSX.Element {
  const read = overview.links?.length ?? 0;
  const review = overview.reviewLinks?.length ?? 0;
  const grants = overview.people?.grants.length ?? 0;
  const parts = [
    overview.links && read ? plural(read, 'read-only link') : null,
    overview.reviewLinks && review ? plural(review, 'review link') : null,
    overview.people && grants ? `${plural(grants, 'person or role', 'people or roles')} with direct access` : null,
  ].filter((p): p is string => p !== null);
  const alreadyPublic = overview.links !== null && isAnonymouslyReadable(def, doc);

  return (
    <RailSection id="share-summary" title="Share">
      {parts.length ? (
        <ul class="flex flex-col gap-1 text-sm text-ink-muted">
          {parts.map((p) => (
            <li>{p}</li>
          ))}
        </ul>
      ) : (
        <p class="text-sm text-ink-muted">
          {alreadyPublic ? 'No links or direct access.' : 'Not shared with anyone yet.'}
        </p>
      )}
      {alreadyPublic ? (
        <p class="text-[13px] leading-normal text-ink-subtle">Anyone can already read this at its public URL.</p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        class="self-start"
        aria-haspopup="dialog"
        data-on:click={`document.getElementById('${SHARE_DRAWER_ID}').showModal()`}
      >
        {parts.length ? 'Manage sharing…' : 'Share…'}
      </Button>
    </RailSection>
  );
}

// ── Links ───────────────────────────────────────────────────────────────────

type AnyLink = (ShareLinkListItem & { readonly review?: undefined }) | (ShareLinkListItem & { readonly review: ReviewLinkListItem });

function linkMeta(l: AnyLink, settings?: SiteSettings): string {
  const bits = [
    l.hasPassword ? 'Password' : 'No password',
    l.expiresAt ? `Expires ${formatDate(l.expiresAt, settings)}` : 'Never expires',
  ];
  if (l.review) {
    const done = l.review.reviewers.filter((r) => r.doneAt).length;
    const active = l.review.reviewers.length - done;
    bits.push(l.review.reviewMode === 'group' ? 'Group' : 'Individual');
    bits.push(
      l.review.reviewers.length
        ? [active ? `${active} reviewing` : null, done ? `${done} done` : null].filter(Boolean).join(', ')
        : 'No reviewers yet',
    );
  }
  return bits.join(' · ');
}

function LinkRow({
  link,
  action,
  settings,
  flash,
}: {
  link: AnyLink;
  action: string;
  settings?: SiteSettings;
  flash?: ShareFlash;
}): JSX.Element {
  const isNew = !!flash?.newUrl && link.url === flash.newUrl;
  const flip = flash?.confirmFlip?.grantId === link.id ? flash.confirmFlip : undefined;
  const name = link.label ?? (link.review ? 'Review link' : 'Untitled link');
  return (
    <li
      data-share-link={link.review ? 'review' : 'read'}
      class={cx('flex flex-col gap-2 px-3 py-3', isNew && 'rounded-md bg-accent-soft')}
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="truncate text-sm font-medium text-ink">{name}</span>
        <Badge tone={link.review ? 'success' : 'neutral'}>{link.review ? 'Can comment' : 'Read only'}</Badge>
        {isNew ? <Badge tone="accent">New</Badge> : null}
      </div>
      <p class="font-mono text-xs leading-relaxed text-ink-subtle">{linkMeta(link, settings)}</p>

      {link.url ? (
        <CopyField id={`share-link-url-${link.id}`} label={`URL for ${name}`} value={link.url} hideLabel />
      ) : (
        <p class="text-[13px] text-ink-muted">This link can't be shown again. Revoke it and create a new one.</p>
      )}

      {flip ? (
        <div role="alert" class="flex flex-col gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2">
          <p class="text-sm text-warning">{flip.warning}</p>
          <div class="flex flex-wrap gap-2">
            <form method="post" action={action} {...post(action)}>
              <input type="hidden" name="op" value="review_mode" />
              <input type="hidden" name="grantId" value={link.id} />
              <input type="hidden" name="mode" value={flip.to} />
              <Button type="submit" size="sm">
                {flip.to === 'group' ? 'Switch to group' : 'Switch to individual'}
              </Button>
            </form>
            <form method="post" action={action} {...post(action)}>
              <input type="hidden" name="op" value="refresh" />
              <Button type="submit" variant="ghost" size="sm">
                Keep as is
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      <details class="group">
        <summary class={SUMMARY_BASE}>
          <Chevron />
          Manage<span class="sr-only"> {name}</span>
        </summary>
        <div class="mt-3 flex flex-col gap-4 border-l border-border pl-4">
          {link.review ? (
            <div class="flex flex-col gap-2">
              {link.review.reviewers.length ? (
                <ul class="flex flex-col gap-1 text-sm text-ink-muted" aria-label="Reviewers">
                  {link.review.reviewers.map((r) => (
                    <li>
                      <span class="text-ink">{r.name}</span> · {r.doneAt ? 'done' : 'reviewing'}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p class="text-[13px] leading-normal text-ink-muted">
                {link.review.reviewMode === 'group'
                  ? 'Group: reviewers see each other’s comments.'
                  : 'Individual: reviewers see only their own comments.'}
              </p>
              <form method="post" action={action} {...post(action)}>
                <input type="hidden" name="op" value="review_mode_preview" />
                <input type="hidden" name="grantId" value={link.id} />
                <Button type="submit" variant="secondary" size="sm">
                  {link.review.reviewMode === 'group' ? 'Switch to individual…' : 'Switch to group…'}
                </Button>
              </form>
            </div>
          ) : null}

          {link.url ? (
            <form method="post" action={action} class="flex flex-col gap-1.5" {...post(action)}>
              <input type="hidden" name="op" value="email_link" />
              <input type="hidden" name="url" value={link.url} />
              <label for={`share-email-${link.id}`} class="text-sm font-medium text-ink">
                Email this link
              </label>
              <div class="flex items-center gap-2">
                <Input
                  id={`share-email-${link.id}`}
                  name="email"
                  type="email"
                  size="sm"
                  placeholder="someone@example.com"
                  required
                />
                <Button type="submit" variant="secondary" size="sm">
                  Send
                </Button>
              </div>
            </form>
          ) : null}

          <form method="post" action={action} class="flex flex-wrap items-center gap-x-3 gap-y-1" {...post(action)}>
            <input type="hidden" name="op" value="revoke_link" />
            <input type="hidden" name="grantId" value={link.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              class="text-danger! hover:bg-danger-soft hover:text-danger!"
              aria-label={`Revoke ${name}`}
            >
              Revoke link
            </Button>
            <span class="text-[13px] text-ink-subtle">Stops working immediately.</span>
          </form>
        </div>
      </details>
    </li>
  );
}

function NewLinkForm({
  id,
  action,
  reviewable,
  open,
}: {
  id: string;
  action: string;
  reviewable: boolean;
  open: boolean;
}): JSX.Element {
  return (
    <details class="group" open={open || undefined}>
      <summary class="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-medium text-ink shadow-xs transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <Plus class="size-4" />
        New link
      </summary>
      <form
        method="post"
        action={action}
        class="mt-3 grid gap-x-4 gap-y-3 rounded-md border border-border p-4 sm:grid-cols-2"
        {...post(action)}
      >
        {reviewable ? (
          <fieldset class="flex flex-col gap-2 sm:col-span-2">
            <legend class="mb-2 text-sm font-medium text-ink">People with this link can</legend>
            <label class="flex items-start gap-2">
              <input type="radio" name="op" value="link" checked class={RADIO} data-bind="shareKind" />
              <span class="flex flex-col gap-0.5">
                <span class="text-sm font-medium text-ink">Read only</span>
                <span class="text-[13px] leading-normal text-ink-muted">Read the document. Nothing else.</span>
              </span>
            </label>
            <label class="flex items-start gap-2">
              <input type="radio" name="op" value="review_link" class={RADIO} data-bind="shareKind" />
              <span class="flex flex-col gap-0.5">
                <span class="text-sm font-medium text-ink">Read and comment</span>
                <span class="text-[13px] leading-normal text-ink-muted">
                  A review link. They can comment without an account.
                </span>
              </span>
            </label>
          </fieldset>
        ) : (
          <input type="hidden" name="op" value="link" />
        )}

        <div class="sm:col-span-2" data-show="$shareKind !== 'review_link'">
          <FormField fieldId={`share-link-label-${id}`} label="Label (optional)">
            <Input id={`share-link-label-${id}`} name="label" type="text" placeholder="e.g. Acme review" size="sm" />
          </FormField>
        </div>

        {reviewable ? (
          <>
            <div data-show="$shareKind === 'review_link'" style="display:none">
              <FormField
                fieldId={`review-name-${id}`}
                label="Reviewer name (optional)"
                description="Blank makes an open link: each reviewer types their own name."
              >
                <Input id={`review-name-${id}`} name="reviewerName" size="sm" maxlength={60} />
              </FormField>
            </div>
            <div data-show="$shareKind === 'review_link'" style="display:none">
              <FormField
                fieldId={`review-email-${id}`}
                label="Email it to (optional)"
                description="Needs a reviewer name. Sends the link straight away."
              >
                <Input id={`review-email-${id}`} name="reviewerEmail" type="email" size="sm" />
              </FormField>
            </div>
            <div class="sm:col-span-2" data-show="$shareKind === 'review_link'" style="display:none">
              <FormField fieldId={`review-mode-${id}`} label="Reviewers see">
                <Select id={`review-mode-${id}`} name="mode" size="sm">
                  <option value="group">Each other's comments (group)</option>
                  <option value="individual">Only their own comments (individual)</option>
                </Select>
              </FormField>
            </div>
          </>
        ) : null}

        <FormField fieldId={`share-link-password-${id}`} label="Password (optional)">
          <div class="relative">
            <Input
              id={`share-link-password-${id}`}
              name="password"
              type="password"
              placeholder="At least 8 characters"
              size="sm"
              class="pr-14"
              autocomplete="new-password"
              data-attr:type="$sharePw ? 'text' : 'password'"
            />
            <button
              type="button"
              class="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-xs font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-controls={`share-link-password-${id}`}
              data-attr:aria-pressed="$sharePw"
              data-on:click="$sharePw = !$sharePw"
              data-text="$sharePw ? 'Hide' : 'Show'"
            >
              Show
            </button>
          </div>
        </FormField>
        <FormField fieldId={`share-link-expiry-${id}`} label="Expires (optional)">
          <Input id={`share-link-expiry-${id}`} name="expiresAt" type="datetime-local" size="sm" />
        </FormField>

        <div class="sm:col-span-2">
          <Button type="submit" size="sm">
            Create link
          </Button>
        </div>
      </form>
    </details>
  );
}

const RADIO =
  'mt-0.5 size-4 shrink-0 border border-border-strong bg-surface accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

// ── People & roles ──────────────────────────────────────────────────────────

function PeopleSection({
  id,
  people,
  action,
  settings,
}: {
  id: string;
  people: SharePeople;
  action: string;
  settings?: SiteSettings;
}): JSX.Element {
  const { grants, principals, roles, teams } = people;
  const nameById = new Map(principals.map((p) => [p.id, p.name]));
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
  const subjectName = (g: (typeof grants)[number]): string =>
    g.subjectKind === 'principal'
      ? (nameById.get(g.subjectId) ?? g.subjectId)
      : g.subjectKind === 'team'
        ? (teamNameById.get(g.subjectId) ?? g.subjectId)
        : g.subjectId;

  return (
    <section class="flex flex-col gap-3 border-t border-border pt-5">
      <SectionHeading count={grants.length}>People &amp; roles</SectionHeading>
      {grants.length === 0 ? (
        <p class="text-sm text-ink-muted">
          No one has direct access. Roles still apply; this is for access to this one document.
        </p>
      ) : (
        <ul class="flex flex-col divide-y divide-border">
          {grants.map((g) => (
            <li class="flex items-center justify-between gap-3 py-2.5">
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium text-ink">{subjectName(g)}</span>
                  <Badge tone={g.subjectKind === 'role' ? 'accent' : g.subjectKind === 'team' ? 'success' : 'info'}>
                    {g.subjectKind}
                  </Badge>
                </span>
                <span class="font-mono text-xs text-ink-subtle">
                  {g.actions.join(', ')} · {g.expiresAt ? `expires ${formatDate(g.expiresAt, settings)}` : 'never expires'}
                </span>
              </div>
              <form method="post" action={action} {...post(action)}>
                <input type="hidden" name="op" value="revoke" />
                <input type="hidden" name="grantId" value={g.id} />
                <Button type="submit" variant="ghost" size="sm" aria-label={`Revoke access for ${subjectName(g)}`}>
                  Revoke
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <details class="group">
        <summary class={SUMMARY_BASE}>
          <Chevron />
          Add person or role
        </summary>
        <form
          method="post"
          action={action}
          class="mt-3 grid gap-x-4 gap-y-3 rounded-md border border-border p-4 sm:grid-cols-2"
          {...post(action)}
        >
          <input type="hidden" name="op" value="grant" />
          <FormField fieldId={`share-subject-${id}`} label="Grant to">
            <Select id={`share-subject-${id}`} name="subject" size="sm">
              <optgroup label="People, services & agents">
                {principals.map((p) => (
                  <option value={`principal:${p.id}`}>
                    {p.name} · {PERSONA_LABEL[personaOf(p.kind, p.subtype)]}
                  </option>
                ))}
              </optgroup>
              {teams.length > 0 ? (
                <optgroup label="Teams">
                  {teams.map((t) => (
                    <option value={`team:${t.id}`}>{t.name}</option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Roles">
                {roles.map((r) => (
                  <option value={`role:${r.slug}`}>{r.name}</option>
                ))}
              </optgroup>
            </Select>
          </FormField>
          <FormField fieldId={`share-expiry-${id}`} label="Expires (optional)">
            <Input id={`share-expiry-${id}`} name="expiresAt" type="datetime-local" size="sm" />
          </FormField>
          <fieldset class="sm:col-span-2">
            <legend class="mb-2 text-sm font-medium text-ink">Can</legend>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
              {SHARE_ACTIONS.map((a) => (
                <label class="flex items-center gap-2 text-sm text-ink">
                  <Checkbox name="action" value={a} checked={a === 'read'} />
                  {ACCESS_ACTION_LABELS[a]}
                </label>
              ))}
            </div>
          </fieldset>
          <div class="sm:col-span-2">
            <Button type="submit" size="sm">
              Grant access
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}

// ── Manager + drawer ────────────────────────────────────────────────────────

/** The drawer's content (`#share-manager`) — re-rendered whole by every share
 *  action. */
export function ShareManager({ slug, id, def, doc, overview, settings, flash, surface = 'editor' }: ShareProps & { flash?: ShareFlash }): JSX.Element {
  const action = `/admin/c/${slug}/${id}/share${surface === 'viewer' ? '?surface=viewer' : ''}`;
  const links: AnyLink[] = [
    ...(overview.links ?? []),
    ...(overview.reviewLinks ?? []).map((review) => ({ ...review, review })),
  ];
  // A link minted by this request leads the list, where the eye already is.
  if (flash?.newUrl) links.sort((a, b) => Number(b.url === flash.newUrl) - Number(a.url === flash.newUrl));
  const alreadyPublic = isAnonymouslyReadable(def, doc);

  return (
    <div id="share-manager" class="flex flex-col gap-6">
      {flash ? (
        <p
          role={flash.tone === 'danger' ? 'alert' : 'status'}
          class={cx(
            'rounded-md px-3 py-2 text-sm',
            flash.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success',
          )}
        >
          {flash.message}
        </p>
      ) : null}

      {overview.links !== null ? (
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <SectionHeading count={links.length}>Links</SectionHeading>
          </div>
          {alreadyPublic ? (
            <p role="status" class="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
              Anyone can already read this at its public URL. Set visibility to Private to require a link.
            </p>
          ) : null}
          <NewLinkForm id={id} action={action} reviewable={overview.reviewLinks !== null} open={links.length === 0} />
          {links.length ? (
            <ul class="flex flex-col divide-y divide-border rounded-md border border-border">
              {links.map((l) => (
                <LinkRow link={l} action={action} settings={settings} flash={flash} />
              ))}
            </ul>
          ) : (
            <p class="text-sm text-ink-muted">
              No links yet. A link lets someone without an account read this document
              {overview.reviewLinks !== null ? ', or read and comment on it' : ''}.
            </p>
          )}
        </section>
      ) : null}

      {overview.people ? <PeopleSection id={id} people={overview.people} action={action} settings={settings} /> : null}
    </div>
  );
}

/** The Share drawer. Render it OUTSIDE `#editor-form` — it carries forms. */
export function ShareDrawer(props: ShareProps): JSX.Element {
  return (
    // Signals sit on this wrapper, outside the morphed #share-manager.
    <div data-signals="{shareKind: 'link', sharePw: false}">
      <Drawer
        id={SHARE_DRAWER_ID}
        title="Share"
        description="Links for people without an account, and direct access for people with one."
        size="lg"
      >
        <ShareManager {...props} />
      </Drawer>
    </div>
  );
}
