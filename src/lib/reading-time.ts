/**
 * Reading-time estimate for the public reading surface (the article template's
 * meta line). Pure — the route hands it the already-extracted plain-text body
 * (`buildSearchText`), so this stays a trivial word count with no field-registry
 * or DB dependency. ~220 wpm is the common adult-prose default; a non-empty body
 * always rounds up to at least one minute so short posts never read "0 min".
 */

/** Whole-minute reading estimate for `text`. Empty/whitespace → 0 (callers hide
 *  the affordance); otherwise `max(1, round(words / wpm))`. */
export function readingTimeMinutes(text: string, wpm = 220): number {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return words ? Math.max(1, Math.round(words / wpm)) : 0;
}
