import { CycleRow, LineRow, PledgeRow, ProductRow } from "../db";
import { all, one } from "../db";
import { acceptingPledges, clubTimeZone, effectiveStatus, unitOwners } from "./club";
import { Credit } from "./ledger";
import { creditOf } from "./ledger";
import { cutoffDisplay, instantToIso, pickupDisplay } from "../time";

export interface LineJson {
  product_id: string;
  case_name: string;
  pack: number;
  unit: string;
  price_cents: number;
  version: number;
  pledged_units: number;
  units_to_go: number;
  status: string;
  short_units: number;
  my_units: number | null;
  cells: ("mine" | "taken" | "empty")[];
}

export interface CycleJson {
  id: string;
  name: string;
  status: string;
  revision: number;
  cutoff_at: string | null;
  cutoff_display: string | null;
  pickup_start_at: string | null;
  pickup_end_at: string | null;
  pickup_display: string | null;
  accepting_pledges: boolean;
  credit: Credit | null;
  lines: LineJson[];
}

export interface Viewer {
  role: "coordinator" | "member" | "volunteer";
  householdCode: string | null;
}

export function buildLine(
  c: CycleRow,
  ln: LineRow,
  product: ProductRow,
  viewer: Viewer
): LineJson {
  const pledges = all<PledgeRow>(
    "SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? ORDER BY id",
    c.id, ln.product_id
  );
  const pledged = pledges.reduce((n, p) => n + p.units, 0);
  const shorts = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM short_units WHERE cycle_id = ? AND product_id = ?",
    c.id, ln.product_id
  )?.n ?? 0;
  const myUnits = pledges.find((p) => p.household_code === viewer.householdCode)?.units ?? 0;
  const owners = unitOwners(c.id, ln.product_id);
  const cells: ("mine" | "taken" | "empty")[] = [];
  for (let i = 1; i <= product.pack; i++) {
    const owner = owners.find((o) => o.unitIndex === i);
    if (!owner) cells.push("empty");
    else if (owner.householdCode === viewer.householdCode) cells.push("mine");
    else cells.push("taken");
  }
  return {
    product_id: ln.product_id,
    case_name: product.case_name,
    pack: product.pack,
    unit: product.unit,
    price_cents: product.price_cents,
    version: ln.version,
    pledged_units: pledged,
    units_to_go: product.pack - pledged,
    status: ln.status,
    short_units: shorts,
    my_units: viewer.role === "member" ? myUnits : null,
    cells,
  };
}

export function buildCycle(c: CycleRow, viewer: Viewer): CycleJson {
  const tz = clubTimeZone();
  const nowSec = Math.floor(Date.now() / 1000);
  const products = all<ProductRow & { status: string; version: number }>(
    `SELECT p.*, l.status AS status, l.version AS version FROM cycle_products cp
     JOIN products p ON p.id = cp.product_id
     JOIN lines l ON l.cycle_id = cp.cycle_id AND l.product_id = cp.product_id
     WHERE cp.cycle_id = ? ORDER BY cp.sort_order, p.sort_order`,
    c.id
  );
  const lines = products.map((p) =>
    buildLine(
      c,
      { cycle_id: c.id, product_id: p.id, version: p.version, status: p.status },
      p,
      viewer
    )
  );
  return {
    id: c.id,
    name: c.name,
    status: effectiveStatus(c, nowSec),
    revision: c.revision,
    cutoff_at: instantToIso(c.cutoff_at),
    cutoff_display: c.cutoff_at === null ? null : cutoffDisplay(c.cutoff_at, tz),
    pickup_start_at: instantToIso(c.pickup_start_at),
    pickup_end_at: instantToIso(c.pickup_end_at),
    pickup_display:
      c.pickup_start_at === null || c.pickup_end_at === null
        ? null
        : pickupDisplay(c.pickup_start_at, c.pickup_end_at, tz),
    accepting_pledges: acceptingPledges(c, nowSec),
    credit: viewer.role === "member" && viewer.householdCode ? creditOf(viewer.householdCode) : null,
    lines,
  };
}

export function cycleSummary(c: CycleRow): { id: string; name: string; status: string; cutoff_display: string | null } {
  const tz = clubTimeZone();
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    id: c.id,
    name: c.name,
    status: effectiveStatus(c, nowSec),
    cutoff_display: c.cutoff_at === null ? null : cutoffDisplay(c.cutoff_at, tz),
  };
}
