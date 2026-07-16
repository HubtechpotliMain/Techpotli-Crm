import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { amountInWordsINR } from '../common/utils/amount-in-words';

type PdfDoc = InstanceType<typeof PDFDocument>;

const COMPANY = {
  legalName: 'TECHPOTLI E-COMMERCE PRIVATE LIMITED',
  addressLines: [
    'C-52-A LGF, Block C, Kalkaji',
    'New Delhi, South Delhi - 110019',
  ],
  phone: '01147200987',
  mobiles: '9911475599, 9911399733',
  gstin: '07AAMCT2939C1Z9',
  stateName: 'Delhi',
  stateCode: '07',
  email: 'support@techpotli.com',
  website: 'www.techpotli.com',
};

const BANK = {
  accountName: 'TECHPOTLI E-COMMERCE PRIVATE LIMITED',
  bankName: 'Axis Bank',
  accountNumber: '925020045561018',
  branch: 'Nehru Enclave New Delhi 110019',
  ifsc: 'UTIB0004813',
  swift: '',
};

export type ShipToSnapshot = {
  companyName?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
};

export type InvoicePdfInput = {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  customer: {
    companyName: string;
    ownerName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    state?: string | null;
    pincode?: string | null;
    gstNumber?: string | null;
  };
  shipTo?: ShipToSnapshot | null;
  lineItems: Array<{ name: string; qty: number; rate: number; amount: number }>;
  subtotal: number;
  gstRate: number;
  gstAmount: number;
  grandTotal: number;
  taxType?: 'CGST_SGST' | 'IGST';
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  hsnSac?: string;
  placeOfSupply?: string | null;
};

@Injectable()
export class PdfService {
  private assetPath(filename: string) {
    const candidates = [
      path.join(process.cwd(), 'assets', filename),
      path.join(__dirname, '..', '..', 'assets', filename),
      path.join(__dirname, '..', '..', '..', 'assets', filename),
    ];
    return candidates.find((p) => fs.existsSync(p));
  }

  private logoPath() {
    return this.assetPath('techpotli-logo.png');
  }

  private sealPath() {
    return this.assetPath('techpotli-seal.png');
  }

  private formatMoney(value: number) {
    return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private formatDate(value: Date) {
    return value.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private drawRule(doc: PdfDoc, y: number, color = '#C9A227', weight = 0.8) {
    const { left, right } = doc.page.margins;
    const width = doc.page.width - left - right;
    doc.save().lineWidth(weight).strokeColor(color).moveTo(left, y).lineTo(left + width, y).stroke().restore();
  }

  private drawWatermark(doc: PdfDoc) {
    const logo = this.logoPath();
    if (!logo) return;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const size = Math.min(pageW, pageH) * 0.55;
    doc.save();
    doc.opacity(0.08);
    doc.image(logo, (pageW - size) / 2, (pageH - size) / 2, { width: size });
    doc.restore();
  }

  async generateInvoicePdf(data: InvoicePdfInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 36,
        size: 'A4',
        info: {
          Title: `Invoice ${data.invoiceNumber}`,
          Author: COMPANY.legalName,
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawWatermark(doc);

      const left = doc.page.margins.left;
      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const hsn = data.hsnSac || '998314';
      const taxType = data.taxType || (data.igstAmount && data.igstAmount > 0 ? 'IGST' : 'CGST_SGST');
      const cgst = Number(data.cgstAmount ?? (taxType === 'CGST_SGST' ? data.gstAmount / 2 : 0));
      const sgst = Number(data.sgstAmount ?? (taxType === 'CGST_SGST' ? data.gstAmount / 2 : 0));
      const igst = Number(data.igstAmount ?? (taxType === 'IGST' ? data.gstAmount : 0));

      const ship = data.shipTo || {
        companyName: data.customer.companyName,
        contactName: data.customer.ownerName || undefined,
        phone: data.customer.phone || undefined,
        address: data.customer.address || undefined,
        state: data.customer.state || undefined,
        pincode: data.customer.pincode || undefined,
      };

      let y = doc.page.margins.top;
      const logo = this.logoPath();
      if (logo) {
        doc.image(logo, left, y, { width: 72 });
      }

      const headerX = left + (logo ? 82 : 0);
      const headerW = contentWidth - (logo ? 82 : 0);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A1A1A').text(COMPANY.legalName, headerX, y, {
        width: headerW,
      });
      doc.font('Helvetica').fontSize(7.5).fillColor('#444444');
      let hy = y + 14;
      for (const line of COMPANY.addressLines) {
        doc.text(line, headerX, hy, { width: headerW });
        hy += 10;
      }
      doc.text(`Ph: ${COMPANY.phone}  ·  Mob: ${COMPANY.mobiles}`, headerX, hy, { width: headerW });
      hy += 10;
      doc.text(`GSTIN/UIN: ${COMPANY.gstin}  ·  State: ${COMPANY.stateName}, Code: ${COMPANY.stateCode}`, headerX, hy, {
        width: headerW,
      });

      y = Math.max(y + 78, hy + 14);
      this.drawRule(doc, y, '#C9A227', 1.5);
      y += 8;

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1A1A1A').text('TAX INVOICE', left, y, {
        width: contentWidth,
        align: 'center',
      });
      y += 16;

      doc.font('Helvetica').fontSize(8).fillColor('#1A1A1A');
      const metaW = contentWidth / 3;
      doc.text(`Invoice No: ${data.invoiceNumber}`, left, y, { width: metaW });
      doc.text(`Date: ${this.formatDate(data.invoiceDate)}`, left + metaW, y, { width: metaW });
      doc.text(`Due: ${this.formatDate(data.dueDate)}`, left + metaW * 2, y, { width: metaW, align: 'right' });
      y += 14;
      this.drawRule(doc, y);
      y += 8;

      // Consignee
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#9A7B2F').text('Consignee (Ship to)', left, y);
      y += 12;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1A1A').text(ship.companyName || data.customer.companyName || '—', left, y, {
        width: contentWidth,
      });
      y += 11;
      doc.font('Helvetica').fontSize(8).fillColor('#333333');
      if (ship.contactName || ship.phone) {
        doc.text([ship.contactName, ship.phone].filter(Boolean).join(' — '), left, y, { width: contentWidth });
        y += 10;
      }
      if (ship.address) {
        const addrH = doc.heightOfString(ship.address, { width: contentWidth });
        doc.text(ship.address, left, y, { width: contentWidth });
        y += addrH + 4;
      }
      const stateLine = [
        ship.state ? `State Name: ${ship.state}` : '',
        ship.stateCode ? `Code: ${ship.stateCode}` : '',
        ship.pincode ? `PIN: ${ship.pincode}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      if (stateLine) {
        doc.text(stateLine, left, y, { width: contentWidth });
        y += 10;
      }
      if (data.customer.gstNumber) {
        doc.text(`Buyer GSTIN: ${data.customer.gstNumber}`, left, y, { width: contentWidth });
        y += 10;
      }
      if (data.placeOfSupply) {
        doc.text(`Place of Supply: ${data.placeOfSupply}`, left, y, { width: contentWidth });
        y += 10;
      }

      y += 4;
      this.drawRule(doc, y);
      y += 8;

      // Line items
      const cols = [
        { label: '#', width: 22, align: 'center' as const },
        { label: 'Description of Services', width: contentWidth - 22 - 36 - 36 - 58 - 68 },
        { label: 'HSN', width: 36, align: 'center' as const },
        { label: 'Qty', width: 36, align: 'center' as const },
        { label: 'Rate', width: 58, align: 'right' as const },
        { label: 'Amount', width: 68, align: 'right' as const },
      ];

      doc.rect(left, y, contentWidth, 16).fill('#FDF8EE');
      doc.fillColor('#9A7B2F').font('Helvetica-Bold').fontSize(7);
      let x = left;
      for (const col of cols) {
        doc.text(col.label, x + 2, y + 4, { width: col.width - 4, align: col.align });
        x += col.width;
      }
      y += 18;

      doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
      data.lineItems.forEach((item, index) => {
        const descH = Math.max(12, doc.heightOfString(item.name, { width: cols[1].width - 4 }));
        if (index % 2 === 0) {
          doc.rect(left, y - 1, contentWidth, descH + 4).fill('#FAFAF8');
          doc.fillColor('#1A1A1A');
        }
        x = left;
        const row = [
          String(index + 1),
          item.name,
          hsn,
          String(item.qty),
          this.formatMoney(item.rate),
          this.formatMoney(item.amount),
        ];
        cols.forEach((col, i) => {
          doc.text(row[i], x + 2, y, { width: col.width - 4, align: col.align });
          x += col.width;
        });
        y += descH + 4;
      });

      y += 4;
      this.drawRule(doc, y);
      y += 6;

      // Tax summary table
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#9A7B2F').text('Tax Summary', left, y);
      y += 12;

      if (taxType === 'IGST') {
        const taxCols = [
          { label: 'HSN/SAC', w: 55 },
          { label: 'Taxable Value', w: 90 },
          { label: 'IGST Rate', w: 55 },
          { label: 'IGST Amount', w: 80 },
          { label: 'Total', w: contentWidth - 55 - 90 - 55 - 80 },
        ];
        doc.rect(left, y, contentWidth, 14).fill('#FDF8EE');
        doc.fillColor('#9A7B2F').font('Helvetica-Bold').fontSize(7);
        x = left;
        for (const c of taxCols) {
          doc.text(c.label, x + 2, y + 3, { width: c.w - 4, align: 'center' });
          x += c.w;
        }
        y += 16;
        doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
        x = left;
        const taxRow = [hsn, this.formatMoney(data.subtotal), '18%', this.formatMoney(igst), this.formatMoney(data.grandTotal)];
        taxCols.forEach((c, i) => {
          doc.text(taxRow[i], x + 2, y, { width: c.w - 4, align: 'right' });
          x += c.w;
        });
        y += 14;
      } else {
        const taxCols = [
          { label: 'HSN/SAC', w: 48 },
          { label: 'Taxable', w: 70 },
          { label: 'CGST%', w: 40 },
          { label: 'CGST Amt', w: 60 },
          { label: 'SGST%', w: 40 },
          { label: 'SGST Amt', w: 60 },
          { label: 'Total', w: contentWidth - 48 - 70 - 40 - 60 - 40 - 60 },
        ];
        doc.rect(left, y, contentWidth, 14).fill('#FDF8EE');
        doc.fillColor('#9A7B2F').font('Helvetica-Bold').fontSize(7);
        x = left;
        for (const c of taxCols) {
          doc.text(c.label, x + 2, y + 3, { width: c.w - 4, align: 'center' });
          x += c.w;
        }
        y += 16;
        doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
        x = left;
        const taxRow = [
          hsn,
          this.formatMoney(data.subtotal),
          '9%',
          this.formatMoney(cgst),
          '9%',
          this.formatMoney(sgst),
          this.formatMoney(data.grandTotal),
        ];
        taxCols.forEach((c, i) => {
          doc.text(taxRow[i], x + 2, y, { width: c.w - 4, align: 'right' });
          x += c.w;
        });
        y += 14;
      }

      y += 4;
      this.drawRule(doc, y, '#C9A227', 1.2);
      y += 8;

      // Totals + words
      const totalsX = left + contentWidth * 0.5;
      doc.font('Helvetica').fontSize(8).fillColor('#1A1A1A');
      doc.text('Taxable Amount', totalsX, y, { width: contentWidth * 0.28 });
      doc.text(this.formatMoney(data.subtotal), totalsX + contentWidth * 0.28, y, {
        width: contentWidth * 0.22,
        align: 'right',
      });
      y += 11;
      if (taxType === 'IGST') {
        doc.text('IGST @ 18%', totalsX, y, { width: contentWidth * 0.28 });
        doc.text(this.formatMoney(igst), totalsX + contentWidth * 0.28, y, {
          width: contentWidth * 0.22,
          align: 'right',
        });
      } else {
        doc.text('CGST @ 9%', totalsX, y, { width: contentWidth * 0.28 });
        doc.text(this.formatMoney(cgst), totalsX + contentWidth * 0.28, y, {
          width: contentWidth * 0.22,
          align: 'right',
        });
        y += 11;
        doc.text('SGST @ 9%', totalsX, y, { width: contentWidth * 0.28 });
        doc.text(this.formatMoney(sgst), totalsX + contentWidth * 0.28, y, {
          width: contentWidth * 0.22,
          align: 'right',
        });
      }
      y += 12;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A1A1A');
      doc.text('Grand Total', totalsX, y, { width: contentWidth * 0.28 });
      doc.text(`₹ ${this.formatMoney(data.grandTotal)}`, totalsX + contentWidth * 0.28, y, {
        width: contentWidth * 0.22,
        align: 'right',
      });
      y += 14;

      doc.font('Helvetica').fontSize(7.5).fillColor('#333333');
      doc.text(`Amount Chargeable (in words) E. & O.E`, left, y);
      y += 10;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text(amountInWordsINR(data.grandTotal), left, y, {
        width: contentWidth,
      });
      y += 12;
      doc.font('Helvetica').fontSize(7.5).fillColor('#333333').text('Tax Amount (in words):', left, y);
      y += 10;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text(amountInWordsINR(data.gstAmount), left, y, {
        width: contentWidth,
      });
      y += 14;
      this.drawRule(doc, y);
      y += 8;

      // Bank
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#9A7B2F').text("Company's Bank Details", left, y);
      y += 11;
      doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
      const bankLines: [string, string][] = [
        ["A/c Holder's Name", BANK.accountName],
        ['Bank Name', BANK.bankName],
        ['A/c No.', BANK.accountNumber],
        ['Branch & IFS Code', `${BANK.branch} & ${BANK.ifsc}`],
      ];
      if (BANK.swift) bankLines.push(['SWIFT Code', BANK.swift]);
      for (const [label, value] of bankLines) {
        doc.font('Helvetica-Bold').text(`${label}:`, left, y, { continued: true, width: 120 });
        doc.font('Helvetica').text(` ${value}`);
        y += 10;
      }

      y += 8;
      this.drawRule(doc, y);
      y += 10;

      // Signatory + seal
      const signX = left + contentWidth * 0.55;
      doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
      doc.text(`for ${COMPANY.legalName}`, signX, y, { width: contentWidth * 0.45, align: 'center' });

      const seal = this.sealPath();
      if (seal) {
        const sealSize = 72;
        doc.image(seal, signX + (contentWidth * 0.45 - sealSize) / 2, y + 12, { width: sealSize });
        y += sealSize + 18;
      } else {
        y += 50;
      }

      doc.font('Helvetica-Bold').fontSize(8).text('Authorised Signatory', signX, y, {
        width: contentWidth * 0.45,
        align: 'center',
      });

      doc.end();
    });
  }
}
