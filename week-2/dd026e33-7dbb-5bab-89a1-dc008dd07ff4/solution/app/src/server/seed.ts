// Schema and seed (brief: Seed data). Applied on every serve start under one advisory lock, so
// several processes starting together never race; the seed is written only into an empty database.
import type pg from "pg";
import { PANELS } from "../shared/domain.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { SCHEMA } from "./schema.js";

const SEED_LOCK = 4_173_001;
// Every seeded user shares the brief's seed password; only its scrypt digest is kept in source.
const SEED_PASSWORD_HASH = "scrypt$hSbctCx/9Lx1V2aogS+IHQ==$T1X3qRdfwvQPlhnNBy2UNbnWbstszkFR7f409PePyLQ=";
const DAY = 86_400_000;

const USERS = [
  ["u-ines", "Ines Varga", "ines@marrowlark.test", "concierge"],
  ["u-tomas", "Tomas Riedl", "tomas@marrowlark.test", "care_technician"],
  ["u-luca", "Luca Marent", "luca@marrowlark.test", "care_technician"],
  ["u-odile", "Odile Fenner", "odile@marrowlark.test", "workshop_lead"],
  ["u-rafael", "Rafael Amsel", "rafael@marrowlark.test", "house_manager"],
  ["u-henrietta", "Henrietta Calloway", "henrietta@owners.test", "owner"],
  ["u-kenji", "Kenji Arlow", "kenji@owners.test", "owner"],
] as const;

const BAYS = [
  ["A1", "standard", 5200, 2500, 1, 1],
  ["A2", "standard", 5200, 2500, 1, 2],
  ["A3", "standard", 5200, 2500, 1, 3],
  ["A4", "standard", 4600, 2300, 1, 4],
  ["B1", "covered_lift", 5600, 2700, 2, 1],
  ["B2", "covered_lift", 5600, 2700, 2, 2],
  ["C1", "sealed_capsule", 5800, 2800, 3, 1],
  ["C2", "sealed_capsule", 5000, 2400, 3, 2],
] as const;

// id, owner, year, make, model, registration, colour, length, width, odometer, tyre centibar,
// start-up schedule, days since last start-up (null = never), bay (null = awaiting intake)
const CARS = [
  ["c-etype", "u-henrietta", 1967, "Jaguar", "E-Type", "ZH 41967", "Opalescent Silver Grey", 4450, 1660, 48210, 220, true, 31, "B1"],
  ["c-911rs", "u-henrietta", 1973, "Porsche", "911 Carrera RS 2.7", "ZH 27373", "Grand Prix White", 4147, 1652, 61377, 200, true, 3, "A1"],
  ["c-testarossa", "u-kenji", 1989, "Ferrari", "Testarossa", "GE 19890", "Rosso Corsa", 4485, 1976, 23904, 240, true, 10, "C1"],
  ["c-300sl", "u-kenji", 1962, "Mercedes-Benz", "300 SL Roadster", "BE 30062", "Silver Blue", 4570, 1790, 87650, 210, false, null, "B2"],
  ["c-fulvia", "u-kenji", 1971, "Lancia", "Fulvia Coupé", "TI 19710", "Blu Lancia", 3975, 1555, 112045, 180, true, null, null],
] as const;

const PLAN_OF_CLASS = {
  standard: "bay-standard-monthly",
  covered_lift: "bay-covered-lift-monthly",
  sealed_capsule: "bay-sealed-capsule-monthly",
} as const;

const ITEMS = [
  ["b-etype-keys", "c-etype", "key_set", "Key sets", 2],
  ["b-etype-cover", "c-etype", "cover", "Indoor cover", 1],
  ["b-etype-wheel", "c-etype", "spare_wheel", "Wire spare wheel", 1],
  ["b-etype-cert", "c-etype", "document", "Heritage certificate", 1],
  ["b-911rs-keys", "c-911rs", "key_set", "Key sets", 2],
  ["b-911rs-cover", "c-911rs", "cover", "Indoor cover", 1],
  ["b-testarossa-keys", "c-testarossa", "key_set", "Key sets", 2],
  ["b-testarossa-cover", "c-testarossa", "cover", "Indoor cover", 1],
  ["b-testarossa-book", "c-testarossa", "document", "Service book", 1],
  ["b-300sl-keys", "c-300sl", "key_set", "Key sets", 1],
  ["b-300sl-cover", "c-300sl", "cover", "Indoor cover", 1],
] as const;

// kind, description, quantity hundredths, unit price centimes
const LINES: Record<string, readonly (readonly [string, string, number, number])[]> = {
  "j-1001": [
    ["part", "Bonnet hinge bushes", 200, 3745],
    ["labour", "Strip, prime and paint bonnet and front wings", 2650, 14500],
    ["paint_materials", "Primer, base and clear", 100, 21830],
  ],
  "j-1002": [
    ["labour", "Fill, flat and blend front valance chips", 325, 14500],
    ["paint_materials", "Touch-up primer and base", 100, 6480],
  ],
  "j-1003": [
    ["part", "Touch-in kit", 100, 1290],
    ["labour", "Flat and touch in sill chips", 175, 14500],
    ["paint_materials", "Base and clear", 100, 3840],
  ],
  "j-1004": [["labour", "Lift boot floor mat and inspect for corrosion", 200, 14500]],
};

// J-1001 readings by stage (stage order, days before first start), panels in published order.
const J1001: readonly (readonly [number, string, number, Partial<Record<string, number>>])[] = [
  [0, "Intake", 6, { front_valance: 112, bonnet: 142, front_wing_l: 268, front_wing_r: 335, door_l: 118, door_r: 121, sill_l: 96, sill_r: 74, roof: 131, rear_quarter_l: 127, rear_quarter_r: 124, boot_lid: 138 }],
  [1, "Stripped", 5, { bonnet: 0, front_wing_l: 0, front_wing_r: 0 }],
  [2, "Epoxy primer", 4, { bonnet: 48, front_wing_l: 51, front_wing_r: 50 }],
  [4, "2K primer", 3, { bonnet: 132, front_wing_l: 140, front_wing_r: 138 }],
  [5, "Base", 2, { bonnet: 158, front_wing_l: 166, front_wing_r: 163 }],
];

const J1003: readonly (readonly [number, string, number, Partial<Record<string, number>>])[] = [
  [0, "Intake", 12, { front_valance: 104, bonnet: 118, front_wing_l: 121, front_wing_r: 117, door_l: 112, door_r: 115, sill_l: 212, sill_r: 109, roof: 120, rear_quarter_l: 116, rear_quarter_r: 119, boot_lid: 122 }],
  [6, "Clear", 5, { sill_l: 236 }],
];

async function seed(client: pg.PoolClient): Promise<void> {
  const start = Date.now();
  const ago = (days: number): Date => new Date(start - days * DAY);
  const expiry = config.timers.estimateExpirySeconds * 1000;
  const hash = SEED_PASSWORD_HASH;

  for (const [position, [id, name, email, role]] of USERS.entries()) {
    await client.query("INSERT INTO users (id, name, email, role, password_hash, position) VALUES ($1, $2, $3, $4, $5, $6)", [
      id, name, email, role, hash, position,
    ]);
  }
  for (const [code, cls, length, width, row, column] of BAYS) {
    await client.query("INSERT INTO bays (id, code, class, length_mm, width_mm, row_no, column_no) VALUES ($1, $1, $2, $3, $4, $5, $6)", [
      code, cls, length, width, row, column,
    ]);
  }
  for (const [id, owner, year, make, model, registration, colour, length, width, odometer, tyre, schedule, lastStart, bay] of CARS) {
    const cls = BAYS.find((b) => b[0] === bay)?.[1];
    await client.query(
      `INSERT INTO cars (id, owner_id, year, make, model, registration, colour, length_mm, width_mm, odometer_km,
                         tyre_spec_centibar, startup_schedule, status, bay_id, intake_at, created_at, billing_status, billing_plan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id, owner, year, make, model, registration, colour, length, width, odometer, tyre, schedule,
        bay ? "stored" : "awaiting_intake", bay, bay ? ago(60) : null, ago(bay ? 61 : 1),
        bay ? "pending" : "none", cls ? PLAN_OF_CLASS[cls] : null,
      ],
    );
    if (lastStart !== null) {
      await client.query(
        "INSERT INTO care_entries (id, car_id, at, by_id, started) VALUES ($1, $2, $3, 'u-tomas', true)",
        [`e-${id.slice(2)}-seed`, id, ago(lastStart)],
      );
    }
    if (bay) {
      await client.query("INSERT INTO provider_effects (kind, car_id) VALUES ('subscription_create', $1)", [id]);
    }
  }
  for (const [id, car, kind, label, count] of ITEMS) {
    await client.query("INSERT INTO items (id, car_id, kind, label, created_at) VALUES ($1, $2, $3, $4, $5)", [id, car, kind, label, ago(60)]);
    await client.query("INSERT INTO movements (id, item_id, direction, count, at, by_id) VALUES ($1, $2, 'in', $3, $4, 'u-ines')", [
      `m-${id.slice(2)}-seed`, id, count, ago(60),
    ]);
  }

  const jobs = [
    { id: "j-1001", number: "J-1001", car: "c-911rs", title: "Bonnet and front wings respray", status: "in_progress", sent: ago(22), approved: ago(20), finished: null },
    { id: "j-1002", number: "J-1002", car: "c-testarossa", title: "Front valance stone-chip repair", status: "sent", sent: ago(2), approved: null, finished: null },
    { id: "j-1003", number: "J-1003", car: "c-300sl", title: "Sill touch-in", status: "finished", sent: ago(14), approved: ago(13), finished: ago(4) },
    { id: "j-1004", number: "J-1004", car: "c-etype", title: "Boot floor inspection", status: "draft", sent: null, approved: null, finished: null },
  ];
  for (const job of jobs) {
    await client.query(
      `INSERT INTO jobs (id, number, car_id, title, status, version, sent_at, expires_at, approved_at, finished_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)`,
      [
        job.id, job.number, job.car, job.title, job.status, job.sent,
        job.sent ? new Date(job.sent.getTime() + expiry) : null, job.approved, job.finished, ago(30),
      ],
    );
    for (const [position, [kind, description, quantity, price]] of (LINES[job.id] ?? []).entries()) {
      await client.query(
        `INSERT INTO job_lines (id, job_id, position, kind, description, quantity_hundredths, unit_price_centimes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [`l-${job.id.slice(2)}-${position + 1}`, job.id, position, kind, description, quantity, price],
      );
    }
  }
  for (const [jobId, stages] of [["j-1001", J1001], ["j-1003", J1003]] as const) {
    for (const [order, name, days, values] of stages) {
      const stageId = `s-${jobId.slice(2)}-${order}`;
      await client.query("INSERT INTO stages (id, job_id, stage_order, name, logged_at, logged_by) VALUES ($1, $2, $3, $4, $5, 'u-odile')", [
        stageId, jobId, order, name, ago(days),
      ]);
      for (const panel of PANELS) {
        const value = values[panel.id];
        if (value === undefined) continue;
        await client.query(
          "INSERT INTO readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by) VALUES ($1, $2, $3, $4, $5, $6, 'u-odile')",
          [`r-${jobId.slice(2)}-${order}-${panel.id}`, jobId, stageId, panel.id, value, ago(days)],
        );
      }
    }
  }
}

/** Applies the schema and, on an empty database, the seed. Safe to run from several processes. */
export async function migrateAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK]);
    await client.query(SCHEMA);
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM users");
    if (rows[0]?.n === "0") {
      await client.query("BEGIN");
      try {
        await seed(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK]).catch(() => undefined);
    client.release();
  }
}
