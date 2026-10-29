import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** Önemli işlemleri kalıcı denetim kaydına yazar. Hata olsa bile ana işlemi engellemez. */
  async log(
    user: JwtPayload | null,
    action: string,
    entityType: string,
    entityId?: string,
    before?: unknown,
    after?: unknown,
    organizationId?: string,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: organizationId ?? user?.organizationId ?? '',
          userId: user?.sub,
          action,
          entityType,
          entityId,
          beforeJson: before as Prisma.InputJsonValue,
          afterJson: after as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      console.error('Audit log yazılamadı', e);
    }
  }
}
