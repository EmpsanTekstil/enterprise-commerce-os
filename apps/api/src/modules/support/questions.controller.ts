import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { buildProductContext, QUESTION_ANSWER_SYSTEM } from '../ai/ai.prompts';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { QuestionsService } from './questions.service';

class QQuery extends PaginationQuery { @IsOptional() @IsString() status?: string; @IsOptional() @IsString() accountId?: string; @IsOptional() @IsString() productId?: string; @IsOptional() @IsString() assignedToId?: string }
class DraftDto { @IsString() @MinLength(1) @MaxLength(2000) text: string; @IsOptional() @IsIn(['HUMAN', 'TEMPLATE']) source?: 'HUMAN' | 'TEMPLATE' }
class SendDto { @IsString() responseId: string; @IsOptional() @IsBoolean() markOnly?: boolean }
class AssignDto { @IsOptional() @IsString() assignedToId?: string | null }
class TemplateDto { @IsString() @MaxLength(80) title: string; @IsString() @MaxLength(2000) body: string }

@ApiTags('questions')
@ApiBearerAuth()
@Controller('questions')
export class QuestionsController {
  constructor(private svc: QuestionsService, private ai: AiService, private prisma: PrismaService) {}

  @Get() @RequirePermissions('support.read') list(@CurrentUser() u: JwtPayload, @Query() q: QQuery) { return this.svc.list(u, q); }
  @Post(':id/assign') @RequirePermissions('support.write') assign(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: AssignDto) { return this.svc.assign(u, id, d.assignedToId ?? null); }
  @Post(':id/draft') @RequirePermissions('support.write') draft(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: DraftDto) { return this.svc.draft(u, id, d.text, d.source); }
  @Post(':id/send') @RequirePermissions('support.write') send(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: SendDto) { return this.svc.send(u, id, d.responseId, d.markOnly); }
  @Post(':id/close') @RequirePermissions('support.write') close(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.close(u, id); }

  /** AI taslak: yalnızca ürün kataloğundaki doğrulanmış bilgilerle; gönderilmez, taslak olarak kaydedilir. */
  @Post(':id/ai-draft') @RequirePermissions('support.write', 'ai.use')
  async aiDraft(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    const q = await this.prisma.customerQuestion.findFirst({ where: { id, organizationId: u.organizationId }, include: { product: { include: { category: true, variants: true } } } });
    if (!q) return { error: 'Soru bulunamadı' };
    const context = q.product ? buildProductContext(q.product) : 'ÜRÜN BİLGİSİ YOK (soru bir ürünle eşleştirilemedi)';
    const r = await this.ai.complete(u, u.organizationId, 'question_draft', QUESTION_ANSWER_SYSTEM, `ÜRÜN BİLGİLERİ:\n${context}\n\nMÜŞTERİ SORUSU:\n${q.text}`);
    const missingInfo = r.text.startsWith('BİLGİ YOK');
    const draft = await this.svc.draft(u, id, r.text, 'AI_DRAFT');
    return { draft, missingInfo, costUsd: r.costUsd };
  }

  @Get('templates/all') @RequirePermissions('support.read') templates(@CurrentUser() u: JwtPayload) { return this.svc.templates(u); }
  @Post('templates') @RequirePermissions('support.write') createTemplate(@CurrentUser() u: JwtPayload, @Body() d: TemplateDto) { return this.svc.createTemplate(u, d.title, d.body); }
  @Delete('templates/:id') @RequirePermissions('support.write') deleteTemplate(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.deleteTemplate(u, id); }
}
