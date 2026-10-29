import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Kanal API anahtarlarını veritabanında AES-256-GCM ile şifreler.
 * Anahtar yalnızca sunucu ortam değişkeninden (CREDENTIALS_ENCRYPTION_KEY) okunur.
 * Saklanan format: base64(iv) . base64(authTag) . base64(ciphertext)
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const hex = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        'CREDENTIALS_ENCRYPTION_KEY 64 karakterlik hex olmalı (openssl rand -hex 32).',
      );
    }
    this.key = Buffer.from(hex, 'hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, encB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !encB64) throw new Error('Geçersiz şifreli veri formatı');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptJson(obj: unknown): string {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptJson<T = Record<string, unknown>>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }

  /** Arayüzde göstermek için: "ab12****ef" */
  static mask(value: string | undefined | null): string {
    if (!value) return '';
    if (value.length <= 6) return '****';
    return `${value.slice(0, 3)}****${value.slice(-2)}`;
  }
}
