import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { safeEqual, sha256 } from '../../common/webhook-key';
import { OrdersService } from '../orders/orders.service';

/**
 * Kanal webhook alıcısı: POST /api/v1/webhooks/:channelCode/:accountId
 * Doğrulama: x-api-key başlığı = hesap için üretilen webhook anahtarı (settings.webhookKeyHash ile karşılaştırılır).
 * Teslim garantisi olmadığı için periyodik sipariş senkronu yine çalışır; webhook yalnızca hızlandırır.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private prisma: PrismaService, private registry: AdapterRegistry, private orders: OrdersService) {}

  @Public()
  @Post(':channelCode/:accountId')
  async receive(@Param('channelCode') code: string, @Param('accountId') accountId: string, @Headers('x-api-key') apiKey: string | undefined, @Body() body: unknown) {
    const account = await this.prisma.channelAccount.findFirst({ where: { id: accountId, channel: { code } }, include: { channel: true } });
    if (!account) throw new UnauthorizedException();
    const expected = (account.settings as { webhookKeyHash?: string })?.webhookKeyHash;
    if (!expected || !apiKey || !safeEqual(sha256(apiKey), expected)) throw new UnauthorizedException('Webhook anahtarı geçersiz');
    const adapter = this.registry.get(code);
    const result = await this.orders.ingestWebhook(account, adapter, body);
    await this.prisma.channelAccount.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } });
    return { ok: true, ...result };
  }
}

