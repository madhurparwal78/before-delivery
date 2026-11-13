import type { Database } from "./db.js";
import { hashPassword, newId } from "./crypto.js";

export const STAFF_PASSWORD = "desk-pass-2027";
export const MEMBER_PASSWORD = "member-pass-2027";

const STAFF_SEED = [
  { name: "Maya Okafor", email: "maya.okafor@ocotillo.example", role: "owner" },
  { name: "Priya Shah", email: "priya.shah@ocotillo.example", role: "specialist" },
  { name: "Theo Lindqvist", email: "theo.lindqvist@ocotillo.example", role: "specialist" },
  { name: "Dana Ruiz", email: "dana.ruiz@ocotillo.example", role: "coordinator" },
  { name: "Sam Whitfield", email: "sam.whitfield@ocotillo.example", role: "coordinator" },
  { name: "Jordan Pell", email: "jordan.pell@ocotillo.example", role: "billingLead" },
];

export const PHLEBOTOMIST_SEED = [
  { name: "Luis Carrillo", email: "luis.carrillo@visits.example", states: ["az", "co", "nm", "nv", "ut"] },
  { name: "Ivy Chen", email: "ivy.chen@visits.example", states: ["co", "ut"] },
  { name: "Bree Halvorsen", email: "bree.halvorsen@visits.example", states: ["ca", "id", "mt", "or", "wa", "wy"] },
  { name: "Tomas Reyes", email: "tomas.reyes@visits.example", states: ["ar", "ia", "ks", "la", "mn", "mo", "nd", "ne", "ok", "sd", "tx"] },
  { name: "Nia Brooks", email: "nia.brooks@visits.example", states: ["al", "il", "in", "ky", "mi", "ms", "oh", "tn", "wi"] },
  { name: "Grace Whitaker", email: "grace.whitaker@visits.example", states: ["ct", "de", "ma", "md", "me", "nh", "nj", "ny", "pa", "vt"] },
  { name: "Caleb Ford", email: "caleb.ford@visits.example", states: ["fl", "ga", "nc", "sc", "va", "wv"] },
];

const MEMBER_SEED = [
  {
    name: "Elena Marsh",
    email: "elena.marsh@example.com",
    born: "1987-03-02",
    sex: "female",
    state: "co",
    timeZone: "denver",
    phone: "+1 303 555 0142",
    address: { line1: "1450 Larimer St", line2: "Apt 6B", city: "Denver", postalCode: "80202" },
    gateNotes: "Buzz 6B; the lobby door sticks.",
    membership: "sixMonths",
  },
  {
    name: "Marcus Bell",
    email: "marcus.bell@example.com",
    born: "1971-06-14",
    sex: "male",
    state: "ny",
    timeZone: "newYork",
    phone: "+1 212 555 0187",
    address: { line1: "88 Orchard St", line2: "Apt 3", city: "New York", postalCode: "10002" },
    gateNotes: "Ring twice.",
    membership: "yearly",
  },
  {
    name: "Rosa Delgado",
    email: "rosa.delgado@example.com",
    born: "1958-11-20",
    sex: "female",
    state: "il",
    timeZone: "chicago",
    phone: "+1 312 555 0119",
    address: { line1: "2201 W Armitage Ave", line2: "", city: "Chicago", postalCode: "60647" },
    gateNotes: "Side door by the garden.",
    membership: "sixMonths",
  },
  {
    name: "Owen Pryce",
    email: "owen.pryce@example.com",
    born: "1990-08-09",
    sex: "male",
    state: "az",
    timeZone: "phoenix",
    phone: "+1 480 555 0163",
    address: { line1: "3300 N Scottsdale Rd", line2: "Unit 12", city: "Scottsdale", postalCode: "85251" },
    gateNotes: null,
    membership: null,
  },
  {
    name: "Hana Sato",
    email: "hana.sato@example.com",
    born: "1979-04-27",
    sex: "female",
    state: "ca",
    timeZone: "losAngeles",
    phone: "+1 415 555 0175",
    address: { line1: "640 Valencia St", line2: "", city: "San Francisco", postalCode: "94110" },
    gateNotes: "Gate code 4417.",
    membership: "yearly",
  },
];

export type SeedResult = {
  memberIds: Map<string, string>;
  phlebotomistIds: Map<string, string>;
  staffIds: Map<string, string>;
};

/** Idempotently insert exactly the published starting data. */
export async function seedCore(db: Database): Promise<SeedResult> {
  const state = await db.one<{ done: boolean }>(`SELECT done FROM seeding_state WHERE id = 1`);
  if (state?.done) {
    const memberIds = new Map(
      (await db.query<{ name: string; id: string }>(`SELECT name, id FROM members`)).map((r) => [r.name, r.id])
    );
    const phlebotomistIds = new Map(
      (await db.query<{ name: string; id: string }>(`SELECT name, id FROM phlebotomists`)).map((r) => [r.name, r.id])
    );
    const staffIds = new Map(
      (await db.query<{ name: string; id: string }>(`SELECT name, id FROM staff`)).map((r) => [r.name, r.id])
    );
    return { memberIds, phlebotomistIds, staffIds };
  }

  const staffPasswordHash = await hashPassword(STAFF_PASSWORD);
  const memberPasswordHash = await hashPassword(MEMBER_PASSWORD);
  const staffIds = new Map<string, string>();
  const memberIds = new Map<string, string>();
  const phlebotomistIds = new Map<string, string>();

  for (const person of STAFF_SEED) {
    const id = newId("staff");
    staffIds.set(person.name, id);
    await db.exec(
      `INSERT INTO staff (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [id, person.name, person.email, staffPasswordHash, person.role]
    );
  }
  const staffByEmail = new Map(
    (await db.query<{ email: string; id: string }>(`SELECT email, id FROM staff`)).map((r) => [r.email, r.id])
  );
  for (const person of STAFF_SEED) {
    const id = staffByEmail.get(person.email);
    if (id) staffIds.set(person.name, id);
  }

  for (const person of PHLEBOTOMIST_SEED) {
    const id = newId("phleb");
    phlebotomistIds.set(person.name, id);
    await db.exec(
      `INSERT INTO phlebotomists (id, name, email, states) VALUES ($1, $2, $3, $4)`,
      [id, person.name, person.email, person.states]
    );
  }

  for (const member of MEMBER_SEED) {
    const id = newId("mem");
    memberIds.set(member.name, id);
    await db.exec(
      `INSERT INTO members (id, name, email, password_hash, phone, date_of_birth, sex, state, time_zone,
        address_line1, address_line2, city, postal_code, gate_notes, account_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active')
       ON CONFLICT (email) DO NOTHING`,
      [
        id,
        member.name,
        member.email,
        memberPasswordHash,
        member.phone,
        member.born,
        member.sex,
        member.state,
        member.timeZone,
        member.address.line1,
        member.address.line2,
        member.address.city,
        member.address.postalCode,
        member.gateNotes,
      ]
    );
    await db.exec(
      `INSERT INTO memberships (member_id, state) VALUES ($1, 'free')
       ON CONFLICT (member_id) DO NOTHING`,
      [id]
    );
  }
  const memberByEmail = new Map(
    (await db.query<{ email: string; id: string }>(`SELECT email, id FROM members`)).map((r) => [r.email, r.id])
  );
  for (const member of MEMBER_SEED) {
    const id = memberByEmail.get(member.email);
    if (id) memberIds.set(member.name, id);
  }

  await db.exec(`INSERT INTO seeding_state (id, done) VALUES (1, TRUE) ON CONFLICT (id) DO UPDATE SET done = TRUE`);
  return { memberIds, phlebotomistIds, staffIds };
}

/** Range table starting data, applied inside the seeding transaction. */
export const STARTING_RANGES: {
  marker: string;
  effectiveFrom: string;
  rows: { sex: string; ageBand: string; low: string; high: string; optimalLow: string; optimalHigh: string }[];
}[] = [
  { marker: "glucose", effectiveFrom: "2020-01-01", rows: allRows("70", "99", "75", "90") },
  { marker: "hba1c", effectiveFrom: "2020-01-01", rows: allRows("4.0", "5.6", "4.6", "5.3") },
  { marker: "insulin", effectiveFrom: "2020-01-01", rows: allRows("2.0", "19.6", "2.0", "8.0") },
  { marker: "ldl", effectiveFrom: "2020-01-01", rows: allRows("40", "129", "40", "99") },
  {
    marker: "hdl",
    effectiveFrom: "2020-01-01",
    rows: [
      ...sexRows("female", "50", "100", "60", "90"),
      ...sexRows("male", "40", "100", "50", "90"),
    ],
  },
  { marker: "triglycerides", effectiveFrom: "2020-01-01", rows: allRows("30", "149", "30", "99") },
  { marker: "apoB", effectiveFrom: "2020-01-01", rows: allRows("40", "99", "40", "79") },
  { marker: "tsh", effectiveFrom: "2020-01-01", rows: allRows("0.45", "4.50", "1.00", "2.50") },
  {
    marker: "testosterone",
    effectiveFrom: "2020-01-01",
    rows: [
      ...sexRows("female", "15", "70", "25", "60"),
      { sex: "male", ageBand: "age18To39", low: "300", high: "1000", optimalLow: "500", optimalHigh: "900" },
      { sex: "male", ageBand: "age40To59", low: "300", high: "950", optimalLow: "450", optimalHigh: "850" },
      { sex: "male", ageBand: "age60Plus", low: "250", high: "900", optimalLow: "400", optimalHigh: "800" },
    ],
  },
  {
    marker: "estradiol",
    effectiveFrom: "2020-01-01",
    rows: [
      { sex: "female", ageBand: "age18To39", low: "30", high: "400", optimalLow: "50", optimalHigh: "250" },
      { sex: "female", ageBand: "age40To59", low: "10", high: "350", optimalLow: "30", optimalHigh: "200" },
      { sex: "female", ageBand: "age60Plus", low: "0", high: "30", optimalLow: "0", optimalHigh: "20" },
      ...sexRows("male", "10", "40", "20", "35"),
    ],
  },
  {
    marker: "creatinine",
    effectiveFrom: "2020-01-01",
    rows: [
      ...sexRows("female", "0.50", "1.00", "0.60", "0.90"),
      ...sexRows("male", "0.70", "1.30", "0.80", "1.10"),
    ],
  },
  {
    marker: "egfr",
    effectiveFrom: "2020-01-01",
    rows: [
      { sex: "female", ageBand: "age18To39", low: "90", high: "150", optimalLow: "100", optimalHigh: "130" },
      { sex: "female", ageBand: "age40To59", low: "75", high: "150", optimalLow: "90", optimalHigh: "120" },
      { sex: "female", ageBand: "age60Plus", low: "60", high: "150", optimalLow: "75", optimalHigh: "110" },
      { sex: "male", ageBand: "age18To39", low: "90", high: "150", optimalLow: "100", optimalHigh: "130" },
      { sex: "male", ageBand: "age40To59", low: "75", high: "150", optimalLow: "90", optimalHigh: "120" },
      { sex: "male", ageBand: "age60Plus", low: "60", high: "150", optimalLow: "75", optimalHigh: "110" },
    ],
  },
  {
    marker: "alt",
    effectiveFrom: "2020-01-01",
    rows: [
      ...sexRows("female", "7", "33", "10", "25"),
      ...sexRows("male", "7", "40", "10", "30"),
    ],
  },
  { marker: "vitaminD", effectiveFrom: "2020-01-01", rows: allRows("30.0", "100.0", "40.0", "60.0") },
  {
    marker: "ferritin",
    effectiveFrom: "2020-01-01",
    rows: [
      ...sexRows("female", "15", "150", "40", "120"),
      ...sexRows("male", "30", "400", "50", "200"),
    ],
  },
  { marker: "vitaminB12", effectiveFrom: "2020-01-01", rows: allRows("232", "1245", "500", "1000") },
  { marker: "magnesiumRbc", effectiveFrom: "2020-01-01", rows: allRows("4.2", "6.8", "5.5", "6.5") },
  { marker: "hsCrp", effectiveFrom: "2020-01-01", rows: allRows("0.00", "3.00", "0.00", "1.00") },
  { marker: "homocysteine", effectiveFrom: "2020-01-01", rows: allRows("4.0", "15.0", "4.0", "9.0") },
  {
    marker: "hemoglobin",
    effectiveFrom: "2020-01-01",
    rows: [
      ...sexRows("female", "12.0", "15.5", "13.0", "14.5"),
      ...sexRows("male", "13.5", "17.5", "14.0", "16.0"),
    ],
  },
];

function allRows(low: string, high: string, optimalLow: string, optimalHigh: string) {
  return [
    ...sexRows("female", low, high, optimalLow, optimalHigh),
    ...sexRows("male", low, high, optimalLow, optimalHigh),
  ];
}

function sexRows(sex: string, low: string, high: string, optimalLow: string, optimalHigh: string) {
  return (["age18To39", "age40To59", "age60Plus"] as const).map((ageBand) => ({
    sex,
    ageBand,
    low,
    high,
    optimalLow,
    optimalHigh,
  }));
}

/** Insert starting range versions and the seeded LDL change. */
export async function seedRanges(db: Database): Promise<void> {
  for (const version of STARTING_RANGES) {
    const id = newId("rngver");
    const inserted = await db.one<{ id: string }>(
      `INSERT INTO range_versions (id, marker, effective_from, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (marker, effective_from) DO NOTHING
       RETURNING id`,
      [id, version.marker, version.effectiveFrom, "Maya Okafor", new Date("2020-01-01T00:00:00Z")]
    );
    if (!inserted) continue;
    for (const row of version.rows) {
      await db.exec(
        `INSERT INTO range_rows (version_id, sex, age_band, low, high, optimal_low, optimal_high)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [inserted.id, row.sex, row.ageBand, row.low, row.high, row.optimalLow, row.optimalHigh]
      );
    }
  }
  const ldlChange = newId("rngver");
  const inserted = await db.one<{ id: string }>(
    `INSERT INTO range_versions (id, marker, effective_from, created_by, created_at)
     VALUES ($1, 'ldl', '2026-07-01', 'Maya Okafor', $2)
     ON CONFLICT (marker, effective_from) DO NOTHING
     RETURNING id`,
    [ldlChange, new Date("2026-07-01T00:00:00Z")]
  );
  if (inserted) {
    for (const row of allRows("40", "115", "40", "89")) {
      await db.exec(
        `INSERT INTO range_rows (version_id, sex, age_band, low, high, optimal_low, optimal_high)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [inserted.id, row.sex, row.ageBand, row.low, row.high, row.optimalLow, row.optimalHigh]
      );
    }
  }
}

export type SeedDraw = {
  memberName: string;
  phlebotomistName: string;
  startsAt: string;
  collectedAt: string;
  kitCode: string;
  results: { marker: string; value: string }[];
};

export const SEED_DRAWS: SeedDraw[] = [
  {
    memberName: "Elena Marsh",
    phlebotomistName: "Luis Carrillo",
    startsAt: "2025-09-15T13:00:00Z",
    collectedAt: "2025-09-15T13:12:00Z",
    kitCode: "KT-1000013-6",
    results: [
      { marker: "vitaminD", value: "22.5" },
      { marker: "ldl", value: "118" },
      { marker: "hdl", value: "58" },
      { marker: "apoB", value: "92" },
      { marker: "hsCrp", value: "1.40" },
      { marker: "ferritin", value: "35" },
    ],
  },
  {
    memberName: "Elena Marsh",
    phlebotomistName: "Luis Carrillo",
    startsAt: "2026-03-09T13:00:00Z",
    collectedAt: "2026-03-09T13:15:00Z",
    kitCode: "KT-1000021-6",
    results: [
      { marker: "vitaminD", value: "31.5" },
      { marker: "ldl", value: "108" },
      { marker: "hdl", value: "61" },
      { marker: "apoB", value: "84" },
      { marker: "hsCrp", value: "0.90" },
      { marker: "ferritin", value: "48" },
    ],
  },
  {
    memberName: "Elena Marsh",
    phlebotomistName: "Luis Carrillo",
    startsAt: "2026-09-14T13:00:00Z",
    collectedAt: "2026-09-14T13:10:00Z",
    kitCode: "KT-1000101-6",
    results: [
      { marker: "vitaminD", value: "44.0" },
      { marker: "ldl", value: "120" },
      { marker: "hdl", value: "64" },
      { marker: "apoB", value: "78" },
      { marker: "hsCrp", value: "0.60" },
      { marker: "ferritin", value: "62" },
    ],
  },
  {
    memberName: "Marcus Bell",
    phlebotomistName: "Grace Whitaker",
    startsAt: "2026-10-05T11:20:00Z",
    collectedAt: "2026-10-05T11:31:00Z",
    kitCode: "KT-1000110-4",
    results: [
      { marker: "vitaminD", value: "38.2" },
      { marker: "ldl", value: "96" },
      { marker: "hdl", value: "47" },
      { marker: "apoB", value: "88" },
      { marker: "hsCrp", value: "2.10" },
      { marker: "ferritin", value: "180" },
      { marker: "testosterone", value: "520" },
    ],
  },
];

export const SEED_VITAMIN_D_NOTE = "Keep the morning D3 with breakfast.";
export const SEED_NOTE_BY = "Priya Shah";

export const SEED_PLAN = {
  publishedAt: "2026-09-21T16:30:00Z",
  publishedBy: "Priya Shah",
  nutrition: "Build each meal around protein and vegetables.\n\n- Two portions of oily fish a week\n- Fibre at breakfast",
  movement: "- Walk 30 minutes a day\n- Strength work twice a week",
  sleep: "Lights out by 22:30 on weeknights.",
  supplements: "Take the morning packet with breakfast and the evening packet an hour before bed.",
};

export const SEED_BLEND = {
  items: [
    { ingredient: "vitaminD3", capsulesPerDay: 1 },
    { ingredient: "magnesiumGlycinate", capsulesPerDay: 2 },
    { ingredient: "omega3", capsulesPerDay: 2 },
    { ingredient: "methylB12", capsulesPerDay: 1 },
    { ingredient: "ashwagandha", capsulesPerDay: 1 },
  ],
  savedBy: "Priya Shah",
  savedAt: "2026-09-21T16:30:00Z",
};

export const SEED_MESSAGES = [
  {
    memberName: "Elena Marsh",
    body: "Could we move my spring draw a little earlier?",
    sentAt: "2026-09-22T15:00:00Z",
    fromRole: "member",
    fromName: "Elena Marsh",
  },
  {
    memberName: "Elena Marsh",
    body: "Yes — I'll offer you 06:20 next time.",
    sentAt: "2026-09-22T16:10:00Z",
    fromRole: "coordinator",
    fromName: "Dana Ruiz",
  },
];

export async function seedDrawsAndDependent(
  db: Database,
  seeds: SeedResult,
  computeResult: (member: {
    sex: string;
    dateOfBirth: string;
    timeZone: string;
    marker: string;
    value: string;
    collectedAt: Date;
  }) => Promise<{
    flag: string;
    ageBand: string;
    low: string;
    high: string;
    optimalLow: string;
    optimalHigh: string;
    effectiveFrom: string;
  }>
): Promise<void> {
  for (const draw of SEED_DRAWS) {
    const memberId = seeds.memberIds.get(draw.memberName);
    const phlebotomistId = seeds.phlebotomistIds.get(draw.phlebotomistName);
    if (!memberId || !phlebotomistId) continue;
    const member = await db.one<{
      id: string;
      sex: string;
      date_of_birth: string;
      time_zone: string;
    }>(`SELECT id, sex, date_of_birth::text AS date_of_birth, time_zone FROM members WHERE id = $1`, [memberId]);
    if (!member) continue;
    const startsAt = new Date(draw.startsAt);
    const collectedAt = new Date(draw.collectedAt);
    const drawId = newId("draw");
    const existing = await db.one<{ id: string }>(`SELECT id FROM draws WHERE member_id = $1 AND starts_at = $2`, [
      memberId,
      startsAt,
    ]);
    if (existing) continue;
    const localDate = draw.memberName === "Elena Marsh" ? collectedAtISOStringDenver(collectedAt) : "2026-10-05";
    const localTime = draw.memberName === "Elena Marsh" ? "07:12" : "07:20";
    await db.exec(
      `INSERT INTO draws (id, member_id, phlebotomist_id, state, starts_at, local_date, local_time, time_zone, collected_at, kit_codes, released_at, released_by, created_by)
       VALUES ($1, $2, $3, 'released', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        drawId,
        memberId,
        phlebotomistId,
        startsAt,
        localDate,
        localTime,
        member.time_zone,
        collectedAt,
        [draw.kitCode],
        collectedAt,
        "Priya Shah",
        "Dana Ruiz",
      ]
    );
    for (const result of draw.results) {
      const computed = await computeResult({
        sex: member.sex,
        dateOfBirth: member.date_of_birth,
        timeZone: member.time_zone,
        marker: result.marker,
        value: result.value,
        collectedAt,
      });
      const note =
        draw.memberName === "Elena Marsh" &&
        draw.kitCode === "KT-1000101-6" &&
        result.marker === "vitaminD"
          ? SEED_VITAMIN_D_NOTE
          : null;
      await db.exec(
        `INSERT INTO results (id, draw_id, member_id, marker, value, flag, age_band,
          range_low, range_high, range_optimal_low, range_optimal_high, range_effective_from, note, corrected_by, corrected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          newId("res"),
          drawId,
          memberId,
          result.marker,
          result.value,
          computed.flag,
          computed.ageBand,
          computed.low,
          computed.high,
          computed.optimalLow,
          computed.optimalHigh,
          computed.effectiveFrom,
          note,
          note ? SEED_NOTE_BY : null,
          note ? collectedAt : null,
        ]
      );
    }
  }

  // Seeded plan, blend and care thread for Elena Marsh
  const memberId = seeds.memberIds.get("Elena Marsh");
  if (memberId) {
    const hasPlan = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM longevity_plans WHERE member_id = $1`,
      [memberId]
    );
    if (hasPlan?.count === "0") {
      const blendItems = SEED_BLEND.items;
      const packed = (await import("../shared/blends.js")).packBlend(blendItems);
      const blendId = newId("blend");
      await db.exec(
        `INSERT INTO blends (id, member_id, items, morning_capsules, evening_capsules, list_price_cents, member_price_cents, saved_by, saved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          blendId,
          memberId,
          JSON.stringify(blendItems),
          packed.morningCapsules,
          packed.eveningCapsules,
          packed.listPriceCents,
          packed.memberPriceCents,
          SEED_BLEND.savedBy,
          new Date(SEED_BLEND.savedAt),
        ]
      );
      const planId = newId("plan");
      await db.exec(
        `INSERT INTO longevity_plans (id, member_id, state, based_on_plan_id, nutrition, movement, sleep, supplements, published_at, published_by, blend_id, updated_at)
         VALUES ($1, $2, 'published', NULL, $3, $4, $5, $6, $7, $8, $9, $7)`,
        [
          planId,
          memberId,
          SEED_PLAN.nutrition,
          SEED_PLAN.movement,
          SEED_PLAN.sleep,
          SEED_PLAN.supplements,
          new Date(SEED_PLAN.publishedAt),
          SEED_PLAN.publishedBy,
          blendId,
        ]
      );
      for (const message of SEED_MESSAGES) {
        await db.exec(
          `INSERT INTO messages (id, member_id, from_role, from_name, staff_id, body, sent_at)
           VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
          [
            newId("msg"),
            memberId,
            message.fromRole,
            message.fromName,
            message.body,
            new Date(message.sentAt),
          ]
        );
      }
      await db.exec(
        `INSERT INTO message_threads (member_id, state, last_message_at) VALUES ($1, 'handled', $2)
         ON CONFLICT (member_id) DO UPDATE SET state = 'handled', last_message_at = $2`,
        [memberId, new Date("2026-09-22T16:10:00Z")]
      );
    }
  }
}

function collectedAtISOStringDenver(instant: Date): string {
  const dates: Record<string, string> = {
    "2025-09-15": "2025-09-15",
    "2026-03-09": "2026-03-09",
    "2026-09-14": "2026-09-14",
  };
  for (const [starts, local] of Object.entries(dates)) {
    if (instant.toISOString().startsWith(starts.slice(0, 10))) return local;
  }
  return instant.toISOString().slice(0, 10);
}

