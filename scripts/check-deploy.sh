#!/usr/bin/env bash
# npm run check:deploy — is what's live actually current?
#
# Since the API moved to the Linode (CLAUDE.md "API on the Linode") there are two
# deploy targets, and the naive check — "do the two revision strings match?" — is
# wrong in both directions:
#
#   * They legitimately DIFFER. A UI-only commit ships with `npm run deploy` and
#     never reaches the Linode, so the Linode sitting a few commits back is
#     normal and needs no action. (53274ad, a src/ui/ActionPanel.tsx fix, did
#     exactly this and looked like drift.)
#   * They can MATCH and still be stale — both targets equally behind main.
#
# The real question is per-target: does the revision each target is running
# include every commit that touched the files THAT target serves? That is what
# this checks. Exits non-zero if either target is missing a commit it needs, so
# it can gate a release.
set -uo pipefail
cd "$(dirname "$0")/.."

# Paths whose changes must reach each target. The Linode bundles server/linode.ts
# plus the functions/ handlers it routes to, which pull in the engine and AI.
# Cloudflare serves the client bundle AND the fallback Functions, so it needs
# effectively everything.
# package-lock.json, NOT package.json: the lock changes only when dependencies
# actually change, whereas package.json also churns on script edits — which need
# no redeploy and would otherwise report a false STALE on every tooling tweak.
LINODE_PATHS=(functions server src/engine src/ai package-lock.json)
PAGES_PATHS=(src functions index.html public vite.config.ts package-lock.json)

PAGES_URL="${PAGES_URL:-https://axis-and-allies-classic.pages.dev}"
LINODE_HOST="${AA_API_HOST:-root@172.232.14.119}"

head_rev=$(git rev-parse --short HEAD)
echo "local HEAD: $head_rev  ($(git log -1 --pretty=%s))"
git fetch -q origin 2>/dev/null || true
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
[ "$behind" != "0" ] && echo "  NOTE: origin/main is $behind commit(s) ahead of local HEAD — fetch/merge before deploying."
echo

rc=0

# Reports whether $rev contains every commit touching the given paths.
report() {
  local name="$1" rev="$2"; shift 2
  local paths=("$@")
  if [ -z "$rev" ]; then
    echo "$name: UNKNOWN (could not read deployed revision)"; rc=1; return
  fi
  if ! git cat-file -e "${rev}^{commit}" 2>/dev/null; then
    echo "$name: $rev — not a commit in this repo (deployed from elsewhere?)"; rc=1; return
  fi
  # commits between the deployed revision and HEAD that touch this target's paths
  local missing
  missing=$(git log --oneline "${rev}..HEAD" -- "${paths[@]}")
  local total
  total=$(git rev-list --count "${rev}..HEAD")
  if [ -z "$missing" ]; then
    if [ "$total" = "0" ]; then
      echo "$name: $rev — current"
    else
      echo "$name: $rev — current for what it serves ($total newer commit(s), none touching: ${paths[*]})"
    fi
  else
    echo "$name: $rev — STALE, missing $(echo "$missing" | wc -l) commit(s) it serves:"
    echo "$missing" | sed 's/^/    /'
    rc=1
  fi
}

# Cloudflare Pages: the build id is stamped into the client bundle at build time.
js=$(curl -fsS --max-time 20 "$PAGES_URL/" | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
pages_rev=""
if [ -n "$js" ]; then
  pages_rev=$(curl -fsS --max-time 20 "$PAGES_URL$js" | grep -o '"[0-9a-f]\{7\}"' | tr -d '"' | head -1)
fi
report "Pages client" "$pages_rev" "${PAGES_PATHS[@]}"

# Linode: deploy-api.sh writes the revision it shipped. /api/health only returns
# {"ok":true} and does NOT carry the revision, so this needs ssh.
linode_rev=$(timeout 25 ssh -o BatchMode=yes -o ConnectTimeout=10 "$LINODE_HOST" \
  'cat /opt/aa-api/REVISION 2>/dev/null' 2>/dev/null | tr -d '[:space:]')
if [ -z "$linode_rev" ]; then
  echo "Linode API: UNKNOWN (ssh to $LINODE_HOST failed; run from John's machine)"
  rc=1
else
  report "Linode API " "$linode_rev" "${LINODE_PATHS[@]}"
  state=$(timeout 20 ssh -o BatchMode=yes -o ConnectTimeout=10 "$LINODE_HOST" 'systemctl is-active aa-api' 2>/dev/null | tr -d '[:space:]')
  [ "$state" = "active" ] || { echo "  aa-api.service is '$state', not active"; rc=1; }
fi

echo
[ $rc -eq 0 ] && echo "deploy check PASS" || echo "deploy check FAIL — see above"
exit $rc
