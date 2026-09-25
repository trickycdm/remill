import { describe, it, expect } from 'vitest';
import { healthOf, principalHref, scopeSummary } from '@/components/admin/principal-display';
import type { PrincipalRecord, TokenRecord } from '@/db/queries/principals';
import type { Action } from '@/access/types';

const NOW = '2026-09-25T12:00:00Z';
const agent: PrincipalRecord = { id: 'prn_a', kind: 'agent', subtype: 'agent', name: 'bot', disabled: false, email: null, roles: [] };
const token = (lastUsedAt: string | null): TokenRecord =>
  ({ id: 'tok_1', principalId: 'prn_a', name: 't', scope: null, lastUsedAt, oauth: false }) as unknown as TokenRecord;
const mask = (collection: string, actions: string[]) => actions.map((action) => ({ collection, action: action as Action }));

describe('scopeSummary', () => {
  it('says Full access for an unnarrowed token', () => {
    expect(scopeSummary(null)).toBe('Full access');
    expect(scopeSummary([])).toBe('Full access');
  });

  it('uses the preset name when the mask matches one', () => {
    expect(scopeSummary(mask('*', ['read']))).toBe('Read-only');
    expect(scopeSummary(mask('notes', ['read']))).toBe('Read-only on notes');
  });

  it('names what is left out when the mask covers most actions', () => {
    const seven = ['read', 'create', 'update', 'delete', 'publish', 'share_link', 'manage_schema'];
    expect(scopeSummary(mask('*', seven))).toMatch(/^All except .*Comment.*$/);
  });
});

describe('healthOf', () => {
  it('ranks disabled over any token activity', () => {
    expect(healthOf({ ...agent, disabled: true }, [token(NOW)], NOW).state).toBe('disabled');
  });

  it('distinguishes no token, never used, and connected', () => {
    expect(healthOf(agent, [], NOW).state).toBe('no-token');
    expect(healthOf(agent, [token(null)], NOW).state).toBe('never');
    expect(healthOf(agent, [token(null), token(NOW)], NOW).state).toBe('connected');
  });
});

describe('principalHref', () => {
  it('links a well-formed id to its detail page', () => {
    expect(principalHref('prn_1fyJGrUVczdWJ8n0IWA8r')).toBe('/admin/access/principals/prn_1fyJGrUVczdWJ8n0IWA8r');
  });

  it('falls back to the directory for anything else (no open redirect)', () => {
    expect(principalHref('')).toBe('/admin/access');
    expect(principalHref('//evil.example')).toBe('/admin/access');
    expect(principalHref('prn_x/../../y')).toBe('/admin/access');
  });
});
