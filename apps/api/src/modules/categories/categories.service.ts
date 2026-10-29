import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { ChannelsService } from '../channels/channels.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService, private audit: AuditService, private channels: ChannelsService, private registry: AdapterRegistry) {}

  // ---------- İç kategori ağacı ----------
  tree(user: JwtPayload) {
    return this.prisma.category.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ path: 'asc' }, { sortOrder: 'asc' }], include: { _count: { select: { products: true } }, mappings: { select: { channelAccountId: true, channelCategoryId: true } } } });
  }

  async create(user: JwtPayload, name: string, parentId?: string) {
    let path = name.trim();
    if (parentId) {
      const parent = await this.prisma.category.findFirst({ where: { id: parentId, organizationId: user.organizationId } });
      if (!parent) throw new NotFoundException('Üst kategori bulunamadı');
      path = `${parent.path} > ${path}`;
    }
    const c = await this.prisma.category.create({ data: { organizationId: user.organizationId, parentId, name: name.trim(), path } });
    await this.audit.log(user, 'category.create', 'Category', c.id, null, { path });
    return c;
  }

  async rename(user: JwtPayload, id: string, name: string) {
    const c = await this.prisma.category.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!c) throw new NotFoundException('Kategori bulunamadı');
    const newPath = c.path.includes(' > ') ? `${c.path.slice(0, c.path.lastIndexOf(' > '))} > ${name.trim()}` : name.trim();
    // Alt kategorilerin yollarını da güncelle
    const children = await this.prisma.category.findMany({ where: { organizationId: user.organizationId, path: { startsWith: `${c.path} > ` } } });
    await this.prisma.$transaction([
      this.prisma.category.update({ where: { id }, data: { name: name.trim(), path: newPath } }),
      ...children.map((ch) => this.prisma.category.update({ where: { id: ch.id }, data: { path: newPath + ch.path.slice(c.path.length) } })),
    ]);
    return this.prisma.category.findUnique({ where: { id } });
  }

  async remove(user: JwtPayload, id: string) {
    const c = await this.prisma.category.findFirst({ where: { id, organizationId: user.organizationId }, include: { _count: { select: { products: true, children: true } } } });
    if (!c) throw new NotFoundException('Kategori bulunamadı');
    if (c._count.products || c._count.children) throw new BadRequestException('Ürünü veya alt kategorisi olan kategori silinemez');
    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Kanal kategorileri ----------
  async searchChannelCategories(user: JwtPayload, accountId: string, q: string, leafOnly = true) {
    await this.channels.getOwned(user, accountId);
    return this.prisma.channelCategory.findMany({
      where: { channelAccountId: accountId, isLeaf: leafOnly ? true : undefined, ...(q ? { path: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { path: 'asc' }, take: 50,
    });
  }

  /** Kanal kategorisinin özellik tanımlarını getirir; önbellekte yoksa adaptörden çeker ve saklar. */
  async channelCategoryAttributes(user: JwtPayload, accountId: string, channelCategoryId: string, refresh = false) {
    const account = await this.channels.getOwned(user, accountId);
    const cat = await this.prisma.channelCategory.findFirst({ where: { id: channelCategoryId, channelAccountId: accountId } });
    if (!cat) throw new NotFoundException('Kanal kategorisi bulunamadı');
    if (cat.attributesJson && !refresh) return cat.attributesJson;
    const adapter = this.registry.get(account.channel.code);
    if (!adapter.fetchCategoryAttributes) return null;
    const attrs = await adapter.fetchCategoryAttributes(this.channels.buildContext(account), cat.externalId);
    await this.prisma.channelCategory.update({ where: { id: cat.id }, data: { attributesJson: attrs as Prisma.InputJsonValue, fetchedAt: new Date() } });
    return attrs;
  }

  // ---------- Eşleştirme ----------
  async map(user: JwtPayload, categoryId: string, accountId: string, channelCategoryId: string, attributeMap?: Record<string, unknown>) {
    const [cat, cc] = await Promise.all([
      this.prisma.category.findFirst({ where: { id: categoryId, organizationId: user.organizationId } }),
      this.prisma.channelCategory.findFirst({ where: { id: channelCategoryId, channelAccountId: accountId, channelAccount: { organizationId: user.organizationId } } }),
    ]);
    if (!cat || !cc) throw new NotFoundException('Kategori veya kanal kategorisi bulunamadı');
    if (!cc.isLeaf) throw new BadRequestException('Yalnızca en alt seviye (yaprak) kanal kategorisi seçilebilir');
    const m = await this.prisma.categoryMapping.upsert({
      where: { categoryId_channelAccountId: { categoryId, channelAccountId: accountId } },
      update: { channelCategoryId, attributeMapJson: (attributeMap ?? {}) as Prisma.InputJsonValue },
      create: { categoryId, channelAccountId: accountId, channelCategoryId, attributeMapJson: (attributeMap ?? {}) as Prisma.InputJsonValue },
      include: { channelCategory: true },
    });
    await this.audit.log(user, 'category.map', 'CategoryMapping', m.id, null, { categoryId, accountId, channelCategoryId });
    return m;
  }

  async mappings(user: JwtPayload, accountId: string) {
    await this.channels.getOwned(user, accountId);
    return this.prisma.categoryMapping.findMany({ where: { channelAccountId: accountId }, include: { category: true, channelCategory: true } });
  }
}
