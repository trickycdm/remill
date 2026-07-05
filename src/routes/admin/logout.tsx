import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { clearSession } from '@/lib/auth';
import { dsRedirect } from '@/lib/datastar-response';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /admin/logout — destroy the session and return to login. The admin shell
 * signs out via a native <form method="post">, which navigates to the response —
 * so respond with a normal 302 redirect. If a Datastar `@post` ever calls this,
 * it sends the `Datastar-Request` header and needs a text/javascript navigation
 * instead (302 bodies are ignored by Datastar). Handle both.
 */
export const onRequestPost = factory.createHandlers((c) => {
  clearSession(c);
  if (c.req.header('Datastar-Request') === 'true') {
    return dsRedirect(c, '/admin/login');
  }
  return c.redirect('/admin/login', 303);
});
