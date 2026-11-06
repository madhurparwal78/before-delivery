// The exact starting data, written once into an empty database (every value is invented).
import { randomUUID } from "node:crypto";
import { hashPassword, digest } from "./auth.js";
import { lockName, one, tx } from "./db.js";
import { normaliseName } from "./names.js";
import { businessDate, shiftMonth, zonedInstant } from "../shared/format.js";

const JURISDICTIONS: [string, string, string, string, bigint | null, string | null, [bigint, string] | null][] = [
  ["LT", "Lithuania", "europe", "EUR", 0n, "2024-12-30", null],
  ["EE", "Estonia", "europe", "EUR", 0n, "2024-12-30", null],
  ["IE", "Ireland", "europe", "EUR", 0n, "2024-12-30", null],
  ["DE", "Germany", "europe", "EUR", 0n, "2024-12-30", null],
  ["MT", "Malta", "europe", "EUR", 0n, "2024-12-30", null],
  ["CH", "Switzerland", "europe", "CHF", 100000n, "2021-01-01", [0n, "2028-01-01"]],
  ["GB", "United Kingdom", "europe", "GBP", 84000n, "2023-09-01", null],
  ["SG", "Singapore", "asia_pacific", "SGD", 150000n, "2020-01-28", null],
  ["HK", "Hong Kong", "asia_pacific", "HKD", 800000n, "2023-06-01", null],
  ["AE", "United Arab Emirates", "middle_east", "AED", null, null, [350000n, "2028-03-01"]],
  ["TH", "Thailand", "asia_pacific", "THB", null, null, [5000000n, "2028-07-01"]],
  ["PA", "Panama", "americas", "USD", null, null, null],
  ["SC", "Seychelles", "africa", "USD", null, null, null],
];

const WORKSPACES = [
  { slug: "neris", name: "Neris Digital", legalName: "Neris Digital UAB", lei: "984500NERISDIGIT0172", jurisdiction: "LT",
    timeZone: "Europe/Vilnius", city: "Vilnius time", currency: "EUR", limit: 100000n, prefix: "NRS-",
    sending: "lnl1neriswallet0000000000000000001" },
  { slug: "kallang", name: "Kallang Exchange", legalName: "Kallang Exchange Pte. Ltd.", lei: "984500KALLANGEX00166",
    jurisdiction: "SG", timeZone: "Asia/Singapore", city: "Singapore time", currency: "SGD", limit: 150000n, prefix: "KLG-",
    sending: "lnl1kallangsend0000000000000000001" },
];

const LISTINGS: [string, string, string, boolean, string | null][] = [
  ["neris-digital", "Neris Digital UAB", "LT", true, "neris"],
  ["kallang-exchange", "Kallang Exchange Pte. Ltd.", "SG", true, "kallang"],
  ["harbourgate-digital-assets", "Harbourgate Digital Assets Ltd", "IE", true, null],
  ["tallinn-star-exchange", "Tallinn Star Exchange OÜ", "EE", false, null],
  ["keystone-vault", "Keystone Vault AG", "CH", true, null],
  ["sakura-vault-hk", "Sakura Vault HK Limited", "HK", true, null],
  ["meridian-coin", "Meridian Coin S.A.", "PA", false, null],
  ["baltic-rail-crypto", "Baltic Rail Crypto UAB", "LT", true, null],
  ["nordlys-exchange", "Nordlys Exchange Ltd", "SC", false, null],
  ["atlas-peak-digital", "Atlas Peak Digital FZE", "AE", true, null],
  ["rheinmark-krypto", "Rheinmark Krypto GmbH", "DE", true, null],
  ["valletta-blockworks", "Valletta Blockworks Ltd", "MT", false, null],
  ["thamesgate-digital", "Thamesgate Digital Ltd", "GB", true, null],
  ["chao-phraya-digital", "Chao Phraya Digital Co., Ltd.", "TH", false, null],
  ["mahe-coin", "Mahé Coin Ltd", "SC", false, null],
];

const MEMBERS: [string, string, string, string][] = [
  ["neris", "Ieva Morkūnė", "officer@neris.example", "compliance_officer"],
  ["neris", "Tomas Vaitkus", "analyst@neris.example", "compliance_analyst"],
  ["neris", "Dalia Petraitytė", "ops@neris.example", "operations_lead"],
  ["neris", "Marius Jankus", "finance@neris.example", "finance_lead"],
  ["neris", "Greta Lukoševičiūtė", "support@neris.example", "support_agent"],
  ["kallang", "Mei Ling Tan", "officer@kallang.example", "compliance_officer"],
  ["kallang", "Arjun Pillai", "analyst@kallang.example", "compliance_analyst"],
  ["kallang", "Siti Rahmah", "ops@kallang.example", "operations_lead"],
  ["kallang", "Daniel Koh", "finance@kallang.example", "finance_lead"],
  ["kallang", "Nur Aisyah", "support@kallang.example", "support_agent"],
];
const SEED_PASSWORD = "Lantern-Desk-2027!";

const CUSTOMERS: [string, string, string, string, string, string][] = [
  ["neris", "cust-neris-01", "Łukasz Ørsted-Ækvist", "TEST-ID-0001", "1986-04-12", "lnl1nerisclient0000000000000000001"],
  ["neris", "cust-neris-02", "Đurđica Weiß", "TEST-ID-0002", "1979-11-03", "lnl1nerisclient0000000000000000002"],
  ["neris", "cust-neris-03", "Œnone Bérubé", "TEST-ID-0003", "1992-02-29", "lnl1nerisclient0000000000000000003"],
  ["neris", "cust-neris-04", "Þóra Jónsdóttir", "TEST-ID-0004", "1990-07-21", "lnl1nerisclient0000000000000000004"],
  ["neris", "cust-neris-05", "Rūta Kairienė", "TEST-ID-0005", "1984-09-30", "lnl1nerisclient0000000000000000005"],
  ["neris", "cust-neris-06", "Jonas Petraitis", "TEST-ID-0006", "2001-01-15", "lnl1nerisclient0000000000000000006"],
  ["kallang", "cust-kallang-01", "Tan Wei Ming", "TEST-ID-0011", "1988-05-06", "lnl1kallangcust0000000000000000001"],
  ["kallang", "cust-kallang-02", "Siobhán Ó Briain", "TEST-ID-0012", "1975-12-24", "lnl1kallangcust0000000000000000002"],
  ["kallang", "cust-kallang-03", "Ægir Løkke", "TEST-ID-0013", "1983-03-17", "lnl1kallangcust0000000000000000003"],
  ["kallang", "cust-kallang-04", "Nguyễn Thị Lan", "TEST-ID-0014", "1996-08-08", "lnl1kallangcust0000000000000000004"],
  ["kallang", "cust-kallang-05", "Paweł Strauß", "TEST-ID-0015", "1991-10-10", "lnl1kallangcust0000000000000000005"],
  ["kallang", "cust-kallang-06", "Priya Raman", "TEST-ID-0016", "1999-06-01", "lnl1kallangcust0000000000000000006"],
];

const COUNTERPARTIES: { name: string; lei: string; jurisdiction: string; licence: string; dd: string; network: string;
  contact: string | null; address: string; signing: Record<string, string> | null }[] = [
  { name: "Harbourgate Digital Assets Ltd", lei: "5299004HARBOURGATE75", jurisdiction: "IE", licence: "IE-CBI-VASP-0417",
    dd: "trusted", network: "on_network", contact: null, address: "lnl1harbourgate0000000000000000001",
    signing: { neris: "lnls_neris_harbourgate_3f9a1c7e", kallang: "lnls_kallang_harbourgate_a4c8e216" } },
  { name: "Tallinn Star Exchange OÜ", lei: "3912006TALLINNSTAR86", jurisdiction: "EE", licence: "EE-FIU-FVT000311",
    dd: "trusted", network: "off_network", contact: "compliance@tallinnstar.example", address: "lnl1tallinnstar0000000000000000001",
    signing: null },
  { name: "Keystone Vault AG", lei: "2549001KEYSTONEVA089", jurisdiction: "CH", licence: "CH-FINMA-SRO-2291",
    dd: "pending", network: "on_network", contact: null, address: "lnl1keystonevlt0000000000000000001",
    signing: { neris: "lnls_neris_keystone_8b2d4f60", kallang: "lnls_kallang_keystone_17f3b9d0" } },
  { name: "Sakura Vault HK Limited", lei: "635400SAKURAVAULT155", jurisdiction: "HK", licence: "HK-SFC-BSV-118",
    dd: "trusted", network: "on_network", contact: null, address: "lnl1sakuravault0000000000000000001",
    signing: { neris: "lnls_neris_sakura_c71e05a9", kallang: "lnls_kallang_sakura_92e5c04b" } },
  { name: "Meridian Coin S.A.", lei: "213800MERIDIANCOIN70", jurisdiction: "PA", licence: "PA-SBP-0093",
    dd: "trusted", network: "off_network", contact: "compliance@meridiancoin.example", address: "lnl1meridiancsa0000000000000000001",
    signing: null },
  { name: "Baltic Rail Crypto UAB", lei: "5493007BALTICRAIL035", jurisdiction: "LT", licence: "LT-FNTT-VASP-0552",
    dd: "restricted", network: "on_network", contact: null, address: "lnl1balticrails0000000000000000001",
    signing: { neris: "lnls_neris_balticrail_5d93b2e4", kallang: "lnls_kallang_balticrail_6ab1d7f3" } },
  { name: "Nordlys Exchange Ltd", lei: "9695009NORDLYSXC0095", jurisdiction: "SC", licence: "SC-FSA-VA-0071",
    dd: "blocked", network: "off_network", contact: "compliance@nordlys.example", address: "lnl1nordlysexch0000000000000000001",
    signing: null },
  { name: "Atlas Peak Digital FZE", lei: "254900ATLASPEAK00012", jurisdiction: "AE", licence: "AE-VARA-0336",
    dd: "trusted", network: "on_network", contact: null, address: "lnl1atlaspeakfz0000000000000000001",
    signing: { neris: "lnls_neris_atlaspeak_e0a6f318", kallang: "lnls_kallang_atlaspeak_d38f0e65" } },
];

const RATES: [string, bigint, bigint][] = [
  ["BTC", 6125000n, 9012550n],
  ["ETH", 333335n, 500000n],
  ["USDC", 92n, 135n],
  ["SOL", 14217n, 20940n],
];

const PARTNER_KEYS: Record<string, [string, string]> = {
  neris: ["Neris core banking", "lnlk_5e1f0a7c3b9d48e2a6f1c0d9b8e7a6f5"],
  kallang: ["Kallang ledger", "lnlk_9a2c4e6f8b0d1e3f5a7c9e1b3d5f7a90"],
};

/** Metered messages of the three months before the copy's first business month, keyed by month offset. */
const METERED_HISTORY: [number, number][] = [[-1, 1002], [-2, 1003], [-3, 1215]];

export async function seed(): Promise<void> {
  const passwordHashes = await Promise.all(MEMBERS.map(() => hashPassword(SEED_PASSWORD)));
  await tx(async (db) => {
    await lockName(db, "lanternline-seed");
    if (await one(db, "SELECT 1 FROM copy_meta")) return;
    const startedAt = Date.now();
    await db.query("INSERT INTO copy_meta (id, started_at) VALUES (1, $1)", [new Date(startedAt)]);
    for (const [i, [code, name, region, currency, threshold, since, change]] of JURISDICTIONS.entries()) {
      await db.query(
        `INSERT INTO jurisdictions (code, name, region, currency, threshold_cents, in_force_since, announced_threshold_cents,
           announced_on, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [code, name, region, currency, threshold, since, change?.[0] ?? null, change?.[1] ?? null, i]);
    }
    for (const w of WORKSPACES) {
      const firstDate = businessDate(w.timeZone, startedAt);
      await db.query(
        `INSERT INTO workspaces (slug, name, legal_name, lei, jurisdiction_code, time_zone, city, currency,
           confirmation_limit_cents, case_prefix, sending_address, next_case_number, first_business_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12)`,
        [w.slug, w.name, w.legalName, w.lei, w.jurisdiction, w.timeZone, w.city, w.currency, w.limit, w.prefix, w.sending, firstDate]);
      for (const [i, [asset, eur, sgd]] of RATES.entries()) {
        await db.query("INSERT INTO rates VALUES ($1, $2, $3, $4, '2026-01-01', $5)",
          [w.slug, asset, w.currency, w.currency === "EUR" ? eur : sgd, i]);
      }
      for (const cp of COUNTERPARTIES) {
        const id = randomUUID();
        await db.query(
          `INSERT INTO counterparties (id, workspace_slug, legal_name, normalised_name, lei, jurisdiction_code, licence_number,
             due_diligence, network, contact_email, notes, signing_value, name_since, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', $11, $12, $13, $13)`,
          [id, w.slug, cp.name, normaliseName(cp.name), cp.lei, cp.jurisdiction, cp.licence, cp.dd, cp.network, cp.contact,
            cp.signing?.[w.slug] ?? null, firstDate, new Date(startedAt)]);
        await db.query("INSERT INTO address_registry VALUES ($1, $2, $3)", [w.slug, cp.address, id]);
      }
      for (const [code, , , , threshold, since, change] of JURISDICTIONS) {
        if (threshold !== null && since !== null) {
          const at = new Date(zonedInstant(w.timeZone, since));
          await db.query(
            `INSERT INTO threshold_changes (id, workspace_slug, jurisdiction_code, threshold_cents, takes_effect_on,
               takes_effect_at, announced_by, announced_at) VALUES ($1, $2, $3, $4, $5, $6, NULL, $6)`,
            [randomUUID(), w.slug, code, threshold, since, at]);
        }
        if (change) {
          await db.query(
            `INSERT INTO threshold_changes (id, workspace_slug, jurisdiction_code, threshold_cents, takes_effect_on,
               takes_effect_at, announced_by, announced_at) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
            [randomUUID(), w.slug, code, change[0], change[1], new Date(zonedInstant(w.timeZone, change[1])), new Date(startedAt)]);
        }
      }
      const [label, key] = PARTNER_KEYS[w.slug];
      await db.query("INSERT INTO partner_keys (id, workspace_slug, label, key_hash, starts_with, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [randomUUID(), w.slug, label, digest(key), key.slice(0, 9), new Date(startedAt)]);
      const firstMonth = firstDate.slice(0, 7);
      for (const [offset, count] of METERED_HISTORY) {
        const at = new Date(zonedInstant(w.timeZone, `${shiftMonth(firstMonth, offset)}-15`, 12, 0));
        await db.query(
          "INSERT INTO metered_messages (workspace_slug, at, direction) SELECT $1, $2, 'received' FROM generate_series(1, $3)",
          [w.slug, at, count]);
      }
    }
    for (const [i, [slug, name, code, onNetwork, workspace]] of LISTINGS.entries()) {
      await db.query("INSERT INTO listings VALUES ($1, $2, $3, $4, true, $5, $6)", [slug, name, code, onNetwork, workspace, i]);
    }
    for (const [i, [workspace, name, email, role]] of MEMBERS.entries()) {
      await db.query(
        "INSERT INTO members (id, workspace_slug, name, email, role, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [randomUUID(), workspace, name, email, role, passwordHashes[i], new Date(startedAt + i)]);
    }
    for (const [i, [workspace, id, name, identity, born, address]] of CUSTOMERS.entries()) {
      await db.query("INSERT INTO customers VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, workspace, name, identity, born, address, i]);
    }
  });
}
