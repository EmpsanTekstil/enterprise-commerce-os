# Canlıya Alma Rehberi (tek sunucu, Docker)

Hedef: Ubuntu 22.04+ bir VPS (2 vCPU / 4 GB RAM yeterli başlangıç), bir alan adı (örn. `panel.firmam.com`).

## 1. Sunucu hazırlığı
```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER && newgrp docker
sudo mkdir -p /opt && sudo chown $USER /opt && cd /opt
git clone https://github.com/EmpsanTekstil/enterprise-commerce-os.git && cd enterprise-commerce-os
cp .env.example .env
```

## 2. `.env` üretim değerleri
```
POSTGRES_PASSWORD=<uzun rastgele>
JWT_SECRET=<openssl rand -hex 32>
CREDENTIALS_ENCRYPTION_KEY=<openssl rand -hex 32>   # 64 karakter; kaybolursa kanal anahtarları çözülemez — yedekleyin
DOMAIN=panel.firmam.com
NEXT_PUBLIC_API_URL=https://panel.firmam.com
PUBLIC_API_URL=https://panel.firmam.com
CORS_ORIGIN=https://panel.firmam.com
S3_PUBLIC_URL=https://panel.firmam.com/media           # MinIO'yu dışa açmak yerine görselleri ters vekilden sunmak için aşağıya bakın
ANTHROPIC_API_KEY=<isteğe bağlı>
```
DNS'te `panel.firmam.com` → sunucu IP'si (A kaydı). Caddy sertifikayı otomatik alır.

## 3. Başlat
```bash
docker compose --profile app --profile prod up -d --build
docker compose exec api sh -c "ADMIN_EMAIL=sen@firmam.com ADMIN_PASSWORD='GucluSifre!' ORG_NAME='Firmam' node -e \"require('child_process').execSync('npx ts-node --transpile-only prisma/seed.ts',{stdio:'inherit'})\""
```
Seed alternatifi (daha basit): sunucuda Node varsa `npm install && ADMIN_EMAIL=... npm run db:seed`.

Kontrol: `https://panel.firmam.com/api/v1/health` → `{"status":"ok"}`; panel `https://panel.firmam.com`.

## 4. Görseller (kanala yayın için zorunlu)
Pazaryerleri görsel için herkese açık HTTPS URL ister. İki yol:
- **MinIO + alt alan adı:** `media.firmam.com` → Caddy'de `reverse_proxy minio:9000`, `.env`'de `S3_PUBLIC_URL=https://media.firmam.com/eco-media`; MinIO konsolunda `eco-media` kovasını "public read" yapın.
- **Yerel disk:** `STORAGE_MODE=local`; görseller `/media/*` üzerinden Caddy ile sunulur (`MEDIA_PUBLIC_URL=https://panel.firmam.com/media`). Tek sunucu için en kolayı budur.

## 5. Yedekleme
```bash
./infra/backup.sh /opt/yedek          # elle
crontab -e  →  0 3 * * * /opt/enterprise-commerce-os/infra/backup.sh /opt/yedek >> /var/log/eco-backup.log 2>&1
```
Yedekler sunucu dışına da kopyalanmalı (rclone ile bir bulut diske). `.env` dosyasını da ayrı ve güvenli yedekleyin.
Geri yükleme: `docker compose stop api && ./infra/restore.sh /opt/yedek/eco-....dump && docker compose start api`.

## 6. Güncelleme
```bash
cd /opt/enterprise-commerce-os && git pull && docker compose --profile app --profile prod up -d --build
```
Migration'lar API başlarken otomatik uygulanır.

## 7. Güvenlik kontrol listesi
- Sunucuda yalnızca 22/80/443 açık (`ufw allow 22,80,443/tcp && ufw enable`); 5432/6379/9000 dışarı kapalı (compose'daki port eşlemelerini üretimde kaldırın).
- Yönetici hesabı dışında personele en dar rol; ilk girişte şifre değiştirme.
- `CREDENTIALS_ENCRYPTION_KEY` ve veritabanı yedekleri ayrı yerlerde.
- Trendyol webhook: Entegrasyonlar → Webhook anahtarı → Partner panelinde `https://panel.firmam.com/api/v1/webhooks/trendyol/<hesapId>` + API_KEY.
