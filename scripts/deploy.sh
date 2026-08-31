#!/usr/bin/env bash
# Create the repo, push, and turn on GitHub Pages.
# Requires an authenticated `gh`. Scopes needed: repo (create + push) and Pages settings.
#
#   REPO=my/model-shelf VISIBILITY=private ./scripts/deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${REPO:-model-shelf}"
VISIBILITY="${VISIBILITY:-public}"
GH="${GH:-gh}"

"$GH" auth status || { echo "Run 'gh auth login' first." >&2; exit 1; }

# Build fresh so what we push matches what the Hub says right now.
python3 scripts/fetch_models.py --out data/models.json
python3 scripts/build_site.py
node scripts/smoke-test.mjs

git add -A
git diff --cached --quiet || git -c user.name="Model Shelf" -c user.email="bot@example.invalid" \
  commit -m "Refresh Hub data"

if "$GH" repo view "$REPO" >/dev/null 2>&1; then
  echo "Repo $REPO already exists, pushing to it."
else
  "$GH" repo create "$REPO" --"$VISIBILITY" --source=. --remote=origin --description \
    "Live card for GLM-5.3, TRELLIS.2-4B and TRELLIS-text-xlarge"
fi

git push -u origin main

# Pages must be served by the Actions workflow, not a branch.
"$GH" api -X POST "repos/{owner}/$REPO/pages" -f 'build_type=workflow' 2>/dev/null \
  || "$GH" api -X PUT "repos/{owner}/$REPO/pages" -f 'build_type=workflow'

echo
echo "Actions run:"
"$GH" run list --limit 3 2>/dev/null || true
echo
echo "Once the first run goes green the site is at:"
echo "  https://$( "$GH" api user --jq .login ).github.io/$REPO/"
