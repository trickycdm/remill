import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { ACTIONS, type Action } from '@/access';
import type { PermissionSpec } from '@/access/policy';
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
  ScopePicker,
  ACCESS_ACTION_GROUPS,
  type ScopePreset,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * Role permission presets. Unlike a token scope, role permissions are ADDITIVE —
 * the role can do exactly the checked actions — so "Full" lists every action (an
 * empty selection means the role can do nothing). `custom` just opens the grid.
 */
const ROLE_PRESETS: readonly ScopePreset[] = [
  { key: 'reader', label: 'Reader', actions: ['read'] },
  { key: 'editor', label: 'Editor', actions: ['read', 'create', 'update', 'delete', 'publish'] },
  { key: 'full', label: 'Full', actions: [...ACTIONS] },
  { key: 'custom', label: 'Custom', actions: null },
];

/** Actions a role holds on '*' (this UI edits install-wide role permissions; it does
 *  not surface per-collection or conditional grants, which the model still supports —
 *  editing a role created with those via API/MCP would flatten them, so we only offer
 *  edit/delete on roles authored here). */
function starActions(perms: { collection: string; action: string }[]): Set<string> {
  return new Set(perms.filter((p) => p.collection === '*').map((p) => p.action));
}

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** Checked actions → install-wide permission specs. */
function toPermissions(actions: string[]): PermissionSpec[] {
  return actions.map((a) => ({ collection: '*', action: a as Action }));
}

// ---------------------------------------------------------------------------
// GET /admin/access/roles — list roles; create + edit/delete custom ones
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const roles = await access.listRoles(getDb(c.env.DB));

  return c.render(
    <AdminShell user={user} current="access">
      <Breadcrumb items={[{ label: 'Access', href: '/admin/access' }, { label: 'Roles' }]} />
      <PageHeader
        title="Roles"
        description="Roles are data — compose least-privilege custom roles from the closed action vocabulary. System roles are read-only."
      />

      {/* Create */}
      <Card class="mb-8">
        <CardContent class="pt-6">
          <h2 class="mb-3 font-display text-display-sm">New role</h2>
          <form method="post" action="/admin/access/roles" class="flex flex-col gap-4">
            <input type="hidden" name="op" value="create" />
            <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <FormField fieldId="role-slug" label="Slug">
                <Input id="role-slug" name="slug" type="text" placeholder="moderator" required />
              </FormField>
              <FormField fieldId="role-name" label="Name">
                <Input id="role-name" name="name" type="text" placeholder="Moderator" required />
              </FormField>
            </div>
            <FormField fieldId="role-desc" label="Description">
              <Input
                id="role-desc"
                name="description"
                type="text"
                placeholder="What this role can do"
              />
            </FormField>
            <ScopePicker
              idPrefix="new-role"
              name="action"
              groups={ACCESS_ACTION_GROUPS}
              checked={new Set()}
              presets={ROLE_PRESETS}
              defaultPreset="custom"
              advancedOpen
              help="Additive: the role can do exactly the checked actions, on all collections."
            />
            <div>
              <Button type="submit">Create role</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <div class="flex flex-col gap-4">
        {roles.map((r) => (
          <Card>
            <CardContent class="pt-5">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span class="font-medium text-ink">{r.name}</span>
                <span class="font-mono text-xs text-ink-subtle">{r.slug}</span>
                {r.system && <Badge tone="neutral">system</Badge>}
              </div>
              {r.description && <p class="mb-3 text-sm text-ink-subtle">{r.description}</p>}
              <ul class="mb-3 flex flex-wrap gap-1.5">
                {r.permissions.length === 0 ? (
                  <li class="text-sm text-ink-subtle">No permissions</li>
                ) : (
                  r.permissions.map((p) => (
                    <li>
                      <Badge tone="accent">
                        {p.action}
                        {p.collection !== '*' ? `@${p.collection}` : ''}
                        {p.condition ? `:${p.condition}` : ''}
                      </Badge>
                    </li>
                  ))
                )}
              </ul>

              {/* Custom roles are editable + deletable; system roles are not. */}
              {!r.system && (
                <div class="flex flex-col gap-4 border-t border-border pt-3 sm:flex-row sm:items-start">
                  <form
                    method="post"
                    action="/admin/access/roles"
                    class="flex flex-1 flex-col gap-4"
                  >
                    <input type="hidden" name="op" value="update" />
                    <input type="hidden" name="slug" value={r.slug} />
                    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                      <FormField fieldId={`name-${r.slug}`} label="Name">
                        <Input
                          id={`name-${r.slug}`}
                          name="name"
                          type="text"
                          value={r.name}
                          required
                        />
                      </FormField>
                      <FormField fieldId={`desc-${r.slug}`} label="Description">
                        <Input
                          id={`desc-${r.slug}`}
                          name="description"
                          type="text"
                          value={r.description ?? ''}
                        />
                      </FormField>
                    </div>
                    <ScopePicker
                      idPrefix={`role-${r.slug}`}
                      name="action"
                      groups={ACCESS_ACTION_GROUPS}
                      checked={starActions(r.permissions)}
                      presets={ROLE_PRESETS}
                      defaultPreset="custom"
                      advancedOpen
                    />
                    <div>
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </div>
                  </form>
                  <form method="post" action="/admin/access/roles">
                    <input type="hidden" name="op" value="delete" />
                    <input type="hidden" name="slug" value={r.slug} />
                    <Button type="submit" variant="danger">
                      Delete
                    </Button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AdminShell>,
  );
});

// ---------------------------------------------------------------------------
// POST /admin/access/roles — create / update / delete a custom role
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const op = String(body.op ?? '');
  const slug = String(body.slug ?? '');

  if (op === 'delete') {
    await access.deleteRole(db, principal, slug, now);
    return c.redirect('/admin/access/roles', 303);
  }

  const name = String(body.name ?? '');
  const description = String(body.description ?? '');
  const permissions = toPermissions(asArray(body.action as string | string[] | undefined));

  if (op === 'update') {
    await access.updateRole(db, principal, slug, name, description || undefined, permissions, now);
  } else {
    await access.createRole(
      db,
      principal,
      { slug: String(body.slug ?? ''), name, description, permissions },
      now,
    );
  }
  return c.redirect('/admin/access/roles', 303);
});
