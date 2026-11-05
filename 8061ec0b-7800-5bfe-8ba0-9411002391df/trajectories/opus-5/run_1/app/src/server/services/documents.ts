import { formatMoney, formatTaxPercent } from '../../shared/money';
import { formatStoreDateTime } from '../../shared/time';
import type { ContractTerms } from '../../shared/types';
import { buildPdf } from './pdf';

export interface AgreementFacts {
  contractId: string;
  studentName: string;
  serial: string;
  instrumentLabel: string;
  terms: ContractTerms;
  waiver: boolean;
  taxRateBpAtSigning: number;
  fullName: string;
  signedAt: Date;
}

export function buildAgreementPdf(facts: AgreementFacts): Buffer {
  const lines: string[] = [
    'Keel & Bell Music — rental agreement',
    '',
    `Contract ${facts.contractId}`,
    `Student: ${facts.studentName}`,
    `Instrument: ${facts.instrumentLabel}`,
    `Serial: ${facts.serial}`,
    `Price list: ${facts.terms.price_list_id}`,
    '',
    `Monthly base rent: ${formatMoney(facts.terms.base_rent_cents)}`,
  ];
  if (facts.waiver) lines.push(`Monthly maintenance and damage waiver: ${formatMoney(facts.terms.waiver_cents)}`);
  lines.push(`Purchase price: ${formatMoney(facts.terms.purchase_price_cents)}`);
  lines.push(
    `Sales tax at ${formatTaxPercent(facts.taxRateBpAtSigning)} (the rate in force when billed applies).`,
  );
  lines.push(`Term: ${facts.terms.term_months} months`);
  lines.push('');
  lines.push('Early buyout discount schedule:');
  for (const tier of facts.terms.tiers) lines.push(tier.label);
  lines.push('');
  lines.push('Each month of base rent builds equity toward the purchase price.');
  lines.push('');
  lines.push(`Signed by: ${facts.fullName}`);
  lines.push(`Signed at: ${formatStoreDateTime(facts.signedAt)}`);
  return buildPdf(lines);
}

export interface BillOfSaleFacts {
  contractId: string;
  parentName: string;
  studentName: string;
  instrumentLabel: string;
  serial: string;
  amountPaidCents: number;
  closedAt: Date;
}

export function buildBillOfSalePdf(facts: BillOfSaleFacts): Buffer {
  return buildPdf([
    'Keel & Bell Music — bill of sale',
    '',
    `Contract ${facts.contractId}`,
    `Sold to: ${facts.parentName}`,
    `Student: ${facts.studentName}`,
    `Instrument: ${facts.instrumentLabel}`,
    `Serial: ${facts.serial}`,
    '',
    'Paid in full',
    `Amount paid at close: ${formatMoney(facts.amountPaidCents)}`,
    `Closed at: ${formatStoreDateTime(facts.closedAt)}`,
  ]);
}
