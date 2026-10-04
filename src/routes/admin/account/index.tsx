/**
 * GET /admin/account — the signed-in human's personal account surface. Any
 * authenticated human reaches it (requireAuth); it is NOT admin-only and carries no
 * breadcrumb (a top-level personal page, opened from the top-bar user menu).
 *
 * Independent forms, each posting to its own sub-route and morphing its own
 * inline-error region (DATASTAR_PATTERNS.md §d — 200 fragment by id):
 *   • Profile  → POST /admin/account/profile   (#profile-result)
 *   • Security → POST /admin/account/password  (#security-result)
 *   • Passkeys → rename/remove post to /admin/account/passkeys/:id/* (a result region
 *     inside each dialog);
 *     adding one is driven by the passkey island (D58 — WebAuthn needs
 *     `navigator.credentials`, which Datastar cannot express).
 *
 * The role is shown read-only: roles are assigned by an administrator under Access,
 * never self-service here (ACCESS_CONTROL.md — no self-escalation).
 */

import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { requireAuth, getUser } from '@/lib/auth';
import { listPasskeys, type PasskeySummary } from '@/services/passkeys';
import { formatDate } from '@/lib/format-date';
import { passkeyResultId } from '@/lib/passkey-http';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  FormField,
  Input,
  Button,
  Badge,
  Dialog,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

const openDialog = (id: string) => `document.getElementById('${id}').showModal()`;
const closeDialog = (id: string) => `document.getElementById('${id}').close()`;
/** DOM-id-safe form of a passkey id. */
const sig = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '');

/** One passkey: what it is, when it was used, and its rename/remove dialogs. */
function PasskeyRow({ p }: { p: PasskeySummary }) {
  const renameId = `passkey-rename-${sig(p.id)}`;
  const removeId = `passkey-remove-${sig(p.id)}`;
  const renameFormId = `${renameId}-form`;
  const nameFieldId = `${renameId}-name`;
  return (
    <li class="flex flex-wrap items-center justify-between gap-3 py-3">
      <div class="min-w-0">
        <p class="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span class="truncate">{p.name}</span>
          {p.backedUp ? <Badge tone="neutral">Synced</Badge> : null}
        </p>
        <p class="text-sm text-ink-subtle">
          Added {formatDate(p.createdAt)} ·{' '}
          {p.lastUsedAt ? `last used ${formatDate(p.lastUsedAt)}` : 'never used'}
        </p>
      </div>
      <div class="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Rename ${p.name}`}
          data-on:click={openDialog(renameId)}
        >
          Rename
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${p.name}`}
          data-on:click={openDialog(removeId)}
        >
          Remove
        </Button>
      </div>

      <Dialog
        id={renameId}
        size="sm"
        title="Rename passkey"
        footer={
          <>
            <Button type="button" variant="ghost" data-on:click={closeDialog(renameId)}>
              Cancel
            </Button>
            <Button type="submit" form={renameFormId}>
              Save name
            </Button>
          </>
        }
      >
        <form
          id={renameFormId}
          data-on:submit={`@post('/admin/account/passkeys/${p.id}/rename', {contentType: 'form'})`}
        >
          <FormField fieldId={nameFieldId} label="Name" required>
            <Input id={nameFieldId} name="name" type="text" value={p.name} required maxlength={60} />
          </FormField>
          <div id={passkeyResultId(p.id, 'rename')} class="mt-3" />
        </form>
      </Dialog>

      <Dialog
        id={removeId}
        size="sm"
        title={`Remove ${p.name}?`}
        description="It stops working for sign-in immediately. Your password still works, and you can add the passkey again later."
        footer={
          <>
            <Button type="button" variant="ghost" data-on:click={closeDialog(removeId)}>
              Cancel
            </Button>
            <form
              class="contents"
              data-on:submit={`@post('/admin/account/passkeys/${p.id}/delete', {contentType: 'form'})`}
            >
              <Button type="submit" variant="danger">
                Remove passkey
              </Button>
            </form>
          </>
        }
      >
        <span class="sr-only">Confirm removing the passkey {p.name}.</span>
        <div id={passkeyResultId(p.id, 'remove')} />
      </Dialog>
    </li>
  );
}

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const passkeys = await listPasskeys(getDb(c.env.DB), user.id);
  // `|| email` (not ??) so an empty display name still reads well.
  const name = user.displayName || user.email;

  return c.render(
    <AdminShell user={user} current="account">
      <PageHeader title="Account" description={`Manage your profile, password, and passkeys, ${name}.`} />

      <div class="flex max-w-2xl flex-col gap-6">
        {/* ── Profile ─────────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Profile</CardTitle>
            <CardDescription>Your display name and login email.</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-5">
            <div class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <span class="font-medium text-ink">Role</span>
              <Badge tone="neutral" class="capitalize">
                {user.role}
              </Badge>
              <span class="text-ink-subtle">· assigned by an administrator</span>
            </div>

            <form
              class="flex flex-col gap-5"
              data-on:submit="@post('/admin/account/profile', {contentType: 'form'})"
            >
              <FormField fieldId="displayName" label="Display name" required>
                <Input
                  id="displayName"
                  name="displayName"
                  type="text"
                  value={user.displayName}
                  required
                  autocomplete="name"
                />
              </FormField>
              <FormField fieldId="email" label="Email" required>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={user.email}
                  required
                  autocomplete="email"
                />
              </FormField>
              {/* Morph target for the inline profile error (200, #profile-result). */}
              <div id="profile-result" />
              <div>
                <Button type="submit" variant="primary">
                  Save profile
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* ── Security ────────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Security</CardTitle>
            <CardDescription>
              Change your password. You will stay signed in on this device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              class="flex flex-col gap-5"
              data-on:submit="@post('/admin/account/password', {contentType: 'form'})"
            >
              <FormField fieldId="currentPassword" label="Current password" required>
                <Input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  required
                  autocomplete="current-password"
                />
              </FormField>
              <FormField
                fieldId="newPassword"
                label="New password"
                description="At least 8 characters."
                required
              >
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  required
                  autocomplete="new-password"
                />
              </FormField>
              <FormField fieldId="confirmPassword" label="Confirm new password" required>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  autocomplete="new-password"
                />
              </FormField>
              {/* Morph target for the inline security error (200, #security-result). */}
              <div id="security-result" />
              <div>
                <Button type="submit" variant="primary">
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* ── Passkeys (D58) ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Passkeys</CardTitle>
            <CardDescription>
              Sign in with your fingerprint, face, or device PIN instead of typing your password.
              Your password keeps working.
            </CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-5">
            {passkeys.length > 0 ? (
              <ul class="divide-y divide-border border-y border-border">
                {passkeys.map((p) => (
                  <PasskeyRow p={p} />
                ))}
              </ul>
            ) : (
              <p class="text-sm text-ink-muted">You have no passkeys yet.</p>
            )}
            <p data-passkey-unsupported class="text-sm text-ink-muted">
              This browser can't create passkeys.
            </p>
            {/* Revealed by the passkey island when the browser supports WebAuthn. */}
            <div data-passkey-add class="hidden flex-col gap-5">
              <form class="flex flex-col gap-5">
                <FormField
                  fieldId="passkeyName"
                  label="Passkey name"
                  description="Something you'll recognise later, like the device it lives on."
                  required
                >
                  <Input
                    id="passkeyName"
                    name="name"
                    type="text"
                    required
                    maxlength={60}
                    placeholder="MacBook Touch ID"
                  />
                </FormField>
                <FormField
                  fieldId="passkeyCurrentPassword"
                  label="Confirm with your password"
                  description="Checks it's really you adding a new way to sign in."
                  required
                >
                  <Input
                    id="passkeyCurrentPassword"
                    name="currentPassword"
                    type="password"
                    required
                    autocomplete="current-password"
                  />
                </FormField>
                <div data-passkey-status role="alert" class="text-sm font-medium text-danger empty:hidden" />
                <div>
                  <Button type="submit" variant="secondary">
                    Add a passkey
                  </Button>
                </div>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
      <Script src="/src/client/passkey.ts" />
    </AdminShell>,
  );
});
