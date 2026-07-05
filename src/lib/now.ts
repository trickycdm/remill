/**
 * The current time as an ISO-8601 string. Services take `now` as a parameter (so
 * tests inject a fixed clock); routes call this at the edge to supply it. Keeping
 * the clock at the boundary keeps the services pure and deterministic to test.
 */
export function nowIso(): string {
  return new Date().toISOString();
}
