# Worklog: framed pages

| When | Action | Detail |
|---|---|---|
| 2026-10-04 14:26 | plan approved | worktree .claude/worktrees/framed-pages, branch feat/frame-render-mode from origin/main b308b6b |
| 2026-10-04 14:36 | phase 1 built | migration 0019 (column swap), src/lib/frame (policy, ticket, document), services/frame, /frame/:ticket route, ViewerShell, frame branches in admin view + /s/:token + public route, builder "Framed page" option + template/bind/config carry-over fix |
| 2026-10-04 14:36 | decision | preview (?preview=1) on a frame collection renders the viewer directly with the session principal instead of redirecting to the admin view; "open full screen" dropped (a 5-minute ticket URL makes a poor standalone link) |
| 2026-10-04 14:36 | docs | D60 row; SCHEMA_ENGINE, SECURITY_STANDARDS, ACCESS_CONTROL, CLAUDE.md updated |
| 2026-10-04 14:39 | verified | type-check, lint, 818 unit tests green; e2e/framed-pages.spec.ts 4/4; viewer screenshots checked at 1728px and 390px, light and dark |
| 2026-10-04 14:39 | blocker noted | full e2e: 99 passed, 2 failed, 2 flaky. The 2 failures (admin-content.spec.ts, revision-diff.spec.ts: markdown editor intercepts clicks; two "Save changes" buttons) reproduce on unmodified origin/main b308b6b, so they pre-date this work. Not fixed here |
