import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { listCollections } from '@/services/collections';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Button,
  Badge,
  EmptyState,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  Boxes,
  Plus,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /admin/collections — the schema builder index. Lists every content-type
 * definition; each definition drives all six surfaces (SCHEMA_ENGINE.md).
 */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const defs = await listCollections(getDb(c.env.DB));

  return c.render(
    <AdminShell user={user} current="collections">
      <PageHeader
        title="Collections"
        description="Define content types. One definition generates storage, validation, the admin, the REST API, and the MCP tools."
        actions={
          <Button href="/admin/collections/new">
            <Plus class="size-4" />
            New collection
          </Button>
        }
      />

      <div>
        {defs.length === 0 ? (
          <EmptyState
            icon={<Boxes class="size-6" />}
            title="No collections yet"
            description="Create your first content type to generate its admin, API, and MCP tools."
            action={<Button href="/admin/collections/new">New collection</Button>}
          />
        ) : (
          <Table caption="Collections">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Slug</TableHeaderCell>
                <TableHeaderCell>Shape</TableHeaderCell>
                <TableHeaderCell class="text-right">Fields</TableHeaderCell>
                <TableHeaderCell>Protected</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {defs.map((d) => (
                <TableRow>
                  <TableCell>
                    <a
                      href={`/admin/collections/${d.slug}`}
                      class="font-medium text-accent-text hover:underline"
                    >
                      {d.name}
                    </a>
                  </TableCell>
                  <TableCell>
                    <span class="font-mono text-xs text-ink-subtle">{d.slug}</span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={d.shape === 'singleton' ? 'info' : 'neutral'}>{d.shape}</Badge>
                  </TableCell>
                  <TableCell class="text-right">{d.fields.length}</TableCell>
                  <TableCell>
                    {d.protected ? (
                      <Badge tone="warning">Protected</Badge>
                    ) : (
                      <span class="text-ink-subtle">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </AdminShell>,
  );
});
