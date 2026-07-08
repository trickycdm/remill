/**
 * Cron jobs (D31) — the `scheduled()` half of the Worker (src/main.tsx exports
 * both fetch and scheduled). Dispatch is keyed on the LITERAL cron expression
 * Cloudflare passes in `controller.cron`, matching wrangler.jsonc `triggers`:
 *
 *   '* * * * *'  per-minute  — scheduled-publish drain (no-op until that phase)
 *   '0 3 * * *'  daily 03:00 — maintenance: retention purges (trash D29; events later)
 *
 * Jobs call SERVICES only — the routes→services→queries layering holds for cron
 * exactly as for requests (CODING_CONVENTIONS.md). Each job is isolated in
 * try/catch so one failure never starves the rest of the batch.
 */

import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { nowIso } from '@/lib/now';
import { purgeExpiredTrash } from '@/services/trash';
import { drainScheduledPublishes } from '@/services/documents';

type Job = { readonly name: string; readonly run: (env: Env, now: string) => Promise<unknown> };

const PER_MINUTE: Job[] = [
  // Publishes due drafts as the system actor (D30/D32) — full pipeline + audit.
  { name: 'drainScheduledPublishes', run: (env, now) => drainScheduledPublishes(getDb(env.DB), now) },
];

const DAILY_MAINTENANCE: Job[] = [
  { name: 'purgeExpiredTrash', run: (env, now) => purgeExpiredTrash(getDb(env.DB), now) },
  // Events-outbox pruning joins this list when the outbox ships.
  // Hook point: cron-scheduled R2 snapshots could also slot in here (plan Phase 8).
];

async function runJobs(jobs: readonly Job[], env: Env, now: string): Promise<void> {
  for (const job of jobs) {
    try {
      await job.run(env, now);
    } catch (e) {
      console.error(`[cron] ${job.name} failed`, e);
    }
  }
}

/** Entry point wired in src/main.tsx: `scheduled: (c, env, ctx) => ctx.waitUntil(runScheduled(c.cron, env))`. */
export async function runScheduled(cron: string, env: Env): Promise<void> {
  const now = nowIso();
  switch (cron) {
    case '* * * * *':
      await runJobs(PER_MINUTE, env, now);
      break;
    case '0 3 * * *':
      await runJobs(DAILY_MAINTENANCE, env, now);
      break;
    default:
      console.error(`[cron] no jobs registered for expression '${cron}'`);
  }
}
