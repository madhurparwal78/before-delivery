// The seed: the club, its people, households, case list and the open Cycle 44. Loaded once, the
// first time the database is created; every invented name here is from the brief.
import { clubWall, localInstant } from "./clubtime.js";
import { nowSeconds, one, run, transaction } from "./db.js";
import { householdAccount, writeMovement } from "./ledger.js";
import { settledStatus, unitsToGo } from "./lines.js";
import { countPledgeChange } from "./pledges.js";

const HOUSEHOLDS: [string, string, string, number, string][] = [
  ["HH-1001", "Okafor-Lindqvist household", "hh1001@elmstreet.example", 12_000, "HOME-1001"],
  ["HH-1002", "Bellweather household", "hh1002@elmstreet.example", 8_000, "HOME-1002"],
  ["HH-1003", "Tran-Osei household", "hh1003@elmstreet.example", 6_000, "HOME-1003"],
  ["HH-1004", "Kowalczyk household", "hh1004@elmstreet.example", 9_500, "HOME-1004"],
  ["HH-1005", "Ruiz-Abernathy household", "hh1005@elmstreet.example", 1_500, "HOME-1005"],
  ["HH-1006", "Patel-Mercer household", "hh1006@elmstreet.example", 0, "HOME-1006"],
];

const PRODUCTS: [string, string, number, string, number][] = [
  ["P-OATS", "Rolled oats, 25 lb sack", 25, "lb", 3850],
  ["P-TAHINI", "Tahini, 12 jars", 12, "jar", 4700],
  ["P-OLIVE", "Olive oil, 6 bottles", 6, "bottle", 8999],
  ["P-LENTIL", "Red lentils, 25 lb sack", 25, "lb", 4125],
  ["P-PNUT", "Peanut butter, 12 jars", 12, "jar", 5150],
  ["P-MAPLE", "Maple syrup, 6 jugs", 6, "jug", 7400],
  ["P-RICE", "Brown rice, 50 lb sack", 50, "lb", 6299],
  ["P-QUINOA", "Quinoa, 10 lb bag", 10, "lb", 3333],
];

/** Cycle 44's lines in cycle order, with their pledges in pledge order. */
const SEED_LINES: [string, [string, number][]][] = [
  ["P-TAHINI", [["HH-1002", 5], ["HH-1003", 4]]],
  ["P-OLIVE", [["HH-1004", 4]]],
  ["P-OATS", []],
  ["P-MAPLE", [["HH-1001", 6]]],
];

export function seedOnce(): void {
  transaction(() => {
    if (one("SELECT value FROM meta WHERE key = 'seeded'")) return;
    const created = nowSeconds();
    run("INSERT INTO club (id, name, time_zone, distributor) VALUES (1, ?, ?, ?)", "Elm Street Basement Co-op", "America/Chicago", "Prairie Hollow Naturals");
    run("INSERT INTO people (access_code, role, name, household_code) VALUES ('COORD-2718', 'coordinator', 'Marisol Ferreira-Quinn', NULL)");
    run("INSERT INTO people (access_code, role, name, household_code) VALUES ('VOL-3141', 'volunteer', 'Desmond Achterberg', NULL)");
    for (const [code, name, email, carried, access] of HOUSEHOLDS) {
      run("INSERT INTO households (code, name, email) VALUES (?, ?, ?)", code, name, email);
      run("INSERT INTO people (access_code, role, name, household_code) VALUES (?, 'member', ?, ?)", access, name, code);
      if (carried > 0) {
        writeMovement("carried_forward", "Carried forward", carried, householdAccount(code), "opening:carried-forward");
      }
    }
    PRODUCTS.forEach(([id, caseName, pack, unit, price], position) =>
      run("INSERT INTO products (id, case_name, pack, unit, price_cents, position) VALUES (?, ?, ?, ?, ?, ?)", id, caseName, pack, unit, price, position),
    );
    const today = clubWall(created);
    const day = (offset: number) => {
      const d = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    };
    const cutoff = localInstant({ ...day(7), hour: 20, minute: 0, second: 0 });
    const pickupStart = localInstant({ ...day(8), hour: 9, minute: 0, second: 0 });
    const pickupEnd = localInstant({ ...day(8), hour: 12, minute: 0, second: 0 });
    run(
      "INSERT INTO cycles (seq, id, name, status, revision, cutoff_at, pickup_start_at, pickup_end_at) VALUES (44, 'cy-44', 'Cycle 44', 'open', 2, ?, ?, ?)",
      cutoff, pickupStart, pickupEnd,
    );
    SEED_LINES.forEach(([productId, pledges], position) => {
      const pack = PRODUCTS.find((p) => p[0] === productId)![2];
      run(
        "INSERT INTO lines (cycle_id, product_id, position, version, status) VALUES ('cy-44', ?, ?, ?, ?)",
        productId, position, 1 + pledges.length,
        settledStatus("filling", unitsToGo(pack, pledges.map(([pledger, units], id) => ({ id, pledger, units })))),
      );
      for (const [household, units] of pledges) {
        run("INSERT INTO pledges (cycle_id, product_id, pledger, units) VALUES ('cy-44', ?, ?, ?)", productId, household, units);
        countPledgeChange("cy-44", units, created);
      }
    });
    run("INSERT INTO meta (key, value) VALUES ('seeded', ?)", String(created));
  });
}
