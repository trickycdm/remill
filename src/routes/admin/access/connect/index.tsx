import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import * as access from '@/services/access';
import { listCollections } from '@/services/collections';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { rateLimit, TOKEN_RATE_LIMIT } from '@/middleware/rate-limit';
import { InputValidationError } from '@/lib/errors';
import { jsonForScript } from '@/lib/json-for-script';
import { CLIENT_TO_SNIPPET } from '@/lib/connect-snippets';
import type { Action } from '@/access';
import { AdminShell } from '@/components/layouts/admin-shell';
import { ConnectCards, SecretReveal } from '@/components/connect-cards';
import {
  PageHeader,
  Button,
  Input,
  Select,
  FormField,
  Stamp,
  ScopePicker,
  ACCESS_ACTION_GROUPS,
  TOKEN_SCOPE_PRESETS,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * /admin/access/connect — the one-step agent wizard (D48): name it, choose a
 * role, get the token AND a paste-ready per-client config in the same breath.
 * Collapses the old create-principal → assign-role → mint-token trek into one
 * atomic `connectAgent` call. `?for=<principalId>` is RECONNECT mode: mint a
 * fresh token for an existing machine principal (this is the index's "New
 * token →" path — one canonical mint surface, always ending at connect cards).
 */

/** Token scope is a NARROWING mask; in the wizard the ROLE carries the
 *  permission choice, so the token defaults to full (= inherit the role) and
 *  narrowing is the advanced move. */
const CLIENT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code (Copilot)' },
  { value: 'gemini-cli', label: 'Gemini CLI' },
  { value: 'other-mcp', label: 'Other MCP client' },
  { value: 'rest', label: 'Script / REST API' },
];

interface RoleOption {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

/** Roles offered by the wizard: everything but anonymous; admin last with a
 *  caution (the wizard IS the sanctioned path for full-admin agents). */
function wizardRoles(roles: { slug: string; name: string; description?: string | null }[]): RoleOption[] {
  const usable = roles
    .filter((r) => r.slug !== 'anonymous')
    .map((r) => ({ slug: r.slug, name: r.name, description: r.description ?? null }));
  return [...usable.filter((r) => r.slug !== 'admin'), ...usable.filter((r) => r.slug === 'admin')];
}

function RoleRadios({ roles }: { roles: RoleOption[] }) {
  return (
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-2 text-sm font-medium text-ink">What may it do?</legend>
      {roles.map((role) => (
        <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 hover:bg-hover">
          <input
            type="radio"
            name="role"
            value={role.slug}
            checked={role.slug === 'editor'}
            class="mt-1 accent-current"
          />
          <span class="flex flex-col">
            <span class="text-sm font-medium text-ink">{role.name}</span>
            <span class="text-xs text-ink-muted">
              {role.slug === 'admin'
                ? 'Everything, including access management. Prefer a narrower role for external clients.'
                : (role.description ?? '')}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function ConnectForm({
  roles,
  collectionSlugs,
  reconnect,
}: {
  roles: RoleOption[];
  collectionSlugs: string[];
  reconnect?: { principalId: string; name: string };
}) {
  return (
    <div id="connect-flow">
      <form
        data-signals={jsonForScript({ cbusy: false, nameDirty: false })}
        data-indicator:cbusy=""
        data-on:submit="!$cbusy && @post('/admin/access/connect', {contentType: 'form'})"
        class="flex max-w-2xl flex-col gap-6"
      >
        {reconnect ? (
          <>
            <input type="hidden" name="principalId" value={reconnect.principalId} />
            <p class="text-sm text-ink-muted">
              New token for <span class="font-medium text-ink">{reconnect.name}</span> — its role
              and existing tokens are untouched.
            </p>
          </>
        ) : (
          <>
            <FormField fieldId="connect-client" label="What are you connecting?">
              <Select
                id="connect-client"
                name="client"
                data-on:change="if (!$nameDirty) document.getElementById('connect-name').value = el.value"
              >
                {CLIENT_OPTIONS.map((o) => (
                  <option value={o.value}>{o.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField
              fieldId="connect-name"
              label="Agent name"
              description="How it appears in Access and the audit trail."
            >
              <Input
                id="connect-name"
                name="name"
                type="text"
                value="claude-code"
                required
                data-on:input="$nameDirty = true"
              />
            </FormField>
            <RoleRadios roles={roles} />
          </>
        )}

        <details>
          <summary class="cursor-pointer text-sm font-medium text-ink-muted hover:text-ink">
            Advanced: limit this token
          </summary>
          <div class="mt-3">
            <ScopePicker
              idPrefix="connect"
              name="scopeAction"
              groups={ACCESS_ACTION_GROUPS}
              presets={TOKEN_SCOPE_PRESETS}
              defaultPreset="full"
              collection={{ name: 'scopeCollection', options: collectionSlugs }}
              help="Full access = the token inherits the role above. Narrow it only if this credential needs less than the role."
            />
          </div>
        </details>

        <div id="connect-error" />
        <div>
          <Button type="submit" variant="primary" busy="$cbusy">
            {reconnect ? 'Mint token' : 'Connect'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Coerce a possibly-repeated form field (Hono `{ all: true }`) into a string[]. */
function asArray(v: unknown): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function parseScope(collection: string, actions: string[]): { collection: string; action: Action }[] | undefined {
  if (actions.length === 0) return undefined;
  const col = collection || '*';
  return actions.map((a) => ({ collection: col, action: a as Action }));
}

// ---------------------------------------------------------------------------
// GET /admin/access/connect (+ ?for=<principalId> reconnect mode)
// ---------------------------------------------------------------------------
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();

  const [roles, collections] = await Promise.all([access.listRoles(db), listCollections(db)]);
  const collectionSlugs = collections.map((col) => col.slug);

  let reconnect: { principalId: string; name: string } | undefined;
  const forId = c.req.query('for');
  if (forId) {
    const target = (await access.listPrincipals(db, principal, now)).find(
      (p) => p.id === forId && p.kind === 'agent',
    );
    if (target) reconnect = { principalId: target.id, name: target.name };
  }

  return c.render(
    <AdminShell user={user} current="access">
      <PageHeader
        breadcrumb={[{ label: 'Access', href: '/admin/access' }, { label: 'Connect an agent' }]}
        title={reconnect ? 'New token' : 'Connect an agent'}
        description={
          reconnect
            ? undefined
            : 'One step: name it, scope it, get a paste-ready config for your client.'
        }
      />
      <ConnectForm roles={wizardRoles(roles)} collectionSlugs={collectionSlugs} reconnect={reconnect} />
    </AdminShell>,
  );
});

// ---------------------------------------------------------------------------
// POST /admin/access/connect — mint, then morph the reveal + cards in place
// ---------------------------------------------------------------------------
export const onRequestPost = factory.createHandlers(
  rateLimit('token', TOKEN_RATE_LIMIT),
  requireAuth(),
  async (c) => {
    const db = getDb(c.env.DB);
    const principal = requirePrincipal(c);
    const now = nowIso();
    const body = await c.req.parseBody({ all: true });
    const scope = parseScope(String(body.scopeCollection ?? '*'), asArray(body.scopeAction));

    let token: string;
    let agentName: string;
    try {
      const reconnectId = typeof body.principalId === 'string' ? body.principalId : '';
      if (reconnectId) {
        const target = (await access.listPrincipals(db, principal, now)).find(
          (p) => p.id === reconnectId && p.kind === 'agent',
        );
        if (!target) {
          throw new InputValidationError([{ path: 'principalId', message: 'Unknown agent.' }]);
        }
        agentName = target.name;
        token = (
          await access.issueToken(
            db,
            principal,
            { principalId: reconnectId, name: `${target.name} token`, scope },
            now,
          )
        ).token;
      } else {
        agentName = String(body.name ?? '');
        const result = await access.connectAgent(
          db,
          principal,
          {
            name: agentName,
            role: String(body.role ?? ''),
            scope,
            // "Script / REST API" is the wizard's Service persona; everything
            // else is an autonomous Agent (display grouping only, never security).
            subtype: body.client === 'rest' ? 'service' : 'agent',
          },
          now,
        );
        token = result.token;
        agentName = agentName.trim();
      }
    } catch (err) {
      if (err instanceof InputValidationError) {
        return c.html(
          <div
            id="connect-error"
            role="alert"
            class="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
          >
            {err.details?.[0]?.message ?? 'Could not connect the agent.'}
          </div>,
          200,
        );
      }
      throw err;
    }

    const baseUrl = resolveBaseUrl(c.env, await getSettings(db), c.req.url);
    const client = typeof body.client === 'string' ? body.client : 'claude-code';
    const initial = CLIENT_TO_SNIPPET[client] ?? 'claude-code';

    // The whole flow morphs: form out, reveal + cards in. The plaintext exists
    // ONLY in this fragment — a refresh renders the empty form again.
    return c.html(
      <div id="connect-flow" class="flex max-w-2xl flex-col gap-6">
        <div class="flex items-center gap-3">
          <Stamp tone="affirm">connected</Stamp>
          <h2 class="font-display text-xl font-semibold text-ink">“{agentName}” is ready</h2>
        </div>
        <SecretReveal
          id="connect-token"
          label="Access token — copy it now"
          note="This is the only time it will be shown; only its hash is stored."
          value={token}
        />
        <ConnectCards baseUrl={baseUrl} token={token} initial={initial} />
        <p class="text-sm">
          <a href="/admin/access" class="text-accent-text hover:underline">
            ← Back to Access
          </a>
          <span class="mx-2 text-ink-subtle">·</span>
          <a href="/admin/access/connect" class="text-accent-text hover:underline">
            Connect another
          </a>
        </p>
      </div>,
      200,
    );
  },
);
