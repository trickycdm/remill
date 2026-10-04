/**
 * Only allow same-origin relative redirects. Browsers read a backslash as a slash
 * and strip tabs/newlines when resolving a URL, so `/\evil.example` and
 * `/<tab>/evil.example` are protocol-relative in disguise — refuse both along with
 * the plain `//` form and anything absolute.
 */
export function safeRedirect(target: string | undefined): string {
  if (!target) return '/admin';
  if (!target.startsWith('/') || target.startsWith('//')) return '/admin';
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return '/admin';
  return target;
}
