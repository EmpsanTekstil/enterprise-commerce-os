import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { buildProductContext, PRODUCT_CONTENT_SYSTEM } from './ai.prompts';
import { AiService } from './ai.service';

class ApplyContentDto { @IsOptional() @IsString() title?: string; @IsOptional() @IsString() description?: string; @IsOptional() @IsBoolean() toProduct?: boolean; @IsOptional() @IsString() listingId?: string }

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private ai: AiService, private prisma: PrismaService, private audit: AuditService) {}

  @Get('status') @RequirePermissions('ai.use')
  async status(@CurrentUser() u: JwtPayload, @Query('days') days?: string) {
    const from = new Date(Date.now() - Number(days ?? 30) * 86_400_000);
    return this.ai.usage(u.organizationId, from);
  }

  @Get('history') @RequirePermissions('ai.use') history(@CurrentUser() u: JwtPayload) { return this.ai.history(u.organizationId); }

  /** Ürün başlığı + açıklama + SEO anahtar kelimeleri önerisi. Uygulanmaz; kullanıcı inceler. */
  @Post('products/:id/content') @RequirePermissions('ai.use', 'products.read')
  async productContent(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { channel?: string }) {
    const p = await this.prisma.product.findFirst({ where: { id, organizationId: u.organizationId }, include: { category: true, variants: true } });
    if (!p) return { error: 'Ürün bulunamadı' };
    const r = await this.ai.complete(u, u.organizationId, 'product_content', PRODUCT_CONTENT_SYSTEM, `HEDEF KANAL: ${body?.channel ?? 'genel pazaryeri'}\n\nÜRÜN BİLGİLERİ:\n${buildProductContext(p)}`, 1200);
    try { return { ...JSON.parse(r.text.replace(/^```json|```$/g, '').trim()), costUsd: r.costUsd, requestId: r.requestId }; }
    catch { return { title: null, description: r.text, seoKeywords: [], missingInfo: [], costUsd: r.costUsd, requestId: r.requestId, note: 'Model yapılandırılmış yanıt vermedi; metin ham hâliyle gösteriliyor.' }; }
  }

  /** Önerilen içeriği kullanıcı onayıyla ürüne veya kanal ilanına yazar. */
  @Post('products/:id/content/apply') @RequirePermissions('ai.use', 'products.write')
  async apply(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: ApplyContentDto) {
    const p = await this.prisma.product.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!p) return { error: 'Ürün bulunamadı' };
    if (d.listingId) {
      const l = await this.prisma.listing.findFirst({ where: { id: d.listingId, channelAccount: { organizationId: u.organizationId } } });
      if (!l) return { error: 'İlan bulunamadı' };
      await this.prisma.listing.update({ where: { id: l.id }, data: { title: d.title?.slice(0, 100), description: d.description } });
    } else {
      await this.prisma.product.update({ where: { id }, data: { name: d.title ?? undefined, description: d.description ?? undefined } });
    }
    await this.audit.log(u, 'ai.content_apply', d.listingId ? 'Listing' : 'Product', d.listingId ?? id, { name: p.name }, { title: d.title, descriptionLength: d.description?.length });
    return { ok: true };
  }

  /** Veri kalitesi: AI gerektirmeyen kural tabanlı kontrol. */
  @Get('data-quality') @RequirePermissions('products.read')
  async dataQuality(@CurrentUser() u: JwtPayload) {
    const products = await this.prisma.product.findMany({ where: { organizationId: u.organizationId, status: { not: 'ARCHIVED' } }, include: { variants: { select: { sku: true, barcode: true, listPrice: true, costPrice: true, weightGrams: true } }, images: { select: { id: true } }, category: { select: { id: true } } } });
    const issues: { productId: string; name: string; problems: string[] }[] = [];
    for (const p of products) {
      const pr: string[] = [];
      if (!p.brand) pr.push('Marka yok');
      if (!p.categoryId) pr.push('Kategori yok');
      if (!p.description || p.description.length < 30) pr.push('Açıklama kısa/yok');
      if (p.images.length === 0) pr.push('Görsel yok');
      if (Object.keys((p.specsJson as object) ?? {}).length === 0) pr.push('Teknik özellik yok');
      for (const v of p.variants) {
        if (!v.barcode) pr.push(`Barkod yok (${v.sku})`);
        if (v.listPrice == null) pr.push(`Fiyat yok (${v.sku})`);
        if (v.costPrice == null) pr.push(`Maliyet yok (${v.sku}) — kârlılık hesaplanamaz`);
        if (v.weightGrams == null) pr.push(`Ağırlık yok (${v.sku}) — desi hesaplanamaz`);
      }
      if (pr.length) issues.push({ productId: p.id, name: p.name, problems: pr });
    }
    return { checked: products.length, withIssues: issues.length, items: issues.slice(0, 200) };
  }
}
