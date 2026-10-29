import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { ReturnsService } from './returns.service';

class ReturnQuery extends PaginationQuery { @IsOptional() @IsString() status?: string; @IsOptional() @IsString() accountId?: string }
class ApproveDto { @IsOptional() @IsArray() @IsString({ each: true }) claimItemIds?: string[] }
class RejectDto { @IsString() reasonId: string; @IsString() @MaxLength(500) description: string; @IsOptional() @IsArray() @IsString({ each: true }) claimItemIds?: string[] }
class RestockDto { @IsOptional() @IsString() warehouseCode?: string }

@ApiTags('returns')
@ApiBearerAuth()
@Controller('returns')
export class ReturnsController {
  constructor(private svc: ReturnsService) {}

  @Get() @RequirePermissions('orders.read') list(@CurrentUser() u: JwtPayload, @Query() q: ReturnQuery) { return this.svc.list(u, q); }
  @Get('reject-reasons/:accountId') @RequirePermissions('orders.read') reasons(@CurrentUser() u: JwtPayload, @Param('accountId') a: string) { return this.svc.rejectReasons(u, a); }
  @Post(':id/approve') @RequirePermissions('orders.write') approve(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: ApproveDto) { return this.svc.approve(u, id, d.claimItemIds); }
  @Post(':id/reject') @RequirePermissions('orders.write') reject(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: RejectDto) { return this.svc.reject(u, id, d.reasonId, d.description, d.claimItemIds); }
  @Post(':id/restock') @RequirePermissions('inventory.write') restock(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: RestockDto) { return this.svc.restock(u, id, d.warehouseCode); }
}
