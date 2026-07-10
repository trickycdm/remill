import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { importCollection, type ImportResult } from '@/services/transfer';
import { BadRequestError } from '@/lib/errors';
import { MAX_IMPORT_BODY_BYTES } from '@/lib/api';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Checkbox,
  FormField,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui';
import type { CollectionDefinition } from '@/fields/types';

const factory = createFactory<{ Bindings: Env }>();

function ImportPage(props: {
  def: CollectionDefinition;
  slug: string;
  result?: ImportResult;
}): ReturnType<typeof ImportForm> {
  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Content', href: '/admin/c' },
          { label: props.def.name, href: `/admin/c/${props.slug}` },
          { label: 'Import' },
        ]}
        title={`Import ${props.def.name}`}
        description="Upload an NDJSON export. Existing ids update; new ids create. Lines with errors are reported — the rest still import."
      />
      {props.result ? <ImportSummary result={props.result} /> : null}
      <ImportForm />
    </>
  );
}

function ImportForm() {
  return (
    <Card class="mt-6 max-w-xl">
      <CardHeader>
        <CardTitle as="h2">Upload export file</CardTitle>
      </CardHeader>
      <CardContent>
        <form method="post" enctype="multipart/form-data" class="flex flex-col gap-4">
          <FormField fieldId="file" label="NDJSON file">
            <input
              id="file"
              name="file"
              type="file"
              accept=".ndjson,.jsonl,application/x-ndjson,text/plain"
              required
              class="block h-10 w-full rounded-md border border-border-strong bg-surface text-sm text-ink shadow-xs file:mr-3 file:h-full file:cursor-pointer file:border-0 file:bg-accent file:px-3 file:text-sm file:font-medium file:text-accent-fg hover:file:bg-accent-hover"
            />
          </FormField>
          <label class="flex items-center gap-2 text-sm text-ink">
            <Checkbox name="dryRun" value="1" />
            Validate only (dry run — nothing is written)
          </label>
          <div>
            <Button type="submit">Import</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <Card class="mt-6">
      <CardHeader>
        <CardTitle as="h2">
          {result.dryRun ? 'Dry run — nothing was written' : 'Import complete'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-ink">
          {result.created} created, {result.updated} updated, {result.failed} failed.
        </p>
        {result.errors.length ? (
          <div class="mt-4">
            <Table aria-label="Import errors">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Line</TableHeaderCell>
                  <TableHeaderCell>Id</TableHeaderCell>
                  <TableHeaderCell>Error</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.errors.map((e) => (
                  <TableRow>
                    <TableCell>
                      <code class="font-mono text-xs">{e.line}</code>
                    </TableCell>
                    <TableCell>
                      <code class="font-mono text-xs">{e.id ?? '—'}</code>
                    </TableCell>
                    <TableCell>{e.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** GET /admin/c/:collection/import — the upload form (D37). */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'collection');
  const def = await getCollectionOrThrow(getDb(c.env.DB), slug);
  return c.render(
    <AdminShell user={getUser(c)} current="content">
      <ImportPage def={def} slug={slug} />
    </AdminShell>,
  );
});

/** POST /admin/c/:collection/import — run the import, render the summary. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const def = await getCollectionOrThrow(db, slug);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new BadRequestError('No file provided.');
  if (file.size > MAX_IMPORT_BODY_BYTES) {
    throw new BadRequestError(
      'File exceeds the 10 MiB import limit — split it into smaller NDJSON files.',
    );
  }
  const result = await importCollection(
    db,
    requirePrincipal(c),
    slug,
    await file.text(),
    nowIso(),
    {
      dryRun: body.dryRun === '1',
    },
  );
  return c.render(
    <AdminShell user={getUser(c)} current="content">
      <ImportPage def={def} slug={slug} result={result} />
    </AdminShell>,
  );
});
