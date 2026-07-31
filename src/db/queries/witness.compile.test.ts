import { describe, it, expect } from 'vitest';
import { getDocument, countDocumentsByCollection } from '@/db/queries/documents';
import { Grant } from '@/access/grant';
import type { Database } from '@/db/client';

/**
 * Compile-time guarantee (steering/ACCESS_CONTROL.md, D17): document queries
 * cannot be called without a Grant witness, and a Grant cannot be fabricated
 * outside the access module. These calls never execute — tsc must flag each line.
 * If the witness requirement is ever weakened, an `@ts-expect-error` goes unused
 * and `bun run type-check` fails. That's the enforcement.
 */
async function _witnessGuarantees(db: Database) {
  // @ts-expect-error — missing the Grant argument entirely
  await getDocument(db, 'posts', 'doc_1');

  // @ts-expect-error — a plain object is not a Grant
  await getDocument(db, 'posts', 'doc_1', {});

  // @ts-expect-error — Grant's constructor is private; services cannot mint one
  await getDocument(db, 'posts', 'doc_1', new Grant('p', 'read', { collection: 'posts' }));

  // @ts-expect-error — the grouped count read requires the Grant[] witness too
  await countDocumentsByCollection(db, [{ collection: 'posts' }]);
}

describe('Grant witness — compile-time enforcement', () => {
  it('document queries reject un-witnessed calls (verified by tsc)', () => {
    expect(typeof _witnessGuarantees).toBe('function');
  });
});
