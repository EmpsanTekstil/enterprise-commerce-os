import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { OrdersService } from './orders.service';

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

  @Get(':id') @RequirePermissions('orders.read')
  get(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.get(u, id); }
}
