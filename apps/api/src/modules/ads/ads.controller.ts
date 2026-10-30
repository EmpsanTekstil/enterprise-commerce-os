import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { AiService } from '../ai/ai.service';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AdsService } from './ads.service';

class RangeQuery { @IsOptional() @IsDateString() from?: string; @IsOptional() @IsDateString() to?: string; @IsOptional() @Type(() => Number) @IsNumber() targetAcos?: number }
class UpdateDto { @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) status?: 'ACTIVE' | 'PAUSED'; @IsOptional() @IsNumber() @Min(0) dailyBudget?: number }
const range = (q: RangeQuery) => { const to = q.to ? new Date(q.to) : new Date(); const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86_400_000); return { from, to }; };

const ADS_AI_SYSTEM = `Sen bir pazaryeri reklam analistisin. Verilen kampanya metriklerinden (harcama, satış, ROAS, ACOS, CTR, dönüşüm) Türkçe, kısa ve somut öneriler üret.
KURALLAR: Yalnızca verilen rakamlara dayan; rakam uydurma. Her öneri bir kampanyayı ve bir eylemi (durdur / bütçe azalt % / bütçe artır % / ürün çıkar / içerik iyileştir) adlandırsın. Bütçeyi değiştirmeyi yalnızca ÖNER; uygulanacağını varsayma. En fazla 8 madde, madde başına 1-2 cümle. Yetersiz veri varsa bunu söyle.`;

@ApiTags('ads')
@ApiBearerAuth()
@Controller('ads')
export class AdsController {
  constructor(private svc: AdsService, private ai: AiService) {}
  @Get('dashboard') @RequirePermissions('ads.read') dashboard(@CurrentUser() u: JwtPayload, @Query() q: RangeQuery) { const r = range(q); return this.svc.dashboard(u, r.from, r.to); }
  @Get('analysis') @RequirePermissions('ads.read') analysis(@CurrentUser() u: JwtPayload, @Query() q: RangeQuery) { const r = range(q); return this.svc.analysis(u, r.from, r.to, q.targetAcos ?? 25); }
  @Post('import/:accountId') @RequirePermissions('ads.write') @ApiConsumes('multipart/form-data') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  import(@CurrentUser() u: JwtPayload, @Param('accountId') a: string, @UploadedFile() file: Express.Multer.File) { return this.svc.importSheet(u, a, file.buffer); }
  @Post('campaigns/:id') @RequirePermissions('ads.write') update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: UpdateDto) { return this.svc.updateCampaign(u, id, d); }
  @Post('ai-analysis') @RequirePermissions('ads.read', 'ai.use')
  async aiAnalysis(@CurrentUser() u: JwtPayload, @Body() q: RangeQuery) {
    const r = range(q); const d = await this.svc.dashboard(u, r.from, r.to);
    const lines = d.campaigns.slice(0, 40).map((c) => `${c.campaign.name} [${c.campaign.channel}] harcama ${c.spend.toFixed(0)}₺, satış ${c.sales.toFixed(0)}₺, sipariş ${c.orders}, ROAS ${c.roas.toFixed(2)}, ACOS ${c.acos == null ? '—' : c.acos.toFixed(1) + '%'}, CTR ${c.ctr.toFixed(2)}%, dönüşüm ${c.conversion.toFixed(1)}%, günlük bütçe ${c.campaign.dailyBudget ?? '—'}`);
    if (!lines.length) return { text: 'Analiz için reklam verisi yok. Önce rapor içe aktarın veya Amazon Ads bağlayın.', costUsd: 0 };
    const res = await this.ai.complete(u, u.organizationId, 'ads_analyze', ADS_AI_SYSTEM, `Hedef ACOS: %${q.targetAcos ?? 25}\nDönem: ${r.from.toISOString().slice(0, 10)} – ${r.to.toISOString().slice(0, 10)}\n\nKAMPANYALAR:\n${lines.join('\n')}`, 900);
    return { text: res.text, costUsd: res.costUsd };
  }
}
