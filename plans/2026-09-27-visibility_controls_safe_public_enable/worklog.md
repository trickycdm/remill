| Time             | Action | Detail                                                                                                                                              |
| ---------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-27 18:46 | PLAN   | Plan approved (safe enable, D57)                                                                                                                    |
| 2026-09-27 18:54 | BUILD  | effectiveVisibility helper; updateCollection D57 guard + enablePublicPages + countExposableDocuments; batched doc visibility in updateCollectionRow |
| 2026-09-27 18:54 | BUILD  | Editor Visibility card on all docs (locked Private + safe enable); header/list labels; builder confirm step; REST/MCP onEnablePublic                |
| 2026-09-27 18:54 | VERIFY | type-check + lint clean; unit 736/736 (9 new); e2e 95 passed + 2 login flakes passed on retry (new spec visibility-safe-enable)                     |
| 2026-09-27 18:54 | NOTE   | local e2e failures in admin-schema-access were dirty local D1 (widgets/Moderator left over); clean D1 → pass                                        |
| 2026-09-27 18:54 | DOCS   | D57 in TECH_DECISIONS, ACCESS_CONTROL invariant, CLAUDE.md status                                                                                   |
| 2026-10-04 08:20 | VERIFY | Re-checked on current main (7987e6b, no drift): type-check clean, unit 736/736, e2e visibility specs 10/10 |
| 2026-10-04 08:20 | FIX    | eslint now ignores .claude/ — a nested worktree's build output was failing the pre-commit lint |
| 2026-10-04 08:20 | NOTE   | Known limit: enabling flips each document in one D1 batch (2 statements per document), so a collection with several hundred non-private documents would hit D1's per-request statement cap and fail closed (nothing exposed) |
