/**
 * Structured logging for Cloudflare Workers. Console-based — the Workers runtime
 * captures `console.*` as structured JSON when observability is enabled in
 * wrangler.jsonc. This is NOT Pino; do not import `pino` (CODING_CONVENTIONS.md).
 * Metadata object always first: `log.info({ documentId, collection }, 'saved')`.
 * Log stable IDs, never emails/names/content (PII discipline).
 */

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function getLogger(service: string): Logger {
  return createLogger({ service });
}

export function withRequestContext(logger: Logger, requestId: string): Logger {
  return logger.child({ requestId });
}

function createLogger(bindings: Record<string, unknown>): Logger {
  const log = (level: string, obj: Record<string, unknown>, msg?: string) => {
    const entry = { level, ...bindings, ...obj, ...(msg ? { msg } : {}) };
    switch (level) {
      case 'error':
        console.error(JSON.stringify(entry));
        break;
      case 'warn':
        console.warn(JSON.stringify(entry));
        break;
      case 'debug':
        console.debug(JSON.stringify(entry));
        break;
      default:
        console.log(JSON.stringify(entry));
    }
  };

  return {
    info: (obj, msg) => log('info', obj, msg),
    warn: (obj, msg) => log('warn', obj, msg),
    error: (obj, msg) => log('error', obj, msg),
    debug: (obj, msg) => log('debug', obj, msg),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}
