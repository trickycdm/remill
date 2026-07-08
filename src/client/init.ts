/**
 * Client entry — the small GLOBAL island bundle Vite compiles for the browser
 * (loaded from src/layouts.tsx on every page). Kept intentionally thin:
 * Datastar handles almost all interactivity declaratively
 * (steering/DATASTAR_PATTERNS.md). Page-specific islands live in their own
 * route-loaded entries (markdown-editor.ts, media-picker.ts — D38).
 *
 * Excluded from tsconfig's server type-check (see tsconfig `exclude`); this runs
 * in the browser, not the Worker.
 */

/** '/' or Cmd/Ctrl-K focuses the admin header search box (D28). '/' is
 *  suppressed while typing in any editable control; Cmd/Ctrl-K always wins. */
document.addEventListener('keydown', (e) => {
  const box = document.getElementById('admin-search-input') as HTMLInputElement | null;
  if (!box) return;
  const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
  const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
  if (!isSlash && !isCmdK) return;
  if (isSlash) {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  }
  e.preventDefault();
  box.focus();
  box.select();
});

export {};
