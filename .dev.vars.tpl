# Local development secrets template.
# Copy to `.dev.vars` (gitignored) and fill in. `.dev.vars` is read by wrangler/vite
# in dev and injected as Worker secrets.
#
# SESSION_SECRET: encryption key for the hono-sessions cookie. MUST be >= 32 chars.
# Generate one with:  openssl rand -hex 32
SESSION_SECRET="change-me-to-a-random-string-at-least-32-characters-long"

# ---------------------------------------------------------------------------
# Email delivery via Resend (D20). OPTIONAL — omit both to keep the console
# stub (logs instead of sending; what tests use). NEVER commit a real key; if
# one ever transits an insecure channel (chat, ticket), rotate it at
# https://resend.com/api-keys after wiring. Production:
#   wrangler secret put RESEND_API_KEY
# The From address must be a Resend-verified sender. settings.emailFrom
# (admin Settings page) overrides EMAIL_FROM.
# RESEND_API_KEY=""
# EMAIL_FROM="remill <bot@yourdomain.com>"

# ---------------------------------------------------------------------------
# First-admin bootstrap (C1). The admin login is NOT seeded — no credentials live
# in the repo. Provision it explicitly with scripts/bootstrap-admin.ts:
#
#   Local dev (dev password 'remilladmin'):   bun run db:seed   (seeds + bootstraps)
#                                       or:    bun run db:bootstrap:local
#
#   Production (choose a strong password, >= 16 chars):
#     ADMIN_BOOTSTRAP_EMAIL=you@site.com \
#     ADMIN_BOOTSTRAP_PASSWORD='…strong…' \
#     bun run db:bootstrap:remote
#   (omit ADMIN_BOOTSTRAP_PASSWORD to have a strong one generated + printed once.)
#
# These are consumed by the bootstrap SCRIPT (process env), not the running Worker —
# export them in your shell / CI secret store rather than committing them here.
# ADMIN_BOOTSTRAP_EMAIL="admin@remill.local"
# ADMIN_BOOTSTRAP_PASSWORD=""
