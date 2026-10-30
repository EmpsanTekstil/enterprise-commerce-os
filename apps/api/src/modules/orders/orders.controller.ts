import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { OrdersService } from './orders.service';

class FulfillDto { @IsIn(['picking', 'invoiced', 'shipped']) action: 'picking' | 'invoiced' | 'shipped'; @IsOptional() @IsString() @MaxLength(50) invoiceNumber?: string; @IsOptional() @IsString() @MaxLength(50) trackingNumber?: string; @IsOptional() @IsString() @MaxLength(40) carrierCode?: string }

class OrderQuery extends PaginationQuery {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private svc: OrdersService) {}

  @Get() @RequirePermissions('orders.read')
  list(@CurrentUser() u: JwtPayload, @Query() q: OrderQuery) { return this.svc.list(u, q); }

  @Post(':id/fulfill') @RequirePermissions('orders.write')
  fulfill(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: FulfillDto) { return this.svc.fulfill(u, id, d.action, d.invoiceNumber, d.trackingNumber, d.carrierCode); }

  /** Kanal kargo etiketi (PDF/ZPL, base64 ya da bağlantı). */
  @Get(':id/label') @RequirePermissions('orders.write')
  label(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.label(u, id); }

  @Get(':id') @RequirePermissions('orders.read')
  get(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.get(u, id); }
}
