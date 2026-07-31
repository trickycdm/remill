/**
 * Line diff for the revision compare view (Phase 10) — hand-rolled LCS, no
 * dependency. Common prefix/suffix are trimmed first (revisions of a document
 * usually share almost everything), then a classic DP/backtrack runs on the
 * remaining core. The core is capped at DIFF_MAX_CELLS DP cells (~8 MB as
 * Uint16) — Workers has a 128 MB ceiling and an admin page must never chew
 * through it; beyond the cap the caller renders "too large to diff".
 */

export interface DiffOp {
  readonly kind: 'same' | 'add' | 'del';
  readonly line: string;
}

/** DP core budget after prefix/suffix trimming (cells = coreA × coreB). */
export const DIFF_MAX_CELLS = 4_000_000;

/** Diff `a` → `b` line-wise. Returns the unified op list, or null when the
 *  post-trim core exceeds the budget. */
export function diffLines(aText: string, bText: string): DiffOp[] | null {
  const a = aText.split('\n');
  const b = bText.split('\n');

  // Trim the shared prefix/suffix — the DP then only sees the changed core.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  if (n * m > DIFF_MAX_CELLS) return null;

  // LCS lengths, dp[i][j] = LCS of a[start+i..) vs b[start+j..). Uint16 is
  // sufficient: an LCS over a ≤4M-cell core never exceeds 65535 lines.
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[start + i] === b[start + j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  for (let k = 0; k < start; k++) ops.push({ kind: 'same', line: a[k] });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      ops.push({ kind: 'same', line: a[start + i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      // Prefer emitting deletions first — the conventional unified order.
      ops.push({ kind: 'del', line: a[start + i] });
      i++;
    } else {
      ops.push({ kind: 'add', line: b[start + j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'del', line: a[start + i++] });
  while (j < m) ops.push({ kind: 'add', line: b[start + j++] });
  for (let k = endA; k < a.length; k++) ops.push({ kind: 'same', line: a[k] });
  return ops;
}

/** Render a field value as diffable lines: strings verbatim, everything else
 *  pretty-printed JSON (stable for objects/arrays/numbers/booleans), absent →
 *  empty. Shared by the compare route. */
export function valueToLines(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2) ?? '';
}
