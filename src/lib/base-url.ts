/**
 * One resolver for the site's absolute base URL, used everywhere a link leaves
 * the current request (share links, team-join links, email bodies, MCP tool
 * results — which have no request Context at all). Precedence: the deploy-time
 * `BASE_URL` var wins (authoritative behind proxies/custom domains), then the
 * admin-editable `settings.siteUrl`, then the request origin as a last resort.
 * Returns '' only when nothing is configured AND no request URL is available.
 */

export function resolveBaseUrl(
  env: { readonly BASE_URL?: string } | undefined,
  settings: { readonly siteUrl?: string } | undefined,
  reqUrl?: string,
): string {
  const configured = trim(env?.BASE_URL) ?? trim(settings?.siteUrl);
  if (configured) return configured;
  if (reqUrl) {
    try {
      return new URL(reqUrl).origin;
    } catch {
      return '';
    }
  }
  return '';
}

/** Trimmed, trailing-slash-free value, or undefined when blank/absent. */
function trim(v: string | undefined): string | undefined {
  const t = v?.trim().replace(/\/+$/, '');
  return t ? t : undefined;
}
