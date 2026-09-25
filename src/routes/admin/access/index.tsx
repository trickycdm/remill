import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { oauthProvenance } from '@/services/oauth';
import { SYSTEM_ROLE_SLUGS } from '@/access/policy';
import { personaOf, type Persona } from '@/lib/persona';
import { healthOf, HealthLabel, principalHref } from '@/components/admin/principal-display';
import type { PrincipalRecord, TokenRecord } from '@/db/queries/principals';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
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
} from '@/components/ui';

/**
 * /admin/access — the DIRECTORY of who has access (D48 restructure): one
 * primary action (Connect an agent), the persona groups as scannable tables
 * with connection health, and the audit trail. Managing one principal (rename,
 * roles, tokens, disable/delete) happens on its detail page,
 * /admin/access/principals/:id. Creation/minting lives in the connect wizard;
 * roles/teams/matrix live on their own sub-pages.
 */

/** One directory row: name (the link to the detail page), status, roles,
 *  tokens. Everything that changes a principal lives on its detail page, so
 *  the list stays scannable however many agents there are. */
function PrincipalRow({
  p,
  tokens,
  oauthClient,
  now,
}: {
  p: PrincipalRecord;
  tokens: TokenRecord[];
  oauthClient: string | undefined;
  now: string;
}) {
  const machine = p.kind === 'agent';
  const href = principalHref(p.id);
  const roles = p.roles.map((r) => (r.collection === '*' ? r.role : `${r.role} (${r.collection})`)).join(', ');
  return (
    <TableRow>
      <TableCell>
        <a href={href} class="font-medium text-ink hover:text-accent-text hover:underline">
          {p.name}
        </a>
        {oauthClient && (
          <span class="ml-2">
            <Badge tone="neutral">via OAuth</Badge>
          </span>
        )}
        {p.email && <span class="block text-xs text-ink-subtle">{p.email}</span>}
      </TableCell>
      {machine && (
        <TableCell class="text-sm text-ink-muted">
          <HealthLabel health={healthOf(p, tokens, now)} />
        </TableCell>
      )}
      <TableCell class="text-sm text-ink-muted">{roles || 'No roles'}</TableCell>
      {machine && (
        <TableCell class="text-sm whitespace-nowrap text-ink-muted">
          {tokens.length} token{tokens.length === 1 ? '' : 's'}
        </TableCell>
      )}
      <TableCell class="text-right">
        <Button href={href} variant="ghost" size="sm" aria-label={`Manage ${p.name}`}>
          Manage →
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** A titled group of principals (People / Services / Agents) as one table, or a hint if empty. */
function PersonaGroup({
  title,
  hint,
  principals,
  tokensByPrincipal,
  oauthByPrincipal,
  now,
  machine,
  headerExtra,
}: {
  title: string;
  hint: unknown;
  principals: PrincipalRecord[];
  tokensByPrincipal: Map<string, TokenRecord[]>;
  oauthByPrincipal: Map<string, string>;
  now: string;
  machine: boolean;
  headerExtra?: unknown;
}) {
  return (
    <div class="mb-8">
      <h3 class="mb-2 text-sm font-semibold tracking-wide text-ink-muted uppercase">
        {title} <span class="ml-1 font-normal text-ink-subtle">({principals.length})</span>
      </h3>
      {headerExtra}
      {principals.length === 0 ? (
        <p class="text-sm text-ink-subtle">{hint}</p>
      ) : (
        <Table caption={title}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              {machine && <TableHeaderCell>Status</TableHeaderCell>}
              <TableHeaderCell>Roles</TableHeaderCell>
              {machine && <TableHeaderCell>Tokens</TableHeaderCell>}
              <TableHeaderCell>
                <span class="sr-only">Actions</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {principals.map((p) => (
              <PrincipalRow
                p={p}
                tokens={tokensByPrincipal.get(p.id) ?? []}
                oauthClient={oauthByPrincipal.get(p.id)}
                now={now}
              />
            ))}
          </TableBody>
        </Table>
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

  const [principals, tokens, audit, oauthByPrincipal] = await Promise.all([
    access.listPrincipals(db, principal, now),
    access.listTokens(db, principal, now),
    access.listAudit(db, principal, now, 30),
    oauthProvenance(db, principal, now),
  ]);
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
          now={now}
          machine={false}
          headerExtra={<AddPersonDisclosure />}
        />
        <PersonaGroup
          title="Services"
          hint={connectHint}
          principals={services}
          tokensByPrincipal={tokensByPrincipal}
          oauthByPrincipal={oauthByPrincipal}
          now={now}
          machine
        />
        <PersonaGroup
          title="Agents"
          hint={connectHint}
          principals={agents}
          tokensByPrincipal={tokensByPrincipal}
          oauthByPrincipal={oauthByPrincipal}
          now={now}
          machine
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
