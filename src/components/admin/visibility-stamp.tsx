/**
 * VisibilityStamp — the one marker for a document that is NOT public (D50/D57).
 * Public is the unmarked default, so it renders nothing. Shared by the list
 * view, the edit header, and the Visibility section so the three never drift
 * apart again (the header once used a Badge while the list used a Stamp).
 */

import type { Visibility } from '@/lib/visibility';
import { Stamp } from '@/components/ui';

export function VisibilityStamp({ visibility }: { visibility: Visibility | undefined }) {
  if (!visibility || visibility === 'public') return null;
  return (
    <Stamp tone="event" class="text-[10px]">
      {visibility}
    </Stamp>
  );
}
