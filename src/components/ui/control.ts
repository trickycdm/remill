/**
 * Control sizing — the single source of truth for the height of interactive box
 * controls (Button, Input, Select, and anything that must line up beside them).
 * Adjacent controls MUST share a `size`; the canonical height is `md` (h-10 / 40px).
 *
 * Keeping height here — rather than inlined per component — is what stops Button
 * and the form controls from drifting apart when placed side by side (item 7).
 */
export const CONTROL_H = { sm: 'h-8', md: 'h-10', lg: 'h-11' } as const;

export type ControlSize = keyof typeof CONTROL_H;
