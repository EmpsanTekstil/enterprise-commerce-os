import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';

export interface DateRange { from: Date; to: Date }

/**
 * Genel Bakış kartlarının verisi. Her rakam gerçek tablolardan hesaplanır;
 * veri yoksa 0 döner, sahte rakam üretilmez.
 */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary(user: JwtPayload, range: DateRange) {
    const org = user.organizationId;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 6);
    const monthStart = new Date(todayStart); monthStart.setDate(1);

    const sumOrders = async (from: Date, to: Date) => {
      const r = await this.prisma.order.aggregate({
        where: { organizationId: org, orderedAt: { gte: from, lte: to }, status: { notIn: ['CANCELLED', 'RETURNED'] } },
        _sum: { grandTotal: true, estimatedProfit: true },
        _count: { _all: true },
      });
      return { revenue: Number(r._sum.grandTotal ?? 0), profit: Number(r._sum.estimatedProfit ?? 0), count: r._count._all };
    };

    const [today, week, month, inRange] = await Promise.all([
      sumOrders(todayStart, new Date()), sumOrders(weekStart, new Date()), sumOrders(monthStart, new Date()), sumOrders(range.from, range.to),
    ]);

    const countOrders = (status: string[]) =>
      this.prisma.order.count({ where: { organizationId: org, status: { in: status as never }, orderedAt: { gte: range.from, lte: range.to } } });

    const [pendingOrders, toShip, cancelled, returned, activeProducts, openQuestions, newReviews, accounts, failedJobs, adSpend] = await Promise.all([
      countOrders(['NEW', 'CONFIRMED']),
      countOrders(['CONFIRMED', 'PICKING', 'PACKED']),
      countOrders(['CANCELLED']),
      countOrders(['RETURNED']),
      this.prisma.product.count({ where: { organizationId: org, status: 'ACTIVE' } }),
      this.prisma.customerQuestion.count({ where: { organizationId: org, status: { in: ['OPEN', 'DRAFTED'] } } }),
      this.prisma.productReview.count({ where: { organizationId: org, reviewedAt: { gte: range.from, lte: range.to } } }),
      this.prisma.channelAccount.findMany({ where: { organizationId: org }, select: { id: true, label: true, status: true, lastSyncAt: true, lastError: true, channel: { select: { code: true, name: true } } } }),
      this.prisma.listingSyncJob.count({ where: { channelAccount: { organizationId: org }, status: 'FAILED', createdAt: { gte: range.from } } }),
      this.prisma.advertisingMetric.aggregate({ where: { campaign: { organizationId: org }, date: { gte: range.from, lte: range.to } }, _sum: { spend: true, sales: true, orders: true } }),
    ]);

    // Kritik stok: onHand - reserved <= reorderPoint
    const lowStock = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "InventoryBalance" ib
      JOIN "ProductVariant" pv ON pv.id = ib."variantId"
      JOIN "Product" p ON p.id = pv."productId"
      WHERE p."organizationId" = ${org} AND (ib."onHand" - ib."reserved") <= ib."reorderPoint"`;

    return {
      range,
      sales: { today, week, month, inRange },
      orders: { pending: pendingOrders, toShip, cancelled, returned, total: inRange.count },
      products: { active: activeProducts, lowStockAlerts: Number(lowStock[0]?.count ?? 0) },
      ads: { spend: Number(adSpend._sum.spend ?? 0), sales: Number(adSpend._sum.sales ?? 0), orders: adSpend._sum.orders ?? 0 },
      support: { openQuestions, newReviews },
      integrations: { accounts, failedSyncJobs: failedJobs },
    };
  }
}
