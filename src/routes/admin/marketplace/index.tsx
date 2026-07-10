/**
 * /admin/marketplace — the content-pack marketplace (D42). Lists the pack
 * registry (src/templates/packs.ts) with installed status; installing creates
 * the pack's collection(s) through the same `installPack` service the MCP
 * `install_pack` tool and `POST /api/packs/:key/install` use (authorization
 * lives in the service — manage_schema). Install button follows the Datastar
 * form-@post idiom (busy indicator; success → dsRedirect to the collection
 * editor; error → renderSaveError morphed into the per-pack result slot).
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { installPack, listPackStatuses } from '@/services/collections';
import { nowIso } from '@/lib/now';
import { dsRedirect } from '@/lib/datastar-response';
import { renderSaveError } from '@/lib/save-error';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Button,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const packs = await listPackStatuses(getDb(c.env.DB));

  return c.render(
    <AdminShell user={user} current="marketplace">
      <PageHeader
        title="Marketplace"
        description="Content packs: a reading template plus the collection shape designed for it. Install one and start filling it — no field design needed."
      />
      <div class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {packs.map((p) => {
          const busy = `busy_${p.key}`;
          return (
            <Card class="flex flex-col">
              <CardHeader>
                <div class="flex items-center justify-between gap-3">
                  <CardTitle>{p.name}</CardTitle>
                  {p.installed ? <Badge tone="success">Installed</Badge> : null}
                </div>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent class="flex flex-col gap-2 text-sm text-ink-muted">
                <p>
                  Template: <span class="font-mono text-ink">{p.template}</span>
                </p>
                <p>
                  Creates:{' '}
                  {p.collections.map((col, i) => (
                    <>
                      {i > 0 ? ', ' : ''}
                      <span class="font-mono text-ink">{col.slug}</span>
                    </>
                  ))}
                </p>
              </CardContent>
              <CardFooter class="mt-auto flex flex-col items-stretch gap-3">
                {p.installed ? (
                  <Button href={`/admin/collections/${p.collections[0].slug}`} variant="secondary">
                    View collection
                  </Button>
                ) : (
                  <form
                    {...{ [`data-indicator:${busy}`]: '' }}
                    data-on:submit={`!$${busy} && @post('/admin/marketplace', {contentType: 'form'})`}
                    class="flex flex-col gap-3"
                  >
                    <input type="hidden" name="pack" value={p.key} />
                    <Button type="submit" busy={`$${busy}`}>
                      Install {p.name}
                    </Button>
                  </form>
                )}
                <div id={`install-result-${p.key}`} />
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </AdminShell>,
  );
});

export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const pack = typeof body.pack === 'string' ? body.pack : '';
  try {
    const created = await installPack(getDb(c.env.DB), requirePrincipal(c), pack, nowIso());
    return dsRedirect(c, `/admin/collections/${created[0].slug}`);
  } catch (err) {
    return renderSaveError(c, err, `install-result-${pack}`);
  }
});
