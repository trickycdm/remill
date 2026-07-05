import { createFactory } from 'hono/factory';
import type { Env } from '@/types';

const factory = createFactory<{ Bindings: Env }>();

/**
 * `/` — remill is headless-first with no public site in v1 (plan §1), so the root
 * sends visitors to the admin. `requireAuth` on the admin routes bounces
 * unauthenticated users to `/admin/login`.
 */
export const onRequestGet = factory.createHandlers((c) => {
  return c.redirect('/admin');
});
