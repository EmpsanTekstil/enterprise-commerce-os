import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { CreateChannelAccountDto, UpdateChannelAccountDto } from './channels.dto';
import { ChannelsService } from './channels.service';

@ApiTags('channels')
@ApiBearerAuth()
@Controller('channels')
export class ChannelsController {
  constructor(private svc: ChannelsService) {}

  @Get() listChannels() { return this.svc.listChannels(); }

  @Get('accounts') listAccounts(@CurrentUser() u: JwtPayload) { return this.svc.listAccounts(u); }

  @Post('accounts') @RequirePermissions('integrations.write')
  create(@CurrentUser() u: JwtPayload, @Body() dto: CreateChannelAccountDto) { return this.svc.createAccount(u, dto); }

  @Patch('accounts/:id') @RequirePermissions('integrations.write')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: UpdateChannelAccountDto) { return this.svc.updateAccount(u, id, dto); }

  @Delete('accounts/:id') @RequirePermissions('integrations.write')
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.deleteAccount(u, id); }

  @Post('accounts/:id/test') @RequirePermissions('integrations.write')
  test(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.testConnection(u, id); }
}
