import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { CreateProductDto, ProductListQuery, UpdateProductDto, VariantDto } from './products.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: JwtPayload, q: ProductListQuery) {
    const where: Prisma.ProductWhereInput = {
      organizationId: user.organizationId,
      status: q.status,
      brand: q.brand,
      categoryId: q.categoryId,
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { brand: { contains: q.q, mode: 'insensitive' } },
              { variants: { some: { OR: [{ sku: { contains: q.q, mode: 'insensitive' } }, { barcode: { contains: q.q } }] } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, path: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: { include: { balances: true, listings: { select: { id: true, status: true, channelAccountId: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(
      items.map((p) => ({
        ...p,
        totalStock: p.variants.reduce((s, v) => s + v.balances.reduce((a, b) => a + b.onHand - b.reserved, 0), 0),
        listingCount: p.variants.reduce((s, v) => s + v.listings.length, 0),
      })),
      total,
      q,
    );
  }

  async get(user: JwtPayload, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        attributes: true,
        variants: {
          include: {
            balances: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
            listings: { include: { channelAccount: { select: { id: true, label: true, channel: { select: { code: true, name: true } } } } } },
          },
        },
      },
    });
    if (!product) throw new NotFoundException('Ürün bulunamadı');
    return product;
  }

  async create(user: JwtPayload, dto: CreateProductDto) {
    await this.assertUniqueSkus(user.organizationId, dto.variants);
    const defaultWarehouse = await this.getOrCreateDefaultWarehouse(user.organizationId);

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          organizationId: user.organizationId,
          name: dto.name,
          brand: dto.brand,
          model: dto.model,
          categoryId: dto.categoryId,
          description: dto.description,
          shortDescription: dto.shortDescription,
          specsJson: (dto.specs ?? {}) as Prisma.InputJsonValue,
          packageContent: dto.packageContent,
          warrantyMonths: dto.warrantyMonths,
          originCountry: dto.originCountry,
          vatRate: dto.vatRate ?? 20,
          status: dto.status ?? 'DRAFT',
        },
      });
      for (const v of dto.variants) {
        const variant = await tx.productVariant.create({ data: { productId: created.id, ...this.variantData(v) } });
        await tx.inventoryBalance.create({
          data: { warehouseId: defaultWarehouse.id, variantId: variant.id, onHand: v.initialStock ?? 0 },
        });
        if (v.initialStock && v.initialStock > 0) {
          await tx.inventoryMovement.create({
            data: {
              warehouseId: defaultWarehouse.id,
              variantId: variant.id,
              type: 'ADJUSTMENT',
              quantity: v.initialStock,
              referenceKey: `product-create:${variant.id}`,
              note: 'Açılış stoğu',
              createdById: user.sub,
            },
          });
        }
      }
      return created;
    });
    await this.audit.log(user, 'product.create', 'Product', product.id, null, { name: dto.name, variants: dto.variants.length });
    return this.get(user, product.id);
  }

  async update(user: JwtPayload, id: string, dto: UpdateProductDto) {
    const before = await this.get(user, id);
    if (dto.variants) await this.assertUniqueSkus(user.organizationId, dto.variants, id);
    const { variants, specs, ...rest } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { ...rest, specsJson: specs as Prisma.InputJsonValue | undefined },
      });
      if (variants) {
        for (const v of variants) {
          if (v.id) await tx.productVariant.update({ where: { id: v.id }, data: this.variantData(v) });
          else await tx.productVariant.create({ data: { productId: id, ...this.variantData(v) } });
        }
      }
    });
    await this.audit.log(user, 'product.update', 'Product', id, { name: before.name, status: before.status }, rest);
    return this.get(user, id);
  }

  async archive(user: JwtPayload, id: string) {
    await this.get(user, id);
    await this.prisma.product.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await this.audit.log(user, 'product.archive', 'Product', id);
    return { ok: true };
  }

  /** Yayına hazırlık kontrolü: eksik alanları listeler (kanal zorunlulukları ileride eklenecek). */
  async readinessCheck(user: JwtPayload, id: string) {
    const p = await this.get(user, id);
    const missing: string[] = [];
    if (!p.brand) missing.push('Marka');
    if (!p.categoryId) missing.push('Kategori');
    if (!p.description || p.description.length < 30) missing.push('Açıklama (en az 30 karakter)');
    if (p.images.length === 0) missing.push('En az 1 ürün görseli');
    for (const v of p.variants) {
      if (!v.barcode) missing.push(`Barkod (${v.sku})`);
      if (v.listPrice == null) missing.push(`Satış fiyatı (${v.sku})`);
    }
    return { ready: missing.length === 0, missing };
  }

  private variantData(v: VariantDto) {
    return {
      sku: v.sku.trim(),
      barcode: v.barcode?.trim() || null,
      color: v.color,
      size: v.size,
      dimensions: v.dimensions,
      weightGrams: v.weightGrams,
      material: v.material,
      costPrice: v.costPrice,
      listPrice: v.listPrice,
      isActive: v.isActive ?? true,
    };
  }

  private async assertUniqueSkus(organizationId: string, variants: VariantDto[], excludeProductId?: string) {
    const skus = variants.map((v) => v.sku.trim());
    if (new Set(skus).size !== skus.length) throw new ConflictException('Aynı üründe tekrar eden SKU var');
    const clash = await this.prisma.productVariant.findFirst({
      where: { sku: { in: skus }, product: { organizationId, id: excludeProductId ? { not: excludeProductId } : undefined } },
      select: { sku: true },
    });
    if (clash) throw new ConflictException(`SKU zaten kullanımda: ${clash.sku}`);
  }

  private async getOrCreateDefaultWarehouse(organizationId: string) {
    const existing = await this.prisma.warehouse.findFirst({ where: { organizationId, isDefault: true } });
    if (existing) return existing;
    return this.prisma.warehouse.create({ data: { organizationId, name: 'Ana Depo', code: 'MAIN', isDefault: true } });
  }
}
