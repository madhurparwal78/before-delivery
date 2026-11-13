import type { Parcel, Quote, QuoteLine } from "../../lib/types";

const PANEL_TONES = ["pink", "yellow", "black", "raised"] as const;
type PanelTone = (typeof PANEL_TONES)[number];

/** One seller's lines in the cart and, once one of them is selected, that seller's parcel. */
export interface Group {
  sellerId: string;
  sellerName: string;
  lines: QuoteLine[];
  parcel: Parcel | null;
}

/** One group per seller, in the order the sellers first appear in the cart. */
export function groupLines(quote: Quote): Group[] {
  const groups: Group[] = [];
  for (const line of quote.lines) {
    let group = groups.find((candidate) => candidate.sellerId === line.seller_id);
    if (!group) {
      group = { sellerId: line.seller_id, sellerName: line.seller_name, lines: [], parcel: quote.parcels.find((parcel) => parcel.seller_id === line.seller_id) ?? null };
      groups.push(group);
    }
    group.lines.push(line);
  }
  return groups;
}

/** The line a shopper reaches next when `lineId` leaves the cart: the one after it in page order, else the one before. */
export function neighbourOf(groups: Group[], lineId: string): string | null {
  const order = groups.flatMap((group) => group.lines.map((line) => line.line_id));
  const at = order.indexOf(lineId);
  return order[at + 1] ?? order[at - 1] ?? null;
}

/** Panels of one parcel colour each; the cards on them are black, except on black panels where they are raised. */
export function toneOf(index: number): PanelTone {
  return PANEL_TONES[index % PANEL_TONES.length] as PanelTone;
}
