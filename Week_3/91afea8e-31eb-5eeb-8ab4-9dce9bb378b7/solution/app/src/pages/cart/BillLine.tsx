import type { ReactNode } from "react";
import { rupees } from "../../../shared/format";

interface BillLineProps {
  label: string;
  paise: number;
  /** A deduction is drawn with a minus sign. */
  deduct?: boolean;
  strong?: boolean;
}

/** One bill line at poster volume: heavy display type, never smaller than body text, the amount never wraps. */
export function BillLine({ label, paise, deduct, strong }: BillLineProps): ReactNode {
  return (
    <div className={`bill bill-line${strong ? " bill-line--strong" : ""}`}>
      <span>{label}</span>
      <span className="amount">{rupees(deduct ? -paise : paise)}</span>
    </div>
  );
}

interface TaxedLine {
  gst_rate: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  coupon_share_paise: number;
  line_total_paise: number;
}

function percent(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

/** A line's taxable value, its CGST and SGST (or IGST), its coupon share and its total. */
export function LineBill({ line }: { line: TaxedLine }): ReactNode {
  return (
    <div className="line-bill">
      <BillLine label="taxable value" paise={line.taxable_value_paise} />
      {line.igst_paise > 0 ? (
        <BillLine label={`IGST ${percent(line.gst_rate)}`} paise={line.igst_paise} />
      ) : (
        <>
          <BillLine label={`CGST ${percent(line.gst_rate / 2)}`} paise={line.cgst_paise} />
          <BillLine label={`SGST ${percent(line.gst_rate / 2)}`} paise={line.sgst_paise} />
        </>
      )}
      {line.coupon_share_paise > 0 && <BillLine label="coupon share" paise={line.coupon_share_paise} deduct />}
      <BillLine label="line total" paise={line.line_total_paise} strong />
    </div>
  );
}
