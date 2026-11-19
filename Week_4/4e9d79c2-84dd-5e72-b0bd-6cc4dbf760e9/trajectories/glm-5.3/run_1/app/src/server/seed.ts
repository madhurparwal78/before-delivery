import type pg from "pg";
import { hashPassword, cryptoRandom } from "./auth.js";
import { loadConfig } from "./config.js";
import { makeReference, foldEmail, foldTelephone, isoInstant } from "./domain.js";
import { addDays, ukDateString, ukDayOfWeek, ukToInstant } from "./uktime.js";
import { SIZES, suggestPlan, quoteVehicleMoney, type Party } from "./rules.js";

const cfg = loadConfig();

const BOOT_INSTANT = new Date();
const B = ukDateString(BOOT_INSTANT);

function nextClockChangeDate(from: string): string {
  let d = from;
  for (let i = 0; i < 400; i++) {
    d = addDays(d, 1);
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    if (ukDayOfWeek(d) !== 0) continue;
    const isMarch = m === 3 && day >= 25;
    const isOctober = m === 10 && day >= 25;
    if (isMarch || isOctober) return d;
    void y;
  }
  return addDays(from, 180);
}

const C = nextClockChangeDate(B);

export async function seedOnce(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const done = await client.query<{ seeded: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM desks WHERE email_folded = $1) AS seeded",
      [foldEmail("maria@merrowfield.example")]
    );
    if (done.rows[0].seeded) {
      await client.query("COMMIT");
      return;
    }
    await seedAll(client as unknown as pg.PoolClient);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

type Client = pg.PoolClient;

const OCCASION_LABEL: Record<string, string> = {
  school: "School",
  weddings: "Weddings",
  company: "Company",
  festivals: "Festivals and sport",
};

async function seedAll(db: Client): Promise<void> {
  const { desks, customers } = await seedDesksAndCustomers(db);
  await seedRateTables(db);
  await seedOperators(db);
  await seedHires(db, desks, customers);
}

async function seedDesksAndCustomers(db: Client): Promise<{ desks: Record<string, string>; customers: Record<string, string> }> {
  const mariaId = await insertDesk(db, {
    name: "Merrowfield Coach Hire",
    email: "maria@merrowfield.example",
    password: "Merrowfield-Desk-2027",
    isPublic: true,
  });
  await insertDesk(db, {
    name: "Zieliński Hire",
    email: "tomasz@zielinski-hire.example",
    password: "Zielinski-Desk-2027",
    isPublic: false,
  });
  const mariaCustomers: [string, string, string, string, string][] = [
    ["CU-1001", "CHELMSLEYWOODANDKINGSHURSTUNITEDFEDERATIONOFPRIMARYSCHOOLSTRUSTS", "office@chelmsleywood-federation.example", "01632 960101", "en"],
    ["CU-1002", "Agnieszka Wiśniewska", "agnieszka@wisniewska.example", "01632 960102", "pl"],
    ["CU-1003", "شازیہ ملک", "shazia@malik.example", "01632 960103", "ur"],
    ["CU-1004", "Jack O'Rourke", "jack@orourke.example", "01632 960155", "en"],
    ["CU-1005", "Foleshill Tool Makers", "office@foleshill-tools.example", "01632 960105", "en"],
    ["CU-1006", "Stoke Aldermoor Bowls Club", "secretary@aldermoor-bowls.example", "01632 960106", "en"],
  ];
  for (const [id, name, email, tel, lang] of mariaCustomers) {
    await db.query(
      `INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
      [id, mariaId, name, email, tel, lang, foldEmail(email), foldTelephone(tel)]
    );
  }
  await db.query(
    `INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ('CU-2001',$1,'Halina Nowak','halina@nowak.example','01632 960180','pl','active','halina@nowak.example','01632960180')`,
    [await deskIdByEmail(db, "tomasz@zielinski-hire.example")]
  );
  return { desks: { maria: mariaId }, customers: Object.fromEntries(mariaCustomers.map((c) => [c[0], c[0]])) };
}

async function insertDesk(db: Client, d: { name: string; email: string; password: string; isPublic: boolean }): Promise<string> {
  const id = "DK-" + Math.abs(hashString(d.email)).toString(36).slice(0, 8).toUpperCase() + "-SEED";
  await db.query(
    `INSERT INTO desks (id, name, email, email_folded, password_hash, public) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, d.name, d.email, foldEmail(d.email), hashPassword(d.password), d.isPublic]
  );
  return id;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function deskIdByEmail(db: Client, email: string): Promise<string> {
  const r = await db.query<{ id: string }>("SELECT id FROM desks WHERE email_folded = $1", [foldEmail(email)]);
  return r.rows[0].id;
}

async function seedRateTables(db: Client): Promise<void> {
  for (const deskRow of (await db.query<{ id: string }>("SELECT id FROM desks")).rows) {
    await db.query(
      `INSERT INTO rate_tables (id, desk_id, effective_from, default_margin_percent, waiting_rate_pennies, second_driver_pennies, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
       VALUES ($1,$2,'2000-01-01','15',2000,15000,5000,10000,10000,15000)`,
      ["RT-DEFAULT-" + deskRow.id, deskRow.id]
    );
  }
}

async function seedOperators(db: Client): Promise<void> {
  const mariaId = await deskIdByEmail(db, "maria@merrowfield.example");
  const rows: [string, string, string, string, string, number[]][] = [
    ["OP-1001", "Hanley Motor Services", "Coventry", "desk@op-1001.example", "01632 960200", [16, 49, 70]],
    ["OP-1002", "Arden Vale Coaches", "Solihull", "desk@op-1002.example", "01632 960201", [31, 49]],
    ["OP-1003", "Nuneaton Road Travel", "Nuneaton", "desk@op-1003.example", "01632 960202", [8, 12, 16]],
    ["OP-1004", "Rugby Town Minibuses", "Rugby", "desk@op-1004.example", "01632 960203", [8, 12]],
    ["OP-1005", "Leam Valley Executive Travel", "Leamington Spa", "desk@op-1005.example", "01632 960204", [49, 56]],
    ["OP-1006", "Tame Bridge Coachworks", "Tamworth", "desk@op-1006.example", "01632 960205", [31, 49, 70]],
    ["OP-1007", "Walsall Lock Coaches", "Walsall", "desk@op-1007.example", "01632 960206", [16, 49]],
    ["OP-1008", "Dudley Castle Travel", "Dudley", "desk@op-1008.example", "01632 960207", [12, 16, 31]],
    ["OP-1009", "Redditch Needle Coaches", "Redditch", "desk@op-1009.example", "01632 960208", [49, 56, 70]],
    ["OP-1010", "Stafford Shire Passenger Services", "Stafford", "desk@op-1010.example", "01632 960209", [31, 56]],
    ["OP-1011", "Hinckley Boot Travel", "Hinckley", "desk@op-1011.example", "01632 960210", [8, 16]],
    ["OP-1012", "Kenilworth Keep Coaches", "Kenilworth", "desk@op-1012.example", "01632 960211", [49, 70]],
    ["OP-1013", "Warwick Bear Minibuses", "Warwick", "desk@op-1013.example", "01632 960212", [8, 12, 16]],
    ["OP-1014", "Lichfield Spire Coaches", "Lichfield", "desk@op-1014.example", "01632 960213", [31, 49]],
    ["OP-1015", "Telford Gorge Travel", "Telford", "desk@op-1015.example", "01632 960214", [16, 49, 56]],
    ["OP-1016", "Worcester Sauce Bottle Tours", "Worcester", "desk@op-1016.example", "01632 960215", [12, 31]],
    ["OP-1017", "Burton Brewery Coaches", "Burton upon Trent", "desk@op-1017.example", "01632 960216", [49, 70]],
    ["OP-1018", "Stourbridge Glass Travel", "Stourbridge", "desk@op-1018.example", "01632 960217", [8, 12]],
    ["OP-1019", "Sutton Park Coachlines", "Sutton Coldfield", "desk@op-1019.example", "01632 960218", [31, 49, 56]],
    ["OP-1020", "Bromsgrove Nail Works Minibuses", "Bromsgrove", "desk@op-1020.example", "01632 960219", [16]],
    ["OP-1021", "Atherstone Ball Game Coaches", "Atherstone", "desk@op-1021.example", "01632 960220", [49]],
    ["OP-1022", "Daventry Mast Travel", "Daventry", "desk@op-1022.example", "01632 960221", [12, 31]],
    ["OP-1023", "Kidderminster Carpet Coaches", "Kidderminster", "desk@op-1023.example", "01632 960222", [16, 49]],
    ["OP-1024", "Hereford Cider Mill Travel", "Hereford", "desk@op-1024.example", "01632 960223", [56, 70]],
  ];
  for (const [id, name, town, email, tel, sizes] of rows) {
    await db.query(
      `INSERT INTO operators (desk_id, id, name, town, email, telephone, sizes, listed) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
      [mariaId, id, name, town, email, tel, sizes]
    );
    const isEarly = Number(id.slice(3)) <= 1012;
    if (isEarly) {
      const plEnds = id === "OP-1012" ? "2027-06-30" : "2028-12-31";
      await db.query(
        `INSERT INTO papers (desk_id, operator_id, kind, ends_on, stored, paper_id) VALUES ($1,$2,'operatorLicence','2028-12-31',FALSE,$3),($1,$2,'publicLiabilityCover',$4,FALSE,$3)`,
        [mariaId, id, "PP-" + id + "-" + Math.floor(cryptoRandom() * 1e6), plEnds]
      );
      await db.query(`UPDATE operators SET dbs_checked_on='2026-01-15' WHERE desk_id=$1 AND id=$2`, [mariaId, id]);
    }
  }
}

const STOPS = ["Coventry station, Coventry CV1 2GT", "NEC, Birmingham B40 1NT"];

interface SeedHire {
  ref: string;
  customerId: string;
  occasion: string;
  state: string;
  stage: string;
  depart: { date: string; time: string };
  vehicles: { seats: number; operatorId: string; bought: number; margin: string }[];
  people: number;
  quoteSentAt: Date | null;
  quoteMailed: boolean;
  payments: number[];
  runs: { driver: [string, string] | null; blocks: [string, number][] }[];
  seatsPlan?: { name: string; group: string; seat: string }[];
  openBids?: { operatorId: string; price: string }[];
}

export async function seedHires(db: Client, desks: Record<string, string>, customers: Record<string, string>): Promise<void> {
  const mariaId = await deskIdByEmail(db, "maria@merrowfield.example");
  const tomaszId = await deskIdByEmail(db, "tomasz@zielinski-hire.example");
  await seedTomaszEnquiry(db, tomaszId);
  const def = (await db.query<{ id: string }>("SELECT id FROM rate_tables WHERE desk_id=$1 AND effective_from='2000-01-01'", [mariaId])).rows[0].id;
  const sends: SeedHire[] = [
    { ref: "CV-7K2M4", customerId: "CU-1004", occasion: "company", state: "new", stage: "enquiry", depart: { date: addDays(B, 60), time: "08:00" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-D2Q5Y", customerId: "CU-1001", occasion: "school", state: "new", stage: "enquiry", depart: { date: addDays(B, 70), time: "09:00" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-3H9QR", customerId: "CU-1001", occasion: "school", state: "priced", stage: "enquiry", depart: { date: addDays(B, 45), time: "08:30" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [], openBids: [
      { operatorId: "OP-1001", price: "1006.30" },
      { operatorId: "OP-1002", price: "1040.00" },
    ] },
    { ref: "CV-8T4VX", customerId: "CU-1002", occasion: "weddings", state: "quoted", stage: "quoted", depart: { date: addDays(B, 50), time: "13:00" }, vehicles: [{ seats: 49, operatorId: "OP-1002", bought: 86957, margin: "15" }], people: 47, quoteSentAt: BOOT_INSTANT, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-5N6WZ", customerId: "CU-1003", occasion: "weddings", state: "quoted", stage: "quoted", depart: { date: addDays(B, 40), time: "12:00" }, vehicles: [{ seats: 8, operatorId: "OP-1003", bought: 52175, margin: "15" }], people: 8, quoteSentAt: new Date(BOOT_INSTANT.getTime() - 10 * 86400000), quoteMailed: true, payments: [], runs: [] },
    { ref: "CV-9D3JS", customerId: "CU-1006", occasion: "festivals", state: "lost", stage: "enquiry", depart: { date: addDays(B, 30), time: "10:00" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-2P7GB", customerId: "CU-1005", occasion: "company", state: "won", stage: "accepted", depart: { date: addDays(C, -1), time: "08:00" }, vehicles: [{ seats: 49, operatorId: "OP-1001", bought: 100630, margin: "15" }], people: 47, quoteSentAt: null, quoteMailed: true, payments: [], runs: [{ driver: ["Ewan Price", "01632 960301"], blocks: [["drive", 270], ["break", 45], ["drive", 120]] }] },
    { ref: "CV-A4F6C", customerId: "CU-1006", occasion: "festivals", state: "won", stage: "accepted", depart: { date: C, time: "08:00" }, vehicles: [{ seats: 12, operatorId: "OP-1004", bought: 65217, margin: "15" }], people: 12, quoteSentAt: null, quoteMailed: true, payments: [2500], runs: [{ driver: ["Marek Zając", "01632 960302"], blocks: [["drive", 271], ["break", 45], ["drive", 60]] }] },
    { ref: "CV-B8H3K", customerId: "CU-1001", occasion: "school", state: "won", stage: "accepted", depart: { date: addDays(C, 7), time: "09:15" }, vehicles: [{ seats: 49, operatorId: "OP-1005", bought: 86956, margin: "15" }], people: 47, quoteSentAt: null, quoteMailed: true, payments: [10000], runs: [{ driver: ["Ewan Price", "01632 960301"], blocks: [["drive", 120]] }], seatsPlan: [
      { name: "Agnieszka Wiśniewska", group: "Adult", seat: "12A" },
      { name: "Jack O'Rourke", group: "Adult", seat: "3C" },
      { name: "Maja Kowalska", group: "Year 5", seat: "1A" },
      { name: "Ibrahim Malik", group: "Year 5", seat: "1B" },
      { name: "Tom Bennett", group: "Year 5", seat: "1C" },
    ] },
    { ref: "CV-C6M9T", customerId: "CU-1002", occasion: "weddings", state: "won", stage: "accepted", depart: { date: addDays(C, -8), time: "07:30" }, vehicles: [{ seats: 8, operatorId: "OP-1003", bought: 52175, margin: "15" }], people: 8, quoteSentAt: null, quoteMailed: true, payments: [5000, 67001], runs: [{ driver: ["Marek Zając", "01632 960302"], blocks: [["drive", 120]] }] },
  ];
  let runNumber = 0;
  for (const h of sends) {
    const depart = ukToInstant(h.depart.date, h.depart.time).instant;
    const endsAt = h.quoteSentAt ? quoteEndFor(h.quoteSentAt) : null;
    const hireId = "HR-" + h.ref;
    await db.query(
      `INSERT INTO hires (id, desk_id, reference, customer_id, occasion, stage, enquiry_state, depart_date, depart_time, depart_instant, quote_version, quote_sent_at, quote_ends_at, quote_path, quote_mailed, rate_table_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16)`,
      [hireId, mariaId, h.ref, h.customerId, h.occasion, h.stage, h.state, h.depart.date, h.depart.time, depart, h.quoteSentAt, endsAt, h.quoteSentAt ? "q" + tokenFor(h.ref) : null, h.quoteMailed, def, BOOT_INSTANT]
    );
    await db.query(
      `INSERT INTO enquiries (id, desk_id, customer_id, reference, occasion, state, journey_type, depart_date, depart_time, depart_instant, name, email, telephone, language, people, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'oneWay',$7,$8,$9,(SELECT name FROM customers WHERE id=$3),(SELECT email FROM customers WHERE id=$3),(SELECT telephone FROM customers WHERE id=$3),(SELECT language FROM customers WHERE id=$3),$10,$11)`,
      [h.ref, mariaId, h.customerId, h.ref, h.occasion, h.state, h.depart.date, h.depart.time, depart, h.people, BOOT_INSTANT]
    );
    for (let i = 0; i < STOPS.length; i++) {
      await db.query(
        `INSERT INTO enquiry_stops (id, enquiry_id, desk_id, position, text, checked) VALUES ($1,$2,$3,$4,$5,TRUE)`,
        ["ST-" + h.ref + "-" + i, h.ref, mariaId, i, STOPS[i]]
      );
    }
    if (h.vehicles.length) {
      await savePlan(db, mariaId, h.ref, h.vehicles.map((v) => v.seats));
    }
    let position = 0;
    for (const v of h.vehicles) {
      position++;
      const money = quoteVehicleMoney(v.bought, v.margin, v.seats, {
        minibus: 5000, minibusHigher: 10000, coach: 10000, coachHigher: 15000, minibusHigherAt: 75000, coachHigherAt: 100000,
      });
      const vid = "VH-" + h.ref + "-" + position;
      await db.query(
        `INSERT INTO vehicles (id, desk_id, hire_id, seats, position, operator_id, bought_pennies, margin_percent, selling_pennies, vat_pennies, total_pennies, deposit_pennies, deposit_fixed, depart_date, depart_time, depart_instant)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13,$14,$15)`,
        [vid, mariaId, hireId, v.seats, position, v.operatorId, v.bought, v.margin, money.selling, money.vat, money.total, money.deposit, h.depart.date, h.depart.time, depart]
      );
      let paidIndex = 0;
      for (const p of h.payments) {
        const kind = paidIndex === 0 ? "deposit" : "balance";
        await recordPayment(db, mariaId, hireId, vid, p, BOOT_INSTANT, kind);
        paidIndex++;
      }
      if (h.runs.length) {
        const run = h.runs[0];
        runNumber++;
        const runId = "RN-" + String(1000 + runNumber);
        await db.query(
          `INSERT INTO runs (id, desk_id, number, hire_id, vehicle_id, driver_name, driver_telephone, driver_folded, confirmed, depart_date, depart_time, depart_instant, sheet_path)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,$10,$11,$12)`,
          [runId, mariaId, runNumber, hireId, vid, run.driver?.[0] ?? null, run.driver?.[1] ?? null, run.driver ? foldTelephone(run.driver[1]) : null, h.depart.date, h.depart.time, depart, "r" + tokenFor(h.ref + runId)]
        );
        for (let bi = 0; bi < run.blocks.length; bi++) {
          await db.query(`INSERT INTO duty_blocks (run_id, desk_id, position, kind, minutes) VALUES ($1,$2,$3,$4,$5)`, [runId, mariaId, bi, run.blocks[bi][0], run.blocks[bi][1]]);
        }
        await db.query(`INSERT INTO run_tokens (token, desk_id, run_id, created_at) VALUES ($1,$2,$3,$4)`, ["r" + tokenFor(h.ref + runId), mariaId, runId, BOOT_INSTANT]);
      }
    }
    if (h.seatsPlan) {
      let i = 0;
      for (const p of h.seatsPlan) {
        i++;
        await db.query(
          `INSERT INTO passengers (id, desk_id, hire_id, name, "group", needs, listed_twice, wheelchair, position, seat, vehicle_id) VALUES ($1,$2,$3,$4,$5,'',FALSE,FALSE,$6,$7,$8)`,
          ["PS-" + h.ref + "-" + i, mariaId, hireId, p.name, p.group, i, p.seat, "VH-" + h.ref + "-1"]
        );
      }
    }
    if (h.openBids?.length) {
      await savePlan(db, mariaId, h.ref, [49]);
      const askedAt = BOOT_INSTANT;
      const closesAt = new Date(Math.floor(askedAt.getTime() / 1000) * 1000 + cfg.bidWindowSeconds * 1000);
      for (const ob of h.openBids) {
        const token = "b" + tokenFor(h.ref + ob.operatorId);
        await db.query(
          `INSERT INTO bids (desk_id, enquiry_id, operator_id, ask_path, asked_at, closes_at, prices, received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$5)`,
          [mariaId, h.ref, ob.operatorId, token, askedAt, closesAt, [ob.price]]
        );
        await db.query(`INSERT INTO bid_tokens (token, desk_id, enquiry_id, operator_id, created_at) VALUES ($1,$2,$3,$4,$5)`, [
          token,
          mariaId,
          h.ref,
          ob.operatorId,
          askedAt,
        ]);
      }
    }
    if (h.quoteSentAt) {
      await db.query(`INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,1,$4)`, ["q" + tokenFor(h.ref), mariaId, hireId, h.quoteSentAt]);
    } else if (h.stage === "accepted") {
      const sentAt = new Date(BOOT_INSTANT.getTime() - 20 * 86400000);
      const endsAt = new Date(Math.floor(sentAt.getTime() / 1000) * 1000 + 5 * 86400000 - 1000);
      await db.query(`UPDATE hires SET quote_sent_at=$1, quote_ends_at=$2, quote_path=$3 WHERE id=$4`, [
        sentAt,
        endsAt,
        "q" + tokenFor(h.ref),
        hireId,
      ]);
      await db.query(`INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,1,$4)`, ["q" + tokenFor(h.ref), mariaId, hireId, sentAt]);
    }
  }
  await seedInvoice(db, mariaId);
  void desks;
  void customers;
}

function tokenFor(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(0, 22);
}

function quoteEndFor(sentAt: Date): Date {
  if (cfg.quoteValidSeconds) return new Date(Math.floor(sentAt.getTime() / 1000) * 1000 + cfg.quoteValidSeconds * 1000 - 1000);
  const d = ukDateString(sentAt);
  const endDay = addDays(d, 5);
  const r = ukToInstant(endDay, "23:59:59".slice(0, 5));
  return new Date(r.instant.getTime() + 59999);
}

async function savePlan(db: Client, deskId: string, enquiryId: string, sizes: number[]): Promise<void> {
  const party: Party = { people: 47, large: 0, medium: 0, hand: 0, wheelchairs: 0 };
  await db.query(
    `INSERT INTO plan_saves (desk_id, enquiry_id, sizes, suggested, larger_than_needed) VALUES ($1,$2,$3,$4,$5)`,
    [deskId, enquiryId, sizes, suggestPlan(party), false]
  );
}

async function recordPayment(db: Client, deskId: string, hireId: string, vehicleId: string, pennies: number, at: Date, kind: string): Promise<void> {
  const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  await db.query(
    `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
     ($1,$2,$3,$4,$10,$5,'clientMoney',$6,$7,'Statement'),($8,$2,$3,$4,$10,$5,'hireIncome',$9,$7,'Statement')`,
    [movementId + "-A", deskId, hireId, movementId, vehicleId, String(pennies), at.toISOString(), movementId + "-B", String(-pennies), kind]
  );
}

async function seedInvoice(db: Client, deskId: string): Promise<void> {
  const year = Number(B.slice(0, 4));
  const hireId = "HR-CV-C6M9T";
  await db.query(
    `INSERT INTO documents (id, desk_id, hire_id, kind, state, number, object_key, customer_name, created_at, history)
     VALUES ($1,$2,$3,'invoice','waiting',NULL,NULL,'Agnieszka Wiśniewska',$4,$5)`,
    ["DC-SEED-INVOICE-1", deskId, hireId, BOOT_INSTANT.toISOString(), JSON.stringify([{ at: isoInstant(BOOT_INSTANT), who: "Maria Whitcombe", what: "Issued" }])]
  );
  await db.query(
    `INSERT INTO document_numbers (desk_id, kind_prefix, year, last_number) VALUES ($1,'INV',$2,0) ON CONFLICT DO NOTHING`,
    [deskId, year]
  );
  void SIZES;
}

async function seedTomaszEnquiry(db: Client, deskId: string): Promise<void> {
  const depart = ukToInstant(addDays(B, 20), "10:00").instant;
  await db.query(
    `INSERT INTO enquiries (id, desk_id, customer_id, reference, occasion, state, journey_type, depart_date, depart_time, depart_instant, name, email, telephone, language, people, created_at)
     VALUES ('CV-T0MA5',$1,'CU-2001','CV-T0MA5','school','new','oneWay',$2,'10:00',$3,'Halina Nowak','halina@nowak.example','01632 960180','pl',47,$4)`,
    [deskId, addDays(B, 20), depart, BOOT_INSTANT.toISOString()]
  );
  for (let i = 0; i < STOPS.length; i++) {
    await db.query(`INSERT INTO enquiry_stops (id, enquiry_id, desk_id, position, text, checked) VALUES ($1,'CV-T0MA5',$2,$3,$4,TRUE)`, ["ST-T0MA5-" + i, deskId, i, STOPS[i]]);
  }
}

export { makeReference, B, C, BOOT_INSTANT, OCCASION_LABEL };
