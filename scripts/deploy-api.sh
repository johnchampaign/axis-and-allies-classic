#!/usr/bin/env bash
# npm run deploy:api — ship the A&A API to John's Linode (CLAUDE.md "API on
# the Linode"). Needs SSH as root to the Linode, so it runs from
# John's machine; a cloud session cannot deploy the API.
#
# Bundles server/linode.ts to one self-contained file (no npm install on
# the box), copies it to /opt/aa-api, restarts aa-api.service, and checks
# /api/health both on the box and through the tunnel. The previous bundle is
# kept as aa-api.prev.mjs; to roll back:
#   ssh root@$HOST 'cp /opt/aa-api/aa-api.prev.mjs /opt/aa-api/aa-api.mjs && systemctl restart aa-api'
set -euo pipefail
HOST="${AA_API_HOST:-root@172.232.14.119}"
PUBLIC="${AA_API_ORIGIN:-https://aa-api.johnchampaign.com}"

npm run build:api
rev=$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- src functions server package.json package-lock.json || echo '+dirty')
echo "deploying A&A API $rev to $HOST"
scp -q dist-api/aa-api.mjs "$HOST:/opt/aa-api/aa-api.next.mjs"
ssh "$HOST" "set -e; cd /opt/aa-api
  [ -f aa-api.mjs ] && cp aa-api.mjs aa-api.prev.mjs
  mv aa-api.next.mjs aa-api.mjs && echo '$rev' > REVISION
  systemctl restart aa-api
  for i in \$(seq 20); do curl -fsS http://127.0.0.1:8393/api/health >/dev/null 2>&1 && break; sleep 0.5; done
  curl -fsS http://127.0.0.1:8393/api/health"
echo
curl -fsS "$PUBLIC/api/health" && echo && echo "A&A API $rev live at $PUBLIC"
