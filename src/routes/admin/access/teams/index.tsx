import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { getEmailTransport } from '@/lib/email';
import { teamJoinEmail } from '@/lib/email/templates';
import { personaOf, PERSONA_LABEL } from '@/lib/persona';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardContent,
  Badge,
  Input,
  Button,
  FormField,
  Breadcrumb,
  Select,
  EmptyState,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** Default join-link expiry offered in the form: 14 days out, minute precision
 *  (datetime-local format). */
function defaultExpiry(now: string): string {
  return new Date(new Date(now).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// GET /admin/access/teams — create teams, manage membership + join links
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const [teams, principals, roles] = await Promise.all([
    access.listTeams(db),
    access.listPrincipals(db, principal, now),
    access.listRoles(db),
  ]);
  const teamViews = await Promise.all(
    teams.map(async (t) => ({
      team: t,
      members: await access.listTeamMembers(db, principal, t.id, now),
      invites: await access.listTeamInvites(db, principal, t.id, now),
    })),
  );
  const assignableRoles = roles.filter((r) => r.slug !== 'anonymous');

  return c.render(
    <AdminShell user={user} current="access">
      <Breadcrumb items={[{ label: 'Access', href: '/admin/access' }, { label: 'Teams' }]} />
      <PageHeader
        title="Teams"
        description="Group people so content can be shared with everyone at once ('share with the tech team'). Teams carry no permissions of their own — only per-document grants."
      />

      {/* Create */}
      <Card class="mb-8">
        <CardContent class="pt-6">
          <h2 class="mb-3 font-serif text-display-sm">New team</h2>
          <form method="post" action="/admin/access/teams" class="flex flex-wrap items-end gap-3">
            <input type="hidden" name="op" value="create" />
            <FormField fieldId="team-name" label="Name">
              <Input id="team-name" name="name" type="text" placeholder="Tech team" required />
            </FormField>
            <FormField fieldId="team-desc" label="Description">
              <Input id="team-desc" name="description" type="text" placeholder="Who this team is" />
            </FormField>
            <Button type="submit">Create team</Button>
          </form>
        </CardContent>
      </Card>

      {/* Teams */}
      {teamViews.length === 0 ? (
        <EmptyState
          title="No teams yet"
          description="Create a team above, then add members or mint a join link."
        />
      ) : (
        <div class="flex flex-col gap-4">
          {teamViews.map(({ team, members, invites }) => {
            const memberIds = new Set(members.map((m) => m.principalId));
            const addable = principals.filter((p) => !p.disabled && !memberIds.has(p.id));
            return (
              <Card>
                <CardContent class="pt-5">
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <span class="font-medium text-ink">{team.name}</span>
                    <span class="font-mono text-xs text-ink-subtle">{team.id}</span>
                    <Badge tone="neutral">
                      {members.length} member{members.length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  {team.description && (
                    <p class="mb-3 text-sm text-ink-subtle">{team.description}</p>
                  )}

                  {/* Members */}
                  <ul class="mb-3 flex flex-wrap gap-1.5">
                    {members.length === 0 ? (
                      <li class="text-sm text-ink-subtle">No members yet</li>
                    ) : (
                      members.map((m) => (
                        <li>
                          <form method="post" action="/admin/access/teams" class="inline">
                            <input type="hidden" name="op" value="remove-member" />
                            <input type="hidden" name="teamId" value={team.id} />
                            <input type="hidden" name="principalId" value={m.principalId} />
                            <button
                              type="submit"
                              class="inline-flex items-center gap-1 rounded-full bg-hover px-2.5 py-0.5 text-xs font-medium text-ink-muted hover:bg-danger-soft hover:text-danger"
                              aria-label={`Remove ${m.name} from ${team.name}`}
                              title="Remove from team"
                            >
                              {m.name}
                              <span class="text-ink-subtle">
                                ({PERSONA_LABEL[personaOf(m.kind, m.subtype)]})
                              </span>
                              <span aria-hidden="true">×</span>
                            </button>
                          </form>
                        </li>
                      ))
                    )}
                  </ul>

                  {/* Add member */}
                  {addable.length > 0 && (
                    <form
                      method="post"
                      action="/admin/access/teams"
                      class="mb-4 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="op" value="add-member" />
                      <input type="hidden" name="teamId" value={team.id} />
                      <FormField fieldId={`add-${team.id}`} label="Add member">
                        <Select id={`add-${team.id}`} name="principalId" required>
                          <option value="">Choose…</option>
                          {addable.map((p) => (
                            <option value={p.id}>
                              {p.name} ({PERSONA_LABEL[personaOf(p.kind, p.subtype)]})
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <Button
                        type="submit"
                        variant="secondary"
                        aria-label={`Add member to ${team.name}`}
                      >
                        Add
                      </Button>
                    </form>
                  )}

                  {/* Join links */}
                  <div class="border-t border-border pt-3">
                    <h3 class="mb-2 text-xs font-medium tracking-wide text-ink-muted uppercase">
                      Join links
                    </h3>
                    {invites.length > 0 && (
                      <ul class="mb-3 flex flex-col gap-1.5">
                        {invites.map((inv) => {
                          const spent = inv.maxUses !== null && inv.useCount >= inv.maxUses;
                          const expired = inv.expiresAt <= now;
                          const dead = Boolean(inv.revokedAt) || spent || expired;
                          return (
                            <li class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                              <Badge tone={dead ? 'neutral' : 'accent'}>
                                {inv.revokedAt
                                  ? 'revoked'
                                  : spent
                                    ? 'used up'
                                    : expired
                                      ? 'expired'
                                      : 'active'}
                              </Badge>
                              <span>
                                role <span class="font-mono text-xs">{inv.role}</span> ·{' '}
                                {inv.useCount}
                                {inv.maxUses !== null ? `/${inv.maxUses}` : ''} uses · expires{' '}
                                {inv.expiresAt.slice(0, 16).replace('T', ' ')}
                              </span>
                              {!dead && (
                                <form method="post" action="/admin/access/teams" class="inline">
                                  <input type="hidden" name="op" value="revoke-invite" />
                                  <input type="hidden" name="inviteId" value={inv.id} />
                                  <button
                                    type="submit"
                                    class="text-xs font-medium text-danger hover:underline"
                                  >
                                    Revoke
                                  </button>
                                </form>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <form
                      method="post"
                      action="/admin/access/teams"
                      class="flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="op" value="invite" />
                      <input type="hidden" name="teamId" value={team.id} />
                      <FormField fieldId={`role-${team.id}`} label="Role for joiners">
                        <Select id={`role-${team.id}`} name="role">
                          {assignableRoles.map((r) => (
                            <option value={r.slug} selected={r.slug === 'reader'}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField fieldId={`expires-${team.id}`} label="Expires">
                        <Input
                          id={`expires-${team.id}`}
                          name="expiresAt"
                          type="datetime-local"
                          value={defaultExpiry(now)}
                          required
                        />
                      </FormField>
                      <FormField fieldId={`uses-${team.id}`} label="Max uses (blank = unlimited)">
                        <Input
                          id={`uses-${team.id}`}
                          name="maxUses"
                          type="number"
                          min="1"
                          placeholder="∞"
                        />
                      </FormField>
                      <FormField fieldId={`email-${team.id}`} label="Email link to (optional)">
                        <Input
                          id={`email-${team.id}`}
                          name="email"
                          type="email"
                          placeholder="stu@example.com"
                        />
                      </FormField>
                      <Button
                        type="submit"
                        variant="secondary"
                        aria-label={`Mint join link for ${team.name}`}
                      >
                        Mint join link
                      </Button>
                    </form>
                  </div>

                  {/* Delete */}
                  <form
                    method="post"
                    action="/admin/access/teams"
                    class="mt-4 border-t border-border pt-3"
                  >
                    <input type="hidden" name="op" value="delete" />
                    <input type="hidden" name="teamId" value={team.id} />
                    <Button type="submit" variant="danger" aria-label={`Delete team ${team.name}`}>
                      Delete team
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AdminShell>,
  );
});

// ---------------------------------------------------------------------------
// POST /admin/access/teams — op dispatch: create | delete | add-member |
// remove-member | invite | revoke-invite
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const op = String(body.op ?? '');
  const teamId = String(body.teamId ?? '');

  if (op === 'create') {
    await access.createTeam(
      db,
      principal,
      { name: String(body.name ?? ''), description: String(body.description ?? '') },
      now,
    );
  } else if (op === 'delete') {
    await access.deleteTeam(db, principal, teamId, now);
  } else if (op === 'add-member') {
    await access.addTeamMember(db, principal, teamId, String(body.principalId ?? ''), now);
  } else if (op === 'remove-member') {
    await access.removeTeamMember(db, principal, teamId, String(body.principalId ?? ''), now);
  } else if (op === 'revoke-invite') {
    await access.revokeTeamInvite(db, principal, String(body.inviteId ?? ''), now);
  } else if (op === 'invite') {
    const maxUsesRaw = String(body.maxUses ?? '').trim();
    const expiresRaw = String(body.expiresAt ?? '');
    const { token } = await access.createTeamInvite(
      db,
      principal,
      {
        teamId,
        role: String(body.role ?? 'reader'),
        maxUses: maxUsesRaw ? Number(maxUsesRaw) : undefined,
        expiresAt: expiresRaw ? new Date(expiresRaw).toISOString() : '',
      },
      now,
    );

    const team = (await access.listTeams(db)).find((t) => t.id === teamId);
    const settings = await getSettings(db);
    const link = `${resolveBaseUrl(c.env, settings, c.req.url)}/auth/join/${token}`;

    const email = String(body.email ?? '').trim();
    const transport = getEmailTransport(c.env, settings);
    if (email) {
      await transport.send({
        to: email,
        ...teamJoinEmail({ link, teamName: team?.name ?? 'a team', siteName: settings.siteName }),
      });
    }

    const emailNote = email
      ? transport.kind === 'resend'
        ? ` — it was emailed to ${email}`
        : ` — the email to ${email} was stubbed (logged, not sent), so share it directly`
      : '';
    const user = getUser(c);
    return c.render(
      <AdminShell user={user} current="access">
        <PageHeader
          title="Join link created"
          description="Share this link — it will not be shown again."
        />
        <Card>
          <CardContent class="pt-6">
            <p class="mb-3 text-sm text-ink-muted">
              Anyone with this link can create an account on{' '}
              {team?.name ? `the "${team.name}" team` : 'this team'} until it expires{emailNote}.
              Copy it now; only its hash is stored.
            </p>
            <code class="block overflow-x-auto rounded-md bg-hover px-4 py-3 font-mono text-sm break-all">
              {link}
            </code>
            <div class="mt-5">
              <Button href="/admin/access/teams">Back to Teams</Button>
            </div>
          </CardContent>
        </Card>
      </AdminShell>,
    );
  }

  return c.redirect('/admin/access/teams', 303);
});
