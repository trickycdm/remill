import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { listRevisions } from '@/services/documents';
import { getSettings } from '@/services/settings';
import { diffLines, valueToLines, type DiffOp } from '@/lib/diff';
import { fieldLabel } from '@/lib/humanize';
import { formatDate } from '@/lib/format-date';
import { nowIso } from '@/lib/now';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Select,
  EmptyState,
} from '@/components/ui';
import type { CollectionDefinition } from '@/fields/types';

const factory = createFactory<{ Bindings: Env }>();

type Revision = { revision: number; data: Record<string, unknown>; savedAt: string };

/** Field keys to compare: declared order first, then stale keys present in
 *  either revision but no longer on the definition (they still differed). */
function fieldKeys(def: CollectionDefinition, a: Revision, b: Revision): string[] {
  const declared = def.fields.map((f) => f.key);
  const seen = new Set(declared);
  const stale = [...Object.keys(a.data), ...Object.keys(b.data)].filter(
    (k) => !seen.has(k) && seen.add(k),
  );
  return [...declared, ...stale];
}

function DiffBlock({ ops }: { ops: DiffOp[] }) {
  return (
    <pre class="overflow-x-auto rounded-md border border-border bg-surface p-0 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {ops.map((op) =>
        op.kind === 'del' ? (
          <del class="block bg-danger-soft px-3 py-0.5 text-danger no-underline">− {op.line}</del>
        ) : op.kind === 'add' ? (
          <ins class="block bg-success-soft px-3 py-0.5 text-success no-underline">+ {op.line}</ins>
        ) : (
          <span class="block px-3 py-0.5 text-ink-muted">&nbsp; {op.line}</span>
        ),
      )}
    </pre>
  );
}

/**
 * GET /admin/c/:collection/:id/revisions?from=&to= — the revision compare view
 * (Phase 10): per-field LCS line diffs between two revisions. Read-authorized
 * via listRevisions; defaults to the latest two.
 */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const def = await getCollectionOrThrow(db, slug);
  const settings = await getSettings(db);
  // Newest first; carries full data per revision.
  const revisions = (await listRevisions(
    db,
    requirePrincipal(c),
    slug,
    id,
    nowIso(),
  )) as Revision[];

  const editorHref = `/admin/c/${slug}/${id}`;
  const shell = (children: unknown) => (
    <AdminShell user={user} current="content">
      <PageHeader
        breadcrumb={[
          { label: 'Content', href: '/admin/c' },
          { label: def.name, href: `/admin/c/${slug}` },
          { label: 'Edit', href: editorHref },
          { label: 'Compare revisions' },
        ]}
        title="Compare revisions"
        actions={
          <Button href={editorHref} variant="ghost" size="sm">
            Back to editor
          </Button>
        }
      />
      {children}
    </AdminShell>
  );

  if (revisions.length < 2) {
    return c.render(
      shell(
        <EmptyState
          title="Nothing to compare yet"
          description="A document needs at least two revisions before a comparison makes sense."
        />,
      ),
    );
  }

  const byNumber = new Map(revisions.map((r) => [r.revision, r]));
  const parse = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return byNumber.has(n) ? n : fallback;
  };
  // Default: previous → latest.
  const to = parse(c.req.query('to'), revisions[0].revision);
  const from = parse(c.req.query('from'), revisions[1].revision);
  const fromRev = byNumber.get(from)!;
  const toRev = byNumber.get(to)!;

  const rows = fieldKeys(def, fromRev, toRev).map((key) => {
    const a = valueToLines(fromRev.data[key]);
    const b = valueToLines(toRev.data[key]);
    const label = def.fields.some((f) => f.key === key)
      ? fieldLabel(def.fields.find((f) => f.key === key)!)
      : `${key} (removed field)`;
    if (a === b) return { key, label, ops: null, changed: false as const };
    return { key, label, ops: diffLines(a, b), changed: true as const };
  });
  const changed = rows.filter((r) => r.changed);

  const revLabel = (r: Revision) => `#${r.revision} — ${formatDate(r.savedAt, settings)}`;

  return c.render(
    shell(
      <>
        <form method="get" class="mb-6 flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1.5 text-sm font-medium text-ink">
            From
            <Select name="from" size="sm" aria-label="Compare from revision">
              {revisions.map((r) => (
                <option value={String(r.revision)} selected={r.revision === from}>
                  {revLabel(r)}
                </option>
              ))}
            </Select>
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-medium text-ink">
            To
            <Select name="to" size="sm" aria-label="Compare to revision">
              {revisions.map((r) => (
                <option value={String(r.revision)} selected={r.revision === to}>
                  {revLabel(r)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="secondary" size="sm">
            Compare
          </Button>
        </form>

        {changed.length === 0 ? (
          <EmptyState
            title="No differences"
            description={`Revisions #${from} and #${to} have identical content.`}
          />
        ) : (
          <div class="flex flex-col gap-5">
            {changed.map((row) => (
              <Card>
                <CardHeader>
                  <CardTitle as="h2">{row.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  {row.ops ? (
                    <DiffBlock ops={row.ops} />
                  ) : (
                    <p class="text-sm text-ink-muted">
                      This field changed but is too large to diff — restore a revision to inspect
                      it.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </>,
    ),
  );
});
