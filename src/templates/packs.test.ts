import { describe, it, expect } from 'vitest';
import { PACK_KEYS, PACKS, resolvePack, blogCollectionScaffold } from '@/templates/packs';
import { resolveTemplate, listTemplates } from '@/templates/registry';
import { validateDefinition } from '@/services/collections';

describe('the pack registry', () => {
  it('every pack targets a registered template and ships only valid definitions', () => {
    for (const key of PACK_KEYS) {
      const pack = PACKS[key];
      expect(pack.key).toBe(key);
      expect(pack.name.length).toBeGreaterThan(0);
      expect(pack.description.length).toBeGreaterThan(0);
      expect(resolveTemplate(pack.template)).toBeDefined();
      expect(pack.collections.length).toBeGreaterThan(0);
      for (const def of pack.collections) {
        // The whole point of a pack: its scaffold passes the standard pipeline
        // untouched, and each collection actually selects the pack's template.
        expect(() => validateDefinition(def)).not.toThrow();
        expect(def.template).toBe(pack.template);
      }
    }
  });

  it('resolvePack mirrors the closed-set posture (unknown keys resolve to nothing)', () => {
    expect(resolvePack('blog')?.name).toBe('Blog');
    expect(resolvePack('warez')).toBeUndefined();
  });

  it('the blog pack carries the original scaffold (back-compat re-export intact)', () => {
    expect(PACKS.blog.collections[0]).toBe(blogCollectionScaffold);
  });

  it('every registered template carries discovery metadata', () => {
    for (const t of listTemplates()) {
      expect(t.key.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});
