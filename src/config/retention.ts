/**
 * Retention windows for the daily maintenance cron (D29/D31). Constants, not
 * settings — retention is an operator policy, not per-site content config
 * (change here + redeploy; a settings field was considered and skipped to
 * avoid settings sprawl).
 */

/** Days a trashed document stays restorable before the daily purge removes it. */
export const TRASH_RETENTION_DAYS = 30;

/** Newest revisions snapshotted into a trash entry (bounds `revisions_json`
 *  well under D1 row-size limits; older history is forfeited on delete). */
export const TRASH_MAX_REVISIONS = 20;

/** Milliseconds in a day — for computing retention cutoffs from `now`. */
export const DAY_MS = 24 * 60 * 60 * 1000;
