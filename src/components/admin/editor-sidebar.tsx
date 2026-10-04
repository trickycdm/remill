/**
 * EditorSidebar — the document editor's action/metadata rail. The form
 * (GeneratedForm) is content-only; every action and all metadata live here in a
 * right column with one clear hierarchy: a single primary Save, a secondary
 * Publish, then Visibility, Sharing, Comments, Details, Revisions, and an
 * isolated destructive action quietly footed at the end.
 *
 * ONE SCROLLER: the rail never scrolls on its own. It flows with the page, and
 * only the Save card is sticky — so Save is always in reach while everything
 * else lines up with the content beside it. That holds only while the rail
 * stays short, so anything unbounded (share links, the full comment list, the
 * full revision history) is summarised here and managed elsewhere (the Share
 * drawer, the review overlay, the revisions page). Sections are divided by
 * hairlines rather than boxed (DESIGN_SYSTEM "hairlines over boxes"); the Save
 * card keeps its surface because it floats over the page while stuck.
 *
 * The Save button drives the form in the left column via `form="editor-form"`
 * association — an associated submit fires the form's own `@post`, so there
 * are no nested forms and no route changes. `$busy` is a page-global Datastar
 * signal (seeded by the form), so the spinner works across columns.
 * Publish/Schedule/Restore/Delete are their own small native forms (siblings),
 * so they keep working with no JavaScript at all.
 *
 * `mode: 'create'` shows only the Save card (nothing exists yet to publish,
 * revise, share, or delete); `'edit'` adds the rest. `shareSlot` / `reviewSlot`
 * are composition seams — the route passes `<ShareSummary />` and
 * `<CommentsSection />` through them so this file never imports their internals.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import type { CollectionDefinition } from '@/fields/types';
import type { DocumentRecord, Visibility } from '@/services/documents';
import type { SiteSettings } from '@/services/settings';
import { formatDate } from '@/lib/format-date';
import { hasLifecycle } from '@/lib/lifecycle';
import { publicUrlOf } from '@/lib/def-helpers';
import { Button, Card, CardContent, Dialog, Input, cx } from '@/components/ui';
import { VisibilityStamp } from '@/components/admin/visibility-stamp';

type Revision = { readonly revision: number; readonly savedAt: string };

/** Revisions listed in the rail; the rest live on the revisions page. */
const RAIL_REVISIONS = 5;

/** One hairline-divided rail section: a heading (with an optional trailing
 *  action or marker) over its content. `id` makes it a Datastar morph target. */
export function RailSection({
  title,
  aside,
  id,
  children,
}: {
  title: string;
  aside?: unknown;
  id?: string;
  children: unknown;
}): JSX.Element {
  return (
    <section id={id} class="flex flex-col gap-3 border-t border-border pt-5">
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-display text-base leading-snug font-semibold tracking-tight text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const RAIL_LINK =
  'rounded-sm text-[13px] font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

type EditorSidebarProps =
  | {
      mode: 'create';
      formId: string;
      submitLabel: string;
      def: CollectionDefinition;
      settings?: SiteSettings;
    }
  | {
      mode: 'edit';
      formId: string;
      submitLabel: string;
      def: CollectionDefinition;
      slug: string;
      id: string;
      doc: DocumentRecord;
      revisions: readonly Revision[];
      authorName: string;
      settings?: SiteSettings;
      /** The site's absolute base URL (resolveBaseUrl), for showing the unlisted
       *  doc_ URL (D50). Falls back to a relative path when absent. */
      baseUrl?: string;
      /** The Share section (ShareSummary), composed in — undefined when neither
       *  share_link nor manage_access is held. */
      shareSlot?: unknown;
      /** The Comments card (D55) — undefined when the viewer can't comment or
       *  the collection has nothing to annotate. */
      reviewSlot?: unknown;
      /** D57: on a collection WITHOUT public pages, whether the viewer may
       *  turn them on (manage_schema) and how many OTHER documents that would
       *  switch to private first. Unused on publicRead collections. */
      enablePublic?: { readonly canManageSchema: boolean; readonly otherCount: number };
    };

const VISIBILITY_OPTIONS: { value: Visibility; label: string; help: string }[] = [
  { value: 'public', label: 'Public', help: 'Listed on the site, in feeds and search' },
  { value: 'unlisted', label: 'Unlisted', help: 'Only people with the link' },
  { value: 'private', label: 'Private', help: 'Only through share links' },
];

const RADIO_BASE =
  'mt-0.5 size-4 shrink-0 border border-border-strong bg-surface accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The Visibility card on a collection WITHOUT public pages (D57). The stored
 *  visibility is inert there, so the effective answer is always Private; a
 *  schema manager can pick Public/Unlisted and "Enable public pages & apply",
 *  which switches every OTHER document to private in the same batch. */
function PrivateCollectionVisibility(props: {
  def: CollectionDefinition;
  slug: string;
  id: string;
  enablePublic?: { readonly canManageSchema: boolean; readonly otherCount: number };
}): JSX.Element {
  const name = props.def.name;
  const others = props.enablePublic?.otherCount ?? 0;
  return (
    <RailSection title="Visibility" aside={<VisibilityStamp visibility="private" />}>
      <div class="flex flex-col gap-3">
        <p class="text-sm text-ink-muted">
          {name} has no public pages. Only people with access, or a share link, can read this.
        </p>
        {props.enablePublic?.canManageSchema ? (
          <form
            method="post"
            action={`/admin/c/${props.slug}/${props.id}/visibility`}
            class="flex flex-col gap-3"
            data-signals="{visibility: 'private'}"
          >
            <fieldset class="flex flex-col gap-3">
              <legend class="text-[13px] font-medium text-ink-muted">Make this document</legend>
              {VISIBILITY_OPTIONS.map((opt) => (
                <label class="flex items-start gap-2">
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    checked={opt.value === 'private'}
                    class={RADIO_BASE}
                    data-bind="visibility"
                  />
                  <span class="flex flex-col gap-0.5">
                    <span class="text-sm font-medium text-ink">{opt.label}</span>
                    <span class="text-[13px] leading-normal text-ink-muted">{opt.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p class="text-[13px] leading-normal text-ink-subtle">
              {`Turns on public pages for ${name}.`}
              {others > 0
                ? ` The other ${others} ${others === 1 ? 'document' : 'documents'} will be set to Private first, so only this one goes live.`
                : ''}
            </p>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              class="self-start"
              data-attr:disabled="$visibility === 'private'"
            >
              Enable public pages &amp; apply
            </Button>
          </form>
        ) : (
          <p class="text-[13px] leading-normal text-ink-subtle">
            Ask an admin to enable public pages for this collection.
          </p>
        )}
      </div>
    </RailSection>
  );
}

/** A tiny `<details>` chevron shared by every rail disclosure — matches the
 *  ScopePicker "Individual actions" precedent (a plain glyph, no icon import). */
function DisclosureChevron(): JSX.Element {
  return (
    <span class="transition-transform group-open:rotate-90" aria-hidden="true">
      ›
    </span>
  );
}

/** A readonly value + "Copy" button, wired via Datastar (no client island): the
 *  button reads the input's current DOM value, writes it to the clipboard, and
 *  flips a per-instance signal that drives an aria-live "Copied" announcement.
 *  Shared between the Visibility card's unlisted URL, the Details card's ID,
 *  and the Share drawer's link rows (share-drawer.tsx). */
export function CopyField({
  id,
  label,
  value,
  mono = true,
  hideLabel = false,
}: {
  id: string;
  label: string;
  value: string;
  mono?: boolean;
  /** Keep the label for assistive tech only — for rows where the surrounding
   *  context already says what the value is. */
  hideLabel?: boolean;
}): JSX.Element {
  const signal = `copied_${id.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div class="flex flex-col gap-1" data-signals={`{${signal}: false}`}>
      <label for={id} class={hideLabel ? 'sr-only' : 'text-[13px] font-medium text-ink-muted'}>
        {label}
      </label>
      <div class="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          value={value}
          readonly
          size="sm"
          class={mono ? 'font-mono text-xs' : undefined}
          data-on:focus="evt.target.select()"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-on:click={`navigator.clipboard.writeText(document.getElementById('${id}').value).then(() => { $${signal} = true; setTimeout(() => $${signal} = false, 2000) })`}
        >
          {/* The label itself confirms the copy; the sr-only status announces it. */}
          <span data-text={`$${signal} ? 'Copied' : 'Copy'`}>Copy</span>
        </Button>
      </div>
      <span role="status" aria-live="polite" class="sr-only" data-text={`$${signal} ? 'Copied' : ''`} />
    </div>
  );
}

/** One `<dl>` row: a mono-caps label and its value. */
function MetaRow({ label, children }: { label: string; children: unknown }): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-3">
      <dt class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">{label}</dt>
      <dd class="min-w-0 truncate text-right text-ink-muted">{children}</dd>
    </div>
  );
}

export function EditorSidebar(props: EditorSidebarProps): JSX.Element {
  return (
    // No own scroll and no max-height: the rail flows with the page (see the
    // file header). `min-w-0` lets long values truncate instead of widening it.
    <aside class="flex min-w-0 flex-col gap-5" aria-label="Document actions">
      {/* ── Save / Publish — the one sticky piece ─────────────────────────── */}
      <Card class="lg:sticky lg:top-20 lg:z-10">
        <CardContent class="flex flex-col gap-3 p-4">
          {/* Associated submit: fires #editor-form's @post from outside the form. */}
          {/* Below lg the MobileSaveBar carries Save, so only one is ever shown. */}
          <Button type="submit" form={props.formId} busy="$busy" class="w-full max-lg:hidden">
            {props.submitLabel}
          </Button>

          {props.mode === 'edit' && props.def.workflow?.draftPublish ? (
            <form method="post" action={`/admin/c/${props.slug}/${props.id}/publish`} class="contents">
              <input type="hidden" name="publish" value={props.doc.status === 'published' ? '0' : '1'} />
              <Button type="submit" variant="secondary" class="w-full">
                {props.doc.status === 'published' ? 'Unpublish' : 'Publish'}
              </Button>
            </form>
          ) : null}

          {/* Scheduled publishing (D32) — drafts only; a published doc can't
              hold a schedule (manual publish clears any pending one). */}
          {props.mode === 'edit' && props.def.workflow?.draftPublish && props.doc.status === 'draft' ? (
            props.doc.publishAt ? (
              <form
                method="post"
                action={`/admin/c/${props.slug}/${props.id}/schedule`}
                class="flex flex-col gap-2 border-t border-border pt-3"
              >
                <input type="hidden" name="op" value="cancel" />
                <p class="text-sm text-ink-muted">
                  Scheduled for <strong class="font-medium text-ink">{formatDate(props.doc.publishAt, props.settings)}</strong>
                </p>
                <Button type="submit" variant="secondary" size="sm" class="w-full">
                  Cancel schedule
                </Button>
              </form>
            ) : (
              <details class="group border-t border-border pt-3">
                <summary class="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <DisclosureChevron />
                  Schedule for later
                </summary>
                <form
                  method="post"
                  action={`/admin/c/${props.slug}/${props.id}/schedule`}
                  class="mt-3 flex flex-col gap-2"
                >
                  <label for="rm-publish-at" class="text-sm font-medium text-ink-muted">
                    Publish at
                  </label>
                  <Input id="rm-publish-at" name="publish_at" type="datetime-local" size="sm" required />
                  <Button type="submit" variant="secondary" size="sm" class="w-full">
                    Schedule
                  </Button>
                </form>
              </details>
            )
          ) : null}

          {/* Morph target for the inline save-error fragment (200, #form-result). */}
          <div id="form-result" class="empty:hidden" />
        </CardContent>
      </Card>

      {props.mode === 'create' ? (
        <p class="px-1 text-sm text-ink-muted">
          {hasLifecycle(props.def)
            ? `Save to create this ${props.def.name.toLowerCase()}; you can publish it afterward.`
            : `Save to create this ${props.def.name.toLowerCase()}.`}
        </p>
      ) : (
        <>
          {/* ── Visibility (D50/D57) — on a publicRead collection, the three-way
              control; otherwise the document is private by construction, so
              say so and (for schema managers) offer the safe enable. ───────── */}
          {props.def.access?.publicRead ? (
            <RailSection title="Visibility" aside={<VisibilityStamp visibility={props.doc.visibility} />}>
              <form
                method="post"
                action={`/admin/c/${props.slug}/${props.id}/visibility`}
                class="flex flex-col gap-3"
                data-signals={`{visibility: '${props.doc.visibility ?? 'public'}'}`}
              >
                <fieldset class="flex flex-col gap-3">
                  <legend class="sr-only">Visibility</legend>
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <label class="flex items-start gap-2">
                      <input
                        type="radio"
                        name="visibility"
                        value={opt.value}
                        checked={props.doc.visibility === opt.value}
                        class={RADIO_BASE}
                        data-bind="visibility"
                      />
                      <span class="flex flex-col gap-0.5">
                        <span class="text-sm font-medium text-ink">{opt.label}</span>
                        <span class="text-[13px] leading-normal text-ink-muted">{opt.help}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                {(props.doc.visibility ?? 'public') === 'public' ? (
                  <p class="text-[13px] leading-normal text-ink-subtle">Unlisted and Private retire the slug URL.</p>
                ) : null}

                {props.doc.visibility === 'unlisted' && props.doc.status === 'published' ? (
                  <CopyField
                    id="rm-unlisted-url"
                    label="Unlisted URL"
                    value={publicUrlOf(props.def, props.doc, props.baseUrl ?? '')}
                  />
                ) : null}

                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  class="self-start"
                  data-attr:disabled={`$visibility === '${props.doc.visibility ?? 'public'}'`}
                >
                  Apply
                </Button>
              </form>
            </RailSection>
          ) : (
            <PrivateCollectionVisibility
              def={props.def}
              slug={props.slug}
              id={props.id}
              enablePublic={props.enablePublic}
            />
          )}

          {props.shareSlot}

          {props.reviewSlot}

          {/* ── Details ───────────────────────────────────────────────────────── */}
          <RailSection title="Details">
            <dl class="flex flex-col gap-2.5 text-sm">
              <MetaRow label="Updated">
                <time dateTime={props.doc.updatedAt}>{formatDate(props.doc.updatedAt, props.settings)}</time>
              </MetaRow>
              <MetaRow label="Created">
                <time dateTime={props.doc.createdAt}>{formatDate(props.doc.createdAt, props.settings)}</time>
              </MetaRow>
              {hasLifecycle(props.def) && props.doc.publishedAt ? (
                <MetaRow label="Published">
                  <time dateTime={props.doc.publishedAt}>{formatDate(props.doc.publishedAt, props.settings)}</time>
                </MetaRow>
              ) : null}
              <MetaRow label="Author">{props.authorName}</MetaRow>
            </dl>
            <CopyField id="rm-doc-id" label="ID" value={props.doc.id} />
          </RailSection>

          {/* ── Revisions — the latest few; the full history (and compare) is
              the revisions page, so this never grows the rail. ────────────── */}
          <RailSection
            title="Revisions"
            aside={
              props.revisions.length >= 2 ? (
                <a href={`/admin/c/${props.slug}/${props.id}/revisions`} class={RAIL_LINK}>
                  Compare
                </a>
              ) : undefined
            }
          >
            <ol class="flex flex-col gap-2 text-sm">
              {props.revisions.slice(0, RAIL_REVISIONS).map((r) => (
                <li class="flex items-center justify-between gap-2">
                  <span class="font-mono text-xs text-ink-subtle">
                    #{r.revision} · {r.savedAt.slice(0, 16).replace('T', ' ')}
                  </span>
                  {r.revision === props.revisions[0]?.revision ? (
                    <span class="text-xs font-medium text-ink-subtle">Current</span>
                  ) : (
                    <form method="post" action={`/admin/c/${props.slug}/${props.id}/restore`} class="contents">
                      <input type="hidden" name="revision" value={String(r.revision)} />
                      <button type="submit" class={cx(RAIL_LINK, 'text-xs')}>
                        Restore
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
            {props.revisions.length > RAIL_REVISIONS ? (
              <a href={`/admin/c/${props.slug}/${props.id}/revisions`} class={cx(RAIL_LINK, 'self-start')}>
                All {props.revisions.length} revisions
              </a>
            ) : null}
          </RailSection>

          {/* ── Delete (isolated destructive action, quietly footed) ────────── */}
          <div class="border-t border-border pt-4">
            <Button
              variant="ghost"
              size="sm"
              class="text-danger! hover:bg-danger-soft hover:text-danger!"
              data-on:click="document.getElementById('rm-delete-doc').showModal()"
            >
              Move to trash…
            </Button>
            <Dialog
              id="rm-delete-doc"
              size="sm"
              title={`Delete this ${props.def.name.toLowerCase()}?`}
              description="This moves the document and its revisions to Trash — an admin can restore it for 30 days, then it is purged."
              footer={
                <>
                  <Button variant="ghost" data-on:click="document.getElementById('rm-delete-doc').close()">
                    Cancel
                  </Button>
                  <form method="post" action={`/admin/c/${props.slug}/${props.id}/delete`} class="contents">
                    <Button type="submit" variant="danger">
                      Delete
                    </Button>
                  </form>
                </>
              }
            >
              <span class="sr-only">Confirm deletion of this {props.def.name.toLowerCase()}.</span>
            </Dialog>
          </div>
        </>
      )}
    </aside>
  );
}

/** Save, pinned to the bottom of the viewport below `lg` — where the rail
 *  stacks UNDER a body that now grows with the page, so its Save card can be a
 *  long scroll away. Same associated submit as the rail's button; hidden from
 *  `lg` up, where the sticky Save card does this job. */
export function MobileSaveBar({ formId, submitLabel }: { formId: string; submitLabel: string }): JSX.Element {
  return (
    <div class="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:hidden">
      <Button type="submit" form={formId} busy="$busy" class="w-full">
        {submitLabel}
      </Button>
    </div>
  );
}
