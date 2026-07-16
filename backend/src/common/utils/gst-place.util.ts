/** GST place-of-supply helpers for TechPotli (supplier state: Delhi / 07). */

const STATE_CODES: Record<string, string> = {
  'andaman and nicobar islands': '35',
  andaman: '35',
  'andhra pradesh': '37',
  'arunachal pradesh': '12',
  assam: '18',
  bihar: '10',
  chandigarh: '04',
  chhattisgarh: '22',
  delhi: '07',
  'nct of delhi': '07',
  'new delhi': '07',
  goa: '30',
  gujarat: '24',
  haryana: '06',
  'himachal pradesh': '02',
  'jammu and kashmir': '01',
  jharkhand: '20',
  karnataka: '29',
  kerala: '32',
  ladakh: '38',
  lakshadweep: '31',
  'madhya pradesh': '23',
  maharashtra: '27',
  manipur: '14',
  meghalaya: '17',
  mizoram: '15',
  nagaland: '13',
  odisha: '21',
  puducherry: '34',
  punjab: '03',
  rajasthan: '08',
  sikkim: '11',
  'tamil nadu': '33',
  telangana: '36',
  tripura: '16',
  'uttar pradesh': '09',
  uttarakhand: '05',
  'west bengal': '19',
};

export function normalizeStateName(state?: string | null): string {
  return String(state ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isDelhiState(state?: string | null): boolean {
  const n = normalizeStateName(state);
  if (!n) return false;
  return (
    n === 'delhi' ||
    n === 'new delhi' ||
    n === 'nct of delhi' ||
    n.includes('delhi')
  );
}

export function gstStateCode(state?: string | null): string {
  const n = normalizeStateName(state);
  if (!n) return '';
  if (STATE_CODES[n]) return STATE_CODES[n];
  for (const [name, code] of Object.entries(STATE_CODES)) {
    if (n.includes(name) || name.includes(n)) return code;
  }
  return '';
}

export function displayStateName(state?: string | null): string {
  const raw = String(state ?? '').trim();
  if (!raw) return '';
  if (isDelhiState(raw)) return 'Delhi';
  return raw;
}

export type InvoiceTaxType = 'CGST_SGST' | 'IGST';

export function computeInvoiceTax(subtotal: number, isDelhi: boolean) {
  const gstRate = 18;
  const gstAmount = Math.round(subtotal * gstRate) / 100;
  const taxType: InvoiceTaxType = isDelhi ? 'CGST_SGST' : 'IGST';
  if (isDelhi) {
    const half = Math.round((gstAmount / 2) * 100) / 100;
    // Adjust so cgst+sgst equals gstAmount exactly
    const cgstAmount = half;
    const sgstAmount = Math.round((gstAmount - half) * 100) / 100;
    return {
      gstRate,
      gstAmount,
      taxType,
      cgstAmount,
      sgstAmount,
      igstAmount: 0,
      grandTotal: Math.round((subtotal + gstAmount) * 100) / 100,
      placeOfSupply: 'Delhi',
    };
  }
  return {
    gstRate,
    gstAmount,
    taxType,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: gstAmount,
    grandTotal: Math.round((subtotal + gstAmount) * 100) / 100,
    placeOfSupply: undefined as string | undefined,
  };
}
