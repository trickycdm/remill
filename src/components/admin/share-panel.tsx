/**
 * SharePanel — the editor rail's Share card (D51). One Card, two independently
 * gated subsections, divided by a hairline:
 *
 *  - **Links**, shown to anyone holding `share_link` on the document (editors
 *    included). Optional label, password, and expiry; no email field — email is
 *    a secondary action on the result page (`share.tsx`), decoupled from
 *    creation.
 *  - **People & roles**, the item-grant form — `manage_access` only.
 *
 * Composed into the rail through `EditorSidebar`'s `shareSlot` prop, so this
 * file stays presentational and doesn't need to know about Publish/Details/etc.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import type { ItemGrantRecord } from '@/db/queries/grants';
import { personaOf, PERSONA_LABEL } from '@/lib/persona';
import { isAnonymouslyReadable } from '@/lib/def-helpers';
import { formatDate } from '@/lib/format-date';
import type { Visibility } from '@/lib/visibility';
import type { CollectionDefinition } from '@/fields/types';
import type { SiteSettings } from '@/services/settings';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  FormField,
  Select,
  Input,
  Checkbox,
  ACCESS_ACTION_LABELS,
} from '@/components/ui';

/** Actions meaningful to grant on a single document. */
const SHARE_ACTIONS = ['read', 'update', 'delete', 'publish'] as const;

/** A tiny `<details>` chevron shared with editor-sidebar.tsx's disclosures. */
function DisclosureChevron(): JSX.Element {
  return (
    <span class="transition-transform group-open:rotate-90" aria-hidden="true">
      ›
    </span>
  );
}

function Eyebrow({ children }: { children: unknown }): JSX.Element {
  return (
    <p class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">{children}</p>
  );
}

function ExpiryMeta({ expiresAt, settings }: { expiresAt: string | null; settings?: SiteSettings }): JSX.Element {
  return (
    <span class="font-mono text-xs text-ink-subtle">
      {expiresAt ? `· expires ${formatDate(expiresAt, settings)}` : '· never expires'}
    </span>
  );
}

export interface ShareSubject {
  readonly id: string;
  readonly name: string;
  readonly kind: 'user' | 'agent';
  readonly subtype: string | null;
}

/** The minimal document shape the panel needs for the "already public"
 *  warning — a structural subset so this stays a presentational component. */
export interface ShareDoc {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly visibility?: Visibility;
}

function LinksSection({
  id,
  def,
  doc,
  links,
  action,
  settings,
}: {
  id: string;
  def: CollectionDefinition;
  doc: ShareDoc;
  links: ItemGrantRecord[];
  action: string;
  settings?: SiteSettings;
}) {
  const alreadyPublic = isAnonymouslyReadable(def, doc);

  return (
    <div class="flex flex-col gap-3">
      <Eyebrow>Links</Eyebrow>

      {alreadyPublic ? (
        <div role="status" class="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
          Anyone can already read this at its public URL. Set visibility to Private to require a link.
        </div>
      ) : null}

      <div class="flex flex-col gap-2">
        {links.length === 0 ? (
          <p class="text-sm text-ink-subtle">No links yet.</p>
        ) : (
          links.map((g) => (
            <div class="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate text-sm font-medium text-ink">{g.label ?? 'Untitled link'}</span>
                <span class="flex items-center gap-1 font-mono text-xs text-ink-subtle">
                  {g.hasPassword ? 'Password' : 'No password'}
                  <ExpiryMeta expiresAt={g.expiresAt} settings={settings} />
                </span>
              </div>
              <form method="post" action={action}>
                <input type="hidden" name="op" value="revoke_link" />
                <input type="hidden" name="grantId" value={g.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Revoke
                </Button>
              </form>
            </div>
          ))
        )}
      </div>

      <details class="group">
        <summary class="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <DisclosureChevron />
          New share link
        </summary>
        <form method="post" action={action} class="mt-3 flex flex-col gap-3">
          <input type="hidden" name="op" value="link" />
          <FormField fieldId={`share-link-label-${id}`} label="Label (optional)">
            <Input id={`share-link-label-${id}`} name="label" type="text" placeholder="e.g. Acme review" size="sm" />
          </FormField>
          <FormField fieldId={`share-link-password-${id}`} label="Password (optional)">
            <div class="relative" data-signals={`{showLinkPassword_${id}: false}`}>
              <Input
                id={`share-link-password-${id}`}
                name="password"
                type="password"
                placeholder="At least 8 characters"
                size="sm"
                class="pr-16"
                data-attr:type={`$showLinkPassword_${id} ? 'text' : 'password'`}
              />
              <button
                type="button"
                class="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-xs font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-controls={`share-link-password-${id}`}
                data-attr:aria-pressed={`$showLinkPassword_${id}`}
                data-on:click={`$showLinkPassword_${id} = !$showLinkPassword_${id}`}
                data-text={`$showLinkPassword_${id} ? 'Hide' : 'Show'`}
              >
                Show
              </button>
            </div>
          </FormField>
          <FormField fieldId={`share-link-expiry-${id}`} label="Expires (optional)">
            <Input id={`share-link-expiry-${id}`} name="expiresAt" type="datetime-local" size="sm" />
          </FormField>
          <Button type="submit" variant="secondary" size="sm" class="w-full">
            Create link
          </Button>
        </form>
      </details>
    </div>
  );
}

function GrantsSection({
  id,
  grants,
  principals,
  roles,
  teams,
  action,
  settings,
}: {
  id: string;
  grants: ItemGrantRecord[];
  principals: ShareSubject[];
  roles: { slug: string; name: string }[];
  teams: { id: string; name: string }[];
  action: string;
  settings?: SiteSettings;
}) {
  const nameById = new Map(principals.map((p) => [p.id, p.name]));
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  return (
    <div class="flex flex-col gap-3 border-t border-border pt-4">
      <Eyebrow>People &amp; roles</Eyebrow>

      <div class="flex flex-col gap-2">
        {grants.length === 0 ? (
          <p class="text-sm text-ink-subtle">No one has item-level access.</p>
        ) : (
          grants.map((g) => (
            <div class="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-medium text-ink">
                    {g.subjectKind === 'principal'
                      ? (nameById.get(g.subjectId) ?? g.subjectId)
                      : g.subjectKind === 'team'
                        ? (teamNameById.get(g.subjectId) ?? g.subjectId)
                        : g.subjectId}
                  </span>
                  <Badge tone={g.subjectKind === 'role' ? 'accent' : g.subjectKind === 'team' ? 'success' : 'info'}>
                    {g.subjectKind}
                  </Badge>
                </span>
                <span class="font-mono text-xs text-ink-subtle">
                  {g.actions.join(', ')} <ExpiryMeta expiresAt={g.expiresAt} settings={settings} />
                </span>
              </div>
              <form method="post" action={action}>
                <input type="hidden" name="op" value="revoke" />
                <input type="hidden" name="grantId" value={g.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Revoke
                </Button>
              </form>
            </div>
          ))
        )}
      </div>

      <details class="group">
        <summary class="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <DisclosureChevron />
          Add person or role
        </summary>
        <form method="post" action={action} class="mt-3 flex flex-col gap-3">
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
              {teams.length > 0 && (
                <optgroup label="Teams">
                  {teams.map((t) => (
                    <option value={`team:${t.id}`}>{t.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Roles">
                {roles.map((r) => (
                  <option value={`role:${r.slug}`}>{r.name}</option>
                ))}
              </optgroup>
            </Select>
          </FormField>
          <fieldset>
            <legend class="mb-2 text-sm font-medium text-ink">Can</legend>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
              {SHARE_ACTIONS.map((a) => (
                <label class="flex items-center gap-2 text-sm text-ink">
                  <Checkbox name="action" value={a} checked={a === 'read'} />
                  {ACCESS_ACTION_LABELS[a]}
                </label>
              ))}
            </div>
          </fieldset>
          <FormField fieldId={`share-expiry-${id}`} label="Expires (optional)">
            <Input id={`share-expiry-${id}`} name="expiresAt" type="datetime-local" size="sm" />
          </FormField>
          <Button type="submit" variant="secondary" size="sm" class="w-full">
            Grant access
          </Button>
        </form>
      </details>
    </div>
  );
}

export function SharePanel({
  slug,
  id,
  grants,
  principals,
  roles,
  teams,
  def,
  doc,
  links,
  baseUrl,
  settings,
}: {
  slug: string;
  id: string;
  /** Present only for principals holding `manage_access` — renders the
   *  People & roles subsection below Links. */
  grants?: ItemGrantRecord[];
  principals?: ShareSubject[];
  roles?: { slug: string; name: string }[];
  teams?: { id: string; name: string }[];
  /** Present only for principals holding `share_link` — renders the Links
   *  subsection above People & roles. */
  def?: CollectionDefinition;
  doc?: ShareDoc;
  links?: ItemGrantRecord[];
  baseUrl?: string;
  settings?: SiteSettings;
}) {
  const action = `/admin/c/${slug}/${id}/share`;
  const hasLinks = !!(def && doc && links && baseUrl);
  const hasGrants = !!(grants && principals && roles && teams);

  if (!hasLinks && !hasGrants) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Share</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        {hasLinks ? (
          <LinksSection id={id} def={def!} doc={doc!} links={links!} action={action} settings={settings} />
        ) : null}
        {hasGrants ? (
          <GrantsSection
            id={id}
            grants={grants!}
            principals={principals!}
            roles={roles!}
            teams={teams!}
            action={action}
            settings={settings}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
