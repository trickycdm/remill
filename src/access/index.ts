/**
 * Public surface of the access module. Services import from here.
 *
 * Note what is NOT exported: `Grant.__mint` is reachable only because it's a
 * static on the exported class, but services must never call it — the sanctioned
 * ways to obtain a Grant are `authorize()` (production) and `grantForTest()`
 * (src/test/, tests only). See steering/ACCESS_CONTROL.md.
 */

export { authorize, principalFromSession, anonymousPrincipal, systemPrincipal, compileReadFilter, resolveAccess, Grant, resourceKey, ACTIONS } from '@/access/authorize';
export type { ResolvedAccess } from '@/access/authorize';
export type { Action, Principal, Resource, Condition, Surface } from '@/access/types';
export { scopeMatches } from '@/access/permissions';
export type { TokenScopeEntry } from '@/access/permissions';
