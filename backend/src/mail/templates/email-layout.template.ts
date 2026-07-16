import * as fs from 'fs';
import * as path from 'path';

export const EMAIL_BRAND = {
  gold: '#C9A227',
  goldDark: '#9A7B2F',
  goldLight: '#FDF8EE',
  goldBorder: '#E8D9A8',
  charcoal: '#1A1A1A',
  charcoalMid: '#2D2D2D',
  warmBg: '#F5F3EF',
  warmSurface: '#FAF9F7',
  border: '#E8E4DF',
  text: '#1A1A1A',
  textMuted: '#6B6B6B',
  textLight: '#8A8A8A',
  cream: '#FFFBF5',
};

const COMPANY = {
  phone: '+91 9911475599',
  email: 'support@techpotli.com',
  website: 'www.techpotli.com',
  legalName: 'Techpotli E-Commerce Private Limited',
  hours: 'Mon–Sat 10:00 AM – 6:00 PM',
  tagline: 'TECH ON MAKES THINGS EASY',
};

let cachedLogoDataUri: string | null = null;

export function getEmailLogoDataUri(): string | null {
  if (cachedLogoDataUri) return cachedLogoDataUri;

  const candidates = [
    path.join(process.cwd(), 'assets', 'techpotli-logo.png'),
    path.join(__dirname, '..', '..', '..', 'assets', 'techpotli-logo.png'),
    path.join(__dirname, '..', '..', 'assets', 'techpotli-logo.png'),
  ];

  const logoPath = candidates.find((p) => fs.existsSync(p));
  if (!logoPath) return null;

  const buffer = fs.readFileSync(logoPath);
  cachedLogoDataUri = `data:image/png;base64,${buffer.toString('base64')}`;
  return cachedLogoDataUri;
}

export type BrandedEmailLayoutOptions = {
  title: string;
  subtitle?: string;
  contentHtml: string;
  headerBadge?: string;
};

export function buildBrandedEmailLayout(options: BrandedEmailLayoutOptions): string {
  const { title, subtitle, contentHtml, headerBadge } = options;
  const logoUri = getEmailLogoDataUri();

  const logoBlock = logoUri
    ? `<img src="${logoUri}" alt="TechPotli" width="150" style="display:block;max-width:150px;height:auto;border:0" />`
    : `<p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${EMAIL_BRAND.gold}">TechPotli</p>`;

  const badgeBlock = headerBadge
    ? `<span style="display:inline-block;margin-top:14px;background:${EMAIL_BRAND.goldLight};border:1px solid ${EMAIL_BRAND.goldBorder};border-radius:999px;padding:6px 14px;font-size:10px;font-weight:800;color:${EMAIL_BRAND.goldDark};text-transform:uppercase;letter-spacing:0.1em">${headerBadge}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_BRAND.warmBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${EMAIL_BRAND.warmBg};padding:32px 16px">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(17, 24, 39, 0.08)">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${EMAIL_BRAND.cream} 0%,${EMAIL_BRAND.goldLight} 60%,#FFFFFF 100%);padding:30px 28px 26px;border:1px solid ${EMAIL_BRAND.border};border-bottom:none">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td valign="middle">${logoBlock}</td>
                  <td align="right" valign="middle" style="padding-left:16px">
                    <p style="margin:0;font-size:9px;color:${EMAIL_BRAND.goldDark};text-transform:uppercase;letter-spacing:0.12em;font-weight:700">${COMPANY.tagline}</p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:20px">
                <tr>
                  <td style="height:2px;background:linear-gradient(90deg,${EMAIL_BRAND.gold} 0%,${EMAIL_BRAND.goldDark} 45%,transparent 100%);font-size:0;line-height:0">&nbsp;</td>
                </tr>
              </table>
              <h1 style="margin:18px 0 0;font-size:24px;font-weight:800;color:${EMAIL_BRAND.text};line-height:1.25;letter-spacing:-0.02em">${title}</h1>
              ${subtitle ? `<p style="margin:8px 0 0;font-size:14px;color:${EMAIL_BRAND.textMuted};font-weight:500">${subtitle}</p>` : ''}
              ${badgeBlock}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#FFFFFF;padding:32px 28px;border-left:1px solid ${EMAIL_BRAND.border};border-right:1px solid ${EMAIL_BRAND.border}">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${EMAIL_BRAND.warmSurface};border:1px solid ${EMAIL_BRAND.border};border-top:3px solid ${EMAIL_BRAND.gold};border-radius:0 0 16px 16px;padding:28px">
              <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:${EMAIL_BRAND.text};letter-spacing:0.02em">Need help?</p>
              <p style="margin:0;font-size:13px;line-height:2;color:${EMAIL_BRAND.textMuted}">
                <a href="tel:+919211405666" style="color:${EMAIL_BRAND.goldDark};text-decoration:none;font-weight:500">${COMPANY.phone}</a><br/>
                <a href="mailto:${COMPANY.email}" style="color:${EMAIL_BRAND.goldDark};text-decoration:none;font-weight:500">${COMPANY.email}</a><br/>
                <a href="https://${COMPANY.website}" style="color:${EMAIL_BRAND.goldDark};text-decoration:none;font-weight:500">${COMPANY.website}</a>
              </p>
              <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${EMAIL_BRAND.border};font-size:11px;color:${EMAIL_BRAND.textLight};line-height:1.7">
                ${COMPANY.legalName}<br/>${COMPANY.hours}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function wrapEmailBodyFragment(bodyHtml: string, subject: string): string {
  const content = bodyHtml.includes('<')
    ? bodyHtml
    : `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:${EMAIL_BRAND.textMuted}">${bodyHtml.replace(/\n/g, '<br/>')}</p>`;

  return buildBrandedEmailLayout({
    title: subject,
    contentHtml: content,
  });
}

export function isFullHtmlDocument(html: string): boolean {
  const lower = html.trim().toLowerCase();
  return lower.includes('<!doctype') || lower.includes('<html');
}

/** Extract editable inner content from a full branded email document. */
export function extractEditableBodyFromHtml(html: string): string {
  const raw = String(html ?? '').trim();
  if (!raw) return '';
  if (!isFullHtmlDocument(raw)) return raw;

  // Prefer the white body cell content from branded layout
  const bodyCellMatch = raw.match(
    /background:#FFFFFF;padding:32px 28px[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<!-- Footer -->/i,
  );
  if (bodyCellMatch?.[1]) return bodyCellMatch[1].trim();

  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch?.[1]) return bodyMatch[1].trim();

  return raw;
}
