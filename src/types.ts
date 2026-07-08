// D1Database, R2Bucket, DurableObjectNamespace are globally available via
// @cloudflare/workers-types (injected by the Vite plugin / tsconfig types).

export type Env = {
  // Storage
  DB: D1Database;
  MEDIA: R2Bucket;

  // KV namespace backing the fixed-window rate limiter (SEC-2). OPTIONAL by design:
  // it is bound in production/preview (wrangler.jsonc) but absent in unit tests, and
  // the limiter degrades to a no-op when it is missing (src/middleware/rate-limit.ts).
  RATE_LIMIT?: KVNamespace;

  // Durable Objects (MCP server — bound in Phase 7)
  // MCP: DurableObjectNamespace;

  // Secrets
  SESSION_SECRET: string;

  // Resend API key (D20). OPTIONAL by design: absent locally/in tests, where the
  // email transport degrades to the console stub (RATE_LIMIT? precedent).
  // Set with `wrangler secret put RESEND_API_KEY`; local via .dev.vars.
  RESEND_API_KEY?: string;

  // Bootstrap: the first-admin password used ONLY by scripts/bootstrap-admin.ts.
  // Never committed; supplied at bootstrap time (see .dev.vars.tpl / C1).
  ADMIN_BOOTSTRAP_PASSWORD?: string;

  // Vars
  BASE_URL: string;
  // Default From address for outgoing mail; settings.emailFrom overrides it.
  EMAIL_FROM?: string;
};
