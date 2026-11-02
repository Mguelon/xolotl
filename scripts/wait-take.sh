#!/usr/bin/env bash
# Follows a take through the app until it ends, as an open page does: the app stores a finished take's result in
# data/takes/<id>/ when it is asked for the job, so a take sent from a page that was then closed needs this.
#   usage: scripts/wait-take.sh <job id> [app url, default http://127.0.0.1:3011]
# Prints one line when the take reaches a final state (succeeded, failed, cancelled, error, expired) and exits.
set -euo pipefail
J="${1:?usage: $0 <job id> [app url]}"
APP="${2:-http://127.0.0.1:3011}"
while true; do
  s=$(curl -s --max-time 20 "$APP/api/jobs/$J" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
  case "$s" in succeeded|failed|cancelled|canceled|error|expired) echo "take $J: $s at $(date +%H:%M:%S)"; exit 0 ;; esac
  sleep 20
done
