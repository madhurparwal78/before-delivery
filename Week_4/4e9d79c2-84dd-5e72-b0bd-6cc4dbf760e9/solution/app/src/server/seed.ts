// The exact starting state, applied once per database on first serve.
import { hashPassword } from "./auth.js";
import { nowSeconds, one, transaction, type Db } from "./db.js";
import { addDefaultRates, depositFor, rateInForce, vehicleTotals, writeMovement } from "./domain.js";
import { newId, newToken } from "./http.js";
import { config } from "./config.js";
import { quoteEnds } from "./api-hires.js";
import { foldEmail, foldName, foldTelephone } from "../shared/rules.js";
import { addDays, nextClockChange, toInstant, ukDate } from "../shared/time.js";

const DIRECTORY: [string, string, string, number[]][] = [
  ["OP-1001", "Hanley Motor Services", "Coventry", [16, 49, 70]], ["OP-1002", "Arden Vale Coaches", "Solihull", [31, 49]], ["OP-1003", "Nuneaton Road Travel", "Nuneaton", [8, 12, 16]],
  ["OP-1004", "Rugby Town Minibuses", "Rugby", [8, 12]], ["OP-1005", "Leam Valley Executive Travel", "Leamington Spa", [49, 56]], ["OP-1006", "Tame Bridge Coachworks", "Tamworth", [31, 49, 70]],
  ["OP-1007", "Walsall Lock Coaches", "Walsall", [16, 49]], ["OP-1008", "Dudley Castle Travel", "Dudley", [12, 16, 31]], ["OP-1009", "Redditch Needle Coaches", "Redditch", [49, 56, 70]],
  ["OP-1010", "Stafford Shire Passenger Services", "Stafford", [31, 56]], ["OP-1011", "Hinckley Boot Travel", "Hinckley", [8, 16]], ["OP-1012", "Kenilworth Keep Coaches", "Kenilworth", [49, 70]],
  ["OP-1013", "Warwick Bear Minibuses", "Warwick", [8, 12, 16]], ["OP-1014", "Lichfield Spire Coaches", "Lichfield", [31, 49]], ["OP-1015", "Telford Gorge Travel", "Telford", [16, 49, 56]],
  ["OP-1016", "Worcester Sauce Bottle Tours", "Worcester", [12, 31]], ["OP-1017", "Burton Brewery Coaches", "Burton upon Trent", [49, 70]], ["OP-1018", "Stourbridge Glass Travel", "Stourbridge", [8, 12]],
  ["OP-1019", "Sutton Park Coachlines", "Sutton Coldfield", [31, 49, 56]], ["OP-1020", "Bromsgrove Nail Works Minibuses", "Bromsgrove", [16]], ["OP-1021", "Atherstone Ball Game Coaches", "Atherstone", [49]],
  ["OP-1022", "Daventry Mast Travel", "Daventry", [12, 31]], ["OP-1023", "Kidderminster Carpet Coaches", "Kidderminster", [16, 49]], ["OP-1024", "Hereford Cider Mill Travel", "Hereford", [56, 70]],
];
const CUSTOMERS: [string, string, string, string, string][] = [
  ["CU-1001", "CHELMSLEYWOODANDKINGSHURSTUNITEDFEDERATIONOFPRIMARYSCHOOLSTRUSTS", "office@chelmsleywood-federation.example", "01632 960101", "en"],
  ["CU-1002", "Agnieszka Wiśniewska", "agnieszka@wisniewska.example", "01632 960102", "pl"],
  ["CU-1003", "شازیہ ملک", "shazia@malik.example", "01632 960103", "ur"],
  ["CU-1004", "Jack O'Rourke", "jack@orourke.example", "01632 960155", "en"],
  ["CU-1005", "Foleshill Tool Makers", "office@foleshill-tools.example", "01632 960105", "en"],
  ["CU-1006", "Stoke Aldermoor Bowls Club", "secretary@aldermoor-bowls.example", "01632 960106", "en"],
];
const STOPS = ["Coventry station, Coventry CV1 2GT", "NEC, Birmingham B40 1NT"];

const addDesk = async (tx: Db, name: string, email: string, password: string, now: number): Promise<string> => {
  const id = newId("DK");
  await tx.query("INSERT INTO desks (id,name,email,email_folded,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [id, name, email, foldEmail(email), await hashPassword(password), now]);
  await addDefaultRates(tx, id);
  return id;
};
const addCustomer = async (tx: Db, deskId: string, [id, name, email, telephone, language]: string[], now: number): Promise<void> => {
  await tx.query("INSERT INTO customers (id,desk_id,name,email,email_folded,telephone,telephone_folded,language,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, deskId, name, email, foldEmail(email), telephone, foldTelephone(telephone), language, now]);
};

interface SeedHire { id: string; customer: string[]; occasion: string; state: string; day: string; time: string; created: number; people?: number; plan?: number[] }
const addHire = async (tx: Db, deskId: string, h: SeedHire): Promise<void> => {
  const at = { date: h.day, time: h.time };
  await tx.query(
    `INSERT INTO hires (id,desk_id,customer_id,occasion,journey_type,state,plan_sizes,party,name,email,telephone,language,created_at,depart_date,depart_time,depart_instant)
     VALUES ($1,$2,$3,$4,'oneWay',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [h.id, deskId, h.customer[0], h.occasion, h.state, h.plan ?? null, JSON.stringify({ people: h.people ?? 47, large: 0, medium: 0, hand: 0, wheelchairs: 0 }), h.customer[1], h.customer[2], h.customer[3], h.customer[4], h.created, h.day, h.time, toInstant(at)],
  );
  for (const [position, text] of STOPS.entries()) await tx.query("INSERT INTO stops (id,hire_id,position,text,checked) VALUES ($1,$2,$3,$4,true)", [newId("ST"), h.id, position, text]);
};
const addVehicle = async (tx: Db, deskId: string, h: SeedHire, seats: number, operator: string, bought: number, sentAt: number, ends: number, accepted: boolean): Promise<string> => {
  const rates = await rateInForce(tx, deskId, ukDate(sentAt));
  const figures = { seats, bought, margin_halves: 30, charges: 0 };
  const id = newId("VH");
  await tx.query(
    "INSERT INTO vehicles (id,hire_id,position,seats,operator_id,bought,margin_halves,deposit,depart_date,depart_time,depart_instant) VALUES ($1,$2,0,$3,$4,$5,30,$6,$7,$8,$9)",
    [id, h.id, seats, operator, bought, depositFor(seats, vehicleTotals(figures).total, rates), h.day, h.time, toInstant({ date: h.day, time: h.time })],
  );
  await tx.query("UPDATE hires SET awarded_operator=$2,awarded_at=$3,quote_token=$4,quote_sent_at=$3,quote_ends_at=$5,rate_table_id=$6,accepted_at=$7 WHERE id=$1", [h.id, operator, sentAt, newToken(), ends, rates.id, accepted ? sentAt : null]);
  return id;
};

export const applySeed = async (): Promise<void> => {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(727401)");
    if (await one(tx, "SELECT 1 FROM meta WHERE key='seeded'")) return;
    const now = nowSeconds();
    const B = ukDate(now);
    const C = nextClockChange(B);
    const maria = await addDesk(tx, "Merrowfield Coach Hire", "maria@merrowfield.example", "Merrowfield-Desk-2027", now);
    const tomasz = await addDesk(tx, "Zieliński Hire", "tomasz@zielinski-hire.example", "Zielinski-Desk-2027", now);
    for (const customer of CUSTOMERS) await addCustomer(tx, maria, customer, now);
    const halina = ["CU-2001", "Halina Nowak", "halina@nowak.example", "01632 960180", "pl"];
    await addCustomer(tx, tomasz, halina, now);
    await addHire(tx, tomasz, { id: "CV-T0MA5", customer: halina, occasion: "company", state: "new", day: addDays(B, 60), time: "08:00", created: now });

    for (const [index, [id, name, town, sizes]] of DIRECTORY.entries()) {
      await tx.query("INSERT INTO operators (desk_id,id,name,town,email,telephone,sizes,dbs_checked_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [maria, id, name, town, `desk@op-${id.slice(3)}.example`, `01632 ${960200 + index}`, sizes, index < 12 ? "2026-01-15" : null]);
      if (index < 12) {
        await tx.query("INSERT INTO papers (desk_id,operator_id,kind,ends_on) VALUES ($1,$2,'operatorLicence','2028-12-31')", [maria, id]);
        await tx.query("INSERT INTO papers (desk_id,operator_id,kind,ends_on) VALUES ($1,$2,'publicLiabilityCover',$3)", [maria, id, id === "OP-1012" ? "2027-06-30" : "2028-12-31"]);
      }
    }
    const [c1, c2, c3, c4, c5, c6] = CUSTOMERS;
    const seeded: SeedHire[] = [
      { id: "CV-7K2M4", customer: c4, occasion: "company", state: "new", day: addDays(B, 60), time: "08:00", created: now },
      { id: "CV-D2Q5Y", customer: c1, occasion: "school", state: "new", day: addDays(B, 70), time: "09:00", created: now - 1 },
      { id: "CV-3H9QR", customer: c1, occasion: "school", state: "priced", day: addDays(B, 45), time: "08:30", created: now - 2, plan: [49] },
      { id: "CV-8T4VX", customer: c2, occasion: "weddings", state: "quoted", day: addDays(B, 50), time: "13:00", created: now - 3, plan: [49] },
      { id: "CV-5N6WZ", customer: c3, occasion: "weddings", state: "quoted", day: addDays(B, 40), time: "12:00", created: now - 4, people: 8, plan: [8] },
      { id: "CV-9D3JS", customer: c6, occasion: "festivals", state: "lost", day: addDays(B, 30), time: "10:00", created: now - 5 },
      { id: "CV-2P7GB", customer: c5, occasion: "company", state: "won", day: addDays(C, -1), time: "08:00", created: now - 6, plan: [49] },
      { id: "CV-A4F6C", customer: c6, occasion: "festivals", state: "won", day: C, time: "08:00", created: now - 7, people: 12, plan: [12] },
      { id: "CV-B8H3K", customer: c1, occasion: "school", state: "won", day: addDays(C, 7), time: "09:15", created: now - 8, plan: [49] },
      { id: "CV-C6M9T", customer: c2, occasion: "weddings", state: "won", day: addDays(C, -8), time: "07:30", created: now - 9, people: 8, plan: [8] },
    ];
    const hire = (id: string): SeedHire => seeded.find((h) => h.id === id) as SeedHire;
    for (const h of seeded) await addHire(tx, maria, h);

    for (const [operator, price] of [["OP-1001", 100630], ["OP-1002", 104000]] as const) {
      await tx.query("INSERT INTO bid_asks (token,desk_id,hire_id,operator_id,sent_at,closes_at,prices,received_at,mailed) VALUES ($1,$2,'CV-3H9QR',$3,$4,$5,$6,$4,true)",
        [newToken(), maria, operator, now, now + config.bidWindow, [price]]);
    }
    await addVehicle(tx, maria, hire("CV-8T4VX"), 49, "OP-1002", 86957, now, quoteEnds(now), false);
    const tenBefore = toInstant({ date: addDays(B, -10), time: "10:00" });
    await addVehicle(tx, maria, hire("CV-5N6WZ"), 8, "OP-1003", 52175, tenBefore, quoteEnds(tenBefore), false);
    const booked: [string, string, number, string, number, string, string, [string, number][]][] = [
      ["CV-2P7GB", "RN-1001", 1, "OP-1001", 100630, "Ewan Price", "01632 960301", [["drive", 270], ["break", 45], ["drive", 120]]],
      ["CV-A4F6C", "RN-1002", 2, "OP-1004", 65217, "Marek Zając", "01632 960302", [["drive", 271], ["break", 45], ["drive", 60]]],
      ["CV-B8H3K", "RN-1003", 3, "OP-1005", 86956, "Ewan Price", "01632 960301", [["drive", 120]]],
      ["CV-C6M9T", "RN-1004", 4, "OP-1003", 52175, "Marek Zając", "01632 960302", [["drive", 120]]],
    ];
    const vehicles = new Map<string, string>();
    for (const [id, runId, number, operator, bought, driver, telephone, blocks] of booked) {
      const h = hire(id);
      const seats = h.plan?.[0] as number;
      const vehicleId = await addVehicle(tx, maria, h, seats, operator, bought, now, quoteEnds(now), true);
      vehicles.set(id, vehicleId);
      await tx.query("INSERT INTO runs (id,desk_id,number,hire_id,vehicle_id,driver_name,driver_telephone,telephone_folded,token,duty_start,blocks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [runId, maria, number, id, vehicleId, driver, telephone, foldTelephone(telephone), newToken(), toInstant({ date: h.day, time: h.time }), JSON.stringify(blocks.map(([kind, minutes]) => ({ kind, minutes })))]);
    }
    await tx.query("UPDATE desks SET next_run=5 WHERE id=$1", [maria]);

    const pay = async (id: string, pennies: number, part: "deposit" | "balance"): Promise<void> => {
      await writeMovement(tx, { deskId: maria, hireId: id, vehicleId: vehicles.get(id) as string, plus: "clientMoney", minus: "hireIncome", pennies, at: now, part, description: `Payment ${id}` });
    };
    await pay("CV-A4F6C", 2500, "deposit");
    await pay("CV-B8H3K", 10000, "deposit");
    await pay("CV-C6M9T", 5000, "deposit");
    await pay("CV-C6M9T", 67001, "balance");

    const b8 = vehicles.get("CV-B8H3K");
    const seated: [string, string, string][] = [["Agnieszka Wiśniewska", "Adult", "12A"], ["Jack O'Rourke", "Adult", "3C"], ["Maja Kowalska", "Year 5", "1A"], ["Ibrahim Malik", "Year 5", "1B"], ["Tom Bennett", "Year 5", "1C"]];
    for (const [name, group, seat] of seated) {
      await tx.query("INSERT INTO passengers (id,hire_id,name,grp,folded,vehicle_id,seat) VALUES ($1,'CV-B8H3K',$2,$3,$4,$5,$6)", [newId("PX"), name, group, [name, group, ""].map(foldName).join("|"), b8, seat]);
    }
    const year = Number(B.slice(0, 4));
    await tx.query("INSERT INTO documents (id,desk_id,hire_id,kind,state,number,customer_name,created_at,history) VALUES ($1,$2,'CV-C6M9T','invoice','waiting',$3,$4,$5,$6)",
      [newId("DC"), maria, `INV-${year}-0001`, c2[1], now, JSON.stringify([{ at: new Date(now * 1000).toISOString().replace(/\.\d+Z$/, "Z"), who: "Merrowfield Coach Hire", what: "Asked for" }])]);
    await tx.query("INSERT INTO number_counters (desk_id,kind,year,last) VALUES ($1,'invoice',$2,1)", [maria, year]);
    await tx.query("INSERT INTO meta (key,value) VALUES ('seeded','yes')");
  });
};
