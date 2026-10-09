#!/usr/bin/env bash
set -euo pipefail
cd /opt/ami-clickup-assistant
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U ami -d ami_assistant -Fc > "backups/ami-${stamp}.dump"
find backups -type f -name 'ami-*.dump' -mtime +7 -delete
