# Worklog — Admin UX Improvements

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-05 11:00 | START | Branch `feature/admin-ux` off main (e4ec9b3). 7 UI/UX items, sequential phased. Plan approved (full settings+account overhaul). |
| 2026-07-05 11:20 | Phase 0 | Foundations committed (156a03b): control.ts, Checkbox fix (accent-accent), Toggle, Breadcrumb, humanize/fieldLabel (wired into field-shell+generated), PageHeader mb-8+breadcrumb slot. 154 tests green. |
| 2026-07-05 11:55 | Phase 1 | Consistency+adoption committed: CONTROL_H into Button/Input/Select (+size,+multiple); Access sm→md; media controls; boolean+builder Toggles; flag fieldset; breadcrumbs on collection/collections pages; mt-8 removed. 154 tests + 16 e2e green. |
| 2026-07-05 12:20 | Phase 2 | User menu committed: Datastar disclosure (trigger name+chevron, panel role=menu, click-outside, Esc), logout moved in, Account link (→ Phase 4). New menu e2e. 17 e2e green. Note: /admin/account 404s until Phase 4. |
