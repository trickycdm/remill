/**
 * Client entry — the small island bundle Vite compiles for the browser. Kept
 * intentionally thin: Datastar handles almost all interactivity declaratively
 * (steering/DATASTAR_PATTERNS.md). Reserve this for browser APIs Datastar can't
 * express (Phase 4: CodeMirror; Phase 5: Uppy).
 *
 * Excluded from tsconfig's server type-check (see tsconfig `exclude`); this runs
 * in the browser, not the Worker.
 */

// Nothing to initialise yet. Phase 4/5 register their islands here.
export {};
