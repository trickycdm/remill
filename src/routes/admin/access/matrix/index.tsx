import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { getPrincipalPermissions } from '@/services/access';
import { listCollections } from '@/services/collections';
import { personaOf, PERSONA_LABEL, PERSONA_TONE } from '@/lib/persona';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Breadcrumb,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  Badge,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

type Perm = { collection: string; action: string; condition: unknown };

/** Effective actions a permission set grants on one collection (folding in '*'). */
function effectiveOn(perms: Perm[], collection: string): string[] {
  const acts = new Set<string>();
  for (const p of perms) {
    if (p.collection === '*' || p.collection === collection) {
      acts.add(p.condition ? `${p.action}:${p.condition}` : p.action);
    }
  }
  return [...acts].sort();
}

/** GET /admin/access/matrix — one place to see who/what can touch what. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const [principals, collections, tokens, grants, teams] = await Promise.all([
    access.listPrincipals(db, principal, now),
    listCollections(db),
    access.listTokens(db, principal, now),
    access.listAllItemGrants(db, principal, now),
    access.listTeams(db),
  ]);
  const slugs = collections.map((col) => col.slug);
  const nameById = new Map(principals.map((p) => [p.id, p.name]));
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

  // Effective permissions per principal (un-gated capability read).
  const permsList = await Promise.all(principals.map((p) => getPrincipalPermissions(db, p.id)));
  const permsByPrincipal = new Map<string, Perm[]>(
    principals.map((p, i) => [p.id, permsList[i] as Perm[]]),
  );

  return c.render(
    <AdminShell user={user} current="access">
      <Breadcrumb items={[{ label: 'Access', href: '/admin/access' }, { label: 'Overview' }]} />
      <PageHeader
        title="Access overview"
        description="Who and what can touch each collection — effective role permissions, item grants, and token scopes in one place."
      />

      {/* Effective-permission matrix */}
      <section class="mb-10 overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Principal</TableHeaderCell>
              {slugs.map((s) => (
                <TableHeaderCell>{s}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {principals.map((p) => {
              const perms = permsByPrincipal.get(p.id) ?? [];
              const persona = personaOf(p.kind, p.subtype);
              return (
                <TableRow>
                  <TableCell>
                    <span class="font-medium text-ink">{p.name}</span>{' '}
                    <Badge tone={PERSONA_TONE[persona]}>{PERSONA_LABEL[persona]}</Badge>
                  </TableCell>
                  {slugs.map((s) => {
                    const acts = effectiveOn(perms, s);
                    return (
                      <TableCell>
                        {acts.length === 0 ? (
                          <span class="text-ink-subtle">—</span>
                        ) : (
                          <span class="font-mono text-xs text-ink-muted">{acts.join(', ')}</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {/* Item grants */}
      <section class="mb-10">
        <h2 class="mb-3 font-serif text-display-sm">Item grants</h2>
        {grants.length === 0 ? (
          <p class="text-sm text-ink-subtle">
            No per-document grants. Share a document from its edit page to add one.
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Subject</TableHeaderCell>
                <TableHeaderCell>Document</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {grants.map((g) => (
                <TableRow>
                  <TableCell>
                    <Badge
                      tone={
                        g.subjectKind === 'role'
                          ? 'accent'
                          : g.subjectKind === 'team'
                            ? 'success'
                            : g.subjectKind === 'link'
                              ? 'warning'
                              : 'info'
                      }
                    >
                      {g.subjectKind}
                    </Badge>{' '}
                    <span class="text-sm">
                      {g.subjectKind === 'principal'
                        ? (nameById.get(g.subjectId) ?? g.subjectId)
                        : g.subjectKind === 'team'
                          ? (teamNameById.get(g.subjectId) ?? g.subjectId)
                          : g.subjectKind === 'link'
                            ? `link …${g.subjectId.slice(0, 8)}`
                            : g.subjectId}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span class="font-mono text-xs">{g.documentId}</span>
                  </TableCell>
                  <TableCell>
                    <span class="font-mono text-xs">{g.actions.join(', ')}</span>
                  </TableCell>
                  <TableCell>
                    {g.expiresAt ? (
                      <span class="font-mono text-xs text-ink-subtle">
                        {g.expiresAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    ) : (
                      <span class="text-ink-subtle">never</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {/* Token scopes */}
      <section>
        <h2 class="mb-3 font-serif text-display-sm">Token scopes</h2>
        {tokens.length === 0 ? (
          <p class="text-sm text-ink-subtle">No tokens issued.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Token</TableHeaderCell>
                <TableHeaderCell>Principal</TableHeaderCell>
                <TableHeaderCell>Scope</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tokens.map((t) => (
                <TableRow>
                  <TableCell>{t.name}</TableCell>
                  <TableCell>
                    <span class="text-sm">{nameById.get(t.principalId) ?? t.principalId}</span>
                  </TableCell>
                  <TableCell>
                    {t.scope ? (
                      <span class="font-mono text-xs text-ink-muted">
                        {t.scope.map((s) => `${s.action}@${s.collection}`).join(', ')}
                      </span>
                    ) : (
                      <span class="text-ink-subtle">full (no narrowing)</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </AdminShell>,
  );
});
