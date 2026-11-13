import { randomBytes } from "node:crypto";
import { hashPassword } from "./auth.js";
import { SCHEMA, tx } from "./db.js";
import { ceilingFor } from "./pricing.js";

const DRINKS = [
  ["kairi-panna", "Kairi Panna", false, 9000],
  ["balcony-soda", "Balcony Soda", true, 7500],
  ["second-show-jeera", "Second Show Jeera", true, 6200],
  ["matinee-kokum", "Matinee Kokum", false, 8400],
  ["ticket-nimbu", "Ticket Nimbu", false, 5500],
  ["reel-gulab", "Reel Gulab", false, 10500],
] as const;

const SKUS = [
  ["KP-200-CTN", "kairi-panna", "200 ml Carton", "carton", 200, 365, 2000],
  ["KP-600-PET", "kairi-panna", "600 ml PET", "pet", 600, 365, 4500],
  ["KP-1200-PET", "kairi-panna", "1.2 L PET", "pet", 1200, 365, 8000],
  ["BS-300-GLS", "balcony-soda", "300 ml Glass", "glass", 300, 365, 2500],
  ["BS-300-CAN", "balcony-soda", "300 ml Can", "can", 300, 365, 3000],
  ["BS-750-PET", "balcony-soda", "750 ml PET", "pet", 750, 365, 4500],
  ["SJ-300-CAN", "second-show-jeera", "300 ml Can", "can", 300, 365, 3500],
  ["SJ-1000-PET", "second-show-jeera", "1 L PET", "pet", 1000, 365, 9000],
  ["MK-200-CTN", "matinee-kokum", "200 ml Carton", "carton", 200, 365, 2000],
  ["MK-1000-PET", "matinee-kokum", "1 L PET", "pet", 1000, 365, 8000],
  ["TN-500-PET", "ticket-nimbu", "500 ml PET", "pet", 500, 365, 2000],
  ["TN-200-CTN", "ticket-nimbu", "200 ml Carton", "carton", 200, 365, 1000],
  ["RG-300-GLS", "reel-gulab", "300 ml Glass", "glass", 300, 180, 3000],
  ["RG-2000-PET", "reel-gulab", "2 L PET", "pet", 2000, 365, 12000],
] as const;

const BATCHES = [
  ["NSK-260915-07", "KP-200-CTN"], ["NSK-261005-02", "KP-200-CTN"], ["NSK-260918-01", "KP-600-PET"],
  ["PUN-260920-03", "KP-1200-PET"], ["NSK-261001-04", "BS-300-GLS"], ["PUN-261002-01", "BS-300-CAN"],
  ["NSK-261010-08", "BS-750-PET"], ["PUN-261020-06", "SJ-300-CAN"], ["PUN-261012-03", "SJ-1000-PET"],
  ["NSK-260922-06", "MK-200-CTN"], ["NSK-260925-09", "MK-1000-PET"], ["NSK-260720-05", "TN-500-PET"],
  ["NSK-260810-05", "TN-500-PET"], ["PUN-260905-02", "TN-200-CTN"], ["NSK-250301-03", "RG-300-GLS"],
  ["PUN-260915-02", "RG-2000-PET"],
] as const;

const ACCOUNTS = [
  ["editor", "Vasant Talkies Desk", "editor@vasant-talkies.example", "Interval-Editor-2026"],
  ["stockist", "Sagar Traders", "orders@sagar-traders.example", "Interval-Stock-A1"],
  ["stockist", "Deccan Cold Chain", "orders@deccan-cold.example", "Interval-Stock-B2"],
] as const;

interface SeedRow { sku: string; old: number; revised: number }
interface SeedVersion {
  version: number; reason: string | null; published: string; rows: SeedRow[];
}
interface SeedNotice {
  number: string; title: string; kind: "sticker" | "new_print"; rates: [number, number] | null; effective: string;
  runOut: string | null; versions: SeedVersion[];
}

const NOTICES: SeedNotice[] = [
  {
    number: "VT-2026-01", title: "Ticket Nimbu new print", kind: "new_print", rates: null, effective: "2026-08-01", runOut: null,
    versions: [
      { version: 1, reason: null, published: "2026-07-20T12:00:00+05:30", rows: [{ sku: "TN-500-PET", old: 2000, revised: 2400 }, { sku: "TN-200-CTN", old: 1000, revised: 1200 }] },
      { version: 2, reason: "Corrected the Ticket Nimbu 500 ml new-print price.", published: "2026-07-24T12:00:00+05:30", rows: [{ sku: "TN-500-PET", old: 2000, revised: 2250 }, { sku: "TN-200-CTN", old: 1000, revised: 1200 }] },
    ],
  },
  {
    number: "VT-2026-02", title: "Fruit drinks rate change", kind: "sticker", rates: [12, 5], effective: "2026-10-01", runOut: "2026-12-31",
    versions: [{ version: 1, reason: null, published: "2026-09-25T12:00:00+05:30", rows: [
      { sku: "KP-200-CTN", old: 2000, revised: 1875 }, { sku: "KP-600-PET", old: 4500, revised: 4200 }, { sku: "KP-1200-PET", old: 8000, revised: 7500 },
      { sku: "MK-200-CTN", old: 2000, revised: 1875 }, { sku: "MK-1000-PET", old: 8000, revised: 7500 }] }],
  },
  {
    number: "VT-2026-03", title: "Aerated drinks rate change", kind: "sticker", rates: [28, 40], effective: "2026-10-15", runOut: null,
    versions: [{ version: 1, reason: null, published: "2026-10-08T12:00:00+05:30", rows: [{ sku: "BS-300-GLS", old: 2500, revised: 2700 }, { sku: "BS-300-CAN", old: 3000, revised: 3200 }] }],
  },
  {
    number: "VT-2026-04", title: "Second Show Jeera rate change (scheduled)", kind: "sticker", rates: [40, 18], effective: "2028-04-01", runOut: null,
    versions: [{ version: 1, reason: null, published: "2026-10-25T12:00:00+05:30", rows: [{ sku: "SJ-300-CAN", old: 3500, revised: 2950 }, { sku: "SJ-1000-PET", old: 9000, revised: 7500 }] }],
  },
];

const ALIASES = [["panna ctn 200", "KP-200-CTN"], ["nimbu half ltr 500ml", "TN-500-PET"]] as const;

/** Applies the schema, and fills an empty database with exactly the Seed data of the brief. */
export async function migrateAndSeed(): Promise<void> {
  const accounts = await Promise.all(ACCOUNTS.map(async (a) => ({ a, hash: await hashPassword(a[3]) })));
  await tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock(7001)");
    await q.query(SCHEMA);
    const seeded = await q.query("SELECT 1 FROM meta WHERE key = 'copy_id'");
    if (seeded.rows.length) return;
    await q.query("INSERT INTO meta (key, value) VALUES ('copy_id', $1), ('held_work', '0'), ('search_gen', '1'), ('search_synced', '0')", [randomBytes(8).toString("hex")]);
    for (const [i, d] of DRINKS.entries()) await q.query("INSERT INTO drinks (id, name, carbonated, sugar_mg_per_100ml, position) VALUES ($1,$2,$3,$4,$5)", [d[0], d[1], d[2], d[3], i]);
    for (const [i, s] of SKUS.entries())
      await q.query("INSERT INTO skus (code, drink_id, variant, format, size_ml, shelf_days, launch_mrp_paise, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [s[0], s[1], s[2], s[3], s[4], s[5], s[6], i]);
    for (const [code, sku] of BATCHES) {
      const yymmdd = code.split("-")[1]!;
      await q.query("INSERT INTO batches (code, sku_code, packed_date, old_wrapper) VALUES ($1,$2,$3,false)", [code, sku, `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`]);
    }
    for (const [alias, sku] of ALIASES) await q.query("INSERT INTO aliases (alias, sku_code) VALUES ($1,$2)", [alias, sku]);
    for (const { a, hash } of accounts) await q.query("INSERT INTO accounts (id, role, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)", [randomBytes(8).toString("hex"), a[0], a[2], a[1], hash]);
    const names = new Map<string, string>();
    for (const s of SKUS) names.set(s[0], `${DRINKS.find((d) => d[0] === s[1])![1]} ${s[2]}`);
    for (const n of NOTICES) {
      const [, year, seq] = /^VT-(\d{4})-(\d+)$/.exec(n.number)!;
      await q.query("INSERT INTO notices (number, year, seq) VALUES ($1,$2,$3)", [n.number, Number(year), Number(seq)]);
      for (const v of n.versions) {
        await q.query(
          "INSERT INTO notice_versions (number, version, title, effective_date, run_out_until, published_at, reason, print_state) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')",
          [n.number, v.version, n.title, n.effective, n.runOut, v.published, v.reason],
        );
        for (const [i, r] of v.rows.entries()) {
          const sticker = n.kind === "sticker" && n.rates !== null;
          await q.query(
            "INSERT INTO notice_rows (number, version, position, sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate, ceiling_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [n.number, v.version, i, r.sku, names.get(r.sku), n.kind, r.old, r.revised, sticker ? n.rates![0] : null, sticker ? n.rates![1] : null, sticker ? ceilingFor(r.old, n.rates![0], n.rates![1]) : null],
          );
        }
      }
    }
  });
}
