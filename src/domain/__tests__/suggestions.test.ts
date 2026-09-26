import { detectDate, detectIssuer, detectType, matchFolder, suggestFiling } from '../suggestions';

const NOW = new Date('2026-09-26T10:00:00Z');

describe('detectDate', () => {
  it.each([
    ['Date: 12/09/2026', '2026-09-12'],
    ['12-09-26 14:02', '2026-09-12'],
    ['Issued 2026-03-01', '2026-03-01'],
    ['15th October, 2026', '2026-10-15'],
    ['Sept 3, 2025', '2025-09-03'],
    // Only valid as month/day (US order).
    ['12/25/2025', '2025-12-25'],
  ])('%s → %s', (text, expected) => {
    expect(detectDate(text, NOW)).toBe(expected);
  });

  it('rejects impossible and far-future dates, and takes the first date', () => {
    expect(detectDate('31/02/2026', NOW)).toBeNull();
    expect(detectDate('Valid until 01/01/2031', NOW)).toBeNull();
    expect(detectDate('Paid 03/04/2026, due 30/04/2026', NOW)).toBe('2026-04-03');
    expect(detectDate('Phone 0712 345 678', NOW)).toBeNull();
  });
});

describe('detectType', () => {
  it('recognises common Kenyan paperwork', () => {
    expect(detectType('CASH SALE\nTOTAL 1,250\nM-PESA\nThank you for shopping')).toBe('receipt');
    expect(detectType('TAX INVOICE\nBill to: Acme Ltd\nAmount due KSh 25,000\nDue date 15/10/2026')).toBe('invoice');
    expect(detectType('PAYSLIP September\nBasic salary\nPAYE\nNHIF\nNSSF\nNet pay')).toBe('payslip');
    expect(detectType('TENANCY AGREEMENT between the landlord and the tenant')).toBe('contract');
    expect(detectType('Patient: J. Otieno\nDiagnosis: malaria\nPrescription: tablets')).toBe('medical');
  });

  it('needs enough evidence', () => {
    expect(detectType('Total')).toBeNull();
    expect(detectType('Lecture notes on linear algebra')).toBeNull();
  });
});

describe('detectIssuer', () => {
  it('takes the first clean line, title-cased when shouted', () => {
    expect(detectIssuer('NAIVAS LIMITED\nP.O. Box 123')).toBe('Naivas Limited');
    expect(detectIssuer('RECEIPT\n12/09/2026\nJava House')).toBe('Java House');
    expect(detectIssuer('0712 345 678\n*** 123 ***')).toBeNull();
  });
});

describe('matchFolder', () => {
  const folders = [
    { id: 'f1', name: 'Receipts' },
    { id: 'f2', name: 'KRA' },
    { id: 'f3', name: 'School fees' },
  ];

  it('matches by document type first, then by a folder name mentioned in the text', () => {
    expect(matchFolder('receipt', 'anything', folders)).toBe('f1');
    expect(matchFolder(null, 'KRA PIN certificate A123', folders)).toBe('f2');
    expect(matchFolder(null, 'Nothing relevant', folders)).toBeNull();
  });
});

describe('suggestFiling', () => {
  it('builds a title from type, issuer and date', () => {
    expect(suggestFiling('JAVA HOUSE\nReceipt\n03/04/2026\nTotal 850\nPaid M-PESA', [], NOW)).toEqual({
      type: 'receipt',
      title: 'Receipt – Java House 2026-04-03',
      date: '2026-04-03',
      folderId: null,
    });
  });

  it('returns null for pages without useful text', () => {
    expect(suggestFiling('', [], NOW)).toBeNull();
    expect(suggestFiling('~~ 12 ~~', [], NOW)).toBeNull();
  });
});
