/**
 * Share panel — two independent sections on the edit view (D51):
 *
 *  - **Share links**, shown to anyone holding `share_link` on the document
 *    (editors included). Optional label, password, and expiry; no email
 *    field — email is a secondary action on the result page (`share.tsx`),
 *    decoupled from creation.
 *  - **People & roles**, the pre-existing item-grant form — `manage_access` only.
 */

import type { ItemGrantRecord } from '@/db/queries/grants';
import { personaOf, PERSONA_LABEL } from '@/lib/persona';
import { publicUrlOf, isAnonymouslyReadable } from '@/lib/def-helpers';
import type { Visibility } from '@/lib/visibility';
import type { CollectionDefinition } from '@/fields/types';
import {
  Card,
  CardContent,
  Badge,
  Button,
  FormField,
  Select,
  Input,
  Checkbox,
  ScopePicker,
  ACCESS_ACTION_LABELS,
} from '@/components/ui';

/** Actions meaningful to grant on a single document. */
const SHARE_ACTIONS = ['read', 'update', 'delete', 'publish'] as const;

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

function ShareLinksSection({
  slug,
  id,
  def,
  doc,
  links,
  baseUrl,
}: {
  slug: string;
  id: string;
  def: CollectionDefinition;
  doc: ShareDoc;
  links: ItemGrantRecord[];
  baseUrl: string;
}) {
  const action = `/admin/c/${slug}/${id}/share`;
  const alreadyPublic = isAnonymouslyReadable(def, doc);
  const publicUrl = alreadyPublic ? publicUrlOf(def, doc, baseUrl) : null;

  return (
    <Card class="mt-8">
      <CardContent class="pt-6">
        <h2 class="mb-1 font-display text-display-sm">Share links</h2>
        <p class="mb-4 text-sm text-ink-subtle">
          Mint a read-only link anyone can open — no account needed. Optionally require a password.
        </p>

        {alreadyPublic && publicUrl ? (
          <div role="status" class="mb-4 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
            This document is already readable at <span class="font-mono">{publicUrl}</span>. Links and
            passwords don't restrict that — set visibility to Private to require a link.
          </div>
        ) : null}

        <div class="mb-5 flex flex-col gap-2">
          {links.length === 0 ? (
            <p class="text-sm text-ink-subtle">No share links yet.</p>
          ) : (
            links.map((g) => (
              <div class="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
                <span class="text-sm font-medium text-ink">
                  {g.label ?? `link …${g.subjectId.slice(0, 8)}`}
                </span>
                {g.hasPassword ? <Badge tone="accent">Password</Badge> : null}
                {g.expiresAt && (
                  <span class="font-mono text-xs text-ink-subtle">until {g.expiresAt.slice(0, 16).replace('T', ' ')}</span>
                )}
                <form method="post" action={action} class="ml-auto">
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

        <form
          method="post"
          action={action}
          class="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <input type="hidden" name="op" value="link" />
          <FormField fieldId={`share-link-label-${id}`} label="Label (optional)">
            <Input id={`share-link-label-${id}`} name="label" type="text" placeholder="e.g. Acme review" />
          </FormField>
          <FormField fieldId={`share-link-password-${id}`} label="Password (optional)">
            <div class="flex items-center gap-2">
              <Input
                id={`share-link-password-${id}`}
                name="password"
                type="password"
                placeholder="At least 8 characters"
                data-attr:type="$showLinkPassword ? 'text' : 'password'"
              />
              <label class="flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-subtle">
                <Checkbox aria-label="Show password" data-bind="showLinkPassword" />
                Show
              </label>
            </div>
          </FormField>
          <FormField fieldId={`share-link-expiry-${id}`} label="Expires (optional)">
            <Input id={`share-link-expiry-${id}`} name="expiresAt" type="datetime-local" />
          </FormField>
          <Button type="submit" variant="secondary">
            Create share link
          </Button>
        </form>
      </CardContent>
    </Card>
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
}: {
  slug: string;
  id: string;
  /** Present only for principals holding `manage_access` — renders the
   *  People & roles section below Share links. */
  grants?: ItemGrantRecord[];
  principals?: ShareSubject[];
  roles?: { slug: string; name: string }[];
  teams?: { id: string; name: string }[];
  /** Present only for principals holding `share_link` — renders the Share
   *  links section above the People & roles grants. */
  def?: CollectionDefinition;
  doc?: ShareDoc;
  links?: ItemGrantRecord[];
  baseUrl?: string;
}) {
  const action = `/admin/c/${slug}/${id}/share`;
  const nameById = new Map((principals ?? []).map((p) => [p.id, p.name]));
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  return (
    <>
      {def && doc && links && baseUrl ? (
        <ShareLinksSection slug={slug} id={id} def={def} doc={doc} links={links} baseUrl={baseUrl} />
      ) : null}

      {grants && principals && roles && teams ? (
      <Card class="mt-8">
        <CardContent class="pt-6">
          <h2 class="mb-1 font-display text-display-sm">People & roles</h2>
          <p class="mb-4 text-sm text-ink-subtle">
            Grant a specific person, service, agent, or role scoped access to this item — without changing
            their collection-wide role. Grants can expire.
          </p>

          {/* Active grants */}
          <div class="mb-5 flex flex-col gap-2">
            {grants.length === 0 ? (
              <p class="text-sm text-ink-subtle">No one has been granted item-level access yet.</p>
            ) : (
              grants.map((g) => (
                <div class="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
                  <Badge
                    tone={
                      g.subjectKind === 'role'
                        ? 'accent'
                        : g.subjectKind === 'team'
                          ? 'success'
                          : 'info'
                    }
                  >
                    {g.subjectKind}
                  </Badge>
                  <span class="text-sm font-medium text-ink">
                    {g.subjectKind === 'principal'
                      ? (nameById.get(g.subjectId) ?? g.subjectId)
                      : g.subjectKind === 'team'
                        ? (teamNameById.get(g.subjectId) ?? g.subjectId)
                        : g.subjectId}
                  </span>
                  <span class="flex flex-wrap gap-1">
                    {g.actions.map((a) => (
                      <Badge tone="neutral">{a}</Badge>
                    ))}
                  </span>
                  {g.expiresAt && (
                    <span class="font-mono text-xs text-ink-subtle">until {g.expiresAt.slice(0, 16).replace('T', ' ')}</span>
                  )}
                  <form method="post" action={action} class="ml-auto">
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

          {/* Grant form */}
          <form
            method="post"
            action={action}
            class="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <input type="hidden" name="op" value="grant" />
            <FormField fieldId={`share-subject-${id}`} label="Grant to">
              <Select id={`share-subject-${id}`} name="subject">
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
            <ScopePicker
              idPrefix={`share-${id}`}
              name="action"
              groups={[{ label: 'Actions', actions: SHARE_ACTIONS.map((a) => ({ value: a, label: ACCESS_ACTION_LABELS[a] })) }]}
              checked={new Set(['read'])}
            />
            <FormField fieldId={`share-expiry-${id}`} label="Expires (optional)">
              <Input id={`share-expiry-${id}`} name="expiresAt" type="datetime-local" />
            </FormField>
            <Button type="submit" variant="secondary">
              Grant access
            </Button>
          </form>
        </CardContent>
      </Card>
      ) : null}
    </>
  );
}
