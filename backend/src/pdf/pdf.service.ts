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
      path.join(process.cwd(), 'backend', 'assets', filename),
      path.join(__dirname, '..', '..', 'assets', filename),
      path.join(__dirname, '..', '..', '..', 'assets', filename),
      path.join(__dirname, 'assets', filename),
      // Nest may copy to dist/assets next to compiled output
      path.join(__dirname, '..', 'assets', filename),
    ];
    return candidates.find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
  }

  private logoPath() {
    return (
      this.assetPath('techpotli-logo.png') ||
      this.assetPath('techpotlilogo.png') ||
      this.assetPath('techpotli-logo.PNG')
    );
  }

  private sealPath() {
    return (
      this.assetPath('techpotli-seal.png') ||
      this.assetPath('techpotli-seal.PNG') ||
      // Fallback: use logo as seal if stamp file missing
      this.logoPath()
    );
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

  /** Advance Y by the real wrapped height of a text block (prevents overlap). */
  private drawWrappedText(
    doc: PdfDoc,
    text: string,
    x: number,
    y: number,
    opts: { width: number; font?: string; size?: number; color?: string; align?: 'left' | 'center' | 'right' },
  ) {
    const font = opts.font ?? 'Helvetica';
    const size = opts.size ?? 8;
    const color = opts.color ?? '#1A1A1A';
    doc.font(font).fontSize(size).fillColor(color);
    const height = doc.heightOfString(text, { width: opts.width, align: opts.align });
    doc.text(text, x, y, { width: opts.width, align: opts.align, lineBreak: true });
    return y + height;
  }

  private drawLabelValue(
    doc: PdfDoc,
    label: string,
    value: string,
    x: number,
    y: number,
    contentWidth: number,
  ) {
    const labelWidth = 118;
    const valueWidth = contentWidth - labelWidth - 8;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1A1A1A');
    const labelH = doc.heightOfString(`${label}:`, { width: labelWidth });
    doc.text(`${label}:`, x, y, { width: labelWidth });

    doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
    const valueH = doc.heightOfString(value || '—', { width: valueWidth });
    doc.text(value || '—', x + labelWidth + 4, y, { width: valueWidth, lineBreak: true });

    return y + Math.max(labelH, valueH) + 6;
  }

  private drawWatermark(doc: PdfDoc) {
    const logo = this.logoPath();
    if (!logo) return;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const size = Math.min(pageW, pageH) * 0.5;
    doc.save();
    doc.opacity(0.07);
    try {
      doc.image(logo, (pageW - size) / 2, (pageH - size) / 2, { width: size });
    } catch {
      /* ignore watermark failures */
    }
    doc.restore();
  }

  private drawSealStamp(doc: PdfDoc, cx: number, cy: number, size: number) {
    const seal = this.sealPath();
    if (seal) {
      try {
        doc.opacity(1);
        doc.image(seal, cx - size / 2, cy - size / 2, { fit: [size, size], align: 'center', valign: 'center' });
        return true;
      } catch {
        /* fall through to vector stamp */
      }
    }
    // Vector fallback stamp so signatory is never blank
    doc.save();
    doc.lineWidth(1.5).strokeColor('#9A7B2F');
    doc.circle(cx, cy, size / 2 - 2).stroke();
    doc.lineWidth(0.8).circle(cx, cy, size / 2 - 8).stroke();
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#9A7B2F');
    doc.text('TECHPOTLI', cx - size / 2 + 6, cy - 10, { width: size - 12, align: 'center' });
    doc.font('Helvetica').fontSize(5);
    doc.text('07AAMCT2939C1Z9', cx - size / 2 + 6, cy + 2, { width: size - 12, align: 'center' });
    doc.restore();
    return true;
  }

  async generateInvoicePdf(data: InvoicePdfInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 36,
        size: 'A4',
        bufferPages: true,
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
      const logoW = 90;
      if (logo) {
        try {
          doc.opacity(1);
          doc.image(logo, left, y, { fit: [logoW, 48] });
        } catch {
          /* continue without header logo */
        }
      }

      const headerX = left + (logo ? logoW + 12 : 0);
      const headerW = contentWidth - (logo ? logoW + 12 : 0);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A1A1A');
      let hy = this.drawWrappedText(doc, COMPANY.legalName, headerX, y, {
        width: headerW,
        font: 'Helvetica-Bold',
        size: 10,
      });
      hy += 2;
      for (const line of COMPANY.addressLines) {
        hy = this.drawWrappedText(doc, line, headerX, hy, {
          width: headerW,
          size: 7.5,
          color: '#444444',
        });
      }
      hy = this.drawWrappedText(doc, `Ph: ${COMPANY.phone}  ·  Mob: ${COMPANY.mobiles}`, headerX, hy, {
        width: headerW,
        size: 7.5,
        color: '#444444',
      });
      hy = this.drawWrappedText(
        doc,
        `GSTIN/UIN: ${COMPANY.gstin}  ·  State: ${COMPANY.stateName}, Code: ${COMPANY.stateCode}`,
        headerX,
        hy,
        { width: headerW, size: 7.5, color: '#444444' },
      );

      y = Math.max(y + 56, hy + 8);
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

      doc.font('Helvetica-Bold').fontSize(8).fillColor('#9A7B2F').text('Consignee (Ship to)', left, y);
      y += 12;
      y = this.drawWrappedText(doc, ship.companyName || data.customer.companyName || '—', left, y, {
        width: contentWidth,
        font: 'Helvetica-Bold',
        size: 9,
      });
      y += 2;
      if (ship.contactName || ship.phone) {
        y = this.drawWrappedText(
          doc,
          [ship.contactName, ship.phone].filter(Boolean).join(' — '),
          left,
          y,
          { width: contentWidth, size: 8, color: '#333333' },
        );
        y += 2;
      }
      if (ship.address) {
        y = this.drawWrappedText(doc, ship.address, left, y, {
          width: contentWidth,
          size: 8,
          color: '#333333',
        });
        y += 2;
      }
      const stateLine = [
        ship.state ? `State Name: ${ship.state}` : '',
        ship.stateCode ? `Code: ${ship.stateCode}` : '',
        ship.pincode ? `PIN: ${ship.pincode}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      if (stateLine) {
        y = this.drawWrappedText(doc, stateLine, left, y, { width: contentWidth, size: 8, color: '#333333' });
        y += 2;
      }
      if (data.customer.gstNumber) {
        y = this.drawWrappedText(doc, `Buyer GSTIN: ${data.customer.gstNumber}`, left, y, {
          width: contentWidth,
          size: 8,
          color: '#333333',
        });
        y += 2;
      }
      if (data.placeOfSupply) {
        y = this.drawWrappedText(doc, `Place of Supply: ${data.placeOfSupply}`, left, y, {
          width: contentWidth,
          size: 8,
          color: '#333333',
        });
        y += 2;
      }

      y += 4;
      this.drawRule(doc, y);
      y += 8;

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
        doc.font('Helvetica').fontSize(7.5);
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
          doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
          doc.text(row[i], x + 2, y, { width: col.width - 4, align: col.align });
          x += col.width;
        });
        y += descH + 4;
      });

      y += 4;
      this.drawRule(doc, y);
      y += 6;

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

      const totalsX = left + contentWidth * 0.5;
      const totalsLabelW = contentWidth * 0.28;
      const totalsValueW = contentWidth * 0.22;
      doc.font('Helvetica').fontSize(8).fillColor('#1A1A1A');
      doc.text('Taxable Amount', totalsX, y, { width: totalsLabelW });
      doc.text(this.formatMoney(data.subtotal), totalsX + totalsLabelW, y, {
        width: totalsValueW,
        align: 'right',
      });
      y += 12;
      if (taxType === 'IGST') {
        doc.text('IGST @ 18%', totalsX, y, { width: totalsLabelW });
        doc.text(this.formatMoney(igst), totalsX + totalsLabelW, y, {
          width: totalsValueW,
          align: 'right',
        });
      } else {
        doc.text('CGST @ 9%', totalsX, y, { width: totalsLabelW });
        doc.text(this.formatMoney(cgst), totalsX + totalsLabelW, y, {
          width: totalsValueW,
          align: 'right',
        });
        y += 12;
        doc.text('SGST @ 9%', totalsX, y, { width: totalsLabelW });
        doc.text(this.formatMoney(sgst), totalsX + totalsLabelW, y, {
          width: totalsValueW,
          align: 'right',
        });
      }
      y += 14;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A1A1A');
      doc.text('Grand Total', totalsX, y, { width: totalsLabelW });
      doc.text(`₹ ${this.formatMoney(data.grandTotal)}`, totalsX + totalsLabelW, y, {
        width: totalsValueW,
        align: 'right',
      });
      y += 16;

      // Amount in words — use real wrapped heights (fixes overlap)
      const chargeableWords = amountInWordsINR(data.grandTotal);
      const taxWords = amountInWordsINR(data.gstAmount);

      y = this.drawWrappedText(doc, 'Amount Chargeable (in words) E. & O.E', left, y, {
        width: contentWidth,
        size: 7.5,
        color: '#555555',
      });
      y += 3;
      y = this.drawWrappedText(doc, chargeableWords, left, y, {
        width: contentWidth,
        font: 'Helvetica-Bold',
        size: 8,
        color: '#1A1A1A',
      });
      y += 8;
      y = this.drawWrappedText(doc, 'Tax Amount (in words):', left, y, {
        width: contentWidth,
        size: 7.5,
        color: '#555555',
      });
      y += 3;
      y = this.drawWrappedText(doc, taxWords, left, y, {
        width: contentWidth,
        font: 'Helvetica-Bold',
        size: 8,
        color: '#1A1A1A',
      });
      y += 8;
      this.drawRule(doc, y);
      y += 8;

      // Bank (left) + signatory/seal (right) — side-by-side so nothing overlaps or clips
      const sealSize = 72;
      const signColW = contentWidth * 0.4;
      const bankColW = contentWidth - signColW - 12;
      const signX = left + contentWidth - signColW;
      const footerTop = y;

      doc.font('Helvetica-Bold').fontSize(8).fillColor('#9A7B2F').text("Company's Bank Details", left, footerTop);
      let bankY = footerTop + 12;
      const bankLines: [string, string][] = [
        ["A/c Holder's Name", BANK.accountName],
        ['Bank Name', BANK.bankName],
        ['A/c No.', BANK.accountNumber],
        ['Branch', BANK.branch],
        ['IFS Code', BANK.ifsc],
      ];
      if (BANK.swift) bankLines.push(['SWIFT Code', BANK.swift]);
      for (const [label, value] of bankLines) {
        bankY = this.drawLabelValue(doc, label, value, left, bankY, bankColW);
      }

      doc.font('Helvetica').fontSize(7).fillColor('#1A1A1A');
      doc.text(`for ${COMPANY.legalName}`, signX, footerTop, { width: signColW, align: 'center' });

      const sealCy = footerTop + 16 + sealSize / 2;
      const sealCx = signX + signColW / 2;
      this.drawSealStamp(doc, sealCx, sealCy, sealSize);

      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A');
      doc.text('Authorised Signatory', signX, footerTop + 16 + sealSize + 6, {
        width: signColW,
        align: 'center',
      });

      doc.end();
    });
  }
}
