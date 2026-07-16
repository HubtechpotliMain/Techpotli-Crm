import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberSequenceService } from '../common/number-sequence.service';
import { PdfService, type ShipToSnapshot } from '../pdf/pdf.service';
import { S3Service } from '../uploads/s3.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { buildInvoiceEmailHtml } from '../mail/templates/invoice-email.template';
import { EventPublisherService } from '../events/event-publisher.service';
import {
  computeInvoiceTax,
  displayStateName,
  gstStateCode,
  isDelhiState,
} from '../common/utils/gst-place.util';

export type CreateInvoiceInput = {
  customerId: string;
  lineItems: unknown[];
  dueDate: Date;
  notes?: string;
  /** When set, overrides auto-detect from customer.state */
  isDelhi?: boolean;
  shipTo?: ShipToSnapshot;
  /** @deprecated ignored — tax is always 18% split by place of supply */
  gstRate?: number;
};

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private numbers: NumberSequenceService,
    private pdf: PdfService,
    private s3: S3Service,
    private mail: MailService,
    private notifications: NotificationsService,
    private activityLog: ActivityLogService,
    private events: EventPublisherService,
    @InjectQueue('pdf') private pdfQueue: Queue,
  ) {}

  private useAsyncPdf() {
    return process.env.ENABLE_ASYNC_PDF !== 'false';
  }

  async findAll(opts?: { page?: number; limit?: number }) {
    const limit = Math.min(opts?.limit ?? parseInt(process.env.DEFAULT_LIST_LIMIT || '20', 10), 100);
    const page = Math.max(1, opts?.page ?? 1);
    const skip = (page - 1) * limit;
    const [totalCount, data] = await Promise.all([
      this.prisma.invoice.count(),
      this.prisma.invoice.findMany({
        include: { customer: { select: { id: true, companyName: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
    ]);
    return {
      data,
      totalCount,
      page,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      limit,
      hasMore: page * limit < totalCount,
    };
  }

  findByCustomer(customerId: string) {
    return this.prisma.invoice.findMany({ where: { customerId }, orderBy: { invoiceDate: 'desc' } });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { customer: true, payments: true },
    });
    if (!invoice) return null;
    const pdfViewUrl = await this.resolvePdfViewUrl(invoice.pdfUrl);
    return { ...invoice, pdfViewUrl };
  }

  async resolvePdfViewUrl(pdfUrl: string | null | undefined): Promise<string | null> {
    if (!pdfUrl) return null;

    if (pdfUrl.startsWith('http://') || pdfUrl.startsWith('https://')) {
      return pdfUrl;
    }

    let key = pdfUrl;
    if (pdfUrl.startsWith('/api/uploads/local/')) {
      key = pdfUrl.replace('/api/uploads/local/', '');
      if (this.s3.localFileExists(key)) {
        return this.s3.getAccessUrl(key);
      }
      return null;
    }

    if (key.startsWith('invoices/') || key.startsWith('files/')) {
      return this.s3.getAccessUrl(key);
    }

    return null;
  }

  extractS3Key(pdfUrl: string | null | undefined): string | null {
    if (!pdfUrl) return null;
    if (pdfUrl.startsWith('/api/uploads/local/')) {
      return pdfUrl.replace('/api/uploads/local/', '');
    }
    if (pdfUrl.startsWith('invoices/') || pdfUrl.startsWith('files/')) {
      return pdfUrl;
    }
    return null;
  }

  private buildShipTo(
    customer: {
      companyName: string;
      ownerName?: string | null;
      phone?: string | null;
      address?: string | null;
      state?: string | null;
      pincode?: string | null;
    },
    override?: ShipToSnapshot,
  ): ShipToSnapshot {
    const state = override?.state ?? customer.state ?? undefined;
    return {
      companyName: override?.companyName ?? customer.companyName,
      contactName: override?.contactName ?? customer.ownerName ?? undefined,
      phone: override?.phone ?? customer.phone ?? undefined,
      address: override?.address ?? customer.address ?? undefined,
      state: displayStateName(state) || state,
      stateCode: override?.stateCode || gstStateCode(state) || undefined,
      pincode: override?.pincode ?? customer.pincode ?? undefined,
    };
  }

  async create(data: CreateInvoiceInput, createdById: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const lineItems = data.lineItems as Array<{ name: string; qty: number; rate: number; amount: number }>;
    if (!lineItems?.length) throw new BadRequestException('Add at least one line item');

    const subtotal = lineItems.reduce((s, i) => s + Number(i.amount), 0);
    const delhi =
      typeof data.isDelhi === 'boolean' ? data.isDelhi : isDelhiState(customer.state);
    const tax = computeInvoiceTax(subtotal, delhi);
    const placeOfSupply =
      tax.placeOfSupply || displayStateName(data.shipTo?.state || customer.state) || customer.state || null;
    const shipTo = this.buildShipTo(customer, data.shipTo);
    if (!shipTo.stateCode && placeOfSupply) {
      shipTo.stateCode = gstStateCode(placeOfSupply) || undefined;
    }

    const invoiceNumber = await this.numbers.nextInvoiceNumber();

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        customerId: data.customerId,
        dueDate: data.dueDate,
        lineItems,
        subtotal,
        gstRate: tax.gstRate,
        gstAmount: tax.gstAmount,
        grandTotal: tax.grandTotal,
        taxType: tax.taxType,
        placeOfSupply,
        cgstAmount: tax.cgstAmount,
        sgstAmount: tax.sgstAmount,
        igstAmount: tax.igstAmount,
        hsnSac: '998314',
        shipTo: shipTo as unknown as Prisma.InputJsonValue,
        notes: data.notes,
        createdById,
      },
      include: { customer: true },
    });

    if (this.useAsyncPdf()) {
      const job = await this.pdfQueue.add('generate-invoice-pdf', {
        invoiceId: invoice.id,
        userId: createdById,
      });
      const admins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN' } });
      await this.notifications.notifyMany(
        admins.map((a) => a.id),
        {
          type: 'INVOICE_CREATED',
          title: 'New invoice',
          message: invoiceNumber,
          link: `/invoices/${invoice.id}`,
        },
      );
      await this.activityLog.log({
        userId: createdById,
        action: 'INVOICE_CREATED',
        module: 'invoice',
        recordId: invoice.id,
        newValue: { invoiceNumber, customerId: data.customerId },
      });
      const result = await this.findOne(invoice.id);
      if (!result) throw new NotFoundException('Invoice not found after create');
      return { ...result, pdfJobId: job.id, pdfStatus: 'queued' as const };
    }

    const pdfBuffer = await this.buildInvoicePdfBuffer(invoice);
    const upload = await this.s3.upload(pdfBuffer, `${invoiceNumber}.pdf`, 'application/pdf', 'invoices');
    await this.prisma.invoice.update({ where: { id: invoice.id }, data: { pdfUrl: upload.key } });

    const admins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN' } });
    await this.notifications.notifyMany(
      admins.map((a) => a.id),
      {
        type: 'INVOICE_CREATED',
        title: 'New invoice',
        message: invoiceNumber,
        link: `/invoices/${invoice.id}`,
      },
    );
    await this.activityLog.log({
      userId: createdById,
      action: 'INVOICE_CREATED',
      module: 'invoice',
      recordId: invoice.id,
      newValue: { invoiceNumber, customerId: data.customerId },
    });
    if (customer?.email) {
      try {
        await this.deliverInvoiceEmail(invoice, pdfBuffer);
      } catch {
        // Invoice is created even if email fails
      }
    }
    return this.findOne(invoice.id);
  }

  private async buildInvoicePdfBuffer(invoice: {
    invoiceNumber: string;
    invoiceDate: Date;
    dueDate: Date;
    lineItems: unknown;
    subtotal: unknown;
    gstRate: unknown;
    gstAmount: unknown;
    grandTotal: unknown;
    taxType?: string | null;
    cgstAmount?: unknown;
    sgstAmount?: unknown;
    igstAmount?: unknown;
    hsnSac?: string | null;
    placeOfSupply?: string | null;
    shipTo?: unknown;
    customer?: {
      companyName?: string | null;
      ownerName?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      state?: string | null;
      pincode?: string | null;
      gstNumber?: string | null;
    } | null;
  }) {
    const lineItems = invoice.lineItems as Array<{ name: string; qty: number; rate: number; amount: number }>;
    const shipTo = (invoice.shipTo as ShipToSnapshot | null) || undefined;
    const taxType =
      invoice.taxType === 'CGST_SGST' || invoice.taxType === 'IGST'
        ? invoice.taxType
        : Number(invoice.igstAmount) > 0
          ? 'IGST'
          : 'CGST_SGST';

    return this.pdf.generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      customer: {
        companyName: invoice.customer?.companyName || '',
        ownerName: invoice.customer?.ownerName,
        phone: invoice.customer?.phone,
        email: invoice.customer?.email,
        address: invoice.customer?.address,
        state: invoice.customer?.state,
        pincode: invoice.customer?.pincode,
        gstNumber: invoice.customer?.gstNumber,
      },
      shipTo,
      lineItems,
      subtotal: Number(invoice.subtotal),
      gstAmount: Number(invoice.gstAmount),
      grandTotal: Number(invoice.grandTotal),
      gstRate: Number(invoice.gstRate),
      taxType,
      cgstAmount: Number(invoice.cgstAmount ?? 0),
      sgstAmount: Number(invoice.sgstAmount ?? 0),
      igstAmount: Number(invoice.igstAmount ?? 0),
      hsnSac: invoice.hsnSac || '998314',
      placeOfSupply: invoice.placeOfSupply,
    });
  }

  async getPdfStatus(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { pdfUrl: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return { status: invoice.pdfUrl ? 'ready' : 'processing' };
  }

  async enqueuePdfGeneration(id: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const job = await this.pdfQueue.add('generate-invoice-pdf', {
      invoiceId: id,
      userId,
      replaceOldKey: this.extractS3Key(invoice.pdfUrl),
    });
    return { jobId: job.id, status: 'queued' };
  }

  private async getInvoicePdfBuffer(invoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: Date;
    dueDate: Date;
    lineItems: unknown;
    subtotal: unknown;
    gstAmount: unknown;
    grandTotal: unknown;
    gstRate: unknown;
    taxType?: string | null;
    cgstAmount?: unknown;
    sgstAmount?: unknown;
    igstAmount?: unknown;
    hsnSac?: string | null;
    placeOfSupply?: string | null;
    shipTo?: unknown;
    pdfUrl: string | null;
    customer?: {
      companyName?: string | null;
      ownerName?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      state?: string | null;
      pincode?: string | null;
      gstNumber?: string | null;
    } | null;
  }) {
    const key = this.extractS3Key(invoice.pdfUrl);
    if (key) {
      try {
        return await this.s3.download(key);
      } catch {
        /* regenerate below */
      }
    }
    return this.buildInvoicePdfBuffer(invoice);
  }

  private async deliverInvoiceEmail(
    invoice: {
      id: string;
      invoiceNumber: string;
      invoiceDate: Date;
      dueDate: Date;
      subtotal: unknown;
      gstAmount: unknown;
      grandTotal: unknown;
      lineItems: unknown;
      customer?: {
        companyName?: string | null;
        ownerName?: string | null;
        email?: string | null;
      } | null;
    },
    pdfBuffer: Buffer,
  ) {
    const email = invoice.customer?.email;
    if (!email) throw new BadRequestException('Customer has no email address');

    const lineItems = invoice.lineItems as Array<{ name: string; qty: number; rate: number; amount: number }>;
    const html = buildInvoiceEmailHtml({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      subtotal: Number(invoice.subtotal),
      gstAmount: Number(invoice.gstAmount),
      grandTotal: Number(invoice.grandTotal),
      customer: invoice.customer,
      lineItems,
    });

    const result = await this.mail.send(
      email,
      `Invoice ${invoice.invoiceNumber} · ₹${Number(invoice.grandTotal).toLocaleString('en-IN')} due ${invoice.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} — TechPotli`,
      html,
      [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    );

    if ((result as { skipped?: boolean }).skipped) {
      throw new BadGatewayException(
        'Email is not configured. Add RESEND_API_KEY to backend/.env and restart the server.',
      );
    }

    return result;
  }

  async regeneratePdf(id: string, userId?: string) {
    if (this.useAsyncPdf() && userId) {
      return this.enqueuePdfGeneration(id, userId);
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const pdfBuffer = await this.buildInvoicePdfBuffer(invoice);
    const oldKey = this.extractS3Key(invoice.pdfUrl);
    const upload = await this.s3.upload(pdfBuffer, `${invoice.invoiceNumber}.pdf`, 'application/pdf', 'invoices');
    if (oldKey && oldKey !== upload.key) {
      await this.s3.delete(oldKey).catch(() => undefined);
    }
    await this.prisma.invoice.update({ where: { id }, data: { pdfUrl: upload.key } });
    return this.findOne(id);
  }

  async sendEmail(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.customer?.email) {
      throw new BadRequestException('Customer has no email address. Add email on the customer profile first.');
    }

    const pdfBuffer = await this.getInvoicePdfBuffer(invoice);
    await this.deliverInvoiceEmail(invoice, pdfBuffer);

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'SENT', emailSentAt: new Date() },
    });
    await this.events.invoiceSent(updated as unknown as Record<string, unknown>);
    return { sent: true, to: invoice.customer.email };
  }

  update(id: string, data: Prisma.InvoiceUpdateInput) {
    return this.prisma.invoice.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.invoice.delete({ where: { id } });
  }
}
