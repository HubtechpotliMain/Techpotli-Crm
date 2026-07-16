import { buildBrandedEmailLayout, EMAIL_BRAND } from './email-layout.template';

export type CustomerEmailReason =
  | 'PAYMENT_PENDING'
  | 'PAYMENT_OVERDUE'
  | 'MAINTENANCE_CLOSURE'
  | 'RENEWAL_DUE';

export const CUSTOMER_NOTIFY_TEMPLATES: Record<
  CustomerEmailReason,
  { label: string; subject: string; preview: string; urgency: 'info' | 'warning' | 'critical' }
> = {
  PAYMENT_PENDING: {
    label: 'Payment pending',
    subject: 'Payment Reminder — Action Required | TechPotli',
    preview: 'Friendly reminder about outstanding payment on your account.',
    urgency: 'info',
  },
  PAYMENT_OVERDUE: {
    label: 'Payment overdue',
    subject: 'Urgent: Overdue Payment Notice | TechPotli',
    preview: 'Formal notice for overdue payment with immediate action requested.',
    urgency: 'warning',
  },
  MAINTENANCE_CLOSURE: {
    label: 'Maintenance — website closure',
    subject: 'Important: Website Maintenance & Service Suspension | TechPotli',
    preview: 'Notify client that website/services may be suspended due to pending dues or maintenance.',
    urgency: 'critical',
  },
  RENEWAL_DUE: {
    label: 'Renewal payment due',
    subject: 'Renewal Payment Due — TechPotli',
    preview: 'Reminder to renew domain, hosting or annual services.',
    urgency: 'info',
  },
};

type PaymentRow = { pendingAmount: number; dueDate?: Date | null; status: string };
type InvoiceRow = { invoiceNumber: string; grandTotal: number; dueDate: Date; status: string };

export type CustomerNoticeData = {
  reason: CustomerEmailReason;
  customer: { companyName: string; ownerName?: string | null; email?: string | null };
  pendingTotal: number;
  payments: PaymentRow[];
  invoices: InvoiceRow[];
  websiteUrl?: string | null;
  notes?: string;
};

function formatMoney(value: number) {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value?: Date | null) {
  if (!value) return '—';
  return value.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function urgencyColor(urgency: string) {
  if (urgency === 'critical') return { bg: '#FEF2F2', border: '#FECACA', accent: '#DC2626', badge: 'Action required' };
  if (urgency === 'warning') return { bg: '#FFFBEB', border: '#FDE68A', accent: '#D97706', badge: 'Urgent' };
  return { bg: EMAIL_BRAND.goldLight, border: EMAIL_BRAND.goldBorder, accent: EMAIL_BRAND.goldDark, badge: 'Reminder' };
}

function buildBodyCopy(data: CustomerNoticeData) {
  const name = data.customer.ownerName || data.customer.companyName;
  const total = formatMoney(data.pendingTotal);
  const site = data.websiteUrl ? ` (${data.websiteUrl})` : '';

  switch (data.reason) {
    case 'PAYMENT_PENDING':
      return `
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          Dear <strong>${name}</strong>,
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          This is a courteous reminder that your TechPotli account has an <strong>outstanding balance of ${total}</strong>.
          Please complete the payment at your earliest convenience to keep your services running without interruption.
        </p>`;
    case 'PAYMENT_OVERDUE':
      return `
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          Dear <strong>${name}</strong>,
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          Our records show an <strong>overdue payment of ${total}</strong> on your account.
          Immediate settlement is requested to avoid service disruption and additional penalties.
        </p>`;
    case 'MAINTENANCE_CLOSURE':
      return `
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          Dear <strong>${name}</strong>,
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          Due to <strong>pending payment of ${total}</strong> and scheduled system maintenance,
          we must inform you that your website${site} and related services may be
          <strong>temporarily suspended or taken offline</strong> until dues are cleared.
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          To avoid downtime, please complete payment within <strong>48 hours</strong>.
          Once payment is received, normal service will be restored promptly.
        </p>`;
    case 'RENEWAL_DUE':
      return `
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          Dear <strong>${name}</strong>,
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569">
          Your renewal payment of <strong>${total}</strong> is due soon.
          Renew on time to continue domain, hosting, and website services without lapse.
        </p>`;
  }
}

export function getCustomerNoticeSubject(reason: CustomerEmailReason) {
  return CUSTOMER_NOTIFY_TEMPLATES[reason].subject;
}

/** Editable fragment (no branded shell) for Email Center / TipTap. */
export function buildCustomerNoticeBodyFragment(data: CustomerNoticeData): string {
  const tpl = CUSTOMER_NOTIFY_TEMPLATES[data.reason];
  const colors = urgencyColor(tpl.urgency);

  const paymentRows = data.payments
    .slice(0, 5)
    .map(
      (p) =>
        `<li>Payment · ${p.status} — ${formatMoney(p.pendingAmount)} (due ${formatDate(p.dueDate)})</li>`,
    )
    .join('');

  const invoiceRows = data.invoices
    .slice(0, 5)
    .map(
      (inv) =>
        `<li>${inv.invoiceNumber} — ${formatMoney(inv.grandTotal)} (due ${formatDate(inv.dueDate)})</li>`,
    )
    .join('');

  const detailsList =
    data.payments.length || data.invoices.length
      ? `<p><strong>Outstanding details</strong></p><ul>${paymentRows}${invoiceRows}</ul>`
      : '';

  const notesBlock = data.notes
    ? `<p><strong>Note from TechPotli:</strong> ${data.notes}</p>`
    : '';

  return `
    <p><strong>${colors.badge}</strong> — Total outstanding: ${formatMoney(data.pendingTotal)}</p>
    ${buildBodyCopy(data)}
    ${detailsList}
    ${notesBlock}
    <p><strong>How to pay:</strong> Reply to this email or contact us with your payment reference. Bank details are available on your invoice PDF.</p>
  `.trim();
}

export function buildCustomerNoticeHtml(data: CustomerNoticeData) {
  const tpl = CUSTOMER_NOTIFY_TEMPLATES[data.reason];
  const colors = urgencyColor(tpl.urgency);
  const greeting = data.customer.companyName;

  const paymentRows = data.payments
    .slice(0, 5)
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155">Payment · ${p.status}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-weight:600">${formatMoney(p.pendingAmount)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:right">${formatDate(p.dueDate)}</td>
      </tr>`,
    )
    .join('');

  const invoiceRows = data.invoices
    .slice(0, 5)
    .map(
      (inv) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155">${inv.invoiceNumber}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-weight:600">${formatMoney(inv.grandTotal)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:right">${formatDate(inv.dueDate)}</td>
      </tr>`,
    )
    .join('');

  const detailsTable =
    data.payments.length || data.invoices.length
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
          <tr>
            <td style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_BRAND.goldDark};padding-bottom:8px">Outstanding details</td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;color:#94a3b8;padding-bottom:6px">Reference</td>
            <td style="font-size:11px;color:#94a3b8;padding-bottom:6px;text-align:right">Amount</td>
            <td style="font-size:11px;color:#94a3b8;padding-bottom:6px;text-align:right;width:90px">Due</td>
          </tr>
          ${paymentRows}
          ${invoiceRows}
        </table>`
      : '';

  const notesBlock = data.notes
    ? `<div style="margin:20px 0;padding:14px 16px;background:${EMAIL_BRAND.goldLight};border-left:4px solid ${EMAIL_BRAND.gold};border-radius:0 8px 8px 0">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;color:${EMAIL_BRAND.goldDark}">Note from TechPotli</p>
        <p style="margin:0;font-size:14px;color:${EMAIL_BRAND.text};line-height:1.6">${data.notes}</p>
      </div>`
    : '';

  const contentHtml = `
    <div style="background:${colors.bg};border:1px solid ${colors.border};border-radius:12px;padding:16px 18px;margin-bottom:24px">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;color:${colors.accent}">${colors.badge}</p>
      <p style="margin:0;font-size:22px;font-weight:800;color:${EMAIL_BRAND.text}">Total outstanding: ${formatMoney(data.pendingTotal)}</p>
    </div>
    ${buildBodyCopy(data)}
    ${detailsTable}
    ${notesBlock}
    <div style="margin-top:24px;background:${EMAIL_BRAND.warmSurface};border:1px solid ${EMAIL_BRAND.border};border-left:4px solid ${EMAIL_BRAND.gold};border-radius:12px;padding:16px 18px">
      <p style="margin:0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:${EMAIL_BRAND.goldDark}">How to pay</p>
      <p style="margin:8px 0 0;font-size:13px;color:${EMAIL_BRAND.textMuted};line-height:1.7">
        Reply to this email or contact us with your payment reference.<br/>
        Bank details are available on your invoice PDF.
      </p>
    </div>`;

  return buildBrandedEmailLayout({
    title: tpl.label,
    subtitle: greeting,
    headerBadge: colors.badge,
    contentHtml,
  });
}
