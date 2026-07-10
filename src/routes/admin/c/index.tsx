import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { listCollections } from '@/services/collections';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  EmptyState,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c — the content home: pick a collection to browse/author. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const collections = (await listCollections(getDb(c.env.DB))).filter(
    (col) => col.slug !== 'media',
  );

  return c.render(
    <AdminShell user={user} current="content">
      <PageHeader
        title="Content"
        description="Browse and author documents across your collections."
      />
      {collections.length === 0 ? (
        <EmptyState
          title="No collections yet"
          description="Define a content type first — its list and edit views are generated automatically."
          action={<Button href="/admin/collections">Go to Collections</Button>}
        />
      ) : (
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((col) => (
            <a
              href={`/admin/c/${col.slug}`}
              class="block rounded-lg transition-shadow hover:shadow-md"
            >
              <Card>
                <CardHeader>
                  <CardTitle>{col.name}</CardTitle>
                  <CardDescription>
                    {col.shape === 'singleton' ? 'Singleton' : 'Collection'} · {col.fields.length}{' '}
                    field
                    {col.fields.length === 1 ? '' : 's'}
                  </CardDescription>
                </CardHeader>
              </Card>
            </a>
          ))}
        </div>
      )}
    </AdminShell>,
  );
});
