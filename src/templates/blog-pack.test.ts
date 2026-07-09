import { describe, it, expect } from 'vitest';
import { blogCollectionScaffold } from '@/templates/blog-pack';
import { validateDefinition } from '@/services/collections';
import { resolveTemplate } from '@/templates/registry';
import { resolveConventionLayout } from '@/templates/lib/conventions';

describe('blog pack scaffold', () => {
  it('is a valid collection definition that selects the article template', () => {
    const def = validateDefinition(blogCollectionScaffold);
    expect(def.template).toBe('article');
    expect(resolveTemplate(def.template)).toBeDefined();
  });

  it('binds cleanly to the article convention (only tags left as meta)', () => {
    const layout = resolveConventionLayout(blogCollectionScaffold);
    expect(layout.titleField?.key).toBe('title');
    expect(layout.hero?.key).toBe('hero');
    expect(layout.lead?.key).toBe('excerpt');
    expect(layout.body.map((f) => f.key)).toEqual(['body']);
    expect(layout.meta.map((f) => f.key)).toEqual(['tags']);
  });
});
