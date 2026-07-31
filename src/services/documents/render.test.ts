import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import { createDocument, renderDocumentText } from '@/services/documents';
import { InputValidationError, ForbiddenError } from '@/lib/errors';
import type { Principal } from '@/access';

const NOW = '2026-07-20T12:00:00Z';

describe('renderDocumentText (D47) — the one service both doors call', () => {
  let db: Database;
  let admin: Principal;
  let warpId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.installPack(db, admin, 'collab', NOW);
    const task = await createDocument(db, admin, 'tasks', { title: 'T', goal: 'G' }, NOW);
    const warp = await createDocument(
      db,
      admin,
      'warps',
      {
        title: 'Session 1',
        task: task.id,
        state: 'Happy path works.',
        open_questions: '- locale?',
        next_action: 'Wire the button.',
      },
      NOW,
    );
    warpId = warp.id;
  });

  it('renders markdown through the gated read', async () => {
    const md = await renderDocumentText(
      db,
      admin,
      'warps',
      warpId,
      { render: 'implementer' },
      NOW,
    );
    expect(md.startsWith('# Session 1')).toBe(true);
    expect(md).toContain('## Next action');
  });

  it('an unprivileged principal is denied — render rides the read action', async () => {
    const nobody = await makePrincipal(db, NOW, { id: 'prn_nobody' });
    await expect(
      renderDocumentText(db, nobody, 'warps', warpId, { render: 'implementer' }, NOW),
    ).rejects.toThrow(ForbiddenError);
  });

  it('unknown render 422s BEFORE any document read (render names are code metadata)', async () => {
    // A nonexistent document id: the render-name check fires first, so we get
    // the 422 with available names, never a 404 existence probe.
    await expect(
      renderDocumentText(db, admin, 'warps', 'doc_nope', { render: 'bogus' }, NOW),
    ).rejects.toThrow(InputValidationError);
  });

  it('a non-positive or fractional budget is the standard 422', async () => {
    for (const budget of [0, -5, 1.5]) {
      await expect(
        renderDocumentText(db, admin, 'warps', warpId, { render: 'implementer', budget }, NOW),
      ).rejects.toThrow(InputValidationError);
    }
  });

  it('a collection whose template has no renders refuses loudly', async () => {
    await expect(
      renderDocumentText(db, admin, 'tasks', 'doc_any', { render: 'reviewer' }, NOW),
    ).rejects.toThrow(InputValidationError);
  });
});
