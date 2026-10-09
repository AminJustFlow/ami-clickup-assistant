#!/usr/bin/env bash
set -euo pipefail
cd /opt/ami-clickup-assistant
umask 077
set -a
source /tmp/ami-source.env
set +a
postgres_password=$(openssl rand -hex 24)
auth_password=$(openssl rand -hex 16)
cat >.env.production <<EOF
POSTGRES_PASSWORD=${postgres_password}
DATABASE_URL=postgresql://ami:${postgres_password}@postgres:5432/ami_assistant
APP_DOMAIN=ami.34.224.54.213.sslip.io
APP_URL=https://ami.34.224.54.213.sslip.io
APP_AUTH_USER=ami
APP_AUTH_PASSWORD=${auth_password}
CLICKUP_API_TOKEN=${CLICKUP_API_TOKEN}
CLICKUP_WORKSPACE_ID=${CLICKUP_WORKSPACE_ID}
CLICKUP_WEBHOOK_SECRET=${CLICKUP_WEBHOOK_SECRET}
OPENAI_API_KEY=${OPENAI_API_KEY}
OPENAI_INTELLIGENCE_MODEL=gpt-5.6-luna
CLICKUP_SYNC_INTERVAL_MINUTES=15
CLICKUP_SYNC_CONCURRENCY=2
AI_DAILY_BUDGET_USD=2.00
AI_BATCH_BUDGET_USD=0.50
AI_MAX_ATTEMPTS_PER_CYCLE=10
AI_MAX_JOB_RETRIES=3
AI_INPUT_USD_PER_MILLION=0.20
AI_OUTPUT_USD_PER_MILLION=1.20
AI_WORKER_INTERVAL_SECONDS=60
AI_MAX_INPUT_TOKENS_PER_TASK=20000
AI_MAX_OUTPUT_TOKENS_PER_TASK=2000
EOF
chmod 600 .env.production
chown ubuntu:ubuntu .env.production
rm -f /tmp/ami-source.env
printf '%s' "${auth_password}" > /home/ubuntu/ami-initial-password.txt
chmod 600 /home/ubuntu/ami-initial-password.txt
