import { createHash, randomBytes, timingSafeEqual } from 'crypto';
export function sha256(v: string) { return createHash('sha256').update(v).digest('hex'); }
export function newWebhookKey() { return randomBytes(24).toString('hex'); }
export function safeEqual(a: string, b: string) { const ba = Buffer.from(a); const bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
