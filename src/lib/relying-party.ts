/**
 * The WebAuthn "relying party" for passkeys (D58): the hostname a passkey is bound
 * to (`rpId`) and the exact origin a browser ceremony must come from (`origin`).
 *
 * The deploy-time `BASE_URL` wins; without it (per-PR preview Workers) the request
 * origin is used. Unlike resolveBaseUrl this deliberately IGNORES the
 * admin-editable `settings.siteUrl` — a setting must never be able to break or
 * re-point sign-in.
 *
 * One local-development exception: browsers refuse an IP address as an RP ID, so
 * when `BASE_URL` is a loopback address a request made to `localhost` is honoured
 * (both are the same machine; this can never match a deployed hostname).
 */

export interface RelyingParty {
  readonly rpId: string;
  readonly origin: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveRelyingParty(env: { readonly BASE_URL?: string } | undefined, reqUrl: string): RelyingParty {
  const request = new URL(reqUrl);
  const configured = parseUrl(env?.BASE_URL);
  const url =
    configured && !(LOOPBACK_HOSTS.has(configured.hostname) && LOOPBACK_HOSTS.has(request.hostname))
      ? configured
      : request;
  return { rpId: url.hostname, origin: url.origin };
}

function parseUrl(value: string | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}
