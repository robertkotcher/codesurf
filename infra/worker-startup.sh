#!/bin/bash
set -eu
# Unique keys on every clone. Publish through authenticated Compute API.
rm -f /etc/ssh/ssh_host_*key*
ssh-keygen -A
printf 'GatewayPorts clientspecified\n' > /etc/ssh/sshd_config.d/codesurf.conf
systemctl restart ssh
curl -fsS -X PUT -H 'Metadata-Flavor: Google' --data-binary @/etc/ssh/ssh_host_ed25519_key.pub http://metadata.google.internal/computeMetadata/v1/instance/guest-attributes/codesurf/hostkey
