import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AutomationService } from './automation.service';
import { NotificationsService } from './notifications.service';

class RuleDto { @IsString() @MaxLength(80) name: string; @IsString() trigger: string; @IsOptional() @IsObject() condition?: Record<string, unknown>; @IsOptional() @IsBoolean() isEnabled?: boolean }
class ToggleDto { @IsBoolean() isEnabled: boolean }
class ReadDto { @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[] }

@ApiTags('automation')
@ApiBearerAuth()
@Controller()
export class AutomationController {
  constructor(private svc: AutomationService, private notes: NotificationsService) {}
  @Get('automations/triggers') @RequirePermissions('automations.write') triggers() { return this.svc.triggers(); }
  @Get('automations') @RequirePermissions('automations.write') rules(@CurrentUser() u: JwtPayload) { return this.svc.rules(u); }
  @Post('automations') @RequirePermissions('automations.write') create(@CurrentUser() u: JwtPayload, @Body() d: RuleDto) { return this.svc.save(u, d); }
  @Put('automations/:id') @RequirePermissions('automations.write') update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: RuleDto) { return this.svc.save(u, d, id); }
  @Post('automations/:id/toggle') @RequirePermissions('automations.write') toggle(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: ToggleDto) { return this.svc.toggle(u, id, d.isEnabled); }
  @Delete('automations/:id') @RequirePermissions('automations.write') remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.remove(u, id); }
  @Post('automations/install-defaults') @RequirePermissions('automations.write') defaults(@CurrentUser() u: JwtPayload) { return this.svc.installDefaults(u); }
  @Post('automations/evaluate') @RequirePermissions('automations.write') evaluate() { return this.svc.evaluateAll(); }

  @Get('notifications') @RequirePermissions('dashboard.read') list(@CurrentUser() u: JwtPayload, @Query('unread') unread?: string) { return this.notes.list(u, unread === '1'); }
  @Get('notifications/unread-count') @RequirePermissions('dashboard.read') unread(@CurrentUser() u: JwtPayload) { return this.notes.unreadCount(u); }
  @Post('notifications/read') @RequirePermissions('dashboard.read') read(@CurrentUser() u: JwtPayload, @Body() d: ReadDto) { return this.notes.markRead(u, d.ids); }
}
