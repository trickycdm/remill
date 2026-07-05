/**
 * GET /admin/account — the signed-in human's personal account surface. Any
 * authenticated human reaches it (requireAuth); it is NOT admin-only and carries no
 * breadcrumb (a top-level personal page, opened from the top-bar user menu).
 *
 * Two independent forms, each posting to its own sub-route and morphing its own
 * inline-error region (DATASTAR_PATTERNS.md §d — 200 fragment by id):
 *   • Profile  → POST /admin/account/profile   (#profile-result)
 *   • Security → POST /admin/account/password  (#security-result)
 *
 * The role is shown read-only: roles are assigned by an administrator under Access,
 * never self-service here (ACCESS_CONTROL.md — no self-escalation).
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
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
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestGet = factory.createHandlers(requireAuth(), (c) => {
  const user = getUser(c);
  // `|| email` (not ??) so an empty display name still reads well.
  const name = user.displayName || user.email;

  return c.render(
    <AdminShell user={user} current="account">
      <PageHeader title="Account" description={`Manage your profile and password, ${name}.`} />

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
                <Input id="email" name="email" type="email" value={user.email} required autocomplete="email" />
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
            <CardDescription>Change your password. You will stay signed in on this device.</CardDescription>
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
                <Input id="newPassword" name="newPassword" type="password" required autocomplete="new-password" />
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
      </div>
    </AdminShell>,
  );
});
