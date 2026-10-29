import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CryptoService } from '../../common/crypto.service';
import { AdapterContext } from '../../integrations/adapter.interface';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { CreateChannelAccountDto, UpdateChannelAccountDto } from './channels.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private registry: AdapterRegistry,
    private audit: AuditService,
  ) {}

  /** Sistemde tanımlı kanal türleri + adaptör yetenekleri (arayüz "Yakında" / "Destekleniyor" rozetleri için). */
  async listChannels() {
    const channels = await this.prisma.salesChannel.findMany({ where: { isEnabled: true }, orderBy: { name: 'asc' } });
    const adapters = new Map(this.registry.list().map((a) => [a.code, a]));
    return channels.map((c) => ({ ...c, capabilities: adapters.get(c.code)?.capabilities ?? null, hasAdapter: adapters.has(c.code) }));
  }

  async listAccounts(user: JwtPayload) {
    const accounts = await this.prisma.channelAccount.findMany({
      where: { organizationId: user.organizationId },
      include: { channel: true },
      orderBy: { createdAt: 'asc' },
    });
    // credentialsEnc asla dışarı çıkmaz; yalnızca maskelenmiş özet döner
    return accounts.map((a) => this.toPublic(a));
  }

  async createAccount(user: JwtPayload, dto: CreateChannelAccountDto) {
    const channel = await this.prisma.salesChannel.findUnique({ where: { code: dto.channelCode } });
    if (!channel) throw new BadRequestException(`Bilinmeyen kanal: ${dto.channelCode}`);
    const account = await this.prisma.channelAccount.create({
      data: {
        organizationId: user.organizationId,
        channelId: channel.id,
        label: dto.label,
        externalSellerId: dto.externalSellerId,
        credentialsEnc: this.crypto.encryptJson(dto.credentials),
        settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
        isDemo: dto.isDemo ?? false,
        status: 'NOT_CONFIGURED',
      },
      include: { channel: true },
    });
    await this.audit.log(user, 'channel_account.create', 'ChannelAccount', account.id, null, { label: dto.label, channel: dto.channelCode });
    return this.toPublic(account);
  }

  async updateAccount(user: JwtPayload, id: string, dto: UpdateChannelAccountDto) {
    const existing = await this.getOwned(user, id);
    const account = await this.prisma.channelAccount.update({
      where: { id },
      data: {
        label: dto.label,
        externalSellerId: dto.externalSellerId,
        credentialsEnc: dto.credentials ? this.crypto.encryptJson(dto.credentials) : undefined,
        settings: dto.settings as Prisma.InputJsonValue | undefined,
        status: dto.credentials ? 'NOT_CONFIGURED' : undefined,
      },
      include: { channel: true },
    });
    await this.audit.log(user, 'channel_account.update', 'ChannelAccount', id, { label: existing.label }, { label: account.label, credentialsChanged: !!dto.credentials });
    return this.toPublic(account);
  }

  async deleteAccount(user: JwtPayload, id: string) {
    await this.getOwned(user, id);
    await this.prisma.channelAccount.delete({ where: { id } });
    await this.audit.log(user, 'channel_account.delete', 'ChannelAccount', id);
    return { ok: true };
  }

  /** Gerçek API çağrısı ile bağlantı testi; sonuç veritabanına yazılır. */
  async testConnection(user: JwtPayload, id: string) {
    const account = await this.getOwned(user, id);
    const adapter = this.registry.get(account.channel.code);
    const ctx = this.buildContext(account);
    let result: { ok: boolean; message: string };
    try {
      result = await adapter.testConnection(ctx);
    } catch (e) {
      result = { ok: false, message: (e as Error).message };
    }
    await this.prisma.channelAccount.update({
      where: { id },
      data: { status: result.ok ? 'CONNECTED' : 'ERROR', lastError: result.ok ? null : result.message, lastSyncAt: result.ok ? new Date() : undefined },
    });
    await this.audit.log(user, 'channel_account.test', 'ChannelAccount', id, null, result);
    return result;
  }

  /** Diğer modüller (senkronizasyon işleri) için: şifresi çözülmüş bağlam. */
  buildContext(account: { id: string; externalSellerId: string | null; credentialsEnc: string; settings: Prisma.JsonValue }): AdapterContext {
    return {
      accountId: account.id,
      externalSellerId: account.externalSellerId,
      credentials: this.crypto.decryptJson<Record<string, string>>(account.credentialsEnc),
      settings: (account.settings as Record<string, unknown>) ?? {},
    };
  }

  async getOwned(user: JwtPayload, id: string) {
    const account = await this.prisma.channelAccount.findFirst({ where: { id, organizationId: user.organizationId }, include: { channel: true } });
    if (!account) throw new NotFoundException('Kanal hesabı bulunamadı');
    return account;
  }

  private toPublic(a: { credentialsEnc: string; channel: { code: string; name: string; kind: string } } & Record<string, unknown>) {
    const { credentialsEnc, ...rest } = a;
    let credentialSummary: Record<string, string> = {};
    try {
      const creds = this.crypto.decryptJson<Record<string, string>>(credentialsEnc);
      credentialSummary = Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, CryptoService.mask(v)]));
    } catch {
      credentialSummary = { error: 'çözülemedi' };
    }
    return { ...rest, credentialSummary };
  }
}
