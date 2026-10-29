import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { OrdersService } from './orders.service';

class FulfillDto { @IsIn(['picking', 'invoiced']) action: 'picking' | 'invoiced'; @IsOptional() @IsString() @MaxLength(50) invoiceNumber?: string; @IsOptional() @IsString() @MaxLength(50) trackingNumber?: string }

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
  fulfill(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: FulfillDto) { return this.svc.fulfill(u, id, d.action, d.invoiceNumber, d.trackingNumber); }

  @Get(':id') @RequirePermissions('orders.read')
  get(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.get(u, id); }
}
