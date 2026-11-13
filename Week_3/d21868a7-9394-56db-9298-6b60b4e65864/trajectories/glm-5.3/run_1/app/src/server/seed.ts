// Seed data: the district, created once, when the database is empty.
import pg from "pg";
import { createHash, scryptSync, randomBytes } from "node:crypto";
import { formatInstant } from "../shared/district-time.ts";
import { capVolumeMl, rateMlDay } from "../shared/domain.ts";

export const SEED_PASSWORD = "channel-season-26";

// scrypt in the installed format: scrypt$N$r$p$salt$hash
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "hex");
  const want = Buffer.from(parts[5] ?? "", "hex");
  const got = scryptSync(password, salt, want.length, { N, r, p });
  return got.equals(want);
}

const H = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0);
};

export async function seedIfEmpty(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // One transaction so a half-seeded district never exists.
    await client.query("BEGIN");
    const existing = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM people");
    if (existing.rows[0]!.count > 0) {
      await client.query("COMMIT");
      return;
    }

    const h = H();
    const hour = 3600 * 1000;

    const people: Array<[string, string, string, string | null, string | null, string | null]> = [
      ["Mara Ellison", "mara@growers.example", "grower", null, null, null],
      ["Dev Okafor", "dev@growers.example", "grower", null, null, null],
      ["Lin Barrow", "lin@growers.example", "grower", null, null, null],
      ["Rory Kemp", "rory@wirrinbah.example", "operator", "OP-D-01", "district", null],
      ["Tess Nguyen", "tess@wirrinbah.example", "operator", "OP-D-02", "district", null],
      ["Jo Calder", "jo@contractors.example", "operator", "OP-C-07", "contractor", "0491 570 156"],
      ["Sam Pirelli", "sam@contractors.example", "operator", "OP-C-08", "contractor", "0491 570 159"],
      ["Hal Whitcombe", "hal@wirrinbah.example", "dispatcher", null, null, null],
      ["Bea Lindqvist", "bea@wirrinbah.example", "dispatcher", null, null, null],
      ["Priya Anand", "priya@wirrinbah.example", "clerk", null, null, null],
      ["Quinn Mabry", "quinn@regulator.example", "reviewer", null, null, null],
    ];
    const ids = new Map<string, number>();
    const pass = hashPassword(SEED_PASSWORD);
    for (const [name, email, role, code, kind, phone] of people) {
      const res = await client.query<{ id: number }>(
        `INSERT INTO people (name, email, password_hash, role, operator_code, operator_kind, phone, erased)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id`,
        [name, email, pass, role, code, kind, phone],
      );
      ids.set(email, res.rows[0]!.id);
    }

    const channels: Array<[string, string]> = [
      ["C-L4", "Lateral 4"],
      ["C-09", "Channel 9"],
      ["C-12", "Channel 12 Spur"],
    ];
    for (let i = 0; i < channels.length; i++) {
      await client.query("INSERT INTO channels (id, name, rail_order) VALUES ($1,$2,$3)", [channels[i]![0], channels[i]![1], i + 1]);
    }

    const turnouts: Array<[string, string, string, string]> = [
      ["T4-07", "C-L4", "mara@growers.example", "40.000"],
      ["T4-09", "C-L4", "mara@growers.example", "40.000"],
      ["T4-11", "C-L4", "dev@growers.example", "30.000"],
      ["T4-15", "C-L4", "lin@growers.example", "25.000"],
      ["T9-02", "C-09", "mara@growers.example", "60.000"],
      ["T9-05", "C-09", "dev@growers.example", "30.000"],
      ["T12-03", "C-12", "lin@growers.example", "20.000"],
      ["T12-04", "C-12", "mara@growers.example", "20.000"],
    ];
    for (const [code, channelId, growerEmail, maxRate] of turnouts) {
      await client.query(
        "INSERT INTO turnouts (code, channel_id, grower_id, max_rate_ml_day) VALUES ($1,$2,$3,$4)",
        [code, channelId, ids.get(growerEmail)!, maxRate],
      );
    }

    const windows: Array<[string, string, number, number, string, string]> = [
      ["W-L4-A", "C-L4", h - 2 * hour, h + 22 * hour, "60.000", "OP-D-01"],
      ["W-L4-B", "C-L4", h + 22 * hour, h + 46 * hour, "60.000", "OP-D-02"],
      ["W-09-A", "C-09", h - 1 * hour, h + 11 * hour, "120.000", "OP-D-02"],
      ["W-12-A", "C-12", h - 30 * hour, h - 6 * hour, "30.000", "OP-D-01"],
      ["W-12-B", "C-12", h + 264 * hour, h + 288 * hour, "30.000", "OP-D-02"],
    ];
    for (const [id, channelId, opensAt, closesAt, cap, rostered] of windows) {
      const hours = Math.round((closesAt - opensAt) / hour);
      const capVolume = capVolumeMl(cap, null, null, opensAt, hours);
      await client.query(
        `INSERT INTO windows (id, channel_id, opens_at, closes_at, hours, rostered_operator, cap_volume_ml, committed_ml, delivered_ml)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'0.000','0.000')`,
        [id, channelId, new Date(opensAt), new Date(closesAt), hours, rostered, capVolume],
      );
    }

    // allocations
    const allocations: Array<[string, string]> = [
      ["mara@growers.example", "120.000"],
      ["dev@growers.example", "80.000"],
      ["lin@growers.example", "40.000"],
    ];
    for (const [email, allocation] of allocations) {
      await client.query("INSERT INTO allocations (grower_id, allocation_ml, debited_ml) VALUES ($1,$2,'0.000')", [ids.get(email)!, allocation]);
    }

    // capacity revision 1 for each channel, saved by the first dispatcher
    for (const [channelId] of channels) {
      const rev = await client.query<{ id: number }>(
        "INSERT INTO capacity_revisions (channel_id, revision, saved_at, saved_by, restored_from) VALUES ($1,1,now(),$2,null) RETURNING id",
        [channelId, ids.get("hal@wirrinbah.example")!],
      );
      const revId = rev.rows[0]!.id;
      const wres = await client.query<{ id: string }>("SELECT id FROM windows WHERE channel_id = $1 ORDER BY opens_at", [channelId]);
      // caps per window from the seed table
      const caps: Record<string, string> = { "W-L4-A": "60.000", "W-L4-B": "60.000", "W-09-A": "120.000", "W-12-A": "30.000", "W-12-B": "30.000" };
      for (const w of wres.rows) {
        await client.query("INSERT INTO capacity_cells (revision_id, window_id, cap_ml_day) VALUES ($1,$2,$3)", [revId, w.id, caps[w.id] ?? "0.000"]);
      }
    }

    // orders, all scheduled with open start cards
    const orders: Array<[string, string, string, string, string, string, string | null]> = [
      ["ORD-00001", "mara@growers.example", "T4-07", "W-L4-A", "20.000", "OP-C-07", "OP-D-02"],
      ["ORD-00002", "dev@growers.example", "T4-11", "W-L4-A", "30.000", "OP-D-01", null],
      ["ORD-00003", "dev@growers.example", "T9-05", "W-09-A", "15.000", "OP-C-08", null],
    ];
    const windowHoursMap = new Map<string, number>();
    for (const [id, , opensAt, closesAt] of windows) windowHoursMap.set(id, Math.round((closesAt - opensAt) / hour));
    for (const [number, email, turnout, windowId, volume, holder, standby] of orders) {
      const hours = windowHoursMap.get(windowId)!;
      const rate = rateMlDay(volume, hours);
      const res = await client.query<{ opens_at: Date; channel_id: string }>("SELECT opens_at, channel_id FROM windows WHERE id = $1", [windowId]);
      const scheduledAt = res.rows[0]!.opens_at;
      const channelId = res.rows[0]!.channel_id;
      await client.query(
        `INSERT INTO orders (number, grower_id, turnout, window_id, requested_ml, volume_ml, rate_ml_day, status, holder_code, standby_code, conflict, rationed, closed_after_flow, scheduled_at, seq)
         VALUES ($1,$2,$3,$4,$5,$5,$6,'scheduled',$7,$8,null,false,false,$9,nextval('orders_seq'))`,
        [number, ids.get(email)!, turnout, windowId, volume, rate, holder, standby, scheduledAt],
      );
      await client.query("UPDATE windows SET committed_ml = (committed_ml::numeric + $1::numeric)::text WHERE id = $2", [volume, windowId]);
      const growerId = ids.get(email)!;
      await client.query("UPDATE allocations SET debited_ml = (debited_ml::numeric + $1::numeric)::text WHERE grower_id = $2", [volume, growerId]);
      await client.query(
        `INSERT INTO gate_cards (order_number, turnout, channel_id, window_id, kind, state, holder_code, from_ml_day, to_ml_day)
         VALUES ($1,$2,$3,$4,'start','open',$5,'0.000',$6)`,
        [number, turnout, channelId, windowId, holder, rate],
      );
    }

    // sequences start points
    await client.query("INSERT INTO packs_last_number (id, last_number) VALUES (1, 0) ON CONFLICT DO NOTHING");
    // order numbers continue from ORD-00004
    await client.query("SELECT setval('orders_seq', 3, true)");

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export { formatInstant };
