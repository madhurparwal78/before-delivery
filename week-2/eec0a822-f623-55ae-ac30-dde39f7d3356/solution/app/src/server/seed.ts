// The brief's seed data, inserted once into an empty database (brief: Seed data).
import { randomUUID } from "node:crypto";
import { transaction } from "./db";
import { hashPassword } from "./auth";

const SEED_PASSWORD = "Sunlit-Tide-2027";

const WORKSPACES = [
  { slug: "adriatic-sunline", name: "Adriatic Sunline Charters" },
  { slug: "saronic-lightwater", name: "Saronic Lightwater Yachts" },
];

const YACHTS = [
  ["adriatic-sunline", "sunwake", "Sunwake", "split", 4, 1829, 904, 155, "280", "3.0", "9.0", "0.110", 1890000, 2450000, 3290000,
    [["Ivo Matic", "captain"], ["Nina Horvat", "deckhand"], ["Petra Juric", "chef"]]],
  ["adriatic-sunline", "halcyon-drift", "Halcyon Drift", "split", 6, 2440, 1120, 180, "420", "4.5", "14.0", "0.160", 3150000, 3980000, 5200000,
    [["Tomislav Rados", "captain"], ["Marta Vukovic", "stewardess"], ["Dario Simic", "deckhand"]]],
  ["adriatic-sunline", "kelp-lantern", "Kelp Lantern", "lavrio", 4, 1615, 865, 135, "240", "2.5", "8.0", "0.095", 1450000, 1890000, 2490000,
    [["Stavros Mela", "captain"], ["Irini Daskalou", "chef"], ["Marko Lisac", "deckhand"]]],
  ["saronic-lightwater", "meltemi-glow", "Meltemi Glow", "lavrio", 5, 1965, 985, 160, "300", "3.2", "10.0", "0.120", 2100000, 2750000, 3600000,
    [["Yannis Karras", "captain"], ["Dimitra Lekka", "deckhand"], ["Thanos Ritsos", "chef"]]],
  ["saronic-lightwater", "brightwater", "Brightwater", "split", 3, 1495, 795, 120, "200", "2.0", "7.0", "0.080", 1245000, 1590000, 2150000,
    [["Josip Bilic", "captain"], ["Lea Grgic", "stewardess"], ["Pavlos Zervas", "deckhand"]]],
  ["saronic-lightwater", "salt-ember", "Salt Ember", "split", 5, 2135, 1040, 165, "360", "4.0", "12.0", "0.140", 2600000, 3300000, 4450000,
    [["Kresimir Tadic", "captain"], ["Vesna Bozic", "chef"], ["Andreas Mavros", "deckhand"]]],
] as const;

const MEMBERS = [
  ["adriatic-sunline", "Mira Kovac", "mira.kovac@adriatic-sunline.example", "fleet_director", null],
  ["adriatic-sunline", "Luka Babic", "luka.babic@adriatic-sunline.example", "charter_manager", null],
  ["adriatic-sunline", "Ana Peric", "ana.peric@adriatic-sunline.example", "finance_lead", null],
  ["adriatic-sunline", "Ivo Matic", "ivo.matic@adriatic-sunline.example", "captain", null],
  ["adriatic-sunline", "Nina Horvat", "nina.horvat@adriatic-sunline.example", "crew_member", "sunwake"],
  ["saronic-lightwater", "Eleni Papadaki", "eleni.papadaki@saronic-lightwater.example", "fleet_director", null],
  ["saronic-lightwater", "Nikos Vlachos", "nikos.vlachos@saronic-lightwater.example", "charter_manager", null],
  ["saronic-lightwater", "Sofia Andreou", "sofia.andreou@saronic-lightwater.example", "finance_lead", null],
  ["saronic-lightwater", "Yannis Karras", "yannis.karras@saronic-lightwater.example", "captain", null],
  ["saronic-lightwater", "Dimitra Lekka", "dimitra.lekka@saronic-lightwater.example", "crew_member", "meltemi-glow"],
] as const;

const ANCHORAGES = [
  ["split-base", "Split Marina", "split", "43.5040", "16.4290"],
  ["solta-maslinica", "Maslinica, Solta", "split", "43.3985", "16.2060"],
  ["hvar-stari-grad", "Stari Grad, Hvar", "split", "43.1855", "16.5960"],
  ["pakleni-palmizana", "Palmizana, Pakleni Islands", "split", "43.1620", "16.3940"],
  ["vis-town", "Vis Town", "split", "43.0615", "16.1855"],
  ["brac-bol", "Bol, Brac", "split", "43.2600", "16.6550"],
  ["lavrio-base", "Lavrio Marina", "lavrio", "37.7150", "24.0580"],
  ["kea-vourkari", "Vourkari, Kea", "lavrio", "37.6670", "24.3230"],
  ["kythnos-kolona", "Kolona, Kythnos", "lavrio", "37.4300", "24.3950"],
  ["poros-town", "Poros Town", "lavrio", "37.4985", "23.4555"],
  ["aegina-port", "Aegina Port", "lavrio", "37.7465", "23.4275"],
  ["sounio-bay", "Sounio Bay", "lavrio", "37.6520", "24.0250"],
] as const;

const MARINAS = [
  {
    id: "split-marina", name: "Split Marina", base: "split",
    berths: [["A1", 1500, 800, 300], ["A2", 2000, 1000, 350], ["A3", 2500, 1200, 400], ["A4", 1829, 904, 185], ["A5", 1829, 904, 184], ["A6", 1495, 795, 150]],
    pontoons: [["C", 44], ["D", 22]],
    tariffs: [["2026-01-01", 450], ["2028-04-01", 520]],
  },
  {
    id: "lavrio-marina", name: "Lavrio Marina", base: "lavrio",
    berths: [["B1", 1700, 900, 300], ["B2", 2200, 1100, 320], ["B3", 1615, 865, 165], ["B4", 1965, 985, 190]],
    pontoons: [["P", 22]],
    tariffs: [["2026-01-01", 380], ["2028-04-01", 430]],
  },
] as const;

const EXCHANGE_TABLES = [["2026-01-01", "0.8450", "1.0820"], ["2028-04-01", "0.8700", "1.1500"]] as const;

const STORE_ITEMS = [
  ["Still water", "bottles", "drinks", 48, 12, 0],
  ["Olive oil", "litres", "provisions", 10, 3, 0],
  ["Lemons", "kg", "provisions", 8, 2, 1],
  ["Deck cleaner", "bottles", "cleaning", 6, 1, 0],
] as const;

const BROKERS = [
  ["adriatic-sunline", "bluewake", "Bluewake Brokers", "Hana Ostrova", "desk@bluewake-brokers.example", "Commission 10%, pays within 14 days"],
  ["adriatic-sunline", "cetina", "Cetina Yacht Partners", "Rafael Oyelaran", "charters@cetina-partners.example", "Commission 12%, prefers July weeks"],
  ["saronic-lightwater", "aegean-keel", "Aegean Keel Agency", "Clio Varga", "hello@aegean-keel.example", "Commission 10%, Greek clients only"],
  ["saronic-lightwater", "northstar", "Northstar Charter Desk", "Bram Ellery", "desk@northstar-charter.example", "Commission 11%, invoices quarterly"],
] as const;

export async function seedOnce(): Promise<void> {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7414)");
    const existing = await db.query("SELECT 1 FROM workspaces LIMIT 1");
    if (existing.rowCount) return;
    const now = new Date();
    for (const ws of WORKSPACES) await db.query("INSERT INTO workspaces (slug, name) VALUES ($1, $2)", [ws.slug, ws.name]);

    const yachtIds = new Map<string, string>();
    for (const [ws, slug, name, base, cabins, length, beam, draft, battery, hotel, solar, drag, low, shoulder, high, crew] of YACHTS) {
      const id = randomUUID();
      yachtIds.set(`${ws}/${slug}`, id);
      await db.query(
        `INSERT INTO yachts (id, workspace_slug, slug, name, base, status, cabins, length_cm, beam_cm, draft_cm, battery_kwh, hotel_kw,
           solar_kw, drag_kw_per_kn_cubed, shore_power_kw, rate_low_minor, rate_shoulder_minor, rate_high_minor)
         VALUES ($1,$2,$3,$4,$5,'on_sale',$6,$7,$8,$9,$10,$11,$12,$13,22,$14,$15,$16)`,
        [id, ws, slug, name, base, cabins, length, beam, draft, battery, hotel, solar, drag, low, shoulder, high],
      );
      for (const [index, [crewName, position]] of crew.entries()) {
        await db.query("INSERT INTO crew (id, yacht_id, name, position, sort) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), id, crewName, position, index]);
      }
      for (const [itemName, unit, category, received, used, spoiled] of STORE_ITEMS) {
        const itemId = randomUUID();
        await db.query(
          "INSERT INTO store_items (id, yacht_id, name, unit, category, received_qty, used_qty, spoiled_qty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [itemId, id, itemName, unit, category, received, used, spoiled],
        );
        for (const [kind, quantity] of [["received", received], ["used", used], ["spoiled", spoiled]] as const) {
          if (quantity > 0) {
            await db.query("INSERT INTO store_movements (id, item_id, kind, quantity, logged_by, logged_at) VALUES ($1,$2,$3,$4,NULL,$5)",
              [randomUUID(), itemId, kind, quantity, now]);
          }
        }
      }
    }

    const hash = await hashPassword(SEED_PASSWORD);
    for (const [ws, name, email, role, yacht] of MEMBERS) {
      await db.query(
        "INSERT INTO members (id, workspace_slug, name, email, password_hash, role, yacht_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [randomUUID(), ws, name, email, hash, role, yacht ? yachtIds.get(`${ws}/${yacht}`) : null],
      );
    }

    for (const [index, [id, name, base, latitude, longitude]] of ANCHORAGES.entries()) {
      await db.query("INSERT INTO anchorages (id, name, base, latitude, longitude, sort) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        [id, name, base, latitude, longitude, index]);
    }

    for (const ws of WORKSPACES) {
      for (const marina of MARINAS) {
        await db.query("INSERT INTO marinas (workspace_slug, id, name, base) VALUES ($1,$2,$3,$4)", [ws.slug, marina.id, marina.name, marina.base]);
        for (const [code, length, width, depth] of marina.berths) {
          await db.query("INSERT INTO berths (workspace_slug, marina_id, code, length_cm, width_cm, depth_cm) VALUES ($1,$2,$3,$4,$5,$6)",
            [ws.slug, marina.id, code, length, width, depth]);
        }
        for (const [code, limit] of marina.pontoons) {
          await db.query("INSERT INTO pontoons (workspace_slug, marina_id, code, limit_kw) VALUES ($1,$2,$3,$4)", [ws.slug, marina.id, code, limit]);
        }
        for (const [date, rate] of marina.tariffs) {
          await db.query("INSERT INTO tariffs (id, workspace_slug, marina_id, effective_date, rate_per_metre_minor) VALUES ($1,$2,$3,$4,$5)",
            [randomUUID(), ws.slug, marina.id, date, rate]);
        }
      }
      for (const [date, gbp, usd] of EXCHANGE_TABLES) {
        await db.query("INSERT INTO exchange_tables (id, workspace_slug, effective_date, gbp, usd) VALUES ($1,$2,$3,$4,$5)",
          [randomUUID(), ws.slug, date, gbp, usd]);
      }
    }
    for (const [ws, id, name, contact, email, notes] of BROKERS) {
      await db.query("INSERT INTO brokers (workspace_slug, id, name, contact_name, email, notes) VALUES ($1,$2,$3,$4,$5,$6)",
        [ws, id, name, contact, email, notes]);
    }
  });
}
