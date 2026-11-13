import type { PoolClient } from "pg";
import { query } from "../db.js";
import { publicId } from "../id.js";
import { returnSettlement, saleSettlement, type SettlementAmounts } from "../domain/settlement.js";
import { todayInIndia } from "../domain/promise.js";

interface SaleLine {
  id: string;
  seller_id: string;
  shipment_id: string;
  quantity: number;
  unit_price_paise: number;
  gst_rate: number;
  commission_percent: number;
  emi_share_paise: number;
}

function insert(client: PoolClient, line: SaleLine, kind: "sale" | "return", amounts: SettlementAmounts, commissionPercent: number, nowMs: number): Promise<unknown> {
  return query(
    `INSERT INTO settlement_lines (id, seller_id, shipment_id, line_id, kind, posted_on, gross_paise, commission_percent, commission_paise,
        commission_gst_paise, tcs_paise, tds_paise, emi_subvention_paise, net_paise)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      publicId("ST"), line.seller_id, line.shipment_id, line.id, kind, todayInIndia(nowMs), amounts.grossPaise, commissionPercent,
      amounts.commissionPaise, amounts.commissionGstPaise, amounts.tcsPaise, amounts.tdsPaise, amounts.emiSubventionPaise, amounts.netPaise,
    ],
    client,
  );
}

async function saleLines(column: "sl.shipment_id" | "sl.id", value: string, client: PoolClient): Promise<SaleLine[]> {
  return query<SaleLine & Record<string, unknown>>(
    `SELECT sl.id, s.seller_id, sl.shipment_id, sl.quantity, sl.unit_price_paise, sl.gst_rate, sl.commission_percent, sl.emi_share_paise
       FROM shipment_lines sl JOIN shipments s ON s.id = sl.shipment_id WHERE ${column} = $1 ORDER BY sl.seq`,
    [value],
    client,
  );
}

/** Delivery posts one sale settlement line per shipment line. */
export async function postSales(shipmentId: string, nowMs: number, client: PoolClient): Promise<void> {
  for (const line of await saleLines("sl.shipment_id", shipmentId, client)) {
    const sale = saleSettlement(line.unit_price_paise * line.quantity, line.gst_rate, line.commission_percent, line.emi_share_paise);
    await insert(client, line, "sale", sale, line.commission_percent, nowMs);
  }
}

interface SettlementRow {
  gross_paise: number;
  commission_paise: number;
  commission_gst_paise: number;
  tcs_paise: number;
  tds_paise: number;
  emi_subvention_paise: number;
  net_paise: number;
}

function amountsOf(row: SettlementRow): SettlementAmounts {
  return {
    grossPaise: row.gross_paise,
    commissionPaise: row.commission_paise,
    commissionGstPaise: row.commission_gst_paise,
    tcsPaise: row.tcs_paise,
    tdsPaise: row.tds_paise,
    emiSubventionPaise: row.emi_subvention_paise,
    netPaise: row.net_paise,
  };
}

/** A refunded return or support refund of k of q units posts a return line. */
export async function postReturn(lineId: string, unitsReturned: number, unitsBefore: number, nowMs: number, client: PoolClient): Promise<void> {
  const [sale] = await query<SettlementRow & Record<string, unknown>>("SELECT * FROM settlement_lines WHERE line_id = $1 AND kind = 'sale'", [lineId], client);
  if (!sale) return;
  const previous = await query<SettlementRow & Record<string, unknown>>("SELECT * FROM settlement_lines WHERE line_id = $1 AND kind = 'return'", [lineId], client);
  const reversed = previous.reduce<SettlementAmounts>(
    (sum, row) => ({
      grossPaise: sum.grossPaise - row.gross_paise,
      commissionPaise: sum.commissionPaise - row.commission_paise,
      commissionGstPaise: sum.commissionGstPaise - row.commission_gst_paise,
      tcsPaise: sum.tcsPaise - row.tcs_paise,
      tdsPaise: sum.tdsPaise - row.tds_paise,
      emiSubventionPaise: sum.emiSubventionPaise - row.emi_subvention_paise,
      netPaise: sum.netPaise - row.net_paise,
    }),
    { grossPaise: 0, commissionPaise: 0, commissionGstPaise: 0, tcsPaise: 0, tdsPaise: 0, emiSubventionPaise: 0, netPaise: 0 },
  );
  const [line] = await saleLines("sl.id", lineId, client);
  if (!line) return;
  const amounts = returnSettlement(amountsOf(sale), reversed, unitsReturned, line.quantity - unitsBefore, line.quantity);
  await insert(client, line, "return", amounts, line.commission_percent, nowMs);
}
