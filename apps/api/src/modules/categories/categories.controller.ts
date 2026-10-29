import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { CategoriesService } from './categories.service';

class CreateDto { @IsString() @MaxLength(120) name: string; @IsOptional() @IsString() parentId?: string }
class RenameDto { @IsString() @MaxLength(120) name: string }
class MapDto { @IsString() categoryId: string; @IsString() accountId: string; @IsString() channelCategoryId: string; @IsOptional() @IsObject() attributeMap?: Record<string, unknown> }
class SearchQuery {
  @IsString() accountId: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Transform(({ value }) => value !== 'false') @IsBoolean() leafOnly?: boolean;
}

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private svc: CategoriesService) {}

  @Get() @RequirePermissions('products.read') tree(@CurrentUser() u: JwtPayload) { return this.svc.tree(u); }
  @Post() @RequirePermissions('products.write') create(@CurrentUser() u: JwtPayload, @Body() d: CreateDto) { return this.svc.create(u, d.name, d.parentId); }
  @Patch(':id') @RequirePermissions('products.write') rename(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: RenameDto) { return this.svc.rename(u, id, d.name); }
  @Delete(':id') @RequirePermissions('products.write') remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.remove(u, id); }

  @Get('channel/search') @RequirePermissions('listings.read')
  search(@CurrentUser() u: JwtPayload, @Query() q: SearchQuery) { return this.svc.searchChannelCategories(u, q.accountId, q.q ?? '', q.leafOnly ?? true); }

  @Get('channel/:accountId/:channelCategoryId/attributes') @RequirePermissions('listings.read')
  attrs(@CurrentUser() u: JwtPayload, @Param('accountId') a: string, @Param('channelCategoryId') c: string, @Query('refresh') refresh?: string) { return this.svc.channelCategoryAttributes(u, a, c, refresh === '1'); }

  @Get('channel/:accountId/:channelCategoryId/attributes/:attributeId/values') @RequirePermissions('listings.read')
  values(@CurrentUser() u: JwtPayload, @Param('accountId') a: string, @Param('channelCategoryId') c: string, @Param('attributeId') at: string) { return this.svc.attributeValues(u, a, c, at); }

  @Get('mappings/:accountId') @RequirePermissions('listings.read')
  mappings(@CurrentUser() u: JwtPayload, @Param('accountId') a: string) { return this.svc.mappings(u, a); }

  @Post('mappings') @RequirePermissions('listings.write')
  map(@CurrentUser() u: JwtPayload, @Body() d: MapDto) { return this.svc.map(u, d.categoryId, d.accountId, d.channelCategoryId, d.attributeMap); }
}
