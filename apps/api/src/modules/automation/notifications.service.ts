import { Injectable } from '@nestjs/common';
import { NotificationLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';

/** Uygulama içi bildirim merkezi. Aynı olay için tekrar bildirim üretmemek üzere `dedupeKey` link alanında taşınır. */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async notify(organizationId: string, level: NotificationLevel, title: string, body?: string, link?: string, dedupeWindowMinutes = 60) {
    if (link) {
      const recent = await this.prisma.notification.findFirst({ where: { organizationId, title, link, createdAt: { gte: new Date(Date.now() - dedupeWindowMinutes * 60_000) } } });
      if (recent) return recent;
    }
    return this.prisma.notification.create({ data: { organizationId, level, title, body, link } });
  }

  list(user: JwtPayload, unreadOnly = false, take = 50) {
    return this.prisma.notification.findMany({ where: { organizationId: user.organizationId, OR: [{ userId: null }, { userId: user.sub }], isRead: unreadOnly ? false : undefined }, orderBy: { createdAt: 'desc' }, take });
  }

  async unreadCount(user: JwtPayload) { return { count: await this.prisma.notification.count({ where: { organizationId: user.organizationId, OR: [{ userId: null }, { userId: user.sub }], isRead: false } }) }; }

  async markRead(user: JwtPayload, ids?: string[]) {
    await this.prisma.notification.updateMany({ where: { organizationId: user.organizationId, OR: [{ userId: null }, { userId: user.sub }], id: ids ? { in: ids } : undefined }, data: { isRead: true } });
    return { ok: true };
  }
}
