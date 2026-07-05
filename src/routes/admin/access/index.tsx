import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { listCollections } from '@/services/collections';
import { ACTIONS } from '@/access';
import { SYSTEM_ROLE_SLUGS } from '@/access/policy';
import { personaOf, PERSONA_LABEL, PERSONA_TONE, type Persona } from '@/lib/persona';
import type { PrincipalRecord, TokenRecord } from '@/db/queries/principals';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  Badge,
  Input,
  Select,
  Button,
  FormField,
} from '@/components/ui';

/** One principal card — role badges, inline assign, and (machine principals) tokens. */
function PrincipalCard({
  p,
  tokens,
  collectionSlugs,
}: {
  p: PrincipalRecord;
  tokens: TokenRecord[];
  collectionSlugs: string[];
}) {
  const persona = personaOf(p.kind, p.subtype);
  return (
    <Card>
      <CardContent class="pt-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span class="font-medium text-ink">{p.name}</span>{' '}
            <Badge tone={PERSONA_TONE[persona]}>{PERSONA_LABEL[persona]}</Badge>
            {p.disabled && <span class="ml-2"><Badge tone="danger">disabled</Badge></span>}
            {p.email && <span class="ml-2 font-mono text-xs text-ink-subtle">{p.email}</span>}
            <span class="ml-2 font-mono text-xs text-ink-subtle">{p.id}</span>
          </div>
        </div>

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

        {/* Assign a role */}
        <form method="post" action="/admin/access/assign" class="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="op" value="assign" />
          <input type="hidden" name="principalId" value={p.id} />
          <FormField fieldId={`role-${p.id}`} label="Assign role">
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

        {/* Tokens (machine principals — services & agents) */}
        {p.kind === 'agent' && (
          <div class="mt-4 border-t border-border pt-3">
            <div class="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span class="font-medium">Tokens:</span>
              {tokens.length === 0 ? (
                <span class="text-ink-subtle">none</span>
              ) : (
                tokens.map((t) => (
                  <form method="post" action="/admin/access/tokens" class="contents">
                    <input type="hidden" name="op" value="revoke" />
                    <input type="hidden" name="tokenId" value={t.id} />
                    <button type="submit">
                      <Badge tone="neutral">{t.name} ✕</Badge>
                    </button>
                  </form>
                ))
              )}
            </div>
            <form method="post" action="/admin/access/tokens" class="flex flex-wrap items-end gap-2">
              <input type="hidden" name="op" value="issue" />
              <input type="hidden" name="principalId" value={p.id} />
              <FormField fieldId={`tok-${p.id}`} label="New token">
                <Input id={`tok-${p.id}`} name="name" type="text" placeholder="prod read-only" required />
              </FormField>
              <FormField fieldId={`tokc-${p.id}`} label="Scope: collection">
                <Select id={`tokc-${p.id}`} name="scopeCollection">
                  <option value="*">All collections</option>
                  {collectionSlugs.map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </Select>
              </FormField>
              <fieldset class="flex flex-col gap-1">
                <legend class="mb-1 text-xs font-medium text-ink-muted">Scope: actions (none = full)</legend>
                <div class="flex flex-wrap gap-x-3 gap-y-1">
                  {ACTIONS.map((a) => (
                    <label class="inline-flex items-center gap-1 text-sm text-ink-muted">
                      <input type="checkbox" name="scopeAction" value={a} class="accent-accent" /> {a}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" variant="secondary">
                Issue token
              </Button>
            </form>
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
  collectionSlugs,
}: {
  title: string;
  hint: string;
  principals: PrincipalRecord[];
  tokensByPrincipal: Map<string, TokenRecord[]>;
  collectionSlugs: string[];
}) {
  return (
    <div class="mb-6">
      <h3 class="mb-2 text-sm font-semibold tracking-wide text-ink-muted uppercase">
        {title} <span class="ml-1 font-normal text-ink-subtle">({principals.length})</span>
      </h3>
      {principals.length === 0 ? (
        <p class="text-sm text-ink-subtle">{hint}</p>
      ) : (
        <div class="flex flex-col gap-4">
          {principals.map((p) => (
            <PrincipalCard p={p} tokens={tokensByPrincipal.get(p.id) ?? []} collectionSlugs={collectionSlugs} />
          ))}
        </div>
      )}
    </div>
  );
}

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/access — principals & agents, roles, tokens, and the audit log. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const [roles, principals, tokens, audit, collections] = await Promise.all([
    access.listRoles(db),
    access.listPrincipals(db, principal, now),
    access.listTokens(db, principal, now),
    access.listAudit(db, principal, now, 30),
    listCollections(db),
  ]);
  const collectionSlugs = collections.map((c) => c.slug);
  const tokensByPrincipal = new Map<string, typeof tokens>();
  for (const t of tokens) {
    const list = tokensByPrincipal.get(t.principalId) ?? [];
    list.push(t);
    tokensByPrincipal.set(t.principalId, list);
  }

  const byPersona = (target: Persona) => principals.filter((p) => personaOf(p.kind, p.subtype) === target);
  const people = byPersona('person');
  const services = byPersona('service');
  const agents = byPersona('agent');

  return c.render(
    <AdminShell user={user} current="access">
      <PageHeader
        title="Access"
        description="People, services, and agents — their roles and tokens, and the audit trail. Every actor is a first-class principal, least privilege by default."
      />

      {/* Roles */}
      <section class="mb-10">
        <div class="mb-3 flex items-baseline justify-between gap-4">
          <h2 class="font-serif text-display-sm">Roles</h2>
          <a href="/admin/access/roles" class="text-sm font-medium text-accent-text hover:underline">
            Manage roles →
          </a>
        </div>
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <Card>
              <CardHeader>
                <CardTitle>
                  {r.name} {r.system && <Badge tone="neutral">system</Badge>}
                </CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul class="flex flex-wrap gap-1.5">
                  {r.permissions.length === 0 ? (
                    <li class="text-sm text-ink-subtle">No permissions</li>
                  ) : (
                    r.permissions.map((p) => (
                      <li>
                        <Badge tone="accent">
                          {p.action}
                          {p.condition ? `:${p.condition}` : ''}
                        </Badge>
                      </li>
                    ))
                  )}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Principals */}
      <section class="mb-10">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 class="font-serif text-display-sm">Principals</h2>
            <p class="mt-1 max-w-2xl text-sm text-ink-subtle">
              Three kinds of actor: <span class="text-ink-muted">People</span> (humans who sign in),
              {' '}
              <span class="text-ink-muted">Services</span> (systems that pull data via the API), and
              {' '}
              <span class="text-ink-muted">Agents</span> (autonomous AI clients over MCP or the API).
              Services and agents authenticate with scoped bearer tokens.
            </p>
          </div>
          <form method="post" action="/admin/access/agents" class="flex items-end gap-2">
            <FormField fieldId="agent-name" label="New machine identity">
              <Input id="agent-name" name="name" type="text" placeholder="researcher-bot" required />
            </FormField>
            <FormField fieldId="agent-subtype" label="Type">
              <Select id="agent-subtype" name="subtype">
                <option value="agent">Agent</option>
                <option value="service">Service</option>
              </Select>
            </FormField>
            <Button type="submit">Create</Button>
          </form>
        </div>

        {/* Invite / add a Person */}
        <form
          method="post"
          action="/admin/access/users"
          class="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4"
        >
          <FormField fieldId="invite-name" label="Add a person — name">
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
            <Input id="invite-password" name="password" type="password" placeholder="blank → email an invite link" />
          </FormField>
          <Button type="submit" variant="secondary">
            Add person
          </Button>
        </form>

        <PersonaGroup
          title="People"
          hint="Humans who sign in with a password."
          principals={people}
          tokensByPrincipal={tokensByPrincipal}
          collectionSlugs={collectionSlugs}
        />
        <PersonaGroup
          title="Services"
          hint="No services yet — create one above for a system that pulls data via the API."
          principals={services}
          tokensByPrincipal={tokensByPrincipal}
          collectionSlugs={collectionSlugs}
        />
        <PersonaGroup
          title="Agents"
          hint="No agents yet — create one above for an autonomous AI client (MCP or API)."
          principals={agents}
          tokensByPrincipal={tokensByPrincipal}
          collectionSlugs={collectionSlugs}
        />
      </section>

      {/* Audit log */}
      <section>
        <h2 class="mb-3 font-serif text-display-sm">Audit log</h2>
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
                  <span class="font-mono text-xs text-ink-subtle">{a.createdAt.slice(0, 19).replace('T', ' ')}</span>
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
                  <Badge tone={a.allowed ? 'success' : 'danger'}>{a.allowed ? 'allow' : 'deny'}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </AdminShell>,
  );
});
