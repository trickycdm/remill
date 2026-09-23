/**
 * EditorSidebar — the document editor's action/metadata rail (item 4). The form
 * (GeneratedForm) is content-only; every action and all metadata live here in a
 * sticky right column, with one clear hierarchy: a single primary Save, a
 * secondary Publish, and an isolated destructive Delete.
 *
 * The Save button lives here but drives the form in the left column via
 * `form="editor-form"` association — an associated submit fires the form's own
 * `@post`, so there are no nested forms and no route changes. `$busy` is a
 * page-global Datastar signal (seeded by the form), so the spinner works across
 * columns. Publish/Restore/Delete are their own small native forms (siblings).
 *
 * `mode: 'create'` shows only the Actions card (nothing exists yet to publish,
 * revise, or delete); `'edit'` adds Details, Revisions, and Delete.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import type { CollectionDefinition } from '@/fields/types';
import type { DocumentRecord, Visibility } from '@/services/documents';
import type { SiteSettings } from '@/services/settings';
import { formatDate } from '@/lib/format-date';
import { hasLifecycle } from '@/lib/lifecycle';
import { publicUrlOf } from '@/lib/def-helpers';
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Dialog, Input } from '@/components/ui';

type Revision = { readonly revision: number; readonly savedAt: string };

type EditorSidebarProps =
  | {
      mode: 'create';
      formId: string;
      submitLabel: string;
      cancelHref: string;
      def: CollectionDefinition;
      settings?: SiteSettings;
    }
  | {
      mode: 'edit';
      formId: string;
      submitLabel: string;
      cancelHref: string;
      def: CollectionDefinition;
      slug: string;
      id: string;
      doc: DocumentRecord;
      revisions: readonly Revision[];
      settings?: SiteSettings;
      /** The site's absolute base URL (resolveBaseUrl), for showing the unlisted
       *  doc_ URL (D50). Falls back to a relative path when absent. */
      baseUrl?: string;
    };

const VISIBILITY_OPTIONS: { value: Visibility; label: string; help: string }[] = [
  { value: 'public', label: 'Public', help: 'Listed on the site, in feeds and search.' },
  {
    value: 'unlisted',
    label: 'Unlisted',
    help: 'Anyone with the link can read it. Not listed anywhere; not indexed.',
  },
  { value: 'private', label: 'Private', help: 'Only people you share a link or access with.' },
];

const RADIO_BASE =
  'mt-0.5 size-4 shrink-0 border border-border-strong bg-surface accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

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
    <aside class="flex flex-col gap-5 self-start lg:sticky lg:top-24" aria-label="Document actions">
      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent class="flex flex-col gap-3">
          {/* Associated submit: fires #editor-form's @post from outside the form. */}
          <Button type="submit" form={props.formId} busy="$busy" class="w-full">
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
              <form
                method="post"
                action={`/admin/c/${props.slug}/${props.id}/schedule`}
                class="flex flex-col gap-2 border-t border-border pt-3"
              >
                <label for="rm-publish-at" class="text-sm font-medium text-ink-muted">
                  Publish at
                </label>
                <Input id="rm-publish-at" name="publish_at" type="datetime-local" size="sm" required />
                <Button type="submit" variant="secondary" size="sm" class="w-full">
                  Schedule
                </Button>
              </form>
            )
          ) : null}

          {/* Visibility (D50) — only meaningful when the collection is
              publicRead; without it, everything is already private. */}
          {props.mode === 'edit' && props.def.access?.publicRead ? (
            <form
              method="post"
              action={`/admin/c/${props.slug}/${props.id}/visibility`}
              class="flex flex-col gap-3 border-t border-border pt-3"
            >
              <fieldset class="flex flex-col gap-3">
                <legend class="text-sm font-medium text-ink-muted">Visibility</legend>
                {VISIBILITY_OPTIONS.map((opt) => (
                  <label class="flex items-start gap-2">
                    <input
                      type="radio"
                      name="visibility"
                      value={opt.value}
                      checked={props.doc.visibility === opt.value}
                      class={RADIO_BASE}
                    />
                    <span class="flex flex-col gap-0.5">
                      <span class="text-sm font-medium text-ink">{opt.label}</span>
                      <span class="text-[13px] leading-normal text-ink-muted">
                        {opt.help}
                        {opt.value !== 'public' && props.doc.visibility === 'public'
                          ? ' Switching away from Public means the current slug link will stop working.'
                          : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {props.doc.visibility === 'unlisted' && props.doc.status === 'published' ? (
                <div class="flex flex-col gap-1">
                  <label for="rm-unlisted-url" class="text-[13px] font-medium text-ink-muted">
                    Unlisted URL
                  </label>
                  <Input
                    id="rm-unlisted-url"
                    type="text"
                    value={publicUrlOf(props.def, props.doc, props.baseUrl ?? '')}
                    readonly
                    aria-label="Unlisted document URL"
                    data-on:focus="evt.target.select()"
                  />
                </div>
              ) : null}

              <Button type="submit" variant="secondary" size="sm" class="w-full">
                Update visibility
              </Button>
            </form>
          ) : null}

          <a
            href={props.cancelHref}
            class="rounded-md py-1 text-center text-sm text-ink-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Cancel
          </a>

          {/* Morph target for the inline save-error fragment (200, #form-result). */}
          <div id="form-result" />
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
          {/* ── Details ───────────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle as="h2">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl class="flex flex-col gap-2.5 text-sm">
                {/* lifecycle:'none' suppresses the status affordances (B4). */}
                {hasLifecycle(props.def) ? (
                  <MetaRow label="Status">
                    <Badge tone={props.doc.status === 'published' ? 'success' : 'neutral'}>{props.doc.status}</Badge>
                  </MetaRow>
                ) : null}
                <MetaRow label="Updated">{formatDate(props.doc.updatedAt, props.settings)}</MetaRow>
                <MetaRow label="Created">{formatDate(props.doc.createdAt, props.settings)}</MetaRow>
                {hasLifecycle(props.def) && props.doc.publishedAt ? (
                  <MetaRow label="Published">{formatDate(props.doc.publishedAt, props.settings)}</MetaRow>
                ) : null}
                <MetaRow label="Author">{props.doc.createdBy ?? '—'}</MetaRow>
                <MetaRow label="ID">
                  <code class="font-mono text-xs">{props.doc.id}</code>
                </MetaRow>
              </dl>
            </CardContent>
          </Card>

          {/* ── Revisions ─────────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between gap-2">
                <CardTitle as="h2">Revisions</CardTitle>
                {props.revisions.length >= 2 ? (
                  <a
                    href={`/admin/c/${props.slug}/${props.id}/revisions`}
                    class="rounded-sm text-xs text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Compare
                  </a>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <ol class="flex flex-col gap-2 text-sm">
                {props.revisions.map((r) => (
                  <li class="flex items-center justify-between gap-2">
                    <span class="font-mono text-xs text-ink-subtle">
                      #{r.revision} · {r.savedAt.slice(0, 16).replace('T', ' ')}
                    </span>
                    {r.revision !== props.revisions[0]?.revision && (
                      <form method="post" action={`/admin/c/${props.slug}/${props.id}/restore`} class="contents">
                        <input type="hidden" name="revision" value={String(r.revision)} />
                        <button type="submit" class="rounded-sm text-xs text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          Restore
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* ── Delete (isolated destructive action) ──────────────────────────── */}
          <div class="border-t border-border pt-4">
            <Button
              variant="danger"
              size="sm"
              data-on:click="document.getElementById('rm-delete-doc').showModal()"
            >
              Delete…
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
