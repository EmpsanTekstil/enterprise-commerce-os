import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  beforeAll(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('şifreler ve geri çözer', () => {
    const svc = new CryptoService();
    const secret = JSON.stringify({ apiKey: 'abc', apiSecret: 'xyz' });
    const enc = svc.encrypt(secret);
    expect(enc).not.toContain('abc');
    expect(svc.decrypt(enc)).toBe(secret);
  });

  it('aynı metin için her seferinde farklı çıktı üretir (rastgele IV)', () => {
    const svc = new CryptoService();
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('kurcalanmış veriyi reddeder', () => {
    const svc = new CryptoService();
    const enc = svc.encrypt('gizli');
    const parts = enc.split('.');
    parts[2] = Buffer.from('bozuk').toString('base64');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('maskeleme', () => {
    expect(CryptoService.mask('1234567890')).toBe('123****90');
    expect(CryptoService.mask('ab')).toBe('****');
  });
});
