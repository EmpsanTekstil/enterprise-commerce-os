import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';

/**
 * Yapay zekâ servisi (Claude API).
 * İlkeler: yalnızca verilen bağlamdaki doğrulanmış bilgi; bilgi yoksa "bilgi yok"; hiçbir çıktı onaysız gönderilmez;
 * her çağrı AIRequest tablosuna token ve maliyetle yazılır. ANTHROPIC_API_KEY yoksa açıkça "yapılandırılmadı" döner.
 */
export interface AiResult { text: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; requestId: string }

@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  readonly model = process.env.AI_MODEL ?? 'claude-sonnet-5-5';
  // USD / 1M token; fiyatlar değişebildiği için ortamdan ayarlanır
  private readonly inPrice = Number(process.env.AI_PRICE_INPUT_PER_MTOK ?? 3);
  private readonly outPrice = Number(process.env.AI_PRICE_OUTPUT_PER_MTOK ?? 15);

  constructor(private prisma: PrismaService) {}

  get enabled() { return !!process.env.ANTHROPIC_API_KEY; }

  async complete(user: JwtPayload | null, organizationId: string, feature: string, system: string, userPrompt: string, maxTokens = 800): Promise<AiResult> {
    if (!this.enabled) {
      await this.prisma.aIRequest.create({ data: { organizationId, userId: user?.sub, feature, model: this.model, inputSummary: userPrompt.slice(0, 500), status: 'FAILED', error: 'ANTHROPIC_API_KEY tanımlı değil' } });
      throw new ServiceUnavailableException('Yapay zekâ yapılandırılmadı: .env içinde ANTHROPIC_API_KEY tanımlayın.');
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const started = Date.now();
    try {
      const res = (await client.messages.create({ model: this.model, max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: 'user', content: userPrompt }] })) as unknown as {
        content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number };
      };
      const text = res.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
      const inputTokens = res.usage.input_tokens; const outputTokens = res.usage.output_tokens;
      const costUsd = (inputTokens * this.inPrice + outputTokens * this.outPrice) / 1_000_000;
      const req = await this.prisma.aIRequest.create({ data: { organizationId, userId: user?.sub, feature, model: this.model, inputTokens, outputTokens, costUsd, inputSummary: userPrompt.slice(0, 500), outputSummary: text.slice(0, 500), status: 'SUCCESS' } });
      this.log.log(`AI ${feature}: ${inputTokens}+${outputTokens} token, $${costUsd.toFixed(5)}, ${Date.now() - started}ms`);
      return { text, model: this.model, inputTokens, outputTokens, costUsd, requestId: req.id };
    } catch (e) {
      await this.prisma.aIRequest.create({ data: { organizationId, userId: user?.sub, feature, model: this.model, inputSummary: userPrompt.slice(0, 500), status: 'FAILED', error: (e as Error).message.slice(0, 500) } });
      throw e;
    }
  }

  /** Kullanım ve maliyet özeti (AI Stüdyosu ve Finans için). */
  async usage(organizationId: string, from: Date) {
    const rows = await this.prisma.aIRequest.groupBy({ by: ['feature'], where: { organizationId, createdAt: { gte: from } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costUsd: true } });
    const total = rows.reduce((s, r) => s + Number(r._sum.costUsd ?? 0), 0);
    return { enabled: this.enabled, model: this.model, totalCostUsd: total, byFeature: rows.map((r) => ({ feature: r.feature, count: r._count._all, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0, costUsd: Number(r._sum.costUsd ?? 0) })) };
  }

  history(organizationId: string, take = 50) {
    return this.prisma.aIRequest.findMany({ where: { organizationId }, include: { user: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, take });
  }
}
