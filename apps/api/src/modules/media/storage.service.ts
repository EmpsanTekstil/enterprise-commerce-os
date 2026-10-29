import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Dosya depolama: S3_ENDPOINT tanımlıysa S3/MinIO, değilse yerel disk (apps/api/storage, /media altında sunulur).
 * Üretimde S3 önerilir; yerel disk tek sunuculu küçük kurulumlar ve test içindir.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private s3?: S3Client;
  readonly mode: 's3' | 'local';
  readonly localRoot = process.env.LOCAL_STORAGE_DIR ?? join(process.cwd(), 'storage');
  readonly publicBase = (process.env.MEDIA_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}/media`).replace(/\/$/, '');

  constructor() {
    if (process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.STORAGE_MODE !== 'local') {
      this.mode = 's3';
      this.s3 = new S3Client({
        endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? 'eu-central-1', forcePathStyle: true,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
      });
    } else {
      this.mode = 'local';
      this.log.warn(`S3 yapılandırılmadı: dosyalar yerel diske yazılacak (${this.localRoot})`);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    if (this.mode === 's3' && this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'eco-media', Key: key, Body: body, ContentType: contentType }));
      const base = (process.env.S3_PUBLIC_URL ?? `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET ?? 'eco-media'}`).replace(/\/$/, '');
      return `${base}/${key}`;
    }
    const path = join(this.localRoot, key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, body);
    return `${this.publicBase}/${key}`;
  }

  async remove(key: string) {
    try {
      if (this.mode === 's3' && this.s3) await this.s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'eco-media', Key: key }));
      else await unlink(join(this.localRoot, key));
    } catch (e) { this.log.warn(`Silinemedi ${key}: ${(e as Error).message}`); }
  }
}
