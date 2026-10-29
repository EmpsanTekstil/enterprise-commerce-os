/**
 * Başlangıç verisi: yetkiler, kanal kataloğu, ilk organizasyon ve yönetici.
 * Çalıştırma: npm run db:seed  (ortam: ADMIN_EMAIL, ADMIN_PASSWORD, ORG_NAME)
 * Demo verisi istenirse: SEED_DEMO=1
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, PERMISSIONS } from '../src/modules/auth/permissions.catalog';

const prisma = new PrismaClient();

const CHANNELS = [
  { code: 'trendyol', name: 'Trendyol', kind: 'MARKETPLACE' },
  { code: 'hepsiburada', name: 'Hepsiburada', kind: 'MARKETPLACE' },
  { code: 'amazon_tr', name: 'Amazon Türkiye', kind: 'MARKETPLACE' },
  { code: 'n11', name: 'n11', kind: 'MARKETPLACE' },
  { code: 'idefix', name: 'idefix', kind: 'MARKETPLACE' },
  { code: 'shopify', name: 'Shopify', kind: 'STOREFRONT' },
] as const;

async function main() {
  // 1) Yetkiler
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }

  // 2) Kanal kataloğu (+ test kanalı yalnızca test/mock modunda)
  const channels = [...CHANNELS, ...(process.env.ENABLE_MOCK_CHANNEL === '1' || process.env.NODE_ENV === 'test' ? [{ code: 'mock', name: 'Test Kanalı', kind: 'OTHER' } as const] : [])];
  for (const c of channels) {
    await prisma.salesChannel.upsert({ where: { code: c.code }, update: { name: c.name, kind: c.kind }, create: c });
  }

  // 3) Organizasyon + roller
  const orgName = process.env.ORG_NAME ?? 'Mağazam';
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'magazam';
  const org = await prisma.organization.upsert({ where: { slug }, update: {}, create: { name: orgName, slug } });

  const perms = await prisma.permission.findMany();
  const permByKey = new Map(perms.map((p) => [p.key, p.id]));
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: r.key } },
      update: { name: r.name },
      create: { organizationId: org.id, key: r.key, name: r.name, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: r.permissions.map((k) => ({ roleId: role.id, permissionId: permByKey.get(k)! })),
    });
  }

  // 4) Yönetici kullanıcı
  const email = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'Admin123!';
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: 'admin' } } });
  const user = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email } },
    update: {},
    create: { organizationId: org.id, email, fullName: 'Yönetici', passwordHash: await bcrypt.hash(password, 10) },
  });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: adminRole.id } }, update: {}, create: { userId: user.id, roleId: adminRole.id } });

  // 5) Varsayılan depo
  await prisma.warehouse.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
    update: {},
    create: { organizationId: org.id, code: 'MAIN', name: 'Ana Depo', isDefault: true },
  });

  // 6) İsteğe bağlı demo verisi (isDemo=true ile işaretli, gerçek veriden ayrı)
  if (process.env.SEED_DEMO === '1') {
    const demo = await prisma.product.create({
      data: {
        organizationId: org.id, name: 'DEMO - Pamuklu Tişört', brand: 'DemoMarka', status: 'ACTIVE', isDemo: true,
        description: 'Bu bir demo üründür. Gerçek veri değildir. Kataloğu test etmek için eklenmiştir.',
        specsJson: { Malzeme: '%100 Pamuk', Kalıp: 'Regular' },
        variants: { create: [
          { sku: 'DEMO-TS-S', barcode: '8690000000011', size: 'S', color: 'Siyah', costPrice: 120, listPrice: 299 },
          { sku: 'DEMO-TS-M', barcode: '8690000000012', size: 'M', color: 'Siyah', costPrice: 120, listPrice: 299 },
        ] },
      },
      include: { variants: true },
    });
    const wh = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: org.id, isDefault: true } });
    for (const v of demo.variants) {
      await prisma.inventoryBalance.upsert({ where: { warehouseId_variantId: { warehouseId: wh.id, variantId: v.id } }, update: {}, create: { warehouseId: wh.id, variantId: v.id, onHand: 25, reorderPoint: 5 } });
    }
    console.log('Demo ürün eklendi (isDemo=true).');
  }

  console.log(`Seed tamam. Organizasyon: ${org.name}  Yönetici: ${email}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
