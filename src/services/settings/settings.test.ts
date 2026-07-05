import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { documents } from '@/db/schema';
import { getSettings } from '@/services/settings';

const NOW = '2026-07-04T12:00:00Z';

describe('settings service — getSettings (un-gated singleton read)', () => {
  let db: Database;

  // seed:true provides the `settings` collection so the documents FK is satisfiable.
  beforeEach(() => {
    db = getDb(createTestD1({ seed: true }));
  });

  it('returns an all-undefined shape when the singleton is unsaved', async () => {
    const s = await getSettings(db);
    expect(s.siteName).toBeUndefined();
    expect(s.defaultPageSize).toBeUndefined();
    expect(s.timezone).toBeUndefined();
  });

  it('projects the saved singleton data with types, and blanks → undefined', async () => {
    await db.insert(documents).values({
      id: 'doc_settings1',
      collection: 'settings',
      dataJson: JSON.stringify({
        siteName: 'My Site',
        timezone: 'America/New_York',
        dateFormat: 'long',
        defaultPageSize: 10,
        siteDescription: '   ', // whitespace-only → undefined
      }),
      status: 'published',
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      publishedAt: NOW,
    });

    const s = await getSettings(db);
    expect(s.siteName).toBe('My Site');
    expect(s.timezone).toBe('America/New_York');
    expect(s.dateFormat).toBe('long');
    expect(s.defaultPageSize).toBe(10);
    expect(s.siteDescription).toBeUndefined();
  });
});
