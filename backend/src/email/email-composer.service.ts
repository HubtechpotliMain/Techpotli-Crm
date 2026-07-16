import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadActivityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OllamaService } from '../ai/ollama.service';
import { MailService } from '../mail/mail.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CustomersService } from '../customers/customers.service';
import {
  CustomerEmailReason,
} from '../mail/templates/customer-notice.template';
import {
  CUSTOMER_PAYMENT_PURPOSES,
  purposePrompt,
  RecipientType,
  listPurposes,
} from './email-purposes';
import {
  extractEditableBodyFromHtml,
  isFullHtmlDocument,
  wrapEmailBodyFragment,
} from '../mail/templates/email-layout.template';
import { buildBuiltInDraft } from './built-in-email-templates';

type ComposeDraft = {
  to: string | null;
  subject: string;
  body: string;
  contactName?: string | null;
  companyName?: string | null;
  warnings?: string[];
  generatedBy?: 'built-in' | 'notice-template' | 'ai';
};

@Injectable()
export class EmailComposerService {
  constructor(
    private prisma: PrismaService,
    private ollama: OllamaService,
    private mail: MailService,
    private activityLog: ActivityLogService,
    private customers: CustomersService,
  ) {}

  async listRecipients(type: RecipientType, q?: string, limitParam?: number) {
    const term = q?.trim();
    const base = term ? 30 : 50;
    const limit = Math.max(1, Math.min(Number.isFinite(limitParam as number) ? Number(limitParam) : base, 200));

    if (type === 'lead') {
      if (term && term.length >= 2) {
        try {
          return await this.prisma.$queryRaw<
            { id: string; companyName: string; contactName: string; email: string | null; status: string }[]
          >`
            SELECT id, "companyName", "contactName", email, status::text
            FROM "Lead"
            WHERE to_tsvector('english', coalesce("companyName",'') || ' ' || coalesce("contactName",'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,''))
              @@ plainto_tsquery('english', ${term})
            ORDER BY "updatedAt" DESC
            LIMIT ${limit}`;
        } catch {
          /* fallback below */
        }
      }
      return this.prisma.lead.findMany({
        where: term
          ? {
              OR: [
                { companyName: { contains: term, mode: 'insensitive' } },
                { contactName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
              ],
            }
          : undefined,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          companyName: true,
          contactName: true,
          email: true,
          status: true,
        },
      });
    }

    if (term && term.length >= 2) {
      try {
        return await this.prisma.$queryRaw<
          { id: string; companyName: string; ownerName: string; email: string | null; status: string }[]
        >`
          SELECT id, "companyName", "ownerName", email, status::text
          FROM "Customer"
          WHERE to_tsvector('english', coalesce("companyName",'') || ' ' || coalesce("ownerName",'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,''))
            @@ plainto_tsquery('english', ${term})
          ORDER BY "updatedAt" DESC
          LIMIT ${limit}`;
      } catch {
        /* fallback below */
      }
    }
    return this.prisma.customer.findMany({
      where: term
        ? {
            OR: [
              { companyName: { contains: term, mode: 'insensitive' } },
              { ownerName: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        ownerName: true,
        email: true,
        status: true,
      },
    });
  }

  async compose(recipientType: RecipientType, recipientId: string, purpose: string): Promise<ComposeDraft> {
    const allowed = listPurposes(recipientType === 'customer' ? 'customer' : 'lead').some((p) => p.id === purpose);
    if (!allowed) throw new BadRequestException('Invalid email purpose');

    let draft: ComposeDraft;
    if (recipientType === 'customer' && CUSTOMER_PAYMENT_PURPOSES.has(purpose)) {
      draft = await this.customers.getNotificationDraft(
        recipientId,
        purpose as CustomerEmailReason,
      );
    } else if (recipientType === 'lead') {
      draft = await this.composeLeadDraft(recipientId, purpose);
    } else {
      draft = await this.composeCustomerAiDraft(recipientId, purpose);
    }

    return {
      ...draft,
      body: this.toEditableBody(draft.body),
      warnings: draft.warnings ?? [],
      generatedBy: draft.generatedBy ?? 'built-in',
    };
  }

  private toEditableBody(html: string): string {
    return extractEditableBodyFromHtml(html);
  }

  async send(
    userId: string,
    recipientType: RecipientType,
    recipientId: string,
    purpose: string,
    to: string,
    subject: string,
    body: string,
  ) {
    if (!to?.trim()) throw new BadRequestException('Recipient email is required');
    if (!subject?.trim() || !body?.trim()) {
      throw new BadRequestException('Subject and body are required');
    }

    const safeBody = this.sanitizeUserHtml(body);
    const html = isFullHtmlDocument(safeBody)
      ? safeBody
      : wrapEmailBodyFragment(
          safeBody.includes('<') ? safeBody : `<p>${safeBody.replace(/\n/g, '</p><p>')}</p>`,
          subject.trim(),
        );
    const result = await this.mail.send(to.trim(), subject.trim(), html);

    if (recipientType === 'lead') {
      await this.logLeadEmail(userId, recipientId, purpose, to, subject, result.skipped);
    } else {
      await this.logCustomerEmail(userId, recipientId, purpose, to, subject, result.skipped);
    }

    await this.activityLog.log({
      userId,
      action: recipientType === 'lead' ? 'LEAD_EMAIL_SENT' : 'CUSTOMER_EMAIL_SENT',
      module: recipientType,
      recordId: recipientId,
      newValue: { purpose, to, subject, sent: !result.skipped },
    });

    return {
      sent: !result.skipped,
      to,
      subject,
      purpose,
      provider: result.skipped ? 'skipped' : (result.provider ?? 'sent'),
    };
  }

  private async composeLeadDraft(leadId: string, purpose: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 5 },
        quotations: { orderBy: { createdAt: 'desc' }, take: 1 },
        assignedTo: { select: { name: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const context = {
      company: lead.companyName,
      contact: lead.contactName,
      status: lead.status,
      priority: lead.priority,
      services: lead.interestedServices,
      budget: lead.budget,
      assignedTo: lead.assignedTo?.name,
      lastActivities: lead.activities,
      quotation: lead.quotations[0],
    };

    const built = buildBuiltInDraft({
      recipientType: 'lead',
      purpose,
      companyName: lead.companyName,
      contactName: lead.contactName,
      assignedToName: lead.assignedTo?.name ?? null,
    });

    if (built) {
      return {
        to: lead.email || null,
        subject: built.subject,
        body: built.bodyHtml,
        contactName: lead.contactName,
        companyName: lead.companyName,
        generatedBy: 'built-in' as const,
      };
    }

    return this.generateAiDraft(
      purposePrompt('lead', purpose),
      context,
      lead.contactName,
      lead.email,
      lead.companyName,
    );
  }

  private async composeCustomerAiDraft(customerId: string, purpose: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        callLogs: { orderBy: { createdAt: 'desc' }, take: 5 },
        renewals: { where: { status: 'ACTIVE' }, take: 3 },
        projects: { take: 3, orderBy: { updatedAt: 'desc' }, select: { name: true, status: true } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const context = {
      company: customer.companyName,
      contact: customer.ownerName,
      projects: customer.projects,
      callLogs: customer.callLogs,
      renewals: customer.renewals,
      website: customer.liveWebsiteLink || customer.domain,
    };

    const built = buildBuiltInDraft({
      recipientType: 'customer',
      purpose,
      companyName: customer.companyName,
      contactName: customer.ownerName ?? null,
      website: (customer.liveWebsiteLink || customer.domain) ?? null,
    });

    if (built) {
      return {
        to: customer.email || null,
        subject: built.subject,
        body: built.bodyHtml,
        contactName: customer.ownerName,
        companyName: customer.companyName,
        generatedBy: 'built-in' as const,
      };
    }

    return this.generateAiDraft(
      purposePrompt('customer', purpose),
      context,
      customer.ownerName,
      customer.email,
      customer.companyName,
    );
  }

  private async generateAiDraft(
    purposeLabel: string,
    context: unknown,
    contactName: string,
    email: string | null | undefined,
    companyName: string,
  ) {
    const start = Date.now();
    const prompt = `Write a professional ${purposeLabel}.
Company: ${companyName}
Contact: ${contactName}
Context: ${JSON.stringify(context)}
Return JSON only: {"subject":"...","body":"HTML with <p> tags only, no markdown"}`;

    const raw = await this.ollama.generate(
      prompt,
      'You write concise B2B emails for TechPotli, a digital agency. Friendly, professional Indian business tone.',
    );

    let subject = `${companyName} — TechPotli`;
    let body = `<p>Hi ${contactName},</p><p>I hope you are doing well. I wanted to connect regarding ${companyName}.</p><p>Please let me know a convenient time to speak.</p><p>Best regards,<br/>TechPotli Team</p>`;

    if (raw) {
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as { subject?: string; body?: string };
          if (parsed.subject) subject = parsed.subject;
          if (parsed.body) body = parsed.body;
        }
      } catch {
        /* fallback */
      }
    }

    await this.prisma.aiRequestLog.create({
      data: {
        type: 'EMAIL_COMPOSE',
        input: { purposeLabel, context: JSON.parse(JSON.stringify(context)) },
        output: { subject, body },
        latencyMs: Date.now() - start,
      },
    });

    return {
      to: email || null,
      subject,
      body,
      contactName,
      companyName,
      generatedBy: 'ai' as const,
    };
  }

  private async logLeadEmail(
    userId: string,
    leadId: string,
    purpose: string,
    to: string,
    subject: string,
    skipped?: boolean,
  ) {
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        userId,
        type: LeadActivityType.EMAIL,
        notes: `Email sent (${purpose}): ${subject}${skipped ? ' [mail not configured]' : ''}`,
        outcome: `To: ${to}`,
      },
    });
  }

  private async logCustomerEmail(
    userId: string,
    customerId: string,
    purpose: string,
    to: string,
    subject: string,
    skipped?: boolean,
  ) {
    await this.prisma.customerTimelineEvent.create({
      data: {
        customerId,
        eventType: 'EMAIL_SENT',
        title: `Email sent: ${purpose}`,
        description: `To ${to} · ${subject}${skipped ? ' (mail not configured)' : ''}`,
        userId,
        metadata: { purpose, to, subject },
      },
    });
  }

  private sanitizeUserHtml(input: string) {
    let html = String(input ?? '');
    // drop scripts entirely
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // remove inline event handlers (onclick=, onload=, etc.)
    html = html.replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
    // neutralize javascript: urls in href/src
    html = html.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');
    return html.trim();
  }
}
