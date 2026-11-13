// The seed district (brief: Seed data). Created only when the database is empty.
import { hashPassword, type Role } from "./auth.ts";
import type { Db } from "./db.ts";
import { flowRate, parseMl } from "./decimal.ts";
import { issueStartCard } from "./cards.ts";
import { shiftCounted } from "./orders.ts";
import { HOUR } from "./time.ts";

const PASSWORD = "channel-season-26";

interface SeedPerson {
  name: string;
  email: string;
  role: Role;
  operatorCode?: string;
  operatorKind?: "district" | "contractor";
  phone?: string;
  allocation?: string;
}

const PEOPLE: SeedPerson[] = [
  { name: "Mara Ellison", email: "mara@growers.example", role: "grower", allocation: "120.000" },
  { name: "Dev Okafor", email: "dev@growers.example", role: "grower", allocation: "80.000" },
  { name: "Lin Barrow", email: "lin@growers.example", role: "grower", allocation: "40.000" },
  { name: "Rory Kemp", email: "rory@wirrinbah.example", role: "operator", operatorCode: "OP-D-01", operatorKind: "district" },
  { name: "Tess Nguyen", email: "tess@wirrinbah.example", role: "operator", operatorCode: "OP-D-02", operatorKind: "district" },
  { name: "Jo Calder", email: "jo@contractors.example", role: "operator", operatorCode: "OP-C-07", operatorKind: "contractor", phone: "0491 570 156" },
  { name: "Sam Pirelli", email: "sam@contractors.example", role: "operator", operatorCode: "OP-C-08", operatorKind: "contractor", phone: "0491 570 159" },
  { name: "Hal Whitcombe", email: "hal@wirrinbah.example", role: "dispatcher" },
  { name: "Bea Lindqvist", email: "bea@wirrinbah.example", role: "dispatcher" },
  { name: "Priya Anand", email: "priya@wirrinbah.example", role: "clerk" },
  { name: "Quinn Mabry", email: "quinn@regulator.example", role: "reviewer" },
];

// [id, name, turnouts as [code, grower, outlet limit in ML/day]], in rail order
const CHANNELS: [id: string, name: string, turnouts: [code: string, grower: string, maxRate: string][]][] = [
  ["C-L4", "Lateral 4", [
    ["T4-07", "Mara Ellison", "40.000"], ["T4-09", "Mara Ellison", "40.000"],
    ["T4-11", "Dev Okafor", "30.000"], ["T4-15", "Lin Barrow", "25.000"],
  ]],
  ["C-09", "Channel 9", [["T9-02", "Mara Ellison", "60.000"], ["T9-05", "Dev Okafor", "30.000"]]],
  ["C-12", "Channel 12 Spur", [["T12-03", "Lin Barrow", "20.000"], ["T12-04", "Mara Ellison", "20.000"]]],
];

// [id, channel, opens (hours from H), closes (hours from H), table cap, rostered operator]
const WINDOWS: [string, string, number, number, string, string][] = [
  ["W-L4-A", "C-L4", -2, 22, "60.000", "OP-D-01"],
  ["W-L4-B", "C-L4", 22, 46, "60.000", "OP-D-02"],
  ["W-09-A", "C-09", -1, 11, "120.000", "OP-D-02"],
  ["W-12-A", "C-12", -30, -6, "30.000", "OP-D-01"],
  ["W-12-B", "C-12", 264, 288, "30.000", "OP-D-02"],
];

// [number, grower, turnout, window, volume, holder, standby], in scheduling order
const ORDERS: [string, string, string, string, string, string, string | null][] = [
  ["ORD-00001", "Mara Ellison", "T4-07", "W-L4-A", "20.000", "OP-C-07", "OP-D-02"],
  ["ORD-00002", "Dev Okafor", "T4-11", "W-L4-A", "30.000", "OP-D-01", null],
  ["ORD-00003", "Dev Okafor", "T9-05", "W-09-A", "15.000", "OP-C-08", null],
];

const ml = (text: string) => parseMl(text)!;

export async function seedDistrict(db: Db): Promise<void> {
  const existing = await db.query("SELECT 1 FROM channel LIMIT 1");
  if (existing.rowCount) return;

  const ids = new Map<string, number>();
  for (const person of PEOPLE) {
    const inserted = await db.query<{ id: number }>(
      `INSERT INTO person (name, email, password_hash, role, operator_code, operator_kind, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [person.name, person.email, await hashPassword(PASSWORD), person.role,
        person.operatorCode ?? null, person.operatorKind ?? null, person.phone ?? null],
    );
    ids.set(person.name, inserted.rows[0]!.id);
    if (person.allocation) {
      await db.query("INSERT INTO allocation (grower_id, allocation_milli) VALUES ($1, $2)", [
        inserted.rows[0]!.id, ml(person.allocation),
      ]);
    }
  }

  const now = new Date();
  const h = Math.floor(now.getTime() / HOUR) * HOUR;
  for (const [order, [id, name, turnouts]] of CHANNELS.entries()) {
    await db.query("INSERT INTO channel (id, name, rail_order, capacity_revision) VALUES ($1, $2, $3, 1)", [id, name, order + 1]);
    await db.query(
      "INSERT INTO capacity_revision (channel_id, revision, saved_at, saved_by) VALUES ($1, 1, $2, 'District seed')",
      [id, now],
    );
    for (const [code, grower, maxRate] of turnouts) {
      await db.query("INSERT INTO turnout (code, channel_id, grower_id, max_rate_milli) VALUES ($1, $2, $3, $4)", [
        code, id, ids.get(grower), ml(maxRate),
      ]);
    }
  }

  const hours = new Map<string, number>();
  for (const [id, channel, opens, closes, cap, rostered] of WINDOWS) {
    hours.set(id, closes - opens);
    await db.query(
      `INSERT INTO delivery_window (id, channel_id, opens_at, closes_at, hours, table_cap_milli, rostered_operator)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, channel, new Date(h + opens * HOUR), new Date(h + closes * HOUR), closes - opens, ml(cap), rostered],
    );
    await db.query("INSERT INTO capacity_cell (channel_id, revision, window_id, cap_milli) VALUES ($1, 1, $2, $3)", [
      channel, id, ml(cap),
    ]);
  }

  for (const [index, [number, grower, turnout, window, volume, holder, standby]] of ORDERS.entries()) {
    const rate = flowRate(ml(volume), hours.get(window)!);
    await db.query(
      `INSERT INTO water_order (number, grower_id, turnout, window_id, requested_milli, volume_milli, rate_milli, status, holder_code, standby_code, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, 'scheduled', $7, $8, $9)`,
      [number, ids.get(grower), turnout, window, ml(volume), rate, holder, standby, new Date(now.getTime() + index)],
    );
    await shiftCounted(db, { window_id: window, grower_id: ids.get(grower)! }, ml(volume));
    await issueStartCard(db, { number, holder_code: holder, rate_milli: rate });
  }

  await db.query("INSERT INTO counter (name, value) VALUES ('order', 3), ('pack', 0), ('window', 5)");
}
