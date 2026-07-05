import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { SYSTEM_ROLE_SLUGS } from '@/access/policy';
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

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/access — principals & agents, roles, tokens, and the audit log. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const [roles, principals, tokens, audit] = await Promise.all([
    access.listRoles(db),
    access.listPrincipals(db, principal, now),
    access.listTokens(db, principal, now),
    access.listAudit(db, principal, now, 30),
  ]);
  const tokensByPrincipal = new Map<string, typeof tokens>();
  for (const t of tokens) {
    const list = tokensByPrincipal.get(t.principalId) ?? [];
    list.push(t);
    tokensByPrincipal.set(t.principalId, list);
  }

  return c.render(
    <AdminShell user={user} current="access">
      <PageHeader
        title="Access"
        description="People and agents, their roles and tokens, and the audit trail. Agents are first-class principals — least privilege by default."
      />

      {/* Roles */}
      <section class="mb-10">
        <h2 class="mb-3 font-serif text-display-sm">Roles</h2>
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
        <div class="mb-3 flex items-end justify-between gap-4">
          <h2 class="font-serif text-display-sm">Principals</h2>
          <form
            method="post"
            action="/admin/access/agents"
            class="flex items-end gap-2"
          >
            <FormField fieldId="agent-name" label="New agent identity">
              <Input id="agent-name" name="name" type="text" placeholder="researcher-bot" required />
            </FormField>
            <Button type="submit" size="sm">
              Create agent
            </Button>
          </form>
        </div>

        <div class="flex flex-col gap-4">
          {principals.map((p) => (
            <Card>
              <CardContent class="pt-5">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span class="font-medium text-ink">{p.name}</span>{' '}
                    <Badge tone={p.kind === 'agent' ? 'accent' : 'neutral'}>{p.kind}</Badge>
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
                  <Button type="submit" size="sm" variant="secondary">
                    Assign
                  </Button>
                </form>

                {/* Tokens (agents) */}
                {p.kind === 'agent' && (
                  <div class="mt-4 border-t border-border pt-3">
                    <div class="mb-2 flex flex-wrap items-center gap-2 text-sm">
                      <span class="font-medium">Tokens:</span>
                      {(tokensByPrincipal.get(p.id) ?? []).length === 0 ? (
                        <span class="text-ink-subtle">none</span>
                      ) : (
                        (tokensByPrincipal.get(p.id) ?? []).map((t) => (
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
                      <FormField fieldId={`toks-${p.id}`} label="Scope (narrowing)">
                        <Select id={`toks-${p.id}`} name="scope">
                          <option value="">full (no narrowing)</option>
                          <option value="read">read only</option>
                          <option value="read,create,update">write (no publish/delete)</option>
                        </Select>
                      </FormField>
                      <Button type="submit" size="sm" variant="secondary">
                        Issue token
                      </Button>
                    </form>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
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
