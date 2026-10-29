import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { ListingsService } from './listings.service';
import { PublishService } from './publish.service';

class ListingQuery extends PaginationQuery {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() status?: string;
}
class LinkDto { @IsString() variantId: string }
class PublishDto { @IsString() accountId: string; @IsArray() @ArrayMinSize(1) @IsString({ each: true }) variantIds: string[] }
class UpdateListingDto {
  @IsOptional() @IsString() @MaxLength(100) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsNumber() @Min(0) salePrice?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) imageOrder?: string[];
}
class AcceptDto {
  @IsString() accountId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(100) minConfidence?: number;
}

@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings')
export class ListingsController {
  constructor(private svc: ListingsService, private pub: PublishService) {}

  @Get() @RequirePermissions('listings.read')
  list(@CurrentUser() u: JwtPayload, @Query() q: ListingQuery) { return this.svc.list(u, q); }

  @Post(':id/link') @RequirePermissions('listings.write')
  link(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: LinkDto) { return this.svc.link(u, id, dto.variantId); }

  @Post(':id/create-product') @RequirePermissions('products.write')
  createProduct(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.createProductFromListing(u, id); }

  @Post('prepare') @RequirePermissions('listings.read')
  prepare(@CurrentUser() u: JwtPayload, @Body() dto: PublishDto) { return this.pub.prepare(u, dto.accountId, dto.variantIds); }

  @Post('publish') @RequirePermissions('listings.write')
  publish(@CurrentUser() u: JwtPayload, @Body() dto: PublishDto) { return this.pub.publish(u, dto.accountId, dto.variantIds); }

  @Patch(':id') @RequirePermissions('listings.write')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: UpdateListingDto) { return this.pub.updateListing(u, id, dto); }

  @Post('accept-suggestions') @RequirePermissions('listings.write')
  accept(@CurrentUser() u: JwtPayload, @Body() dto: AcceptDto) { return this.svc.acceptSuggestions(u, dto.accountId, dto.minConfidence); }
}
