import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { oauthProvenance } from '@/services/oauth';
import { SYSTEM_ROLE_SLUGS } from '@/access/policy';
import { personaOf, PERSONA_LABEL, PERSONA_TONE, type Persona } from '@/lib/persona';
import { relativeTime } from '@/lib/relative-time';
import { jsLiteral } from '@/lib/datastar-response';
import { listCollections } from '@/services/collections';
import type { PrincipalRecord, TokenRecord } from '@/db/queries/principals';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  Badge,
  Stamp,
  Input,
  Select,
  Button,
  FormField,
  ScopePicker,
  ACCESS_ACTION_GROUPS,
  ACCESS_ACTION_LABELS,
  TOKEN_SCOPE_PRESETS,
  tokenPresetFor,
} from '@/components/ui';

/**
 * /admin/access — the DIRECTORY of who has access (D48 restructure): one
 * primary action (Connect an agent), the persona groups with connection
 * health, and the audit trail. All creation/minting moved to the connect
 * wizard; roles/teams/matrix live on their own sub-pages.
 */

/** Connection health from the freshest token use (resolvePrincipal stamps
 *  last_used_at on every authenticated REST/MCP call). Colour + words, never
 *  colour alone (A11Y). */
function HealthLine({ p, tokens, now }: { p: PrincipalRecord; tokens: TokenRecord[]; now: string }) {
  if (tokens.length === 0) {
    return (
      <p class="mt-1 text-sm text-ink-subtle">
        No token yet —{' '}
        <a href={`/admin/access/connect?for=${p.id}`} class="text-accent-text hover:underline">
          connect it →
        </a>
      </p>
    );
  }
  const used = tokens.map((t) => t.lastUsedAt).filter((t): t is string => t !== null);
  if (used.length === 0) {
    return (
      <p class="mt-1 flex items-center gap-2 text-sm text-ink-muted">
        <span aria-hidden="true" class="size-1.5 rounded-full bg-warning" />
        Never connected — check your client config
        <a href={`/admin/access/connect?for=${p.id}`} class="text-accent-text hover:underline">
          view setup →
        </a>
      </p>
    );
  }
  const latest = used.sort().at(-1)!;
  return (
    <p class="mt-1 flex items-center gap-2 text-sm text-ink-muted">
      <span aria-hidden="true" class="size-1.5 rounded-full bg-success" />
      Connected · last used {relativeTime(latest, now)}
    </p>
  );
}

/** Plain-words summary of a token's scope mask ("Full access" when unnarrowed). */
function scopeSummary(scope: TokenRecord['scope']): string {
  if (!scope || scope.length === 0) return 'Full access';
  const byCollection = new Map<string, string[]>();
  for (const s of scope) byCollection.set(s.collection, [...(byCollection.get(s.collection) ?? []), s.action]);
  return [...byCollection]
    .map(([col, acts]) => {
      const labels = acts.map((a) => ACCESS_ACTION_LABELS[a] ?? a).join(', ');
      return col === '*' ? labels : `${labels} @${col}`;
    })
    .join(' · ');
}

/** One token: name, scope, last use, an in-place scope editor, and revoke. */
function TokenRow({ t, collectionSlugs, now }: { t: TokenRecord; collectionSlugs: string[]; now: string }) {
  const actions = (t.scope ?? []).map((s) => s.action);
  const sig = t.id.replace(/[^a-zA-Z0-9]/g, '');
  return (
    <li class="flex flex-col gap-1 py-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span class="font-medium text-ink">{t.name}</span>
        <Badge tone="neutral">{scopeSummary(t.scope)}</Badge>
        {t.oauth && <span class="text-xs text-ink-subtle">via OAuth</span>}
        <span class="font-mono text-xs text-ink-subtle">
          {t.lastUsedAt ? `used ${relativeTime(t.lastUsedAt, now)}` : 'never used'}
        </span>
        <form
          method="post"
          action="/admin/access/tokens"
          class="ml-auto"
          onsubmit={`return confirm('Revoke the token ${jsLiteral(t.name)}? Clients using it stop working immediately.')`}
        >
          <input type="hidden" name="op" value="revoke" />
          <input type="hidden" name="tokenId" value={t.id} />
          <Button type="submit" variant="ghost" size="sm" aria-label={`Revoke token ${t.name}`}>
            Revoke
          </Button>
        </form>
      </div>
      {t.oauth ? (
        <p class="text-xs text-ink-subtle">
          Scope comes from the OAuth consent — revoke and reconnect the client to change it.
        </p>
      ) : (
        <details>
          <summary class="cursor-pointer text-sm font-medium text-ink-muted hover:text-ink">Edit scope</summary>
          <form method="post" action="/admin/access/tokens" class="mt-2 flex flex-col gap-3">
            <input type="hidden" name="op" value="scope" />
            <input type="hidden" name="tokenId" value={t.id} />
            <ScopePicker
              idPrefix={`tok-${sig}`}
              name="scopeAction"
              groups={ACCESS_ACTION_GROUPS}
              checked={new Set(actions)}
              presets={TOKEN_SCOPE_PRESETS}
              defaultPreset={tokenPresetFor(actions)}
              collection={{ name: 'scopeCollection', options: collectionSlugs, selected: t.scope?.[0]?.collection }}
              help="Full access = the token inherits the agent's roles. A scope only ever narrows them."
            />
            <div>
              <Button type="submit" variant="secondary" size="sm">
                Save scope
              </Button>
            </div>
          </form>
        </details>
      )}
    </li>
  );
}

/** Disable/enable (reversible) and delete (permanent, confirmed) for a machine principal. */
function AgentActions({ p }: { p: PrincipalRecord }) {
  const name = jsLiteral(p.name);
  const toggle = p.disabled ? 'enable' : 'disable';
  return (
    <>
      <form
        data-on:submit={
          p.disabled
            ? `@post('/admin/access/agents', {contentType: 'form'})`
            : `confirm('Disable ${name}? Its tokens stop working until you enable it again.') && @post('/admin/access/agents', {contentType: 'form'})`
        }
      >
        <input type="hidden" name="op" value={toggle} />
        <input type="hidden" name="principalId" value={p.id} />
        <Button type="submit" variant="secondary" size="sm">
          {p.disabled ? 'Enable' : 'Disable'}
        </Button>
      </form>
      <form
        data-on:submit={`confirm('Permanently delete ${name}? Its tokens, roles, and grants are removed. This cannot be undone.') && @post('/admin/access/agents', {contentType: 'form'})`}
      >
        <input type="hidden" name="op" value="delete" />
        <input type="hidden" name="principalId" value={p.id} />
        <Button type="submit" variant="danger" size="sm">
          Delete
        </Button>
      </form>
    </>
  );
}

/** One principal card: identity, roles (+assign disclosure), tokens, health. */
function PrincipalCard({
  p,
  tokens,
  oauthClient,
  collectionSlugs,
  now,
}: {
  p: PrincipalRecord;
  tokens: TokenRecord[];
  oauthClient: string | undefined;
  collectionSlugs: string[];
  now: string;
}) {
  const persona = personaOf(p.kind, p.subtype);
  const machine = p.kind === 'agent';
  return (
    <Card>
      <CardContent class="pt-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span class="font-medium text-ink">{p.name}</span>{' '}
            <Badge tone={PERSONA_TONE[persona]}>{PERSONA_LABEL[persona]}</Badge>
            {oauthClient && (
              <span class="ml-2">
                <Badge tone="neutral">via OAuth</Badge>
              </span>
            )}
            {p.disabled && (
              <span class="ml-2">
                <Badge tone="danger">disabled</Badge>
              </span>
            )}
            {p.email && <span class="ml-2 font-mono text-xs text-ink-subtle">{p.email}</span>}
            <span class="ml-2 font-mono text-xs text-ink-subtle">{p.id}</span>
          </div>
          {machine && (
            <div class="flex flex-wrap items-center gap-2">
              <Button href={`/admin/access/connect?for=${p.id}`} variant="secondary" size="sm">
                New token →
              </Button>
              <AgentActions p={p} />
            </div>
          )}
        </div>

        {machine && <HealthLine p={p} tokens={tokens} now={now} />}

        {/* Role assignments */}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          {p.roles.length === 0 ? (
            <span class="text-sm text-ink-subtle">No roles — can do nothing (default deny).</span>
          ) : (
            p.roles.map((r) => (
              <form method="post" action="/admin/access/assign" class="contents">
                <input type="hidden" name="op" value="unassign" />
                <input type="hidden" name="principalId" value={p.id} />
                <input type="hidden" name="role" value={r.role} />
                <input type="hidden" name="collection" value={r.collection} />
                <button type="submit" class="group inline-flex items-center gap-1 rounded-sm">
                  <Badge tone="success">
                    {r.role}
                    {r.collection !== '*' ? ` @${r.collection}` : ''} ✕
                  </Badge>
                </button>
              </form>
            ))
          )}
        </div>

        {/* Assign a role — collapsed: routine cards stay a directory row. */}
        <details class="mt-2">
          <summary class="cursor-pointer text-sm font-medium text-ink-muted hover:text-ink">
            Assign role
          </summary>
          <form
            method="post"
            action="/admin/access/assign"
            class="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <input type="hidden" name="op" value="assign" />
            <input type="hidden" name="principalId" value={p.id} />
            <FormField fieldId={`role-${p.id}`} label="Role">
              <Select id={`role-${p.id}`} name="role">
                {SYSTEM_ROLE_SLUGS.filter((s) => s !== 'anonymous').map((s) => (
                  <option value={s}>{s}</option>
                ))}
              </Select>
            </FormField>
            <FormField fieldId={`scope-${p.id}`} label="Scope">
              <Input id={`scope-${p.id}`} name="collection" type="text" value="*" placeholder="* or a slug" />
            </FormField>
            <Button type="submit" variant="secondary">
              Assign
            </Button>
          </form>
        </details>

        {/* Tokens (machine principals): scope, re-scope, revoke; minting lives on /connect. */}
        {machine && tokens.length > 0 && (
          <div class="mt-4 border-t border-border pt-2">
            <h4 class="text-sm font-medium text-ink">Tokens</h4>
            <ul class="divide-y divide-border">
              {tokens.map((t) => (
                <TokenRow t={t} collectionSlugs={collectionSlugs} now={now} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A titled group of principal cards (People / Services / Agents), or a hint if empty. */
function PersonaGroup({
  title,
  hint,
  principals,
  tokensByPrincipal,
  oauthByPrincipal,
  collectionSlugs,
  now,
  headerExtra,
}: {
  title: string;
  hint: unknown;
  principals: PrincipalRecord[];
  tokensByPrincipal: Map<string, TokenRecord[]>;
  oauthByPrincipal: Map<string, string>;
  collectionSlugs: string[];
  now: string;
  headerExtra?: unknown;
}) {
  return (
    <div class="mb-6">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold tracking-wide text-ink-muted uppercase">
          {title} <span class="ml-1 font-normal text-ink-subtle">({principals.length})</span>
        </h3>
      </div>
      {headerExtra}
      {principals.length === 0 ? (
        <p class="text-sm text-ink-subtle">{hint}</p>
      ) : (
        <div class="flex flex-col gap-4">
          {principals.map((p) => (
            <PrincipalCard
              p={p}
              tokens={tokensByPrincipal.get(p.id) ?? []}
              oauthClient={oauthByPrincipal.get(p.id)}
              collectionSlugs={collectionSlugs}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** The invite-a-person flow, folded into the People group as a disclosure. */
function AddPersonDisclosure() {
  return (
    <details class="mb-4">
      <summary class="cursor-pointer text-sm font-medium text-accent-text hover:underline">
        Add a person
      </summary>
      <form
        data-indicator:invbusy=""
        data-on:submit="!$invbusy && @post('/admin/access/users', {contentType: 'form'})"
        class="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <FormField fieldId="invite-name" label="Name">
          <Input id="invite-name" name="name" type="text" placeholder="Jane Doe" required />
        </FormField>
        <FormField fieldId="invite-email" label="Email">
          <Input id="invite-email" name="email" type="email" placeholder="jane@example.com" required />
        </FormField>
        <FormField fieldId="invite-role" label="Initial role">
          <Select id="invite-role" name="role">
            {SYSTEM_ROLE_SLUGS.filter((s) => s !== 'anonymous').map((s) => (
              <option value={s} selected={s === 'reader'}>
                {s}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField fieldId="invite-password" label="Password (optional)">
          <Input
            id="invite-password"
            name="password"
            type="password"
            placeholder="blank → email an invite link"
          />
        </FormField>
        <Button type="submit" variant="secondary" busy="$invbusy">
          Add person
        </Button>
      </form>
      {/* Datastar morphs the invite link (+ copy button) into this slot in place. */}
      <div id="invite-reveal" />
    </details>
  );
}

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/access — the access directory + audit log. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const [principals, tokens, audit, oauthByPrincipal, collections] = await Promise.all([
    access.listPrincipals(db, principal, now),
    access.listTokens(db, principal, now),
    access.listAudit(db, principal, now, 30),
    oauthProvenance(db, principal, now),
    listCollections(db),
  ]);
  const collectionSlugs = collections.map((col) => col.slug);
  const tokensByPrincipal = new Map<string, typeof tokens>();
  for (const t of tokens) {
    const list = tokensByPrincipal.get(t.principalId) ?? [];
    list.push(t);
    tokensByPrincipal.set(t.principalId, list);
  }

  const byPersona = (target: Persona) =>
    principals.filter((p) => personaOf(p.kind, p.subtype) === target);
  const people = byPersona('person');
  const services = byPersona('service');
  const agents = byPersona('agent');
  const connectHint = (
    <>
      None yet —{' '}
      <a href="/admin/access/connect" class="text-accent-text hover:underline">
        connect an agent to get started →
      </a>
    </>
  );

  return c.render(
    <AdminShell user={user} current="access">
      <PageHeader
        title="Access"
        description="Who can touch this remill — people, services, and agents, with their roles, tokens, and the audit trail."
        actions={
          <Button href="/admin/access/connect" variant="primary">
            Connect an agent
          </Button>
        }
      />

      <div class="mb-8 flex flex-wrap gap-4 text-sm font-medium">
        <a href="/admin/access/matrix" class="text-accent-text hover:underline">
          Access overview (who can touch what) →
        </a>
        <a href="/admin/access/roles" class="text-accent-text hover:underline">
          Manage roles →
        </a>
        <a href="/admin/access/teams" class="text-accent-text hover:underline">
          Manage teams →
        </a>
      </div>

      {/* Principals directory */}
      <section class="mb-10">
        <PersonaGroup
          title="People"
          hint="Humans who sign in with a password."
          principals={people}
          tokensByPrincipal={tokensByPrincipal}
          oauthByPrincipal={oauthByPrincipal}
          collectionSlugs={collectionSlugs}
          now={now}
          headerExtra={<AddPersonDisclosure />}
        />
        <PersonaGroup
          title="Services"
          hint={connectHint}
          principals={services}
          tokensByPrincipal={tokensByPrincipal}
          oauthByPrincipal={oauthByPrincipal}
          collectionSlugs={collectionSlugs}
          now={now}
        />
        <PersonaGroup
          title="Agents"
          hint={connectHint}
          principals={agents}
          tokensByPrincipal={tokensByPrincipal}
          oauthByPrincipal={oauthByPrincipal}
          collectionSlugs={collectionSlugs}
          now={now}
        />
      </section>

      {/* Audit log */}
      <section>
        <h2 class="mb-3 font-display text-display-sm">Audit log</h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>When</TableHeaderCell>
              <TableHeaderCell>Principal</TableHeaderCell>
              <TableHeaderCell>Surface</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
              <TableHeaderCell>Resource</TableHeaderCell>
              <TableHeaderCell>Result</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {audit.map((a) => (
              <TableRow>
                <TableCell>
                  <span class="font-mono text-xs text-ink-subtle">
                    {a.createdAt.slice(0, 19).replace('T', ' ')}
                  </span>
                </TableCell>
                <TableCell>
                  <span class="font-mono text-xs">{a.principalId}</span>
                </TableCell>
                <TableCell>{a.surface}</TableCell>
                <TableCell>{a.action}</TableCell>
                <TableCell>
                  <span class="font-mono text-xs">{a.resource}</span>
                </TableCell>
                <TableCell>
                  {a.allowed ? (
                    <Badge tone="success">allow</Badge>
                  ) : (
                    <Stamp tone="refuse">deny</Stamp>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </AdminShell>,
  );
});
