// D1Database, R2Bucket, DurableObjectNamespace are globally available via
// @cloudflare/workers-types (injected by the Vite plugin / tsconfig types).

export type Env = {
  // Storage
  DB: D1Database;
  MEDIA: R2Bucket;

  // Durable Objects (MCP server — bound in Phase 7)
  // MCP: DurableObjectNamespace;

  // Secrets
  SESSION_SECRET: string;

  // Vars
  BASE_URL: string;
};
