#!/usr/bin/env bash
# One-step setup on a fresh machine (macOS or Linux; on Windows, run it in WSL or Git Bash).
#   git clone https://github.com/LeeSinLiang/24x100.git && cd 24x100 && ./scripts/setup.sh
# It checks the tools (Node 22.12+ and uv; Chrome is optional), installs the Node and Python dependencies from the
# lockfiles, creates .env from .env.example (never overwrites one), offers to fill in the one key most people want
# (GOOGLE_API_KEY, optional), and runs the tests. The site, the tests and the build need no keys at all.
#
#   ./scripts/setup.sh              everything above
#   ./scripts/setup.sh --no-prompt  don't ask for a key (also the default when not run from a terminal)
#   ./scripts/setup.sh --no-tests   skip the tests
#   ./scripts/setup.sh --full       also build the site (npm run build), as CI does
#
# Keys are read silently, written only to .env (mode 600, gitignored) and never printed.
set -euo pipefail

cd "$(dirname "$0")/.."
PROMPT=1
TESTS=1
FULL=0
for a in "$@"; do
  case "$a" in
    --no-prompt) PROMPT=0 ;;
    --no-tests) TESTS=0 ;;
    --full) FULL=1 ;;
    -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done
[ -t 0 ] || PROMPT=0

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
note() { printf '  · %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

step "1. Tools"
command -v node >/dev/null 2>&1 || fail "Node.js not found. Install Node 22.12 or newer (CI uses 26): https://nodejs.org, or 'brew install node', or 'nvm install 26'."
NODE_V="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_V%%.*}"
NODE_MINOR="$(echo "$NODE_V" | cut -d. -f2)"
# Vite 8 needs Node 20.19+ or 22.12+.
if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 12 ]; } || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -ge 19 ]; }; then
  ok "Node $NODE_V"
else
  fail "Node $NODE_V is too old: Vite 8 needs 20.19+ or 22.12+ (CI uses 26). Update Node and run this again."
fi
command -v npm >/dev/null 2>&1 || fail "npm not found (it comes with Node.js)."
if command -v uv >/dev/null 2>&1; then
  ok "uv $(uv --version | awk '{print $2}') (it installs the right Python, 3.11–3.13, by itself)"
else
  fail "uv not found. Install it, open a new terminal, and run this again:
      macOS/Linux:  curl -LsSf https://astral.sh/uv/install.sh | sh
      Windows:      powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"
      (or 'brew install uv'; see https://docs.astral.sh/uv/)"
fi
CHROME=0
if [ -d "/Applications/Google Chrome.app" ] || command -v google-chrome >/dev/null 2>&1 || command -v google-chrome-stable >/dev/null 2>&1; then
  CHROME=1
  ok "Google Chrome (for the page checks: npm run smoke, the word budgets, the demo recorder)"
else
  note "Google Chrome not found: optional, only the page checks need it (npm run smoke, scripts/words.mjs, npm run demo). Install Chrome, or: npx playwright install chrome"
fi

step "2. Dependencies (from the lockfiles)"
npm ci --no-audit --no-fund --loglevel=error
ok "Node packages (npm ci)"
uv sync --quiet
ok "Python packages (uv sync, into .venv)"

step "3. .env"
if [ -f .env ]; then
  ok ".env already exists: left as it is"
else
  cp .env.example .env
  chmod 600 .env
  ok "created .env from .env.example (gitignored, readable only by you)"
fi
# Replace KEY=... in .env without the value ever touching a command line or the screen.
set_env() {
  local k="$1" v="$2" tmp
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$k="* ]]; then printf '%s=%s\n' "$k" "$v"; else printf '%s\n' "$line"; fi
  done <.env >"$tmp"
  cat "$tmp" >.env
  rm -f "$tmp"
}
is_set() { grep -qE "^$1=.+" .env; }
if [ "$PROMPT" -eq 1 ] && ! is_set GOOGLE_API_KEY; then
  echo "  GOOGLE_API_KEY lets the model read zoning code (extraction) and plan the agents' runs. Free at"
  echo "  https://aistudio.google.com/apikey. Everything else works without it."
  read -r -s -p "  Paste it, or press Enter to skip: " KEY
  echo
  if [ -n "$KEY" ]; then
    set_env GOOGLE_API_KEY "$KEY"
    ok "GOOGLE_API_KEY saved to .env"
  else
    note "skipped: add it to .env any time"
  fi
  unset KEY
fi
for k in GOOGLE_API_KEY ANTHROPIC_API_KEY SLACK_WEBHOOK_URL RESEND_API_KEY DIGEST_TO SMTP_HOST; do
  if is_set "$k"; then ok "$k is set"; else note "$k is empty"; fi
done

if [ "$TESTS" -eq 1 ]; then
  step "4. Checks"
  npm run -s typecheck && ok "typecheck"
  npx vitest run --reporter=dot >/dev/null 2>&1 && ok "engine tests (vitest)" || fail "engine tests failed: run 'npx vitest run' to see why"
  # A fresh clone skips 8 tests that need the raw public pulls (data/raw is gitignored: it holds owner-name fields
  # the pipeline drops); 'npm run rebuild' fetches them. Each skip prints its reason with -rs.
  uv run pytest -q -rs 2>&1 | tail -1 | sed 's/^/  ✓ pipeline and extraction tests (pytest): /'
  if [ "$FULL" -eq 1 ]; then
    npm run -s build >/dev/null && ok "build (the static API and the site in web/dist)"
  fi
fi

step "Ready"
cat <<'EOF'
  npm run dev          the app at http://localhost:5173
  npm test             engine tests (vitest) and pipeline tests (pytest)
  npm run build        the static API and the site in web/dist; npm run preview serves it at :4173

  What each key in .env unlocks (all optional):
    GOOGLE_API_KEY       rule extraction (uv run python -m extract run --district R1D-H) and the agents' model
                         (npm run steward -- 0010K00025000000 --goal two; without it, add --no-model)
    ANTHROPIC_API_KEY    Claude instead of Gemini for extraction (EXTRACT_PROVIDER=anthropic)
    SLACK_WEBHOOK_URL    the watchlist digest to Slack          } only with npm run digest -- --send;
    RESEND_API_KEY + DIGEST_TO, or SMTP_*: the digest by email  } npm run digest -- --dry-run needs none
EOF
[ "$CHROME" -eq 1 ] || echo "  Install Google Chrome for npm run smoke and the other page checks."
