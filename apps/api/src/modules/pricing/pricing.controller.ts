import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { PricingService } from './pricing.service';

class RuleDto {
  @IsString() @MaxLength(80) name: string; @IsOptional() @IsString() channelAccountId?: string | null;
  @IsNumber() @Min(0) @Max(100) commissionPercent: number; @IsNumber() @Min(0) shippingCost: number; @IsNumber() @Min(0) packagingCost: number;
  @IsNumber() @Min(0) @Max(100) otherCostPercent: number; @IsNumber() @Min(0) @Max(95) targetMarginPercent: number;
  @IsOptional() @IsNumber() @Min(0) minPrice?: number | null; @IsOptional() @IsNumber() @Min(0) maxPrice?: number | null;
  @IsOptional() @IsBoolean() requireApproval?: boolean; @IsOptional() @IsBoolean() isActive?: boolean;
}
class GenDto { @IsOptional() @IsString() channelAccountId?: string; @IsOptional() @IsNumber() @Min(0) minDiffPercent?: number }
class DecideDto { @IsArray() @ArrayMinSize(1) @IsString({ each: true }) ids: string[] }

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private svc: PricingService) {}
  @Get('rules') @RequirePermissions('pricing.read') rules(@CurrentUser() u: JwtPayload) { return this.svc.rules(u); }
  @Post('rules') @RequirePermissions('pricing.write') create(@CurrentUser() u: JwtPayload, @Body() d: RuleDto) { return this.svc.saveRule(u, d); }
  @Put('rules/:id') @RequirePermissions('pricing.write') update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: RuleDto) { return this.svc.saveRule(u, d, id); }
  @Delete('rules/:id') @RequirePermissions('pricing.write') remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.deleteRule(u, id); }
  @Get('products/:id') @RequirePermissions('pricing.read') product(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.productProfitability(u, id); }
  @Post('proposals/generate') @RequirePermissions('pricing.write') generate(@CurrentUser() u: JwtPayload, @Body() d: GenDto) { return this.svc.generateProposals(u, d.channelAccountId, d.minDiffPercent); }
  @Get('proposals') @RequirePermissions('pricing.read') proposals(@CurrentUser() u: JwtPayload, @Query('status') s?: string) { return this.svc.proposals(u, s || 'PENDING'); }
  @Post('proposals/approve') @RequirePermissions('pricing.write') approve(@CurrentUser() u: JwtPayload, @Body() d: DecideDto) { return this.svc.decide(u, d.ids, true); }
  @Post('proposals/reject') @RequirePermissions('pricing.write') reject(@CurrentUser() u: JwtPayload, @Body() d: DecideDto) { return this.svc.decide(u, d.ids, false); }
}
