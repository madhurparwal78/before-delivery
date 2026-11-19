import { format as fnsFormat, parseISO } from "date-fns";
import { one, withTransaction } from "./pool.js";
import type { pg } from "./pool.js";
import { hashPassword, newId } from "../engine/ids.js";
import { instantOf, LISBON, wallToInstant, dayHours } from "../engine/time.js";
import type { Config } from "../config/env.js";

/** The factor rows of edition 2027.1 as the library prints them. */
export const FACTORS_2027_1: [string, string, string | null, string, string, string, string, string, string][] = [
  ["organic-cotton", "material", "14.8", "4.02", "2840", "36.5", "0.0412", "318", "52"],
  ["cotton", "material", "14.8", "5.91", "6120", "48.2", "0.0386", "742", "52"],
  ["recycled-cotton", "material", "11.2", "1.87", "410", "21.4", "0.0041", "96", "61"],
  ["linen", "material", "13.5", "2.64", "1180", "29.7", "0.0295", "204", "38"],
  ["wool", "material", "17.6", "18.4", "3120", "44.9", "0.214", "512", "44"],
  ["recycled-wool", "material", "12.3", "3.12", "640", "24.1", "0.0063", "118", "47"],
  ["polyester", "material", "21.4", "3.24", "58", "71.6", "0.0009", "86", "410"],
  ["recycled-polyester", "material", "19.8", "1.95", "41", "39.3", "0.0005", "64", "430"],
  ["viscose", "material", "24.3", "4.77", "1420", "58.8", "0.0172", "377", "29"],
  ["lyocell", "material", "19.1", "2.83", "890", "41.2", "0.0154", "142", "24"],
  ["nylon", "material", "26.7", "7.31", "96", "96.4", "0.0011", "131", "385"],
  ["elastane", "material", "31.2", "12.6", "210", "142", "0.0018", "268", "96"],
  ["PT", "grid", null, "0.0412", "0.118", "0.74", "0.000041", "0.021", "0"],
  ["TR", "grid", null, "0.124", "0.215", "1.62", "0.000085", "0.043", "0"],
  ["VN", "grid", null, "0.158", "0.264", "1.93", "0.000102", "0.057", "0"],
  ["EG", "grid", null, "0.131", "0.302", "1.81", "0.000076", "0.049", "0"],
  ["IN", "grid", null, "0.196", "0.341", "2.24", "0.000118", "0.072", "0"],
  ["BD", "grid", null, "0.172", "0.288", "2.07", "0.000109", "0.064", "0"],
  ["sea", "mode", null, "0.0107", "0.0042", "0.148", "0.000012", "0.0088", "0"],
  ["road", "mode", null, "0.105", "0.038", "1.48", "0.00021", "0.092", "0"],
  ["rail", "mode", null, "0.0281", "0.0113", "0.392", "0.000064", "0.021", "0"],
  ["air", "mode", null, "0.602", "0.176", "8.41", "0.00097", "0.33", "0"],
  ["wash", "use", null, "0.0213", "14.2", "0.31", "0.000012", "0.0064", "3.8"],
  ["disposal", "endOfLife", null, "0.0512", "0.84", "0.19", "0.000034", "1.27", "1.6"],
];

/** Edition 2026.2's kept rows equal 2027.1 except organic-cotton climate 3.96 and TR climate 0.131. */
export function factorsFor(edition: string): unknown[] {
  return FACTORS_2027_1.map((row) => {
    const [id, kind, makingMj, climate, water, fossil, land, toxicity, microfibres] = row;
    let climateOut = climate;
    if (edition === "2026.2" && id === "organic-cotton") climateOut = "3.96";
    if (edition === "2026.2" && id === "TR") climateOut = "0.131";
    const out: Record<string, unknown> = {
      id,
      kind,
      climate: climateOut,
      water,
      fossil,
      land,
      toxicity,
      microfibres,
    };
    if (makingMj !== null) out.makingMjPerKg = makingMj;
    return out;
  });
}

/**
 * The exact published seed. Applied idempotently on every serve; concurrent copies are
 * safe because every insert is guarded by a seed flag row keyed on the record id.
 */
export async function seedIfEmpty(config: Config): Promise<void> {
  const flag = await one<{ value: string }>(`SELECT value FROM seed_flag WHERE key = 'seeded-v1'`);
  if (flag) return;
  await withTransaction(async (client) => {
    const again = await client.query<{ value: string }>(`SELECT value FROM seed_flag WHERE key = 'seeded-v1' FOR UPDATE`);
    if (again.rows.length > 0) return;
    await seedAll(client);
    await client.query(`INSERT INTO seed_flag (key, value) VALUES ('seeded-v1', $1)`, [
      instantOf(new Date()),
    ]);
  });
}

async function seedAll(client: pg.PoolClient): Promise<void> {
  const now = instantOf(new Date());
  const password = hashPassword("desk-pass-2027");

  const deskMarta = newId();
  const deskIris = newId();
  await client.query(
    `INSERT INTO desks (id, name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10)
     ON CONFLICT (email) DO NOTHING`,
    [deskMarta, "Marta Quintela", "marta@fio-contado.example", password, now,
     deskIris, "Iris Vandeputte", "iris@fio-contado.example", password, now],
  );

  const martaId = (await client.query<{ id: string }>(`SELECT id FROM desks WHERE email = $1`, ["marta@fio-contado.example"])).rows[0].id;
  const irisId = (await client.query<{ id: string }>(`SELECT id FROM desks WHERE email = $1`, ["iris@fio-contado.example"])).rows[0].id;

  const labelIds: Record<string, string> = {};
  const seedLabels: [string, string, string, string][] = [
    ["Mar\u00E9 Alta", "In\u00EAs Barros", "ines@mare-alta.example", "marta"],
    ["Linho & Sal", "Tom\u00E1s Leite", "tomas@linho-sal.example", "marta"],
    ["Atelier Noroeste", "Clara Pinto", "clara@atelier-noroeste.example", "marta"],
    ["Kade Studio", "Jef Maes", "jef@kade-studio.example", "iris"],
  ];
  for (const [name, contact, email, desk] of seedLabels) {
    const id = newId();
    labelIds[name] = id;
    await client.query(
      `INSERT INTO labels (id, desk_id, name, contact_name, contact_email, state) VALUES ($1,$2,$3,$4,$5,'open') ON CONFLICT DO NOTHING`,
      [id, desk === "marta" ? martaId : irisId, name, contact, email],
    );
  }

  const supplierIds: Record<string, string> = {};
  const seedSuppliers: [string, string, string, string, string, string][] = [
    ["Y\u0131ld\u0131z \u0130plik", "Mar\u00E9 Alta", "izmir", "tr", "Ay\u015Fe Demir", "ayse@yildiz-iplik.example"],
    ["Coton Bio \u00C9thique", "Mar\u00E9 Alta", "hoChiMinhCity", "fr", "Camille Nguyen", "camille@coton-bio.example"],
    ["Fia\u00E7\u00E3o do Ave", "Atelier Noroeste", "porto", "en", "Rui Matos", "rui@fiacao-ave.example"],
    ["Nile Delta Weaving", "Linho & Sal", "cairo", "ar", "Salma Hassan", "salma@nile-delta.example"],
  ];
  for (const [name, label, town, language, contactName, contactEmail] of seedSuppliers) {
    const id = newId();
    supplierIds[name] = id;
    await client.query(
      `INSERT INTO suppliers (id, label_id, name, town, language, contact_name, contact_email) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [id, labelIds[label], name, town, language, contactName, contactEmail],
    );
  }

  const styleIds: Record<string, string> = {};
  const seedStyles: {
    name: string; code: string; label: string; season: string; gtin: string; garment: string;
    line: { grams: string; material: string };
    tiers: [string, string, string] | null; tier2: [string, string, string] | null; tier3: [string, string, string] | null;
    leg: [string, string] | null; state: string; extras?: { repair: boolean; rangeSize: number; notes: string };
  }[] = [
    {
      name: "Harbour Tee", code: "HT-01", label: "Mar\u00E9 Alta", season: "AW27", gtin: "4006381333931", garment: "tshirt",
      line: { grams: "250", material: "organic-cotton" },
      tiers: ["Y\u0131ld\u0131z \u0130plik", "Izmir", "TR"],
      tier2: ["Ege Dokuma", "Izmir", "TR"],
      tier3: ["Surat Fibre Co-op", "Surat", "IN"],
      leg: ["road", "3200"], state: "published",
      extras: { repair: false, rangeSize: 100000, notes: "Check dye house meter in spring." },
    },
    {
      name: "Quay Shirt", code: "QS-01", label: "Mar\u00E9 Alta", season: "AW27", gtin: "5600000000014", garment: "shirt",
      line: { grams: "300", material: "linen" },
      tiers: ["Coton Bio \u00C9thique", "Ho Chi Minh City", "VN"],
      tier2: ["Saigon Looms", "Ho Chi Minh City", "VN"],
      tier3: ["Mekong Flax", "Can Tho", "VN"],
      leg: ["sea", "10000"], state: "worked",
    },
    {
      name: "Estuary Coat", code: "EC-01", label: "Atelier Noroeste", season: "AW27", gtin: "5600000000021", garment: "coat",
      line: { grams: "1200", material: "wool" },
      tiers: ["Fia\u00E7\u00E3o do Ave", "Porto", "PT"],
      tier2: null, tier3: null,
      leg: ["road", "450"], state: "worked",
    },
    {
      name: "Delta Jeans", code: "DJ-01", label: "Linho & Sal", season: "SS27", gtin: "5600000000038", garment: "jeans",
      line: { grams: "800", material: "cotton" },
      tiers: ["Nile Delta Weaving", "Cairo", "EG"],
      tier2: null, tier3: null,
      leg: null, state: "draft",
    },
    {
      name: "Ribeira Polo", code: "RP-01", label: "Linho & Sal", season: "SS27", gtin: "5600000000045", garment: "tshirt",
      line: { grams: "220", material: "cotton" },
      tiers: null, tier2: null, tier3: null,
      leg: null, state: "archived",
    },
    {
      name: "Kade Overshirt", code: "KS-01", label: "Kade Studio", season: "AW27", gtin: "5600000000069", garment: "shirt",
      line: { grams: "0", material: "cotton" },
      tiers: null, tier2: null, tier3: null,
      leg: null, state: "draft",
    },
  ];
  for (const s of seedStyles) {
    if (s.name === "Kade Overshirt") continue;
    const id = newId();
    styleIds[s.name] = id;
    const desk = s.label === "Kade Studio" ? irisId : martaId;
    await client.query(
      `INSERT INTO styles (id, desk_id, label_id, style_code, name, season, gtin, garment, washes, repair_service, range_size, notes, state, version, changed_at, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,30,$9,$10,$11,$12,1,$13,NULL) ON CONFLICT DO NOTHING`,
      [id, desk, labelIds[s.label], s.code, s.name, s.season, s.gtin, s.garment,
       s.extras?.repair ?? null, s.extras?.rangeSize ?? null, s.extras?.notes ?? null,
       s.state, "2026-03-01T09:00:00Z"],
    );
    const lineId = newId();
    await client.query(
      `INSERT INTO lines (id, style_id, position, material_id, mass_grams, tier1_factory, tier1_town, tier1_country, tier2_factory, tier2_town, tier2_country, tier3_factory, tier3_town, tier3_country)
       VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [lineId, id, s.line.material, s.line.grams,
       s.tiers?.[0] ?? null, s.tiers?.[1] ?? null, s.tiers?.[2] ?? null,
       s.tier2?.[0] ?? null, s.tier2?.[1] ?? null, s.tier2?.[2] ?? null,
       s.tier3?.[0] ?? null, s.tier3?.[1] ?? null, s.tier3?.[2] ?? null],
    );
    await client.query(
      `INSERT INTO line_fibres (id, line_id, position, name, share_percent) VALUES ($1,$2,1,$3,'100.0')`,
      [newId(), lineId, fibreName(s.line.material)],
    );
    if (s.leg) {
      await client.query(
        `INSERT INTO legs (id, style_id, position, mode, km) VALUES ($1,$2,1,$3,$4)`,
        [newId(), id, s.leg[0], s.leg[1]],
      );
    }
  }

  // Iris's own style, with no lines.
  const irisStyleId = newId();
  await client.query(
    `INSERT INTO styles (id, desk_id, label_id, style_code, name, season, gtin, garment, washes, state, version, changed_at, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,30,'draft',1,$9,NULL) ON CONFLICT DO NOTHING`,
    [irisStyleId, irisId, labelIds["Kade Studio"], null, "Kade Overshirt", "AW27", "5600000000069", "shirt", "2026-03-01T09:00:00Z"],
  );

  await seedResults(client, styleIds, supplierIds, labelIds);
  await seedRequests(client, styleIds, supplierIds);
  await seedPassportScoreDossier(client, styleIds, labelIds);
  await seedVisits(client, styleIds, labelIds);
}

function fibreName(materialId: string): string {
  const names: Record<string, string> = {
    "organic-cotton": "Organic cotton",
    cotton: "Cotton",
    linen: "Linen",
    wool: "Wool",
  };
  return names[materialId] ?? materialId;
}

async function seedResults(client: pg.PoolClient, styleIds: Record<string, string>, supplierIds: Record<string, string>, _labelIds: Record<string, string>): Promise<void> {
  const { workOutFootprint } = await import("../engine/footprint.js");
  interface Spec {
    style: string;
    edition: string;
    workedOutAt: string;
    material: string;
    grams: string;
    tier1: string;
    leg: [string, string] | null;
    answeredEnergy?: string;
    answeredWater?: string;
    answeredOrigin?: string;
  }
  const specs: Spec[] = [
    { style: "Harbour Tee", edition: "2026.2", workedOutAt: "2026-03-10T09:00:00Z", material: "organic-cotton", grams: "250", tier1: "TR", leg: ["road", "3200"] },
    { style: "Harbour Tee", edition: "2027.1", workedOutAt: "2026-09-15T09:00:00Z", material: "organic-cotton", grams: "250", tier1: "TR", leg: ["road", "3200"] },
    { style: "Quay Shirt", edition: "2026.2", workedOutAt: "2026-03-12T09:00:00Z", material: "linen", grams: "300", tier1: "VN", leg: ["sea", "10000"], answeredOrigin: "VN" },
    { style: "Estuary Coat", edition: "2027.1", workedOutAt: "2026-09-16T09:00:00Z", material: "wool", grams: "1200", tier1: "PT", leg: ["road", "450"] },
  ];
  for (const spec of specs) {
    const factorRows = factorsFor(spec.edition) as import("../engine/footprint.js").FactorRow[];
    const out = workOutFootprint(factorRows, [{
      materialId: spec.material,
      massGrams: spec.grams,
      tier1Country: spec.tier1,
      answeredEnergyMjPerKg: spec.answeredEnergy ?? null,
      answeredWaterLitresPerKg: spec.answeredWater ?? null,
      answeredFibreOrigin: spec.answeredOrigin ?? null,
    }], spec.leg ? [{ mode: spec.leg[0], km: spec.leg[1] }] : [], { washes: 30 });
    await client.query(
      `INSERT INTO results (id, style_id, desk_id, edition, worked_out_at, data_quality_percent, data_quality_grade, factor_rows, measures)
       VALUES ($1,$2,(SELECT desk_id FROM styles WHERE id=$2),$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [newId(), styleIds[spec.style], spec.edition, spec.workedOutAt, out.dataQualityPercent, out.dataQualityGrade,
       JSON.stringify(factorRows), JSON.stringify(out.measures)],
    );
    if (spec.answeredOrigin) {
      await client.query(`UPDATE lines SET answered_fibre_origin = $1 WHERE style_id = $2 AND position = 1`, [spec.answeredOrigin, styleIds[spec.style]]);
    }
    if (spec.answeredWater) {
      await client.query(`UPDATE lines SET answered_water_l = $1 WHERE style_id = $2 AND position = 1`, [spec.answeredWater, styleIds[spec.style]]);
    }
  }
}

async function seedRequests(client: pg.PoolClient, styleIds: Record<string, string>, supplierIds: Record<string, string>): Promise<void> {
  const harbourLine = (await client.query<{ id: string }>(`SELECT id FROM lines WHERE style_id = $1 AND position = 1`, [styleIds["Harbour Tee"]])).rows[0];
  const quayLine = (await client.query<{ id: string }>(`SELECT id FROM lines WHERE style_id = $1 AND position = 1`, [styleIds["Quay Shirt"]])).rows[0];
  const endedAt = "2026-05-01T23:59:59Z";
  await client.query(
    `INSERT INTO requests (id, desk_id, style_id, line_id, supplier_id, supplier_name, contact_name, contact_email, town, language, questions, due_date, state, sent_at, ends_at, token, token_ends_at)
     VALUES ($1,(SELECT desk_id FROM styles WHERE id=$2),$2,$3,$4,'Y\u0131ld\u0131z \u0130plik','Ay\u015Fe Demir','ayse@yildiz-iplik.example','izmir','tr',ARRAY['energy','water','fibreOrigin'],'2026-04-30','ended','2026-04-01T09:00:00Z',$5,'seed-token-ended',$5)`,
    [newId(), styleIds["Harbour Tee"], harbourLine.id, supplierIds["Y\u0131ld\u0131z \u0130plik"], endedAt],
  );
  const answeredReqId = newId();
  const answeredAt = "2026-05-02T10:00:00Z";
  await client.query(
    `INSERT INTO requests (id, desk_id, style_id, line_id, supplier_id, supplier_name, contact_name, contact_email, town, language, questions, due_date, state, sent_at, ends_at, reminded_at, answered_at, token, token_ends_at)
     VALUES ($1,(SELECT desk_id FROM styles WHERE id=$2),$2,$3,$4,'Coton Bio \u00C9thique','Camille Nguyen','camille@coton-bio.example','hoChiMinhCity','fr',ARRAY['fibreOrigin'],'2026-04-30','answered','2026-04-01T09:00:00Z',$5,'2026-04-08T09:00:00Z',$6,'seed-token-answered',$7)`,
    [answeredReqId, styleIds["Quay Shirt"], quayLine.id, supplierIds["Coton Bio \u00C9thique"], answeredAt, answeredAt, "2026-06-15T23:59:59Z"],
  );
  await client.query(
    `INSERT INTO answers (request_id, energy_value, energy_unit, energy_mj, water_l, fibre_origin, evidence_ids, answered_at)
     VALUES ($1,NULL,NULL,NULL,NULL,'VN','{}',$2)`,
    [answeredReqId, answeredAt],
  );
}

async function seedPassportScoreDossier(client: pg.PoolClient, styleIds: Record<string, string>, _labelIds: Record<string, string>): Promise<void> {
  const harbour = styleIds["Harbour Tee"];
  const latest = (await client.query<{ id: string; measures: unknown }>(
    `SELECT id, measures FROM results WHERE style_id = $1 AND edition = '2027.1'`, [harbour])).rows[0];
  const scoreBody = {
    gtin: "4006381333931",
    garment: "tshirt",
    massGrams: "250",
    washes: 30,
    materials: [{ id: "organic-cotton", sharePercent: "100.0", tier1: "TR", tier2: "TR", tier3: "IN" }],
    repairService: false,
    rangeSize: 100000,
  };
  const { stableHash } = await import("../engine/ids.js");
  await client.query(
    `INSERT INTO scores (style_id, state, score, per_100g, run_id, shown, worst_case_facts, inputs_hash, inputs_body, asked_at)
     VALUES ($1,'current',1240,412,'run-seed',$2,$3,$4,$5,$6)`,
    [harbour, "Score 1,240 points (412 per 100 g)", ["repairService", "rangeSize"],
     stableHash(scoreBody), JSON.stringify(scoreBody), "2026-09-18T10:00:00Z"],
  );
  const snapshot = {
    styleName: "Harbour Tee",
    labelName: "Mar\u00E9 Alta",
    garment: "tshirt",
    factorEdition: "2027.1",
    dataQualityPercent: 0,
    dataQualityGrade: "C",
    scoreShown: "Score 1,240 points (412 per 100 g)",
    measures: (latest.measures as { measure: string; totalShown: string }[]).map((m) => ({ measure: m.measure, totalShown: m.totalShown })),
  };
  await client.query(
    `INSERT INTO passports (id, style_id, gtin, edition, state, published_at, snapshot) VALUES ($1,$2,'4006381333931',1,'published',$3,$4) ON CONFLICT DO NOTHING`,
    [newId(), harbour, "2026-09-20T10:00:00Z", JSON.stringify(snapshot)],
  );
  const dossierId = newId();
  await client.query(
    `INSERT INTO dossiers (id, style_id, result_id, desk_id, edition, state, made_at, signed_off_by, signed_off_at)
     VALUES ($1,$2,$3,(SELECT desk_id FROM styles WHERE id=$2),$4,'signedOff',$5,'In\u00EAs Barros',$6)`,
    [dossierId, harbour, latest.id, "2027.1", "2026-09-22T15:00:00Z", "2026-09-22T15:00:00Z"],
  );
}

async function seedVisits(client: pg.PoolClient, styleIds: Record<string, string>, labelIds: Record<string, string>): Promise<void> {
  // The next Lisbon clock change after first start, and the Friday before and Monday after it.
  const now = new Date();
  let change: string | null = null;
  for (let i = 0; i < 800; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    const iso = d.toISOString().slice(0, 10);
    if (dayHours(LISBON, iso) !== 24) {
      change = iso;
      break;
    }
  }
  if (!change) return;
  const monday = nextWeekday(parseISO(`${change}T00:00:00Z`), 1);
  const friday = previousWeekday(parseISO(`${change}T00:00:00Z`), 5);
  const label = labelIds["Mar\u00E9 Alta"];
  const deskId = (await client.query<{ desk_id: string }>(`SELECT desk_id FROM labels WHERE id = $1`, [label])).rows[0].desk_id;
  for (const d of [friday, monday]) {
    const localDate = fnsFormat(d, "yyyy-MM-dd");
    const res = wallToInstant(localDate, "07:20", "Europe/Istanbul");
    if ("skipped" in res) continue;
    await client.query(
      `INSERT INTO visits (id, desk_id, label_id, factory_name, town, local_date, local_time, at, created_at)
       VALUES ($1,$2,$3,'Y\u0131ld\u0131z \u0130plik','izmir',$4,'07:20',$5,$6)`,
      [newId(), deskId, label, localDate, instantOf(res.at), instantOf(new Date())],
    );
  }
}

function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function previousWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}
