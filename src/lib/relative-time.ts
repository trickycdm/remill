/**
 * relativeTime — compact "how long ago" for admin metadata lines ("just now",
 * "5m ago", "3h ago", "6d ago"). Beyond 30 days the phrasing stops being useful,
 * so it falls back to the date portion of the raw string. A pure boundary helper
 * (formatDate precedent): takes `now` explicitly — no clock, deterministic,
 * unit-testable. Future timestamps (clock skew) clamp to "just now"; invalid
 * input returns '' — never throws into a render.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Render `ts` relative to `nowIso`, compact-style. */
export function relativeTime(ts: string, nowIso: string): string {
  const then = new Date(ts).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(then) || Number.isNaN(now)) return '';
  const delta = now - then;
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return ts.slice(0, 10);
}
