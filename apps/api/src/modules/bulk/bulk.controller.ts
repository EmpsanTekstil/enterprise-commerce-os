import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import type { Response } from 'express';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { BulkService } from './bulk.service';

class ApplyDto { @IsArray() rows: Record<string, string | number | null>[] }
const KINDS = ['products', 'prices', 'stock'] as const;
type Kind = (typeof KINDS)[number];

@ApiTags('bulk')
@ApiBearerAuth()
@Controller('bulk')
export class BulkController {
  constructor(private svc: BulkService) {}

  @Get(':kind/template') @RequirePermissions('products.read')
  template(@Param('kind') kind: Kind, @Res() res: Response) {
    if (!KINDS.includes(kind)) return res.status(404).json({ message: 'Bilinmeyen şablon' });
    const names: Record<Kind, string> = { products: 'urun-yukleme-sablonu.xlsx', prices: 'fiyat-guncelleme-sablonu.xlsx', stock: 'stok-guncelleme-sablonu.xlsx' };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${names[kind]}"`);
    return res.send(this.svc.template(kind));
  }

  @Post(':kind/preview') @RequirePermissions('products.read')
  @ApiConsumes('multipart/form-data') @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  preview(@CurrentUser() u: JwtPayload, @Param('kind') kind: Kind, @UploadedFile() file: Express.Multer.File) {
    if (!file) return { rows: [], total: 0, valid: 0, invalid: 0, unknownColumns: [], message: 'Dosya seçilmedi' };
    if (kind === 'prices') return this.svc.previewPrices(u, file.buffer);
    if (kind === 'stock') return this.svc.previewStock(u, file.buffer);
    return this.svc.previewProducts(u, file.buffer);
  }

  @Post('products/apply') @RequirePermissions('products.write')
  applyProducts(@CurrentUser() u: JwtPayload, @Body() dto: ApplyDto) { return this.svc.applyProducts(u, dto.rows); }

  @Post('prices/apply') @RequirePermissions('pricing.write')
  applyPrices(@CurrentUser() u: JwtPayload, @Body() dto: ApplyDto) { return this.svc.applyPrices(u, dto.rows); }

  @Post('stock/apply') @RequirePermissions('inventory.write')
  applyStock(@CurrentUser() u: JwtPayload, @Body() dto: ApplyDto) { return this.svc.applyStock(u, dto.rows); }
}
