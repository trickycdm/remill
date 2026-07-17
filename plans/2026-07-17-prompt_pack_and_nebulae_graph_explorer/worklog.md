# Worklog — 2026-07-17-prompt_pack_and_nebulae_graph_explorer

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-17 | brainstorm | feature ideas captured to plans/BACKLOG.md; prompt pack + graph committed |
| 2026-07-17 | design round 1 | proof-sheet artifact, 4 flat riso directions — rejected (wanted 3D universe) |
| 2026-07-17 | design round 2 | 3 canvas 3D proofs (deep field / orrery / nebulae) — **Nebulae chosen** |
| 2026-07-17 | research | 3 parallel subagents: pack anatomy, MCP handler, graph data + island patterns |
| 2026-07-17 | decisions | user: prompts PRIVATE by default; graph click navigates to editor |
| 2026-07-17 | plan approved | design-agent review folded in (select has no default; graphData needs dedicated projection query; split/join interpolation; no theme observer; summary region not per-node links) |
| 2026-07-17 | PR 1 start | branch feat/prompt-library-pack created |
| 2026-07-17 | RE-PLAN | pack key `prompt-library` → `prompts`: hyphen broke the Marketplace Datastar busy-signal (`busy_prompt-library` parses as subtraction, install button stuck disabled); also hardened the route to sanitize signal names |
| 2026-07-17 | bug found | pre-existing: 6 e2e failures on dirty persisted D1 (reproduced on clean main); wiped .wrangler/state/v3/d1 → 68/68 pass |
| 2026-07-17 | PR 1 done | template+pack+tests green: tsc, eslint, 425 unit, 68 e2e; PR #30 |
| 2026-07-17 | PR 2 done | MCP prompts primitive (prompts.ts + 2 handler cases + couldDo export), 6 new tests, steering Prompts bullet, D44 logged; dirty-D1 wipe needed again before e2e (2nd time — candidate for /learn) |
| 2026-07-17 | bug found | graph island tokens rendered grey: getPropertyValue returns light-dark() UNRESOLVED — fixed with a probe element computed inside the rm-dark-act subtree (screenshot-verified) |
| 2026-07-17 | tuning | hover pick radius 14px → 26px (probe-tested: 14px unhittable on sparse skies) |
| 2026-07-17 | PR 3 done | queries+graphData+route+nav+island+5 service tests+e2e+D45; visually verified: nebulae tints, arcs, pink hover+label; PRs: #30 pack, #31 MCP prompts (stacked on #30), #32 graph (off main) |
