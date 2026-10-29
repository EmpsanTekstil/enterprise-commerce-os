import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { CreateProductDto, ProductListQuery, UpdateProductDto } from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private svc: ProductsService) {}

  @Get() @RequirePermissions('products.read')
  list(@CurrentUser() u: JwtPayload, @Query() q: ProductListQuery) { return this.svc.list(u, q); }

  @Get(':id') @RequirePermissions('products.read')
  get(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.get(u, id); }

  @Get(':id/readiness') @RequirePermissions('products.read')
  readiness(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.readinessCheck(u, id); }

  @Post() @RequirePermissions('products.write')
  create(@CurrentUser() u: JwtPayload, @Body() dto: CreateProductDto) { return this.svc.create(u, dto); }

  @Patch(':id') @RequirePermissions('products.write')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: UpdateProductDto) { return this.svc.update(u, id, dto); }

  @Delete(':id') @RequirePermissions('products.write')
  archive(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.archive(u, id); }
}
