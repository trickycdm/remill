/**
 * Serialise a value for safe embedding inside an inline <script> block.
 *
 * `JSON.stringify` is quote/backslash-safe, and replacing `<` with its unicode
 * escape prevents a `</script>` sequence (or `<!--`) in the data from breaking out
 * of the script context. This is the ONLY sanctioned way to pass server data into a
 * `dangerouslySetInnerHTML` script island (the `window.__remillConfig` pattern).
 *
 * Never hand-escape values into a JS string literal: that misses `</script>`, line
 * separators (U+2028/U+2029), and escaping-order bugs.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
