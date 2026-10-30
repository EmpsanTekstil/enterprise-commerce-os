import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { FinanceService } from './finance.service';

class RangeQuery { @IsOptional() @IsDateString() from?: string; @IsOptional() @IsDateString() to?: string }
const range = (q: RangeQuery) => { const to = q.to ? new Date(q.to) : new Date(); const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86_400_000); return { from, to }; };

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private svc: FinanceService) {}
  @Get('summary') @RequirePermissions('finance.read') summary(@CurrentUser() u: JwtPayload, @Query() q: RangeQuery) { return this.svc.summary(u, range(q)); }
  @Get('channels') @RequirePermissions('finance.read') channels(@CurrentUser() u: JwtPayload, @Query() q: RangeQuery) { return this.svc.channels(u, range(q)); }
  @Get('products') @RequirePermissions('finance.read') products(@CurrentUser() u: JwtPayload, @Query() q: RangeQuery) { return this.svc.products(u, range(q)); }
  @Get('stock-turnover') @RequirePermissions('finance.read') turnover(@CurrentUser() u: JwtPayload, @Query() q: RangeQuery) { return this.svc.stockTurnover(u, range(q)); }
  @Get('export') @RequirePermissions('finance.read')
  async exportXlsx(@CurrentUser() u: JwtPayload, @Query() q: RangeQuery, @Res() res: Response) {
    const r = range(q); const buf = await this.svc.exportXlsx(u, r);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="rapor-${r.from.toISOString().slice(0, 10)}-${r.to.toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  }
}
