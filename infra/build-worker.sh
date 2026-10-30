#!/bin/bash
set -eu
apt-get update -qq
apt-get install -y -qq docker.io
systemctl enable --now docker
# Controller deploys only a public key; no Google identity or credentials on workers.
getent group docker >/dev/null
useradd -m -s /bin/bash -G docker codesurf || usermod -aG docker codesurf
cd /tmp/codesurf-runner
docker build -t codesurf-runner:local .
rm -rf /tmp/codesurf-runner
# Remove the builder's login keys before imaging.
rm -f /home/*/.ssh/authorized_keys /root/.ssh/authorized_keys
