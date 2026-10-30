#!/usr/bin/env bash
# Yedekten geri yükleme. Kullanım: ./infra/restore.sh backups/eco-YYYYMMDD-HHMMSS.dump
# DİKKAT: mevcut veritabanının üzerine yazar. Önce API'yi durdurun: docker compose stop api
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Yedek dosyası verin}"
USER_="${POSTGRES_USER:-eco}"; DB="${POSTGRES_DB:-eco}"
read -r -p "'$DB' veritabanı '$FILE' ile DEĞİŞTİRİLECEK. Devam? (evet/hayır) " ok; [ "$ok" = "evet" ] || exit 1
docker compose exec -T postgres pg_restore -U "$USER_" -d "$DB" --clean --if-exists --no-owner < "$FILE"
echo "Geri yükleme tamam."
