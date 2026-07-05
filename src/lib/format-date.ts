/**
 * formatDate — render an ISO-8601 timestamp for admin display, honouring the site
 * settings' `timezone` (IANA name) and `dateFormat` preset. A pure boundary helper:
 * it takes the timestamp + the already-read settings (no DB, no clock), so it stays
 * deterministic and unit-testable.
 *
 * Presets (mirrors the `dateFormat` select options in the settings singleton):
 *   iso   → 2026-07-05        (en-CA, zero-padded Y-M-D)
 *   long  → July 5, 2026      (en-US, full month)
 *   short → Jul 5, 2026       (en-US, abbreviated month)
 *
 * Workers' V8 ships full ICU, so `timeZone` and these locales resolve at the edge.
 * Any failure (bad timestamp, unknown timezone) falls back to the date portion of
 * the raw string — never throws into a render.
 */

import type { SiteSettings } from '@/services/settings';

interface Preset {
  readonly locale: string;
  readonly options: Intl.DateTimeFormatOptions;
}

const PRESETS: Record<string, Preset> = {
  iso: { locale: 'en-CA', options: { year: 'numeric', month: '2-digit', day: '2-digit' } },
  long: { locale: 'en-US', options: { year: 'numeric', month: 'long', day: 'numeric' } },
  short: { locale: 'en-US', options: { year: 'numeric', month: 'short', day: 'numeric' } },
};

/** Format an ISO timestamp per the site settings, falling back to `ts.slice(0,10)`. */
export function formatDate(ts: string, settings?: SiteSettings): string {
  const preset = PRESETS[settings?.dateFormat ?? 'iso'] ?? PRESETS.iso;
  const timeZone = settings?.timezone || 'UTC';
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return ts.slice(0, 10);
    return new Intl.DateTimeFormat(preset.locale, { ...preset.options, timeZone }).format(date);
  } catch {
    return ts.slice(0, 10);
  }
}
