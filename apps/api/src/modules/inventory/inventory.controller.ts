import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { InventoryService } from './inventory.service';

class BalanceQuery extends PaginationQuery { @IsOptional() @IsString() warehouseId?: string; @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() lowOnly?: boolean }
class WarehouseDto { @IsString() @MaxLength(80) name: string; @IsString() @MaxLength(20) code: string; @IsOptional() @IsString() address?: string; @IsOptional() @IsBoolean() isDefault?: boolean }
class AdjustDto { @IsString() variantId: string; @IsString() warehouseId: string; @IsOptional() @IsInt() @Min(0) quantity?: number; @IsOptional() @IsInt() delta?: number; @IsOptional() @IsInt() @Min(0) reorderPoint?: number; @IsOptional() @IsString() @MaxLength(200) note?: string }
class PolicyDto { @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) sharePercent?: number; @IsOptional() @IsInt() @Min(0) bufferQuantity?: number; @IsOptional() @IsInt() @Min(0) maxQuantity?: number | null; @IsOptional() @IsBoolean() autoPush?: boolean }

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}

  @Get('warehouses') @RequirePermissions('inventory.read') warehouses(@CurrentUser() u: JwtPayload) { return this.svc.warehouses(u); }
  @Post('warehouses') @RequirePermissions('inventory.write') createWarehouse(@CurrentUser() u: JwtPayload, @Body() d: WarehouseDto) { return this.svc.createWarehouse(u, d); }
  @Get('balances') @RequirePermissions('inventory.read') balances(@CurrentUser() u: JwtPayload, @Query() q: BalanceQuery) { return this.svc.balances(u, q); }
  @Post('adjust') @RequirePermissions('inventory.write') adjust(@CurrentUser() u: JwtPayload, @Body() d: AdjustDto) { return this.svc.adjust(u, d); }
  @Get('movements/:variantId') @RequirePermissions('inventory.read') movements(@CurrentUser() u: JwtPayload, @Param('variantId') v: string) { return this.svc.movements(u, v); }
  @Get('policies') @RequirePermissions('inventory.read') policies(@CurrentUser() u: JwtPayload) { return this.svc.policies(u); }
  @Put('policies/:accountId') @RequirePermissions('inventory.write') setPolicy(@CurrentUser() u: JwtPayload, @Param('accountId') a: string, @Body() d: PolicyDto) { return this.svc.setPolicy(u, a, d); }
  @Get('reconciliation') @RequirePermissions('inventory.read') reconciliation(@CurrentUser() u: JwtPayload) { return this.svc.reconciliation(u); }
}
