import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { ListingsService } from './listings.service';

class ListingQuery extends PaginationQuery {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() status?: string;
}
class LinkDto { @IsString() variantId: string }
class AcceptDto {
  @IsString() accountId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(100) minConfidence?: number;
}

@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings')
export class ListingsController {
  constructor(private svc: ListingsService) {}

  @Get() @RequirePermissions('listings.read')
  list(@CurrentUser() u: JwtPayload, @Query() q: ListingQuery) { return this.svc.list(u, q); }

  @Post(':id/link') @RequirePermissions('listings.write')
  link(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: LinkDto) { return this.svc.link(u, id, dto.variantId); }

  @Post(':id/create-product') @RequirePermissions('products.write')
  createProduct(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.createProductFromListing(u, id); }

  @Post('accept-suggestions') @RequirePermissions('listings.write')
  accept(@CurrentUser() u: JwtPayload, @Body() dto: AcceptDto) { return this.svc.acceptSuggestions(u, dto.accountId, dto.minConfidence); }
}
