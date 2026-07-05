/**
 * Share panel — surfaces the per-document item-grant model on the edit view for
 * principals who hold `manage_access` on the document. Grant a specific principal
 * (person / service / agent) or a role scoped actions on THIS document, optionally
 * expiring; revoke any active grant. All native forms → the sibling `share` route.
 */

import type { ItemGrantRecord } from '@/db/queries/grants';
import { personaOf, PERSONA_LABEL } from '@/lib/persona';
import { Card, CardContent, Badge, Button, FormField, Select, Input } from '@/components/ui';

/** Actions meaningful to grant on a single document. */
const SHARE_ACTIONS = ['read', 'update', 'delete', 'publish'] as const;

export interface ShareSubject {
  readonly id: string;
  readonly name: string;
  readonly kind: 'user' | 'agent';
  readonly subtype: string | null;
}

export function SharePanel({
  slug,
  id,
  grants,
  principals,
  roles,
}: {
  slug: string;
  id: string;
  grants: ItemGrantRecord[];
  principals: ShareSubject[];
  roles: { slug: string; name: string }[];
}) {
  const action = `/admin/c/${slug}/${id}/share`;
  const nameById = new Map(principals.map((p) => [p.id, p.name]));

  return (
    <Card class="mt-8">
      <CardContent class="pt-6">
        <h2 class="mb-1 font-serif text-display-sm">Share</h2>
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
                <Badge tone={g.subjectKind === 'role' ? 'accent' : g.subjectKind === 'link' ? 'warning' : 'info'}>
                  {g.subjectKind}
                </Badge>
                <span class="text-sm font-medium text-ink">
                  {g.subjectKind === 'principal'
                    ? (nameById.get(g.subjectId) ?? g.subjectId)
                    : g.subjectKind === 'link'
                      ? `link …${g.subjectId.slice(0, 8)}`
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
        <form method="post" action={action} class="flex flex-wrap items-end gap-3 border-t border-border pt-4">
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
              <optgroup label="Roles">
                {roles.map((r) => (
                  <option value={`role:${r.slug}`}>{r.name}</option>
                ))}
              </optgroup>
            </Select>
          </FormField>
          <fieldset class="flex flex-col gap-1">
            <legend class="mb-1 text-xs font-medium text-ink-muted">Actions</legend>
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              {SHARE_ACTIONS.map((a) => (
                <label class="inline-flex items-center gap-1 text-sm text-ink-muted">
                  <input type="checkbox" name="action" value={a} checked={a === 'read'} class="accent-accent" /> {a}
                </label>
              ))}
            </div>
          </fieldset>
          <FormField fieldId={`share-expiry-${id}`} label="Expires (optional)">
            <Input id={`share-expiry-${id}`} name="expiresAt" type="datetime-local" />
          </FormField>
          <Button type="submit" variant="secondary">
            Grant access
          </Button>
        </form>

        {/* Share link (C3): grants READ to whoever holds the link — an outsider
            needs no account. Plaintext shown once on the next page. */}
        <form method="post" action={action} class="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <input type="hidden" name="op" value="link" />
          <FormField
            fieldId={`share-link-email-${id}`}
            label="Share by link (optionally email it)"
            description="Creates a read-only link anyone can open — no account needed. Email delivery is stubbed (logged, not sent)."
          >
            <Input id={`share-link-email-${id}`} name="email" type="email" placeholder="someone@example.com (optional)" />
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
