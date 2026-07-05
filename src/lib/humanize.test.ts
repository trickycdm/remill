import { describe, it, expect } from 'vitest';
import { humanizeKey, fieldLabel } from '@/lib/humanize';

describe('humanizeKey', () => {
  it('splits camelCase into sentence case', () => {
    expect(humanizeKey('siteName')).toBe('Site name');
    expect(humanizeKey('defaultAuthorName')).toBe('Default author name');
  });

  it('splits snake_case and kebab-case', () => {
    expect(humanizeKey('default_author_name')).toBe('Default author name');
    expect(humanizeKey('some-key')).toBe('Some key');
  });

  it('capitalizes a single lowercase word', () => {
    expect(humanizeKey('title')).toBe('Title');
  });

  it('keeps digits attached to their word', () => {
    expect(humanizeKey('address2')).toBe('Address2');
    expect(humanizeKey('line1Detail')).toBe('Line1 detail');
  });

  it('returns the key unchanged when there is nothing to humanize', () => {
    expect(humanizeKey('')).toBe('');
  });
});

describe('fieldLabel', () => {
  it('prefers an explicit label', () => {
    expect(fieldLabel({ key: 'siteName', label: 'Site URL' })).toBe('Site URL');
  });

  it('humanizes the key when no label is set', () => {
    expect(fieldLabel({ key: 'siteName' })).toBe('Site name');
  });
});
