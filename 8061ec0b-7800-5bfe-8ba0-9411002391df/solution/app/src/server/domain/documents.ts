// The signed agreement and the bill of sale, as uncompressed PDFs.

import type { Terms } from "../../shared/api.js";
import { formatMoney, formatTaxPercent } from "../../shared/money.js";
import { formatDateTime } from "../../shared/storeTime.js";
import { instrumentLabel } from "../../shared/vocabulary.js";
import { renderPdf, type PdfLine } from "../services/pdf.js";
import type { ContractRow } from "./contracts.js";

/** The agreement for `row` signed under `terms` (tax at the rate in force at signing) by `signer` at `signedAt`. */
export function agreementPdf(row: ContractRow, terms: Terms, signer: string, signedAt: Date): Buffer {
  const lines: PdfLine[] = [
    { text: `Contract ${row.id}`, bold: true },
    { text: `Student: ${row.student_name}, ${row.school_name}` },
    { text: `Instrument: ${instrumentLabel(row.instrument_type, row.size)}, serial ${row.instrument_serial}` },
    { text: `Price list: ${terms.price_list_id}` },
    { text: `Monthly base rent: ${formatMoney(terms.base_rent_cents)}`, gap: 8 },
    ...(row.waiver ? [{ text: `Monthly maintenance and damage waiver: ${formatMoney(terms.waiver_cents)}` }] : []),
    { text: `Purchase price: ${formatMoney(terms.purchase_price_cents)}` },
    { text: `Sales tax at ${formatTaxPercent(terms.tax_rate_bp)} (the rate in force when billed applies).` },
    { text: `Term: ${terms.term_months} months` },
    { text: "Each month's base rent adds equity toward the purchase price. An early buyout takes a stepped discount" },
    { text: "off the remaining balance:" },
    ...terms.tiers.map((tier) => ({ text: `  ${tier.label} (months ${tier.from_month}${tier.to_month === null ? " onward" : ` to ${tier.to_month}`})` })),
    { text: `Signed by: ${signer}`, bold: true, gap: 12 },
    { text: `Signed at: ${formatDateTime(signedAt)}` },
  ];
  return renderPdf("Keel & Bell Music - Rental agreement", lines);
}

/** The bill of sale for a paid-off contract: `amountPaid` is the buyout total with tax, or the final payment. */
export function billOfSalePdf(row: ContractRow, amountPaid: number, closedAt: Date): Buffer {
  return renderPdf("Keel & Bell Music - Bill of sale", [
    { text: `Contract ${row.id}`, bold: true },
    { text: `Buyer: ${row.parent_name}` },
    { text: `Student: ${row.student_name}` },
    { text: `Instrument: ${instrumentLabel(row.instrument_type, row.size)}, serial ${row.instrument_serial}` },
    { text: "Paid in full", bold: true, gap: 10 },
    { text: `Amount paid at close: ${formatMoney(amountPaid)}` },
    { text: `Closed: ${formatDateTime(closedAt)}` },
    { text: "Keel & Bell Music transfers ownership of this instrument to the buyer.", gap: 10 },
  ]);
}
