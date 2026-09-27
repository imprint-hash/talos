#!/bin/bash
# Runs the public watch from the owner's machine: one check every 15 minutes,
# then the log is pushed to the `watch` branch, which the website reads.
# The SERV key stays in .env on this machine; no wallet key is used.
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=../talos-watch
[ -d "$W" ] || { git worktree add --detach "$W" >/dev/null && (cd "$W" && git checkout -q --orphan watch && git rm -rfq .); }
while true; do
  node bin/watch.mjs --log "$W/watch-log.json"
  # One commit, amended each time, so the branch never grows.
  (cd "$W" && git add watch-log.json && { git rev-parse -q --verify HEAD >/dev/null && git commit -q --amend -m "watch $(date -u +%FT%TZ)" || git commit -qm "watch $(date -u +%FT%TZ)"; } && git push -fq origin HEAD:watch)
  sleep $(( 900 - $(date +%s) % 900 ))
done
