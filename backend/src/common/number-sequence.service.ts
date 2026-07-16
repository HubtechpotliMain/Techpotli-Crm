import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Prefix = 'WO' | 'INV' | 'QUO' | 'TKT' | 'TEPL';

/** Indian FY: Apr–Mar. Returns start calendar year (e.g. 2026 for FY 26-27). */
export function indianFyStartYear(date = new Date()): number {
  const month = date.getMonth() + 1; // 1–12
  const year = date.getFullYear();
  return month >= 4 ? year : year - 1;
}

export function indianFyLabel(fyStartYear: number): string {
  const a = String(fyStartYear).slice(-2);
  const b = String(fyStartYear + 1).slice(-2);
  return `${a}-${b}`;
}

@Injectable()
export class NumberSequenceService {
  constructor(private prisma: PrismaService) {}

  async next(prefix: Prefix): Promise<string> {
    const year = new Date().getFullYear();
    const seq = await this.prisma.numberSequence.upsert({
      where: { prefix_year: { prefix, year } },
      update: { lastNumber: { increment: 1 } },
      create: { prefix, year, lastNumber: 1 },
    });
    return `${prefix}-${year}-${seq.lastNumber.toString().padStart(4, '0')}`;
  }

  /**
   * Tax invoice numbers: TEPL/26-27/113
   * Seeds FY 26-27 at 112 so the first CRM invoice is 113.
   */
  async nextInvoiceNumber(date = new Date()): Promise<string> {
    const fyStart = indianFyStartYear(date);
    const label = indianFyLabel(fyStart);

    // Ensure FY 2026-27 starts after external invoice 112
    if (fyStart === 2026) {
      const existing = await this.prisma.numberSequence.findUnique({
        where: { prefix_year: { prefix: 'TEPL', year: fyStart } },
      });
      if (!existing) {
        await this.prisma.numberSequence.create({
          data: { prefix: 'TEPL', year: fyStart, lastNumber: 112 },
        });
      } else if (existing.lastNumber < 112) {
        await this.prisma.numberSequence.update({
          where: { id: existing.id },
          data: { lastNumber: 112 },
        });
      }
    }

    const seq = await this.prisma.numberSequence.upsert({
      where: { prefix_year: { prefix: 'TEPL', year: fyStart } },
      update: { lastNumber: { increment: 1 } },
      create: {
        prefix: 'TEPL',
        year: fyStart,
        lastNumber: fyStart === 2026 ? 113 : 1,
      },
    });

    return `TEPL/${label}/${seq.lastNumber}`;
  }
}
