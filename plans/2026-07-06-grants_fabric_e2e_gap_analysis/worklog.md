# Worklog — 2026-07-06-grants_fabric_e2e_gap_analysis

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-06 07:30 | plan approved | 4 tracks: teams, agent share links, Resend email, HTML pages; branch feature/sharing-fabric-v2 |
| 2026-07-06 07:43 | Phase 0 done | teams/team_members/team_invites + collections.render_mode (0006, CHECKs hand-added, migrated); id prefixes tem/tmm/tin; src/lib/base-url.ts + 5 tests |
| 2026-07-06 08:05 | Track 1 done | 'team' subject kind through subjectMatchFor/authorize/compileReadFilter (decide untouched); teams queries+service (invites rmj_, 90d clamp, acceptTeamInvite); /admin/access/teams, /auth/join/:token (rate-limited), /admin/shared + nav; share panel/route/matrix team support; MCP share_<slug> team enum + list_teams; 13 new unit tests (224 green) + e2e/teams.spec.ts |
| 2026-07-06 08:07 | Track 2 done | share_link action in ACTIONS/policy/seed + drift-guard test; createShareLink re-gated to authorize('share_link'); baseUrl threaded into MCP; share_link_<slug> tool (read-only, 30d clamp, {grantId,url,expiresAt}); 230 unit tests green |
