#!/bin/bash
# Deploy reviewed local sources. Keeps /etc/codesurf.env and evidence untouched.
set -eu
project=codesurf-prod-20261030
archive=$(mktemp -t codesurf-release.XXXXXX)
trap 'rm -f "$archive"' EXIT
COPYFILE_DISABLE=1 tar --exclude='./.env*' --exclude='./.git' --exclude='./node_modules' --exclude='./.vercel' --exclude='./.codesurf' --exclude='./.agents' --exclude='./skills-lock.json' --exclude='./.DS_Store' -czf "$archive" .
args=(--zone=us-central1-a --project="$project" --tunnel-through-iap --quiet)
if [ -n "${CODESURF_DEPLOY_SSH_KEY:-}" ]; then args+=(--ssh-key-file="$CODESURF_DEPLOY_SSH_KEY"); fi
gcloud compute scp "$archive" codesurf-controller:/tmp/codesurf-release.tgz "${args[@]}"
gcloud compute ssh codesurf-controller "${args[@]}" --command='sudo tar -xzf /tmp/codesurf-release.tgz -C /opt/codesurf && cd /opt/codesurf && sudo npm ci --omit=dev && sudo systemctl restart codesurf'
