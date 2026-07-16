import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService, type ShipToSnapshot } from '../pdf/pdf.service';
import { S3Service } from '../uploads/s3.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

type PdfJobData = {
  invoiceId: string;
  userId?: string;
  replaceOldKey?: string | null;
};

@Processor('pdf')
export class PdfProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfProcessor.name);

  constructor(
    private prisma: PrismaService,
    private pdf: PdfService,
    private s3: S3Service,
    private gateway: NotificationsGateway,
  ) {
    super();
  }

  async process(job: Job<PdfJobData>): Promise<void> {
    if (job.name !== 'generate-invoice-pdf') return;

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: job.data.invoiceId },
      include: { customer: true },
    });
    if (!invoice) {
      this.logger.warn(`Invoice ${job.data.invoiceId} not found for PDF job`);
      return;
    }

    const lineItems = invoice.lineItems as Array<{ name: string; qty: number; rate: number; amount: number }>;
    const taxType =
      invoice.taxType === 'CGST_SGST' || invoice.taxType === 'IGST'
        ? invoice.taxType
        : Number(invoice.igstAmount) > 0
          ? 'IGST'
          : 'CGST_SGST';

    const pdfBuffer = await this.pdf.generateInvoicePdf({
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
      shipTo: (invoice.shipTo as ShipToSnapshot | null) || undefined,
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

    const upload = await this.s3.upload(
      pdfBuffer,
      `${invoice.invoiceNumber}.pdf`,
      'application/pdf',
      'invoices',
    );

    if (job.data.replaceOldKey && job.data.replaceOldKey !== upload.key) {
      await this.s3.delete(job.data.replaceOldKey).catch(() => undefined);
    }

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfUrl: upload.key },
    });

    if (job.data.userId) {
      this.gateway.emitToUser(job.data.userId, 'invoice:pdf_ready', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });
    }
  }
}
