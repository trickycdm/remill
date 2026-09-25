import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { nowIso } from '@/lib/now';
import { relativeTime } from '@/lib/relative-time';
import * as access from '@/services/access';
import { oauthProvenance } from '@/services/oauth';
import { listCollections } from '@/services/collections';
import { personaOf, PERSONA_LABEL, PERSONA_TONE } from '@/lib/persona';
import type { PrincipalRecord, TokenRecord } from '@/db/queries/principals';
import type { RoleRecord } from '@/db/queries/roles';
import { AdminShell } from '@/components/layouts/admin-shell';
import { healthOf, HealthLabel, scopeSummary } from '@/components/admin/principal-display';
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
  Dialog,
  FormField,
  ScopePicker,
  ACCESS_ACTION_GROUPS,
  TOKEN_SCOPE_PRESETS,
  tokenPresetFor,
} from '@/components/ui';

/**
 * /admin/access/principals/:id — everything about ONE principal on one page,
 * laid out as plain sections (no disclosure triangles): details (rename for
 * machines), roles, tokens, and an isolated danger zone. The directory at
 * /admin/access stays a scannable list that links here.
 *
 * Action hierarchy (DESIGN_SYSTEM.md): one primary (New token), everything
 * else secondary/ghost, destructive actions isolated in the danger zone and
 * confirmed through `Dialog`, never native confirm(). Disable is reversible,
 * so it acts immediately.
 */

const factory = createFactory<{ Bindings: Env }>();

const AGENT_FORM = `@post('/admin/access/agents', {contentType: 'form'})`;
const openDialog = (id: string) => `document.getElementById('${id}').showModal()`;
const closeDialog = (id: string) => `document.getElementById('${id}').close()`;
/** DOM-id-safe suffix from a record id. */
const sig = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '');

function Section({ title, description, children }: { title: string; description?: unknown; children: unknown }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Name + identity. Machines rename here; people rename themselves on /admin/account. */
function DetailsSection({ p, persona }: { p: PrincipalRecord; persona: string }) {
  const machine = p.kind === 'agent';
  return (
    <Section title="Details">
      <div class="flex flex-col gap-5">
        {machine ? (
          <form data-on:submit={AGENT_FORM} class="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="hidden" name="op" value="rename" />
            <input type="hidden" name="principalId" value={p.id} />
            <FormField fieldId="principal-name" label="Name" class="sm:w-80">
              <Input id="principal-name" name="name" type="text" value={p.name} maxlength={100} required />
            </FormField>
            <Button type="submit" variant="secondary">
              Save name
            </Button>
          </form>
        ) : (
          <p class="text-sm text-ink-muted">People change their own name from their account page.</p>
        )}
        <dl class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt class="text-ink-subtle">Type</dt>
          <dd class="text-ink">{persona}</dd>
          {p.email && (
            <>
              <dt class="text-ink-subtle">Email</dt>
              <dd class="text-ink">{p.email}</dd>
            </>
          )}
          <dt class="text-ink-subtle">ID</dt>
          <dd class="font-mono text-xs text-ink-muted">{p.id}</dd>
        </dl>
      </div>
    </Section>
  );
}

function RolesSection({
  p,
  roles,
  collectionSlugs,
}: {
  p: PrincipalRecord;
  roles: RoleRecord[];
  collectionSlugs: string[];
}) {
  const nameOf = new Map(roles.map((r) => [r.slug, r.name]));
  return (
    <Section title="Roles" description="What this principal is allowed to do. Access starts at nothing; each role adds to it.">
      {p.roles.length === 0 ? (
        <p class="text-sm text-ink-muted">No roles yet, so it can't do anything.</p>
      ) : (
        <ul class="divide-y divide-border rounded-md border border-border">
          {p.roles.map((r) => (
            <li class="flex items-center gap-3 px-4 py-2.5">
              <span class="font-medium text-ink">{nameOf.get(r.role) ?? r.role}</span>
              <span class="text-sm text-ink-muted">
                {r.collection === '*' ? 'all collections' : `${r.collection} only`}
              </span>
              <form method="post" action="/admin/access/assign" class="ml-auto">
                <input type="hidden" name="op" value="unassign" />
                <input type="hidden" name="principalId" value={p.id} />
                <input type="hidden" name="role" value={r.role} />
                <input type="hidden" name="collection" value={r.collection} />
                <Button type="submit" variant="ghost" size="sm" aria-label={`Remove role ${r.role}`}>
                  Remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form method="post" action="/admin/access/assign" class="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="op" value="assign" />
        <input type="hidden" name="principalId" value={p.id} />
        {/* Defaults to the least-privileged role: a stray click must never grant admin. */}
        <FormField fieldId="add-role" label="Add a role">
          <Select id="add-role" name="role">
            {roles
              .filter((r) => r.slug !== 'anonymous')
              .map((r) => (
                <option value={r.slug} selected={r.slug === 'reader'}>
                  {r.name}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField fieldId="add-role-collection" label="On">
          <Select id="add-role-collection" name="collection">
            <option value="*">All collections</option>
            {collectionSlugs.map((s) => (
              <option value={s}>{s}</option>
            ))}
          </Select>
        </FormField>
        <Button type="submit" variant="secondary">
          Add role
        </Button>
      </form>
    </Section>
  );
}

/** Revoke confirmation for one token (irreversible → Dialog). */
function RevokeDialog({ t, principalId }: { t: TokenRecord; principalId: string }) {
  const id = `revoke-${sig(t.id)}`;
  return (
    <Dialog
      id={id}
      size="sm"
      title={`Revoke ${t.name}?`}
      description="Any client using this token stops working immediately. This can't be undone; create a new token to reconnect."
      footer={
        <>
          <Button variant="ghost" data-on:click={closeDialog(id)}>
            Cancel
          </Button>
          <form method="post" action="/admin/access/tokens" class="contents">
            <input type="hidden" name="op" value="revoke" />
            <input type="hidden" name="tokenId" value={t.id} />
            <input type="hidden" name="principalId" value={principalId} />
            <Button type="submit" variant="danger">
              Revoke token
            </Button>
          </form>
        </>
      }
    >
      <span class="sr-only">Confirm revoking the token {t.name}.</span>
    </Dialog>
  );
}

/** Edit what one token may do, in a dialog (the picker is too big to inline per row). */
function EditAccessDialog({
  t,
  principalId,
  collectionSlugs,
}: {
  t: TokenRecord;
  principalId: string;
  collectionSlugs: string[];
}) {
  const id = `access-${sig(t.id)}`;
  const formId = `${id}-form`;
  const actions = (t.scope ?? []).map((s) => s.action);
  return (
    <Dialog
      id={id}
      size="lg"
      title={`Edit access for ${t.name}`}
      description="Full access means the token can do whatever this principal's roles allow. Narrowing only ever takes permissions away. The client keeps using the same token."
      footer={
        <>
          <Button variant="ghost" data-on:click={closeDialog(id)}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            Save access
          </Button>
        </>
      }
    >
      <form id={formId} method="post" action="/admin/access/tokens" class="flex flex-col gap-3">
        <input type="hidden" name="op" value="scope" />
        <input type="hidden" name="tokenId" value={t.id} />
        <input type="hidden" name="principalId" value={principalId} />
        <ScopePicker
          idPrefix={`tok-${sig(t.id)}`}
          name="scopeAction"
          groups={ACCESS_ACTION_GROUPS}
          checked={new Set(actions)}
          presets={TOKEN_SCOPE_PRESETS}
          defaultPreset={tokenPresetFor(actions)}
          collection={{ name: 'scopeCollection', options: collectionSlugs, selected: t.scope?.[0]?.collection }}
        />
      </form>
    </Dialog>
  );
}

function TokensSection({
  p,
  tokens,
  collectionSlugs,
  now,
}: {
  p: PrincipalRecord;
  tokens: TokenRecord[];
  collectionSlugs: string[];
  now: string;
}) {
  return (
    <Section
      title="Tokens"
      description="The credentials this agent connects with. Each client should have its own, so you can revoke one without disconnecting the rest."
    >
      {tokens.length === 0 ? (
        <p class="text-sm text-ink-muted">
          No tokens yet.{' '}
          <a href={`/admin/access/connect?for=${p.id}`} class="font-medium text-accent-text hover:underline">
            Create one to connect it
          </a>
          .
        </p>
      ) : (
        <>
          <Table caption={`Tokens for ${p.name}`}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Access</TableHeaderCell>
                <TableHeaderCell>Last used</TableHeaderCell>
                <TableHeaderCell>
                  <span class="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tokens.map((t) => (
                <TableRow>
                  <TableCell class="font-medium">{t.name}</TableCell>
                  <TableCell>
                    <span class="text-ink">{scopeSummary(t.scope)}</span>
                    {t.oauth && <span class="block text-xs text-ink-subtle">Set when the client signed in (OAuth)</span>}
                  </TableCell>
                  <TableCell class="whitespace-nowrap text-ink-muted">
                    {t.lastUsedAt ? relativeTime(t.lastUsedAt, now) : 'Never'}
                  </TableCell>
                  <TableCell class="text-right whitespace-nowrap">
                    {!t.oauth && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit access for ${t.name}`}
                        data-on:click={openDialog(`access-${sig(t.id)}`)}
                      >
                        Edit access
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke ${t.name}`}
                      data-on:click={openDialog(`revoke-${sig(t.id)}`)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {tokens.map((t) => (
            <>
              <RevokeDialog t={t} principalId={p.id} />
              {!t.oauth && <EditAccessDialog t={t} principalId={p.id} collectionSlugs={collectionSlugs} />}
            </>
          ))}
        </>
      )}
    </Section>
  );
}

/** Disable (reversible, immediate) and delete (permanent, Dialog-confirmed). */
function DangerZone({ p, authored }: { p: PrincipalRecord; authored: number }) {
  const deleteId = 'confirm-delete-principal';
  return (
    <section aria-labelledby="danger-zone" class="rounded-lg border border-danger/40 bg-surface">
      <h2 id="danger-zone" class="px-5 pt-5 font-display text-lg font-semibold text-danger">
        Danger zone
      </h2>
      <div class="divide-y divide-border">
        <div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="font-medium text-ink">{p.disabled ? 'Enable' : 'Disable'} this agent</p>
            <p class="text-sm text-ink-muted">
              {p.disabled
                ? 'Its tokens work again straight away.'
                : 'Its tokens stop working straight away. Nothing is deleted, and you can enable it again any time.'}
            </p>
          </div>
          <form data-on:submit={AGENT_FORM}>
            <input type="hidden" name="op" value={p.disabled ? 'enable' : 'disable'} />
            <input type="hidden" name="principalId" value={p.id} />
            <Button type="submit" variant="secondary">
              {p.disabled ? 'Enable' : 'Disable'}
            </Button>
          </form>
        </div>
        <div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="font-medium text-ink">Delete this agent</p>
            <p class="text-sm text-ink-muted">
              {authored > 0
                ? `It wrote ${authored} item${authored === 1 ? '' : 's'}, so it can't be deleted without losing the record of who wrote them. Disable it instead.`
                : "Removes it with its tokens, roles and shares. The audit log keeps its history. This can't be undone."}
            </p>
          </div>
          <Button variant="danger" disabled={authored > 0} data-on:click={openDialog(deleteId)}>
            Delete
          </Button>
        </div>
      </div>
      {authored === 0 && (
        <Dialog
          id={deleteId}
          size="sm"
          title={`Delete ${p.name}?`}
          description="Its tokens, roles and shares are removed permanently. Any client using it is disconnected."
          footer={
            <>
              <Button variant="ghost" data-on:click={closeDialog(deleteId)}>
                Cancel
              </Button>
              <form data-on:submit={AGENT_FORM} class="contents">
                <input type="hidden" name="op" value="delete" />
                <input type="hidden" name="principalId" value={p.id} />
                <Button type="submit" variant="danger">
                  Delete agent
                </Button>
              </form>
            </>
          }
        >
          <span class="sr-only">Confirm deleting {p.name}.</span>
        </Dialog>
      )}
    </section>
  );
}

/** GET /admin/access/principals/:id */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const id = pathParam(c, 'id');

  const [{ principal: p, tokens, authored }, oauthByPrincipal, collections, roles] = await Promise.all([
    access.getPrincipalDetail(db, principal, id, now),
    oauthProvenance(db, principal, now),
    listCollections(db),
    access.listRoles(db),
  ]);
  const collectionSlugs = collections.map((col) => col.slug);
  const persona = personaOf(p.kind, p.subtype);
  const machine = p.kind === 'agent';
  const oauthClient = oauthByPrincipal.get(p.id);

  return c.render(
    <AdminShell user={user} current="access">
      <PageHeader
        breadcrumb={[{ label: 'Access', href: '/admin/access' }, { label: p.name }]}
        title={p.name}
        description={
          <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={PERSONA_TONE[persona]}>{PERSONA_LABEL[persona]}</Badge>
            {oauthClient && <Badge tone="neutral">via OAuth</Badge>}
            {machine && <HealthLabel health={healthOf(p, tokens, now)} class="text-sm text-ink-muted" />}
          </span>
        }
        actions={
          machine ? (
            <Button href={`/admin/access/connect?for=${p.id}`} variant="primary">
              New token
            </Button>
          ) : undefined
        }
      />
      <div class="flex max-w-4xl flex-col gap-6">
        <DetailsSection p={p} persona={PERSONA_LABEL[persona]} />
        <RolesSection p={p} roles={roles} collectionSlugs={collectionSlugs} />
        {machine && <TokensSection p={p} tokens={tokens} collectionSlugs={collectionSlugs} now={now} />}
        {machine && <DangerZone p={p} authored={authored} />}
      </div>
    </AdminShell>,
  );
});
