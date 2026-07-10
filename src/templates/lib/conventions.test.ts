import { describe, it, expect } from 'vitest';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';

const def = (fields: FieldDescriptor[]): CollectionDefinition => ({
  slug: 'c',
  name: 'C',
  shape: 'collection',
  fields,
});

describe('resolveConventionLayout', () => {
  it('binds title→H1, first media→hero, first non-title text→lead, prose→body; slug omitted', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text', index: true },
        { key: 'slug', type: 'slug', index: true },
        { key: 'cover', type: 'media' },
        { key: 'excerpt', type: 'text' },
        { key: 'body', type: 'markdown' },
        { key: 'tags', type: 'tags', index: true },
      ]),
    );
    expect(layout.titleField?.key).toBe('title');
    expect(layout.hero?.key).toBe('cover');
    expect(layout.lead?.key).toBe('excerpt');
    expect(layout.body.map((f) => f.key)).toEqual(['body']);
    // slug excluded; title/hero/lead/body claimed; only tags remain as meta.
    expect(layout.meta.map((f) => f.key)).toEqual(['tags']);
  });

  it('first media wins as hero; a second media falls through to meta', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text' },
        { key: 'hero', type: 'media' },
        { key: 'gallery', type: 'media' },
      ]),
    );
    expect(layout.hero?.key).toBe('hero');
    expect(layout.meta.map((f) => f.key)).toEqual(['gallery']);
  });

  it('the lead is the first NON-title text field (never the title itself)', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'headline', type: 'text' },
        { key: 'summary', type: 'text' },
      ]),
    );
    expect(layout.titleField?.key).toBe('headline');
    expect(layout.lead?.key).toBe('summary');
  });

  it('slug never appears in any bucket', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text' },
        { key: 'slug', type: 'slug', index: true },
      ]),
    );
    const keys = [
      layout.titleField?.key,
      layout.hero?.key,
      layout.lead?.key,
      ...layout.body.map((f) => f.key),
      ...layout.meta.map((f) => f.key),
    ].filter(Boolean);
    expect(keys).not.toContain('slug');
  });

  it('leftover non-slug fields (json, number) surface in meta — nothing disappears', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text' },
        { key: 'meta', type: 'json' },
        { key: 'views', type: 'number', index: true },
      ]),
    );
    expect(layout.meta.map((f) => f.key).sort()).toEqual(['meta', 'views']);
  });

  it('a slug-first collection titles on the text field, never the slug (title/slug unification)', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'slug', type: 'slug', index: true },
        { key: 'name', type: 'text' },
      ]),
    );
    expect(layout.titleField?.key).toBe('name');
  });

  it('wantHero/wantLead opt-outs unclaim the slots; the fields fall through to meta', () => {
    const fields: FieldDescriptor[] = [
      { key: 'title', type: 'text' },
      { key: 'cover', type: 'media' },
      { key: 'summary', type: 'text' },
      { key: 'body', type: 'markdown' },
    ];
    const layout = resolveConventionLayout(def(fields), { wantHero: false, wantLead: false });
    expect(layout.hero).toBeUndefined();
    expect(layout.lead).toBeUndefined();
    expect(layout.body.map((f) => f.key)).toEqual(['body']);
    expect(layout.meta.map((f) => f.key).sort()).toEqual(['cover', 'summary']);
  });

  it('bind pins slots explicitly; convention fills whatever is left unbound', () => {
    const layout = resolveConventionLayout({
      ...def([
        { key: 'title', type: 'text' },
        { key: 'avatar', type: 'media' },
        { key: 'poster', type: 'media' },
        { key: 'author', type: 'text' },
        { key: 'dek', type: 'text' },
        { key: 'body', type: 'markdown' },
      ]),
      // Without bind, convention would pick avatar (first media) and author
      // (first non-title text) — exactly the wrong-guess cases bind exists for.
      bind: { hero: 'poster', lead: 'dek' },
    });
    expect(layout.hero?.key).toBe('poster');
    expect(layout.lead?.key).toBe('dek');
    // The convention's would-be picks land in meta instead of vanishing.
    expect(layout.meta.map((f) => f.key).sort()).toEqual(['author', 'avatar']);
  });

  it('bind.title flows through titleFieldOf, so the lead never duplicates the bound title', () => {
    const layout = resolveConventionLayout({
      ...def([
        { key: 'kicker', type: 'text' },
        { key: 'headline', type: 'text' },
      ]),
      bind: { title: 'headline' },
    });
    expect(layout.titleField?.key).toBe('headline');
    expect(layout.lead?.key).toBe('kicker');
  });
});
