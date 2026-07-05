# Local development secrets template.
# Copy to `.dev.vars` (gitignored) and fill in. `.dev.vars` is read by wrangler/vite
# in dev and injected as Worker secrets.
#
# SESSION_SECRET: encryption key for the hono-sessions cookie. MUST be >= 32 chars.
# Generate one with:  openssl rand -hex 32
SESSION_SECRET="change-me-to-a-random-string-at-least-32-characters-long"
