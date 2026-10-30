#!/bin/bash
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq caddy curl ca-certificates xz-utils git openssh-client
curl -fsS https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o /tmp/node-checksums
node_archive=$(awk '$2 ~ /linux-x64.tar.xz$/ {print $2}' /tmp/node-checksums)
curl -fsS "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "/tmp/$node_archive"
(cd /tmp && sha256sum --check --ignore-missing node-checksums)
tar -xJf "/tmp/$node_archive" --strip-components=1 -C /usr/local
command -v gcloud >/dev/null || { curl -fsS https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar -xz -C /opt; ln -s /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud; }
id codesurf >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/codesurf --shell /bin/bash codesurf
install -d -o codesurf -g codesurf -m 700 /var/lib/codesurf/runs /var/lib/codesurf/ssh
sudo -u codesurf test -f /var/lib/codesurf/ssh/worker || sudo -u codesurf ssh-keygen -t ed25519 -N '' -f /var/lib/codesurf/ssh/worker >/dev/null
cat > /etc/systemd/system/codesurf.service <<'UNIT'
[Unit]
Description=CodeSurf run controller
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=codesurf
Group=codesurf
WorkingDirectory=/opt/codesurf
EnvironmentFile=/etc/codesurf.env
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=3
TimeoutStopSec=150
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/codesurf
ProtectHome=true
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/Caddyfile <<'CADDY'
runner.codesurf.io {
  reverse_proxy 127.0.0.1:5179 {
    flush_interval -1
  }
}
CADDY
systemctl daemon-reload
systemctl enable codesurf caddy
systemctl restart caddy
