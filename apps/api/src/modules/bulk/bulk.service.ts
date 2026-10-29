import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { PRICE_COLUMNS, PRODUCT_COLUMNS, STOCK_COLUMNS } from './bulk.columns';
import { buildTemplate, ParsedRow, parseSheet } from './bulk.parser';

type Row = Record<string, string | number | null>;
const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));
const num = (v: unknown) => (v == null || v === '' ? undefined : Number(v));

@Injectable()
export class BulkService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  template(kind: 'products' | 'prices' | 'stock') {
    if (kind === 'products') return buildTemplate(PRODUCT_COLUMNS, { urun_grubu: 'TS-PAMUK', urun_adi: 'Pamuklu Tişört', marka: 'Markam', kategori: 'Giyim > Tişört', sku: 'TS-PAMUK-S-SIYAH', barkod: '8690000000001', renk: 'Siyah', beden: 'S', agirlik_gram: 180, alis_maliyeti: 120, satis_fiyati: 299, stok: 25, kdv: 10 });
    if (kind === 'prices') return buildTemplate(PRICE_COLUMNS, { sku: 'TS-PAMUK-S-SIYAH', satis_fiyati: 319, alis_maliyeti: 125 });
    return buildTemplate(STOCK_COLUMNS, { sku: 'TS-PAMUK-S-SIYAH', stok: 40, depo_kodu: 'MAIN' });
  }

  // ---------------- ÖNİZLEME ----------------
  async previewProducts(user: JwtPayload, buffer: Buffer) {
    const { rows, unknownColumns } = parseSheet(buffer, PRODUCT_COLUMNS);
    // Dosya içi tekrar eden SKU ve mevcut SKU kontrolü
    const seen = new Map<string, number>();
    const skus = rows.map((r) => str(r.data.sku)).filter(Boolean) as string[];
    const existing = new Set((await this.prisma.productVariant.findMany({ where: { sku: { in: skus }, product: { organizationId: user.organizationId } }, select: { sku: true } })).map((v) => v.sku));
    for (const r of rows) {
      const sku = str(r.data.sku);
      if (sku) {
        if (seen.has(sku)) r.errors.push(`SKU dosyada tekrar ediyor (satır ${seen.get(sku)})`); else seen.set(sku, r.row);
        (r as ParsedRow & { action?: string }).action = existing.has(sku) ? 'update' : 'create';
      }
      if (str(r.data.urun_adi) && String(r.data.urun_adi).length > 250) r.errors.push('Ürün adı 250 karakteri aşıyor');
    }
    return this.summary(rows, unknownColumns);
  }

  async previewPrices(user: JwtPayload, buffer: Buffer) {
    const { rows, unknownColumns } = parseSheet(buffer, PRICE_COLUMNS);
    await this.checkSkusExist(user, rows);
    for (const r of rows) if (r.data.satis_fiyati == null && r.data.alis_maliyeti == null) r.errors.push('En az bir fiyat alanı dolu olmalı');
    return this.summary(rows, unknownColumns);
  }

  async previewStock(user: JwtPayload, buffer: Buffer) {
    const { rows, unknownColumns } = parseSheet(buffer, STOCK_COLUMNS);
    await this.checkSkusExist(user, rows);
    const codes = [...new Set(rows.map((r) => str(r.data.depo_kodu)).filter(Boolean))] as string[];
    if (codes.length) {
      const wh = new Set((await this.prisma.warehouse.findMany({ where: { organizationId: user.organizationId, code: { in: codes } }, select: { code: true } })).map((w) => w.code));
      for (const r of rows) { const c = str(r.data.depo_kodu); if (c && !wh.has(c)) r.errors.push(`Depo bulunamadı: ${c}`); }
    }
    return this.summary(rows, unknownColumns);
  }

  private async checkSkusExist(user: JwtPayload, rows: ParsedRow[]) {
    const skus = rows.map((r) => str(r.data.sku)).filter(Boolean) as string[];
    const existing = new Set((await this.prisma.productVariant.findMany({ where: { sku: { in: skus }, product: { organizationId: user.organizationId } }, select: { sku: true } })).map((v) => v.sku));
    for (const r of rows) { const s = str(r.data.sku); if (s && !existing.has(s)) r.errors.push(`SKU bulunamadı: ${s}`); }
  }

  private summary(rows: ParsedRow[], unknownColumns: string[]) {
    const invalid = rows.filter((r) => r.errors.length).length;
    return { rows, total: rows.length, valid: rows.length - invalid, invalid, unknownColumns };
  }

  // ---------------- UYGULAMA ----------------
  /** Önizlemeden dönen satırlar (hatasız olanlar) uygulanır. Satırlar urun_grubu/urun_adi ile ürün bazında gruplanır. */
  async applyProducts(user: JwtPayload, rows: Row[]) {
    const importId = uuid();
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      if (!str(r.sku) || !str(r.urun_adi)) continue;
      const g = str(r.urun_grubu) ?? `name:${str(r.urun_adi)}`;
      groups.set(g, [...(groups.get(g) ?? []), r]);
    }
    const wh = await this.prisma.warehouse.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
    let created = 0, updated = 0, variantsCreated = 0, variantsUpdated = 0;
    const errors: { sku: string; error: string }[] = [];

    for (const [, grp] of groups) {
      const first = grp[0];
      try {
        const categoryId = str(first.kategori) ? await this.ensureCategory(user.organizationId, String(first.kategori)) : undefined;
        // Grup içindeki mevcut bir SKU varsa aynı ürüne bağlan
        const existingVariant = await this.prisma.productVariant.findFirst({ where: { sku: { in: grp.map((r) => String(r.sku)) }, product: { organizationId: user.organizationId } }, select: { productId: true } });
        const productData = {
          name: String(first.urun_adi), brand: str(first.marka), model: str(first.model), categoryId, description: str(first.aciklama), shortDescription: str(first.kisa_aciklama),
          packageContent: str(first.paket_icerigi), warrantyMonths: num(first.garanti_ay), originCountry: str(first.mensei), vatRate: num(first.kdv),
        };
        let productId: string;
        if (existingVariant) {
          productId = existingVariant.productId;
          await this.prisma.product.update({ where: { id: productId }, data: Object.fromEntries(Object.entries(productData).filter(([, v]) => v !== undefined)) });
          updated++;
        } else {
          productId = (await this.prisma.product.create({ data: { organizationId: user.organizationId, ...productData, vatRate: productData.vatRate ?? 20, status: 'ACTIVE' } })).id;
          created++;
        }
        for (const r of grp) {
          const v = { sku: String(r.sku), barcode: str(r.barkod) ?? null, color: str(r.renk), size: str(r.beden), dimensions: str(r.olcu), weightGrams: num(r.agirlik_gram), material: str(r.malzeme), costPrice: num(r.alis_maliyeti), listPrice: num(r.satis_fiyati) };
          const ex = await this.prisma.productVariant.findFirst({ where: { sku: v.sku, product: { organizationId: user.organizationId } } });
          if (ex) {
            await this.prisma.productVariant.update({ where: { id: ex.id }, data: Object.fromEntries(Object.entries(v).filter(([k, val]) => k !== 'sku' && val !== undefined)) });
            variantsUpdated++;
          } else {
            const nv = await this.prisma.productVariant.create({ data: { productId, ...v } });
            variantsCreated++;
            const stock = num(r.stok) ?? 0;
            if (wh) {
              await this.prisma.inventoryBalance.create({ data: { warehouseId: wh.id, variantId: nv.id, onHand: stock } });
              if (stock > 0) await this.prisma.inventoryMovement.create({ data: { warehouseId: wh.id, variantId: nv.id, type: 'ADJUSTMENT', quantity: stock, referenceKey: `bulk:${importId}:${v.sku}`, note: 'Toplu yükleme açılış stoğu', createdById: user.sub } });
            }
          }
        }
      } catch (e) {
        errors.push({ sku: String(first.sku), error: (e as Error).message });
      }
    }
    await this.audit.log(user, 'bulk.products', 'Product', importId, null, { created, updated, variantsCreated, variantsUpdated, errors: errors.length });
    return { importId, created, updated, variantsCreated, variantsUpdated, errors };
  }

  async applyPrices(user: JwtPayload, rows: Row[]) {
    let updated = 0; const errors: { sku: string; error: string }[] = [];
    const changes: { sku: string; before: unknown; after: unknown }[] = [];
    for (const r of rows) {
      const sku = str(r.sku); if (!sku) continue;
      const v = await this.prisma.productVariant.findFirst({ where: { sku, product: { organizationId: user.organizationId } } });
      if (!v) { errors.push({ sku, error: 'SKU bulunamadı' }); continue; }
      const data: Prisma.ProductVariantUpdateInput = {};
      if (r.satis_fiyati != null && r.satis_fiyati !== '') data.listPrice = Number(r.satis_fiyati);
      if (r.alis_maliyeti != null && r.alis_maliyeti !== '') data.costPrice = Number(r.alis_maliyeti);
      await this.prisma.productVariant.update({ where: { id: v.id }, data });
      changes.push({ sku, before: { listPrice: v.listPrice, costPrice: v.costPrice }, after: data });
      updated++;
    }
    await this.audit.log(user, 'bulk.prices', 'ProductVariant', undefined, null, { updated, changes: changes.slice(0, 200) });
    return { updated, errors };
  }

  /** Mutlak stok: hedef değer ile mevcut fark kadar ADJUSTMENT hareketi yazılır (hareket defteri bozulmaz). */
  async applyStock(user: JwtPayload, rows: Row[]) {
    const importId = uuid();
    let updated = 0; const errors: { sku: string; error: string }[] = [];
    for (const r of rows) {
      const sku = str(r.sku); if (!sku || r.stok == null || r.stok === '') continue;
      const v = await this.prisma.productVariant.findFirst({ where: { sku, product: { organizationId: user.organizationId } } });
      if (!v) { errors.push({ sku, error: 'SKU bulunamadı' }); continue; }
      const wh = await this.prisma.warehouse.findFirst({ where: { organizationId: user.organizationId, ...(str(r.depo_kodu) ? { code: String(r.depo_kodu) } : { isDefault: true }) } });
      if (!wh) { errors.push({ sku, error: `Depo bulunamadı: ${r.depo_kodu ?? 'MAIN'}` }); continue; }
      const target = Number(r.stok);
      await this.prisma.$transaction(async (tx) => {
        const bal = await tx.inventoryBalance.upsert({ where: { warehouseId_variantId: { warehouseId: wh.id, variantId: v.id } }, update: {}, create: { warehouseId: wh.id, variantId: v.id, onHand: 0 } });
        const diff = target - bal.onHand;
        if (diff !== 0) {
          await tx.inventoryMovement.create({ data: { warehouseId: wh.id, variantId: v.id, type: 'ADJUSTMENT', quantity: diff, referenceKey: `bulk:${importId}:${sku}`, note: `Toplu stok güncelleme (${bal.onHand} → ${target})`, createdById: user.sub } });
          await tx.inventoryBalance.update({ where: { id: bal.id }, data: { onHand: target } });
        }
      });
      updated++;
    }
    await this.audit.log(user, 'bulk.stock', 'InventoryBalance', importId, null, { updated, errors: errors.length });
    return { importId, updated, errors };
  }

  private async ensureCategory(organizationId: string, path: string) {
    const parts = path.split('>').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new BadRequestException('Geçersiz kategori yolu');
    let parentId: string | undefined; let fullPath = '';
    for (const name of parts) {
      fullPath = fullPath ? `${fullPath} > ${name}` : name;
      const ex = await this.prisma.category.findFirst({ where: { organizationId, path: fullPath } });
      parentId = ex ? ex.id : (await this.prisma.category.create({ data: { organizationId, parentId, name, path: fullPath } })).id;
    }
    return parentId!;
  }
}
