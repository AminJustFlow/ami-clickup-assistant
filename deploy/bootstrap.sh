#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker fail2ban unattended-upgrades
usermod -aG docker ubuntu
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
mkdir -p /opt/ami-clickup-assistant/backups
chown -R ubuntu:ubuntu /opt/ami-clickup-assistant
cat >/etc/cron.d/ami-disk-monitor <<'EOF'
*/10 * * * * root test $(df --output=pcent / | tail -1 | tr -dc '0-9') -lt 85 || logger -p daemon.err 'ami-assistant disk usage above 85 percent'
EOF
