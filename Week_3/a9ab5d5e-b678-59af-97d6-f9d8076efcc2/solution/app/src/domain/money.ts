import { ParentRole } from './plan';

interface SplitBp {
  planning: number;
  other: number;
}

interface Shares {
  planning: number;
  other: number;
}

/** Largest-remainder (Hamilton) allocation in integer minor units, ties to the paying parent. */
export function allocateShares(amountMinor: number, splitBp: SplitBp, paidBy: ParentRole): Shares {
  const exact = {
    planning: amountMinor * splitBp.planning,
    other: amountMinor * splitBp.other,
  };
  const floors = { planning: Math.floor(exact.planning / 10000), other: Math.floor(exact.other / 10000) };
  const remainders = { planning: exact.planning % 10000, other: exact.other % 10000 };
  let left = amountMinor - floors.planning - floors.other;
  const order: ParentRole[] = ['planning', 'other'];
  order.sort((a, b) => {
    const diff = remainders[b] - remainders[a];
    if (diff !== 0) return diff;
    if (a === paidBy) return -1;
    if (b === paidBy) return 1;
    return 0;
  });
  const shares: Shares = { ...floors };
  for (const role of order) {
    if (left <= 0) break;
    shares[role] += 1;
    left -= 1;
  }
  return shares;
}

const zeroDecimalCurrencies = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

const threeDecimalCurrencies = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const fourDecimalCurrencies = new Set(['CLF', 'UYW']);

/** Active ISO 4217 alphabetic codes. */
export const activeCurrencies = new Set([
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BOV',
  'BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHE','CHF','CHW','CLF','CLP','CNY','COP','COU','CRC','CUP','CVE','CZK',
  'DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL',
  'HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT',
  'LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MXV','MYR',
  'MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF',
  'SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP',
  'TRY','TTD','TWD','TZS','UAH','UGX','USD','USN','UYI','UYU','UYW','UZS','VED','VES','VND','VUV','WST','XAF','XCD','XCG',
  'XDR','XOF','XPF','XSU','XUA','YER','ZAR','ZMW','ZWG',
]);

export function currencyExponent(currency: string): number {
  if (zeroDecimalCurrencies.has(currency)) return 0;
  if (threeDecimalCurrencies.has(currency)) return 3;
  if (fourDecimalCurrencies.has(currency)) return 4;
  return 2;
}
