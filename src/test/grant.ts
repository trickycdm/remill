/**
 * The SINGLE sanctioned way to mint a Grant witness in tests (ACCESS_CONTROL.md).
 * Never replicate the Grant constructor anywhere else. Production code obtains
 * grants only from authorize().
 */

import { Grant } from '@/access/grant';
import type { Action, Resource } from '@/access/types';

export function grantForTest(
  principalId: string,
  action: Action,
  resource: Resource,
): Grant {
  return Grant.__mint(principalId, action, resource);
}
