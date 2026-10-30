import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { PrivacyService } from './privacy.service';

class RetentionDto {
  @IsOptional() @IsInt() @Min(1) @Max(3650) piiMaskAfterDays?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(3650) rawPurgeAfterDays?: number | null;
}

@ApiTags('privacy')
@ApiBearerAuth()
@Controller('privacy')
export class PrivacyController {
  constructor(private svc: PrivacyService) {}

  @Get('retention') @RequirePermissions('settings.write')
  get(@CurrentUser() u: JwtPayload) { return this.svc.getSettings(u.organizationId); }

  /** Boş/null gönderilen alan kapatılır. */
  @Put('retention') @RequirePermissions('settings.write')
  update(@CurrentUser() u: JwtPayload, @Body() d: RetentionDto) { return this.svc.updateSettings(u, { piiMaskAfterDays: d.piiMaskAfterDays ?? null, rawPurgeAfterDays: d.rawPurgeAfterDays ?? null }); }

  @Get('retention/preview') @RequirePermissions('settings.write')
  preview(@CurrentUser() u: JwtPayload) { return this.svc.preview(u.organizationId); }

  /** Elle çalıştır (geri alınamaz). */
  @Post('retention/run') @RequirePermissions('settings.write')
  run(@CurrentUser() u: JwtPayload) { return this.svc.run(u.organizationId, u); }
}
