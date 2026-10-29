import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { StorageService } from './storage.service';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 2000;       // pazaryerleri için güvenli üst sınır
const MIN_EDGE = 500;        // çoğu pazaryerinin alt sınırı

@Injectable()
export class MediaService {
  constructor(private prisma: PrismaService, private storage: StorageService, private audit: AuditService) {}

  /** Görseli doğrular, gerekirse küçültür, depolar ve ürüne (veya varyanta) sıranın sonuna ekler. */
  async uploadProductImage(user: JwtPayload, productId: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }, variantId?: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId: user.organizationId }, select: { id: true } });
    if (!product) throw new NotFoundException('Ürün bulunamadı');
    if (!ALLOWED.has(file.mimetype)) throw new BadRequestException('Yalnızca JPEG, PNG veya WebP yüklenebilir');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Görsel 8 MB sınırını aşıyor');

    let img = sharp(file.buffer, { failOn: 'error' }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new BadRequestException('Görsel okunamadı');
    if (Math.min(meta.width, meta.height) < MIN_EDGE) throw new BadRequestException(`Görselin kısa kenarı en az ${MIN_EDGE}px olmalı (şu an ${meta.width}×${meta.height})`);
    if (Math.max(meta.width, meta.height) > MAX_EDGE) img = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside' });
    const out = await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });

    const key = `org/${user.organizationId}/products/${productId}/${uuid()}.jpg`;
    const url = await this.storage.put(key, out.data, 'image/jpeg');
    const last = await this.prisma.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    const image = await this.prisma.productImage.create({
      data: { organizationId: user.organizationId, productId, variantId, storageKey: key, url, width: out.info.width, height: out.info.height, sizeBytes: out.info.size, sortOrder: (last?.sortOrder ?? -1) + 1, altText: file.originalname },
    });
    await this.audit.log(user, 'product.image_upload', 'ProductImage', image.id, null, { productId, bytes: out.info.size });
    return image;
  }

  async reorder(user: JwtPayload, productId: string, imageIds: string[]) {
    const images = await this.prisma.productImage.findMany({ where: { productId, organizationId: user.organizationId }, select: { id: true } });
    const known = new Set(images.map((i) => i.id));
    if (imageIds.length !== known.size || !imageIds.every((id) => known.has(id))) throw new BadRequestException('Sıralama listesi ürünün görselleriyle eşleşmiyor');
    await this.prisma.$transaction(imageIds.map((id, i) => this.prisma.productImage.update({ where: { id }, data: { sortOrder: i } })));
    return this.prisma.productImage.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });
  }

  async remove(user: JwtPayload, imageId: string) {
    const img = await this.prisma.productImage.findFirst({ where: { id: imageId, organizationId: user.organizationId } });
    if (!img) throw new NotFoundException('Görsel bulunamadı');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.remove(img.storageKey);
    await this.audit.log(user, 'product.image_delete', 'ProductImage', imageId, { productId: img.productId });
    return { ok: true };
  }
}
