import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { InvoicesService } from '../invoices/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CacheService } from '../redis/cache.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

const PROOF_REQUIRED_ABOVE = 1000;

const paymentInclude = {
  customer: { select: { id: true, companyName: true, ownerName: true, phone: true } },
  invoice: { select: { id: true, invoiceNumber: true, grandTotal: true, status: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  verifiedBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private activityLog: ActivityLogService,
    private invoices: InvoicesService,
    private notifications: NotificationsService,
    private cache: CacheService,
  ) {}

  private isAdmin(role: string) {
    return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
  }

  private normalizeAmounts(data: {
    totalAmount?: unknown;
    paidAmount?: unknown;
    bookingAmount?: unknown;
    status?: PaymentStatus;
  }) {
    const total = Number(data.totalAmount ?? data.paidAmount ?? 0);
    const paid = Number(data.paidAmount ?? 0);
    const pending = Math.max(0, total - paid);
    let status = data.status;
    if (!status) {
      if (paid >= total && total > 0) status = PaymentStatus.PAID;
      else if (paid > 0) status = PaymentStatus.PARTIAL;
      else status = PaymentStatus.PENDING;
    }
    return { total, paid, pending, status };
  }

  private assertProofIfRequired(paid: number, status: PaymentStatus, proofS3Key?: string | null) {
    if (status === PaymentStatus.PAID && paid >= PROOF_REQUIRED_ABOVE && !proofS3Key) {
      throw new BadRequestException(
        `Payment proof is required for collections of ₹${PROOF_REQUIRED_ABOVE} or more`,
      );
    }
  }

  private async attachProofUrl<T extends { proofS3Key?: string | null }>(payment: T) {
    if (!payment.proofS3Key) return { ...payment, proofUrl: null };
    const proofUrl = await this.s3.getAccessUrl(payment.proofS3Key);
    return { ...payment, proofUrl };
  }

  async findAll(
    userRole: string,
    userId: string,
    filters: {
      q?: string;
      status?: PaymentStatus;
      userId?: string;
      customerId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? parseInt(process.env.DEFAULT_LIST_LIMIT || '20', 10)));
    const where: Prisma.PaymentWhereInput = {};

    if (!this.isAdmin(userRole)) {
      where.createdById = userId;
    } else if (filters.userId) {
      where.createdById = filters.userId;
    }

    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;

    if (filters.from || filters.to) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.from) dateFilter.gte = new Date(filters.from);
      if (filters.to) dateFilter.lte = new Date(filters.to);
      where.OR = [
        { collectedAt: dateFilter },
        { collectedAt: null, createdAt: dateFilter },
      ];
    }

    if (filters.q?.trim()) {
      const q = filters.q.trim();
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { transactionId: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
            { customer: { companyName: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ collectedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    const withUrls = await Promise.all(items.map((p) => this.attachProofUrl(p)));
    return { items: withUrls, total, page, limit };
  }

  private paidDateWindow(
    scope: Prisma.PaymentWhereInput,
    from: Date,
    to?: Date,
  ): Prisma.PaymentWhereInput {
    const dateFilter: Prisma.DateTimeFilter = { gte: from };
    if (to) dateFilter.lte = to;
    return {
      ...scope,
      OR: [
        { collectedAt: dateFilter },
        { collectedAt: null, createdAt: dateFilter },
      ],
    };
  }

  private parseSummaryRange(from?: string, to?: string) {
    if (!from?.trim() || !to?.trim()) return null;
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
    return { from: fromDate, to: toDate, fromIso: from, toIso: to };
  }

  async summary(
    userRole: string,
    userId: string,
    filters?: { from?: string; to?: string; userId?: string },
  ) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const scope: Prisma.PaymentWhereInput = { status: PaymentStatus.PAID };
    if (!this.isAdmin(userRole)) {
      scope.createdById = userId;
    } else if (filters?.userId) {
      scope.createdById = filters.userId;
    }

    const range = this.parseSummaryRange(filters?.from, filters?.to);

    const [todayAgg, monthAgg, allTimeAgg, rangeAgg, byUserRaw] = await Promise.all([
      this.prisma.payment.aggregate({
        where: this.paidDateWindow(scope, todayStart, now),
        _sum: { paidAmount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: this.paidDateWindow(scope, monthStart, now),
        _sum: { paidAmount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: scope,
        _sum: { paidAmount: true },
        _count: true,
      }),
      range
        ? this.prisma.payment.aggregate({
            where: this.paidDateWindow(scope, range.from, range.to),
            _sum: { paidAmount: true },
            _count: true,
          })
        : Promise.resolve(null),
      this.isAdmin(userRole)
        ? this.prisma.payment.groupBy({
            by: ['createdById'],
            where: this.paidDateWindow(scope, monthStart, now),
            _sum: { paidAmount: true },
            _count: true,
          })
        : Promise.resolve([]),
    ]);

    const result: {
      today: { count: number; amount: number };
      month: { count: number; amount: number };
      allTime: { count: number; amount: number };
      range?: { count: number; amount: number; from: string; to: string };
      byUser?: Array<{ userId: string; name: string; count: number; amount: number }>;
    } = {
      today: {
        count: todayAgg._count,
        amount: Number(todayAgg._sum.paidAmount ?? 0),
      },
      month: {
        count: monthAgg._count,
        amount: Number(monthAgg._sum.paidAmount ?? 0),
      },
      allTime: {
        count: allTimeAgg._count,
        amount: Number(allTimeAgg._sum.paidAmount ?? 0),
      },
    };

    if (range && rangeAgg) {
      result.range = {
        count: rangeAgg._count,
        amount: Number(rangeAgg._sum.paidAmount ?? 0),
        from: range.fromIso,
        to: range.toIso,
      };
    }

    if (this.isAdmin(userRole) && byUserRaw.length) {
      const userIds = byUserRaw.map((r) => r.createdById);
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u.name]));
      result.byUser = byUserRaw
        .map((r) => ({
          userId: r.createdById,
          name: userMap.get(r.createdById) ?? 'Unknown',
          count: r._count,
          amount: Number(r._sum.paidAmount ?? 0),
        }))
        .sort((a, b) => b.amount - a.amount);
    } else if (this.isAdmin(userRole)) {
      result.byUser = [];
    }

    return result;
  }

  async findOne(id: string, userRole: string, userId: string, opts?: { includeProof?: boolean }) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: paymentInclude,
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!this.isAdmin(userRole) && payment.createdById !== userId) {
      throw new ForbiddenException('You can only view your own payments');
    }
    if (opts?.includeProof) return this.attachProofUrl(payment);
    return { ...payment, proofUrl: null };
  }

  async create(dto: CreatePaymentDto, createdById: string) {
    const totalAmount = dto.totalAmount ?? dto.paidAmount;
    const { total, paid, pending, status } = this.normalizeAmounts({
      totalAmount,
      paidAmount: dto.paidAmount,
      status: dto.status,
    });

    this.assertProofIfRequired(paid, status, dto.proofS3Key);

    const collectedAt =
      dto.collectedAt ? new Date(dto.collectedAt) : status === PaymentStatus.PAID ? new Date() : null;

    const payment = await this.prisma.payment.create({
      data: {
        customerId: dto.customerId,
        invoiceId: dto.invoiceId,
        totalAmount: total,
        bookingAmount: dto.bookingAmount,
        paidAmount: paid,
        pendingAmount: pending,
        status,
        paymentMethod: dto.paymentMethod,
        transactionId: dto.transactionId?.trim() || null,
        notes: dto.notes?.trim() || null,
        proofS3Key: dto.proofS3Key || null,
        proofFilename: dto.proofFilename || null,
        proofMimeType: dto.proofMimeType || null,
        collectedAt,
        paidDate: status === PaymentStatus.PAID ? collectedAt : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById,
      },
      include: paymentInclude,
    });

    if (dto.invoiceId) {
      await this.syncInvoiceFromPayment(dto.invoiceId);
    }

    await this.activityLog.log({
      userId: createdById,
      action: 'PAYMENT_CREATED',
      module: 'payment',
      recordId: payment.id,
      newValue: { customerId: dto.customerId, paidAmount: paid, status },
    });

    void this.cache.bumpNamespace('crm-insights');

    if (status === PaymentStatus.PAID && paid >= PROOF_REQUIRED_ABOVE) {
      const creator = await this.prisma.user.findUnique({
        where: { id: createdById },
        select: { role: true, name: true },
      });
      if (creator?.role === UserRole.EMPLOYEE) {
        const admins = await this.prisma.user.findMany({
          where: {
            isActive: true,
            role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
          },
          select: { id: true },
        });
        if (admins.length) {
          await this.notifications.notifyMany(
            admins.map((a) => a.id),
            {
              type: 'PAYMENT_RECORDED',
              title: 'Large collection recorded',
              message: `${creator.name} recorded ₹${paid.toLocaleString('en-IN')} from ${payment.customer.companyName}`,
              link: `/payments/${payment.id}`,
            },
          );
        }
      }
    }

    return this.attachProofUrl(payment);
  }

  async update(id: string, dto: UpdatePaymentDto, userRole: string, userId: string) {
    const current = await this.prisma.payment.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Payment not found');

    const isOwner = current.createdById === userId;
    const admin = this.isAdmin(userRole);
    if (!admin && !isOwner) {
      throw new ForbiddenException('You can only edit your own payments');
    }

    if (!admin && dto.customerId !== undefined) {
      throw new ForbiddenException('Only admins can change the customer on a collection');
    }
    if (!admin && dto.verify === true) {
      throw new ForbiddenException('Only admins can verify collections');
    }

    const merged = {
      totalAmount: dto.totalAmount ?? current.totalAmount,
      paidAmount: dto.paidAmount ?? current.paidAmount,
      status: (dto.status ?? current.status) as PaymentStatus,
    };
    const { total, paid, pending, status } = this.normalizeAmounts(merged);
    const proofS3Key = dto.proofS3Key ?? current.proofS3Key;
    this.assertProofIfRequired(paid, status, proofS3Key);

    const data: Prisma.PaymentUpdateInput = {
      ...(dto.paidAmount !== undefined || dto.totalAmount !== undefined
        ? { totalAmount: total, paidAmount: paid, pendingAmount: pending, status }
        : {}),
      ...(dto.status !== undefined ? { status } : {}),
      ...(dto.bookingAmount !== undefined ? { bookingAmount: dto.bookingAmount } : {}),
      ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
      ...(dto.transactionId !== undefined ? { transactionId: dto.transactionId?.trim() || null } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
      ...(dto.proofS3Key !== undefined ? { proofS3Key: dto.proofS3Key || null } : {}),
      ...(dto.proofFilename !== undefined ? { proofFilename: dto.proofFilename || null } : {}),
      ...(dto.proofMimeType !== undefined ? { proofMimeType: dto.proofMimeType || null } : {}),
      ...(dto.invoiceId !== undefined
        ? { invoice: dto.invoiceId ? { connect: { id: dto.invoiceId } } : { disconnect: true } }
        : {}),
      ...(dto.dueDate !== undefined
        ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
        : {}),
    };

    if (admin && dto.customerId) {
      data.customer = { connect: { id: dto.customerId } };
    }

    if (dto.collectedAt) {
      data.collectedAt = new Date(dto.collectedAt);
    } else if (status === PaymentStatus.PAID && !current.collectedAt) {
      data.collectedAt = new Date();
    }

    if (status === PaymentStatus.PAID) {
      data.paidDate = data.collectedAt ?? current.collectedAt ?? new Date();
    }

    const verifying = dto.verify === true && admin;
    if (verifying) {
      data.verifiedAt = new Date();
      data.verifiedBy = { connect: { id: userId } };
    }

    const payment = await this.prisma.payment.update({
      where: { id },
      data,
      include: paymentInclude,
    });

    if (payment.invoiceId) {
      await this.syncInvoiceFromPayment(payment.invoiceId);
    }
    if (current.invoiceId && current.invoiceId !== payment.invoiceId) {
      await this.syncInvoiceFromPayment(current.invoiceId);
    }

    if (verifying) {
      await this.activityLog.log({
        userId,
        action: 'PAYMENT_VERIFIED',
        module: 'payment',
        recordId: id,
      });
    }

    return this.attachProofUrl(payment);
  }

  async remove(id: string, userRole: string, userId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');

    if (!this.isAdmin(userRole)) {
      if (payment.createdById !== userId) {
        throw new ForbiddenException('You can only delete your own payments');
      }
      const ageMs = Date.now() - payment.createdAt.getTime();
      const within24h = ageMs < 24 * 60 * 60 * 1000;
      if (!within24h && payment.status !== PaymentStatus.PENDING) {
        throw new ForbiddenException('You can only delete pending payments or entries within 24 hours');
      }
    }

    const invoiceId = payment.invoiceId;
    await this.prisma.payment.delete({ where: { id } });

    if (invoiceId) {
      await this.syncInvoiceFromPayment(invoiceId);
    }

    return { success: true };
  }

  async generateInvoice(id: string, userRole: string, userId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!this.isAdmin(userRole) && payment.createdById !== userId) {
      throw new ForbiddenException('You can only generate invoices for your own payments');
    }
    if (payment.invoiceId) {
      throw new BadRequestException('Payment is already linked to an invoice');
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);
    const amount = Number(payment.paidAmount);

    const invoice = await this.invoices.create(
      {
        customerId: payment.customerId,
        dueDate,
        lineItems: [
          {
            name: `Collection — ${payment.customer.companyName}`,
            qty: 1,
            rate: amount,
            amount,
          },
        ],
        notes: payment.notes ?? undefined,
      },
      userId,
    );
    if (!invoice) {
      throw new BadRequestException('Failed to create invoice');
    }

    await this.prisma.payment.update({
      where: { id },
      data: { invoiceId: invoice.id },
    });

    await this.syncInvoiceFromPayment(invoice.id);
    return this.findOne(id, userRole, userId);
  }

  private async syncInvoiceFromPayment(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) return;

    const totalPaid = invoice.payments
      .filter((p) => p.status === PaymentStatus.PAID || p.status === PaymentStatus.PARTIAL)
      .reduce((sum, p) => sum + Number(p.paidAmount), 0);
    const grandTotal = Number(invoice.grandTotal);

    let status = invoice.status;
    if (totalPaid >= grandTotal) {
      status = 'PAID' as typeof invoice.status;
    } else if (totalPaid > 0 && invoice.status !== 'CANCELLED') {
      status = 'SENT' as typeof invoice.status;
    }

    if (status !== invoice.status) {
      await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
    }
  }

  async exportCsv(userRole: string, month?: string) {
    if (!this.isAdmin(userRole)) {
      throw new ForbiddenException('Only admins can export payments');
    }

    const now = new Date();
    const [year, mon] = month
      ? month.split('-').map(Number)
      : [now.getFullYear(), now.getMonth() + 1];
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 0, 23, 59, 59, 999);

    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PAID,
        OR: [
          { collectedAt: { gte: from, lte: to } },
          { collectedAt: null, createdAt: { gte: from, lte: to } },
        ],
      },
      include: {
        customer: { select: { companyName: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { collectedAt: 'desc' },
    });

    const header = 'Date,Company,Amount,Method,Status,Recorded By,Transaction ID\n';
    const rows = payments
      .map((p) => {
        const cols = [
          p.collectedAt?.toISOString().slice(0, 10) ?? '',
          `"${(p.customer.companyName ?? '').replace(/"/g, '""')}"`,
          Number(p.paidAmount),
          p.paymentMethod ?? '',
          p.status,
          `"${(p.createdBy.name ?? '').replace(/"/g, '""')}"`,
          p.transactionId ?? '',
        ];
        return cols.join(',');
      })
      .join('\n');

    return { csv: header + rows, filename: `collections-${year}-${String(mon).padStart(2, '0')}.csv` };
  }
}
