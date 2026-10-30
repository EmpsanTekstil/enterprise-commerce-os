#!/usr/bin/env bash
# PostgreSQL yedeği (docker compose ile). Kullanım: ./infra/backup.sh [hedef_klasör]
# Cron örneği (her gece 03:00): 0 3 * * * /opt/enterprise-commerce-os/infra/backup.sh /opt/yedek >> /var/log/eco-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-./backups}"; mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
USER_="${POSTGRES_USER:-eco}"; DB="${POSTGRES_DB:-eco}"
docker compose exec -T postgres pg_dump -U "$USER_" -d "$DB" --format=custom > "$DEST/eco-$STAMP.dump"
# 30 günden eski yedekleri sil
find "$DEST" -name 'eco-*.dump' -mtime +30 -delete
echo "Yedek alındı: $DEST/eco-$STAMP.dump ($(du -h "$DEST/eco-$STAMP.dump" | cut -f1))"
