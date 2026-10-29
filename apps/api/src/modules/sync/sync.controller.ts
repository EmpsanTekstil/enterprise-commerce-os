import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { ChannelsService } from '../channels/channels.service';
import { SyncQueue } from './sync.queue';
import { SyncService } from './sync.service';

const TYPES = ['CATEGORY_PULL', 'PRODUCT_PULL', 'ORDER_PULL', 'STOCK_PUSH', 'PRICE_PUSH'] as const;

class RunSyncDto {
  @IsEnum(TYPES) type: (typeof TYPES)[number];
  @IsOptional() @IsArray() @IsString({ each: true }) variantIds?: string[];
}

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private sync: SyncService, private queue: SyncQueue, private channels: ChannelsService) {}

  @Post('accounts/:id/run') @RequirePermissions('listings.write')
  async run(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: RunSyncDto) {
    await this.channels.getOwned(u, id); // sahiplik kontrolü
    return this.queue.enqueue(id, dto.type, { variantIds: dto.variantIds });
  }

  @Get('jobs') @RequirePermissions('listings.read')
  jobs(@CurrentUser() u: JwtPayload, @Query('accountId') accountId?: string) {
    return this.sync.listJobs(u.organizationId, accountId);
  }

  @Get('mode') @RequirePermissions('listings.read')
  mode() { return { mode: this.queue.mode }; }
}
