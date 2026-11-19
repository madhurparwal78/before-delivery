"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/server/schema.ts
var schema_exports = {};
__export(schema_exports, {
  SCHEMA_SQL: () => SCHEMA_SQL
});
var SCHEMA_SQL;
var init_schema = __esm({
  "src/server/schema.ts"() {
    "use strict";
    SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS desks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_folded TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  public BOOL NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS desks_email_folded ON desks(email_folded);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  generation INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  telephone TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  notes TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  closed_at TIMESTAMPTZ,
  erase_at TIMESTAMPTZ,
  email_folded TEXT,
  telephone_folded TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customers_desk ON customers(desk_id);
CREATE INDEX IF NOT EXISTS customers_folded ON customers(desk_id, email_folded, telephone_folded);

CREATE TABLE IF NOT EXISTS rate_tables (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  effective_from DATE NOT NULL,
  default_margin_percent TEXT NOT NULL,
  waiting_rate_pennies BIGINT NOT NULL,
  second_driver_pennies BIGINT NOT NULL,
  deposit_minibus BIGINT NOT NULL,
  deposit_minibus_higher BIGINT NOT NULL,
  deposit_coach BIGINT NOT NULL,
  deposit_coach_higher BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS operators (
  desk_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  town TEXT,
  email TEXT,
  telephone TEXT,
  sizes INT[] NOT NULL DEFAULT '{}',
  listed BOOL NOT NULL DEFAULT TRUE,
  dbs_checked_on DATE,
  PRIMARY KEY (desk_id, id)
);

CREATE TABLE IF NOT EXISTS papers (
  desk_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ends_on DATE NOT NULL,
  stored BOOL NOT NULL DEFAULT FALSE,
  object_key TEXT,
  stored_type TEXT,
  paper_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  PRIMARY KEY (desk_id, operator_id, kind)
);

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  customer_id TEXT,
  reference TEXT NOT NULL,
  occasion TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  journey_type TEXT NOT NULL DEFAULT 'oneWay',
  depart_date DATE NOT NULL,
  depart_time TEXT NOT NULL,
  depart_instant TIMESTAMPTZ NOT NULL,
  depart_repeated_hour TEXT,
  return_date DATE,
  return_time TEXT,
  return_instant TIMESTAMPTZ,
  return_repeated_hour TEXT,
  details TEXT,
  people INT NOT NULL DEFAULT 1,
  large INT NOT NULL DEFAULT 0,
  medium INT NOT NULL DEFAULT 0,
  hand INT NOT NULL DEFAULT 0,
  wheelchairs INT NOT NULL DEFAULT 0,
  name TEXT,
  email TEXT,
  telephone TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  submitted_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  merged_references TEXT[] NOT NULL DEFAULT '{}',
  duplicated TEXT,
  desk_notified_paper TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS enquiries_desk_state ON enquiries(desk_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS enquiries_desk_ref ON enquiries(desk_id, reference);

CREATE TABLE IF NOT EXISTS enquiry_stops (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL,
  desk_id TEXT NOT NULL,
  position INT NOT NULL,
  text TEXT NOT NULL,
  checked BOOL NOT NULL DEFAULT FALSE,
  flight_code TEXT
);
CREATE INDEX IF NOT EXISTS enquiry_stops_enquiry ON enquiry_stops(enquiry_id);

CREATE TABLE IF NOT EXISTS enquiry_rate_limit (
  desk_id TEXT NOT NULL,
  email_folded TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS enquiry_rate_idx ON enquiry_rate_limit(email_folded, created_at);

CREATE TABLE IF NOT EXISTS hires (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  occasion TEXT NOT NULL,
  stage TEXT NOT NULL,
  enquiry_state TEXT NOT NULL DEFAULT 'new',
  depart_date DATE NOT NULL,
  depart_time TEXT NOT NULL,
  depart_instant TIMESTAMPTZ NOT NULL,
  return_date DATE,
  return_time TEXT,
  return_instant TIMESTAMPTZ,
  quote_version INT NOT NULL DEFAULT 1,
  quote_sent_at TIMESTAMPTZ,
  quote_ends_at TIMESTAMPTZ,
  quote_path TEXT,
  quote_mailed BOOLEAN NOT NULL DEFAULT FALSE,
  rate_table_id TEXT,
  cancelled BOOL NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS hires_desk_ref ON hires(desk_id, reference);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  seats INT NOT NULL,
  position INT NOT NULL,
  operator_id TEXT,
  bought_pennies BIGINT,
  margin_percent TEXT,
  selling_pennies BIGINT NOT NULL DEFAULT 0,
  vat_pennies BIGINT NOT NULL DEFAULT 0,
  total_pennies BIGINT NOT NULL DEFAULT 0,
  deposit_pennies BIGINT NOT NULL DEFAULT 0,
  deposit_fixed BOOL NOT NULL DEFAULT FALSE,
  depart_date DATE,
  depart_time TEXT,
  depart_instant TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  number INT NOT NULL,
  hire_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  driver_name TEXT,
  driver_telephone TEXT,
  driver_folded TEXT,
  told_at TIMESTAMPTZ,
  confirmed BOOL NOT NULL DEFAULT FALSE,
  sheet_path TEXT,
  second_driver BOOL NOT NULL DEFAULT FALSE,
  depart_date DATE NOT NULL,
  depart_time TEXT NOT NULL,
  depart_instant TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_desk_number ON runs(desk_id, number);

CREATE TABLE IF NOT EXISTS duty_blocks (
  run_id TEXT NOT NULL,
  desk_id TEXT NOT NULL,
  position INT NOT NULL,
  kind TEXT NOT NULL,
  minutes INT NOT NULL,
  PRIMARY KEY (run_id, position)
);

CREATE TABLE IF NOT EXISTS bids (
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  ask_path TEXT NOT NULL,
  asked_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  prices TEXT[] NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  PRIMARY KEY (desk_id, enquiry_id, operator_id)
);

CREATE TABLE IF NOT EXISTS awards (
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL PRIMARY KEY,
  operator_id TEXT NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL,
  mailed INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_saves (
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  sizes INT[] NOT NULL,
  suggested INT[] NOT NULL,
  larger_than_needed BOOL NOT NULL DEFAULT FALSE,
  PRIMARY KEY (desk_id, enquiry_id)
);

CREATE TABLE IF NOT EXISTS legs (
  enquiry_id TEXT NOT NULL,
  desk_id TEXT NOT NULL,
  position INT NOT NULL,
  km TEXT NOT NULL,
  miles TEXT NOT NULL,
  minutes INT NOT NULL,
  PRIMARY KEY (enquiry_id, position)
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  movement_id TEXT NOT NULL,
  movement_kind TEXT NOT NULL DEFAULT 'payment',
  vehicle_id TEXT,
  account TEXT NOT NULL,
  amount_pennies BIGINT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  description TEXT
);
CREATE INDEX IF NOT EXISTS ledger_desk ON ledger_lines(desk_id);
CREATE INDEX IF NOT EXISTS ledger_hire ON ledger_lines(hire_id);

CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  brought_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS statements_desk_fingerprint ON statements(desk_id, fingerprint);

CREATE TABLE IF NOT EXISTS statement_rows (
  desk_id TEXT NOT NULL,
  statement_id TEXT NOT NULL,
  row_number INT NOT NULL,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount_pennies BIGINT NOT NULL,
  balance_pennies BIGINT,
  reference TEXT,
  already_seen BOOL NOT NULL DEFAULT FALSE,
  PRIMARY KEY (statement_id, row_number)
);

CREATE TABLE IF NOT EXISTS quote_tokens (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  replaced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bid_tokens (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS run_tokens (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS run_presses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  repeat_key TEXT NOT NULL,
  status_code INT NOT NULL DEFAULT 201
);
CREATE UNIQUE INDEX IF NOT EXISTS run_presses_repeat ON run_presses(run_id, stop_id, kind, repeat_key);

CREATE TABLE IF NOT EXISTS run_charges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stop_id TEXT,
  kind TEXT NOT NULL,
  minutes INT NOT NULL,
  amount_pennies BIGINT NOT NULL,
  accepted BOOL NOT NULL DEFAULT FALSE,
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS passengers (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  name TEXT NOT NULL,
  "group" TEXT,
  needs TEXT,
  listed_twice BOOL NOT NULL DEFAULT FALSE,
  wheelchair BOOL NOT NULL DEFAULT FALSE,
  position INT NOT NULL,
  seat TEXT,
  vehicle_id TEXT
);

CREATE TABLE IF NOT EXISTS passenger_files (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting',
  number TEXT,
  object_key TEXT,
  customer_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  history JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS documents_desk ON documents(desk_id);

CREATE TABLE IF NOT EXISTS document_numbers (
  desk_id TEXT NOT NULL,
  kind_prefix TEXT NOT NULL,
  year INT NOT NULL,
  last_number INT NOT NULL,
  PRIMARY KEY (desk_id, kind_prefix, year)
);

CREATE TABLE IF NOT EXISTS file_rate (
  desk_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (desk_id, hire_id, vehicle_id)
);

CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  reply_due DATE NOT NULL,
  holiday_line TEXT
);

CREATE TABLE IF NOT EXISTS lost_items (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  description TEXT NOT NULL,
  found_on DATE NOT NULL,
  held_to DATE NOT NULL,
  state TEXT NOT NULL DEFAULT 'held',
  owner_details TEXT,
  returned_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS holiday_cache (
  desk_id TEXT PRIMARY KEY,
  dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL,
  ok BOOL NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_runs (
  desk_id TEXT NOT NULL,
  day TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  done BOOL NOT NULL DEFAULT FALSE,
  PRIMARY KEY (desk_id, day, hire_id, kind)
);

CREATE TABLE IF NOT EXISTS sheet_review (
  desk_id TEXT NOT NULL,
  row_number INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (desk_id, row_number, created_at)
);

CREATE TABLE IF NOT EXISTS statement_previews (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS statement_previews_desk ON statement_previews(desk_id);

CREATE TABLE IF NOT EXISTS hire_changes (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_data JSONB,
  new_data JSONB,
  price_moved BOOL NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cancellations (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  notice_at TIMESTAMPTZ NOT NULL,
  by TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'
);

ALTER TABLE hires ADD COLUMN IF NOT EXISTS deposit_said_sent TIMESTAMPTZ;
ALTER TABLE hires ADD COLUMN IF NOT EXISTS quote_version_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS desks_generation (
  desk_id TEXT PRIMARY KEY,
  generation INT NOT NULL DEFAULT 0
);
`;
  }
});

// src/server/auth.ts
function hashPassword(password) {
  const salt = (0, import_node_crypto.randomBytes)(16);
  const hash = (0, import_node_crypto.scryptSync)(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function verifyPassword(password, stored) {
  const parts2 = (stored ?? "").split("$");
  if (parts2.length !== 3 || parts2[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts2[1], "base64");
    const expected = Buffer.from(parts2[2], "base64");
    const actual = (0, import_node_crypto.scryptSync)(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return (0, import_node_crypto.timingSafeEqual)(expected, actual);
  } catch {
    return false;
  }
}
function newSessionToken() {
  return (0, import_node_crypto.randomBytes)(24).toString("base64url");
}
function cryptoRandom() {
  const b = (0, import_node_crypto.randomBytes)(4);
  return b.readUInt32BE(0) / 4294967296;
}
var import_node_crypto, SESSION_COOKIE;
var init_auth = __esm({
  "src/server/auth.ts"() {
    "use strict";
    import_node_crypto = require("crypto");
    SESSION_COOKIE = "wayticket_session";
  }
});

// src/server/uktime.ts
function parts(instant) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const o = {};
  for (const p of f.formatToParts(instant)) o[p.type] = p.value;
  return o;
}
function ukFields(instant) {
  const o = parts(instant);
  return {
    y: Number(o.year),
    m: Number(o.month),
    d: Number(o.day),
    hh: Number(o.hour) === 24 ? 0 : Number(o.hour),
    mm: Number(o.minute),
    ss: Number(o.second)
  };
}
function ukDateString(instant) {
  const f = ukFields(instant);
  return pad(f.y) + "-" + pad(f.m) + "-" + pad(f.d);
}
function pad(n) {
  return n < 10 ? "0" + n : String(n);
}
function ukToInstant(date, time, second = false) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const base = Date.UTC(y, m - 1, d, hh, mm, 0);
  const candidates = [];
  for (let off = -3; off <= 3; off++) {
    const t = new Date(base + off * 36e5);
    const f = ukFields(t);
    if (f.y === y && f.m === m && f.d === d && f.hh === hh && f.mm === mm && f.ss === 0) candidates.push(t);
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  if (candidates.length === 0) return { instant: /* @__PURE__ */ new Date(NaN), exists: false, repeated: false };
  const pick = second && candidates.length > 1 ? candidates[1] : candidates[0];
  return { instant: pick, exists: true, repeated: candidates.length > 1 };
}
function daysFromCivil(y, m, d) {
  y += m <= 2 ? -1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function dateKey(y, m, d) {
  return pad(y) + "-" + pad(m) + "-" + pad(d);
}
function ukDayOfWeek(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function civilFromDayNumber(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}
function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const n = daysFromCivil(y, m, d) + days;
  const c = civilFromDayNumber(n);
  return dateKey(c.y, c.m, c.d);
}
var LONDON;
var init_uktime = __esm({
  "src/server/uktime.ts"() {
    "use strict";
    LONDON = "Europe/London";
  }
});

// src/server/domain.ts
function foldEmail(email) {
  return (email ?? "").toLowerCase().replace(/\s+/g, "");
}
function foldTelephone(tel) {
  let digits = (tel ?? "").replace(/\D+/g, "");
  if (digits.startsWith("44")) digits = "0" + digits.slice(2);
  return digits;
}
function foldName(name) {
  return (name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "");
}
function makeReference(rng) {
  let s = "";
  for (let i = 0; i < 5; i++) s += REF_ALPHABET[Math.floor(rng() * REF_ALPHABET.length)];
  return "CV-" + s;
}
function isoInstant(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function ukTimeHM(instant) {
  const f = ukFields(instant);
  return `${String(f.hh).padStart(2, "0")}:${String(f.mm).padStart(2, "0")}`;
}
function parseDDMMYYYY(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text ?? "").trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d < 1 || d > dim[mo - 1]) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
var REF_ALPHABET;
var init_domain = __esm({
  "src/server/domain.ts"() {
    "use strict";
    init_uktime();
    REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  }
});

// src/server/money.ts
function parseMoneyToPennies(text) {
  const t = (text ?? "").toString().trim();
  const m = /^(?:(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2}))$/.exec(t) ?? /^(\d+)\.(\d{2})$/.exec(t);
  if (m) {
    const whole = m[1].replace(/,/g, "");
    const p = Number(whole) * 100 + Number(m[2]);
    return Number.isSafeInteger(p) ? p : null;
  }
  const w = /^(\d{1,3}(?:,\d{3})*|\d+)$/.exec(t);
  if (w) {
    const p = Number(w[1].replace(/,/g, "")) * 100;
    return Number.isSafeInteger(p) ? p : null;
  }
  const h = /^(\d+)[.,](\d)$/.exec(t);
  if (h) {
    const p = Number(h[1]) * 100 + Number(h[2]) * 10;
    return Number.isSafeInteger(p) ? p : null;
  }
  return null;
}
function penniesToString(p) {
  const sign = p < 0 ? "-" : "";
  const a = Math.abs(p);
  return sign + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}
function splitEvenly(pennies, count) {
  if (count <= 0) return [];
  const base = Math.floor(pennies / count);
  let rest = pennies - base * count;
  const out = [];
  for (let i = 0; i < count; i++) {
    let x = base;
    if (pennies >= 0) {
      const take = Math.min(1, rest);
      x += take;
      rest -= take;
    }
    out.push(x);
  }
  if (pennies < 0 && rest !== 0) {
    for (let i = out.length - 1; rest !== 0 && i >= 0; i--) {
      out[i] -= 1;
      rest += 1;
    }
  }
  return out;
}
function percentOf(p, percent) {
  const scaled = p * (100 + percent) + 50;
  return scaled >= 0 ? Math.floor(scaled / 100) : -Math.floor(-scaled / 100);
}
function fractionOf(p, percent) {
  const scaled = p * percent + 50;
  return scaled >= 0 ? Math.floor(scaled / 100) : -Math.floor(-scaled / 100);
}
var init_money = __esm({
  "src/server/money.ts"() {
    "use strict";
  }
});

// src/server/rules.ts
var rules_exports = {};
__export(rules_exports, {
  SIZES: () => SIZES,
  bagUnits: () => bagUnits,
  checkPlan: () => checkPlan,
  comfortCharge: () => comfortCharge,
  hasLift: () => hasLift,
  largerThanNeeded: () => largerThanNeeded,
  partyBagUnits: () => partyBagUnits,
  quoteVehicleMoney: () => quoteVehicleMoney,
  rateInForce: () => rateInForce,
  seatsFor: () => seatsFor,
  suggestPlan: () => suggestPlan,
  vehicleClassFor: () => vehicleClassFor,
  waitingPennies: () => waitingPennies
});
function seatsFor(size) {
  return SEAT_BY_SIZE[size] ?? 0;
}
function bagUnits(size) {
  return BAG_UNITS[size] ?? 0;
}
function hasLift(size) {
  return LIFT_SIZES.has(size);
}
function partyBagUnits(p) {
  return p.large * 3 + p.medium * 2 + p.hand * 1;
}
function suggestPlan(p) {
  const all = [...SIZES];
  const fits = (list) => {
    const seatsSum = list.reduce((s, x) => s + seatsFor(x), 0);
    if (seatsSum < p.people) return false;
    const bagsSum = list.reduce((s, x) => s + bagUnits(x), 0);
    if (bagsSum < partyBagUnits(p)) return false;
    const lifts = list.filter((x) => hasLift(x)).length * 2;
    return lifts >= p.wheelchairs;
  };
  const results = [];
  for (const a of all) for (const b of all) for (const c of all) if (fits([a, b, c])) results.push([a, b, c]);
  for (const a of all) for (const b of all) if (fits([a, b])) results.push([a, b]);
  for (const a of all) if (fits([a])) results.push([a]);
  results.sort((x, y) => {
    if (x.length !== y.length) return x.length - y.length;
    const ex = x.reduce((s, v) => s + seatsFor(v), 0) - p.people;
    const ey = y.reduce((s, v) => s + seatsFor(v), 0) - p.people;
    if (ex !== ey) return ex - ey;
    const a = [...x].sort((m, n) => n - m);
    const b = [...y].sort((m, n) => n - m);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  });
  if (results.length) return [...results[0]].sort((m, n) => n - m);
  return [70, 70, 70, 70];
}
function checkPlan(sizes, party) {
  for (const s of sizes) if (!SIZES.includes(s)) return { ok: false, badSize: true };
  const seats = sizes.reduce((s, x) => s + seatsFor(x), 0);
  if (seats < party.people) return { ok: false, seatsShort: party.people - seats };
  const bags = sizes.reduce((s, x) => s + bagUnits(x), 0);
  const bagNeed = partyBagUnits(party);
  if (bags < bagNeed) return { ok: false, bagsShort: bagNeed - bags };
  const lifts = sizes.filter((x) => hasLift(x)).length * 2;
  if (lifts < party.wheelchairs) return { ok: false, wheelchairsShort: party.wheelchairs - lifts };
  return { ok: true };
}
function largerThanNeeded(sizes, suggested) {
  if (sizes.length > suggested.length) return true;
  if (sizes.length === suggested.length) {
    const s1 = sizes.reduce((a, b) => a + seatsFor(b), 0);
    const s2 = suggested.reduce((a, b) => a + seatsFor(b), 0);
    return s1 > s2;
  }
  return false;
}
function vehicleClassFor(sizes) {
  return sizes.some((s) => s >= 31) ? "coach" : "minibus";
}
function quoteVehicleMoney(bought, marginPercent, seats, limits) {
  const margin = Number(marginPercent);
  const selling = percentOf(bought, margin);
  const vatRate = seats >= 12 ? 0 : 20;
  const vat = fractionOf(selling, vatRate);
  const total = selling + vat;
  const overLimit = seats < 12 ? total > limits.minibusHigherAt : total > limits.coachHigherAt;
  const deposit = seats < 12 ? overLimit ? limits.minibusHigher : limits.minibus : overLimit ? limits.coachHigher : limits.coach;
  return { seats, bought, margin: String(margin), selling, vat, total, deposit };
}
function rateInForce(tables, on) {
  const sorted = [...tables].sort((a, b) => a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0);
  for (const t of sorted) if (t.effectiveFrom <= on) return t;
  return sorted[sorted.length - 1] ?? {
    id: "",
    effectiveFrom: "2000-01-01",
    defaultMarginPercent: "15",
    waitingRatePennies: 2e3,
    secondDriverPennies: 15e3,
    depositMinibus: 5e3,
    depositMinibusHigher: 1e4,
    depositCoach: 1e4,
    depositCoachHigher: 15e3
  };
}
function waitingPennies(minutes, hourlyRatePennies) {
  const free = 15;
  if (minutes <= free) return 0;
  const billable = minutes - free;
  return Math.floor((billable * hourlyRatePennies * 10 + 300) / 600);
}
function comfortCharge(minutes, hourlyRatePennies) {
  return waitingPennies(minutes, hourlyRatePennies);
}
var SIZES, SEAT_BY_SIZE, BAG_UNITS, LIFT_SIZES;
var init_rules = __esm({
  "src/server/rules.ts"() {
    "use strict";
    init_money();
    SIZES = [8, 12, 16, 31, 49, 56, 70];
    SEAT_BY_SIZE = { 8: 8, 12: 12, 16: 16, 31: 31, 49: 49, 56: 56, 70: 70 };
    BAG_UNITS = { 8: 16, 12: 24, 16: 32, 31: 62, 49: 98, 56: 112, 70: 140 };
    LIFT_SIZES = /* @__PURE__ */ new Set([16, 49]);
  }
});

// src/server/errors.ts
var HttpError, errors;
var init_errors = __esm({
  "src/server/errors.ts"() {
    "use strict";
    HttpError = class extends Error {
      constructor(status, code, message, fields, headers) {
        super(message);
        this.status = status;
        this.code = code;
        this.message = message;
        this.fields = fields;
        this.headers = headers;
      }
    };
    errors = {
      unknownRoute: () => new HttpError(404, "notFound", "We can't find that."),
      wrongMethod: (allow) => new HttpError(405, "wrongMethod", "We can't find that.", void 0, { Allow: allow }),
      tooLarge: () => new HttpError(413, "tooLarge", "That file is too big."),
      rateLimited: (retryAfterSeconds, ukTime) => new HttpError(429, "rateLimited", ukTime, void 0, {
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds)))
      }),
      foreignOrigin: () => new HttpError(403, "foreignOrigin", "We can't find that."),
      notSignedIn: () => new HttpError(401, "notSignedIn", "Your session ended. Sign in again to keep going \u2014 what you typed is still here."),
      sessionEnded: () => new HttpError(401, "sessionEnded", "Your session ended. Sign in again to keep going \u2014 what you typed is still here."),
      wrongPassword: () => new HttpError(401, "wrongPassword", "That email and password do not match."),
      notFound: () => new HttpError(404, "notFound", "We can't find that."),
      ended: () => new HttpError(410, "ended", "This page has ended."),
      unsupportedType: () => new HttpError(415, "unsupportedType", "We can't find that."),
      malformedJson: () => new HttpError(400, "malformedJson", "We can't find that."),
      invalid: (fields, message) => new HttpError(422, "invalid", message ?? "That did not save. Try again.", fields),
      state: (code, message) => new HttpError(409, code, message),
      staleEdit: (message) => new HttpError(412, "staleEdit", message),
      provider: (message) => new HttpError(503, "provider", message)
    };
  }
});

// src/server/http.ts
async function readJson(req) {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw errors.unsupportedType();
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    const b = Buffer.from(c);
    total += b.length;
    if (total > JSON_LIMIT) throw errors.tooLarge();
    chunks.push(b);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errors.malformedJson();
  }
}
async function readText(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    const b = Buffer.from(c);
    total += b.length;
    if (total > limit) throw errors.tooLarge();
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function sendError(res, err) {
  const body = { error: { code: err.code, message: err.message } };
  if (err.fields && Object.keys(err.fields).length) body.error.fields = err.fields;
  const headers = { ...err.headers ?? {} };
  if (err.status === 405) headers.Allow = err.headers?.Allow ?? "GET";
  res.status(err.status).set(headers).json(body);
}
var JSON_LIMIT;
var init_http = __esm({
  "src/server/http.ts"() {
    "use strict";
    init_errors();
    JSON_LIMIT = 1e5;
  }
});

// src/server/dates.ts
function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}
async function configureTypes() {
  const pgmod = await import("pg");
  pgmod.default.types.setTypeParser(1082, (v) => v);
}
var init_dates = __esm({
  "src/server/dates.ts"() {
    "use strict";
  }
});

// src/server/repo.ts
var repo_exports = {};
__export(repo_exports, {
  createDesk: () => createDesk,
  deskByEmail: () => deskByEmail,
  deskById: () => deskById,
  duplicatesFor: () => duplicatesFor,
  enquiryById: () => enquiryById,
  enquiryRow: () => enquiryRow,
  foldedDriverTelephone: () => foldedDriverTelephone,
  hireById: () => hireById,
  isoDate: () => isoDate,
  money: () => money,
  moneyHeld: () => moneyHeld,
  newReference: () => newReference,
  newToken: () => newToken,
  nowIso: () => nowIso,
  paymentStateFor: () => paymentStateFor,
  randomId: () => randomId,
  runsFor: () => runsFor,
  stopsForEnquiry: () => stopsForEnquiry,
  tx: () => tx,
  vehicleMoneyState: () => vehicleMoneyState,
  vehiclesFor: () => vehiclesFor,
  writeMovement: () => writeMovement
});
function money(v) {
  return v === null ? null : penniesToString(v);
}
async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw e;
  } finally {
    client.release();
  }
}
async function deskByEmail(db, email) {
  const r = await db.query(
    "SELECT id, name, email, password_hash FROM desks WHERE email_folded = $1",
    [foldEmail(email)]
  );
  const row = r.rows[0];
  return row ? { id: String(row.id), name: String(row.name), email: String(row.email), passwordHash: String(row.password_hash) } : null;
}
async function deskById(db, id) {
  const r = await db.query("SELECT id, name, email, password_hash FROM desks WHERE id = $1", [id]);
  const row = r.rows[0];
  return row ? { id: String(row.id), name: String(row.name), email: String(row.email), passwordHash: String(row.password_hash) } : null;
}
async function createDesk(db, name, email, passwordHash) {
  const id = "DK-" + randomId(8);
  await db.query("INSERT INTO desks (id, name, email, email_folded, password_hash, public) VALUES ($1,$2,$3,$4,$5,FALSE)", [
    id,
    name,
    email,
    foldEmail(email),
    passwordHash
  ]);
  await db.query(
    `INSERT INTO rate_tables (id, desk_id, effective_from, default_margin_percent, waiting_rate_pennies, second_driver_pennies, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
     VALUES ($1,$2,'2000-01-01','15',2000,15000,5000,10000,10000,15000)`,
    ["RT-" + randomId(8), id]
  );
  return { id, name, email, passwordHash };
}
function randomId(len) {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(cryptoRandom() * alphabet.length)];
  return s;
}
function newToken(prefix) {
  return prefix + randomBytesToken(24);
}
function randomBytesToken(n) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(cryptoRandom() * chars.length)];
  return s;
}
async function newReference(db, deskId) {
  for (let i = 0; i < 50; i++) {
    const ref = makeReference(cryptoRandom);
    const exists = await db.query("SELECT 1 FROM enquiries WHERE desk_id=$1 AND reference=$2", [deskId, ref]);
    if (exists.rowCount === 0) return ref;
  }
  throw errors.state("internal", "We can't find that.");
}
function enquiryRow(r) {
  const dupRaw = r.duplicated ?? "";
  return {
    id: String(r.id),
    deskId: String(r.desk_id),
    reference: String(r.reference),
    customerId: r.customer_id ?? null,
    occasion: String(r.occasion),
    state: String(r.state),
    journeyType: String(r.journey_type),
    departDate: isoDate(r.depart_date),
    departTime: String(r.depart_time),
    departInstant: r.depart_instant,
    returnDate: r.return_date ? isoDate(r.return_date) : null,
    returnTime: r.return_time ?? null,
    returnInstant: r.return_instant ?? null,
    details: r.details ?? null,
    people: Number(r.people),
    large: Number(r.large),
    medium: Number(r.medium),
    hand: Number(r.hand),
    wheelchairs: Number(r.wheelchairs),
    name: r.name ?? null,
    email: r.email ?? null,
    telephone: r.telephone ?? null,
    language: String(r.language),
    submittedBody: r.submitted_body ?? null,
    createdAt: r.created_at,
    mergedReferences: r.merged_references ?? [],
    duplicates: dupRaw ? [{ id: dupRaw, reference: dupRaw }] : []
  };
}
async function enquiryById(db, deskId, id) {
  const r = await db.query(
    `SELECT e.*, c.name AS customer_name FROM enquiries e LEFT JOIN customers c ON c.id=e.customer_id AND c.desk_id=e.desk_id
     WHERE e.desk_id=$1 AND (e.id=$2 OR e.reference=$2) ORDER BY e.created_at ASC LIMIT 1`,
    [deskId, id]
  );
  const row = r.rows[0];
  if (!row) return null;
  const dup = await duplicatesFor(db, deskId, row.id, row.email, row.telephone);
  const e = enquiryRow(row);
  e.duplicates = dup;
  return e;
}
async function duplicatesFor(db, deskId, selfId, email, telephone) {
  if (!email && !telephone) return [];
  const r = await db.query(
    `SELECT id, reference FROM enquiries WHERE desk_id=$1 AND id<>$2 AND (${email ? "email=$3 OR " : ""}${telephone ? "telephone=$4" : "FALSE"})
     ORDER BY created_at DESC`,
    [deskId, selfId, email ?? "", telephone ?? ""]
  );
  return r.rows.map((x) => ({ id: String(x.id), reference: String(x.reference) }));
}
async function stopsForEnquiry(db, enquiryId) {
  const r = await db.query("SELECT id, text, checked, flight_code FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [enquiryId]);
  return r.rows.map((x) => ({ id: String(x.id), text: String(x.text), checked: Boolean(x.checked), flightCode: x.flight_code ?? null }));
}
async function hireById(db, deskId, id) {
  const r = await db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, id]);
  return r.rows[0] ?? null;
}
async function vehiclesFor(db, deskId, hireId) {
  const r = await db.query("SELECT * FROM vehicles WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  return r.rows.map((x) => ({
    id: String(x.id),
    hireId: String(x.hire_id),
    seats: Number(x.seats),
    position: Number(x.position),
    operatorId: x.operator_id ?? null,
    bought: x.bought_pennies === null ? null : Number(x.bought_pennies),
    margin: x.margin_percent ?? null,
    selling: Number(x.selling_pennies),
    vat: Number(x.vat_pennies),
    total: Number(x.total_pennies),
    deposit: Number(x.deposit_pennies),
    depositFixed: Boolean(x.deposit_fixed),
    departDate: x.depart_date ? isoDate(x.depart_date) : null,
    departTime: x.depart_time ?? null,
    departInstant: x.depart_instant ?? null
  }));
}
async function runsFor(db, deskId, hireId) {
  const r = await db.query("SELECT * FROM runs WHERE desk_id=$1 AND hire_id=$2 ORDER BY number", [deskId, hireId]);
  return r.rows;
}
async function moneyHeld(db, deskId) {
  const r = await db.query(
    "SELECT COALESCE(SUM(amount_pennies),0) AS sum FROM ledger_lines WHERE desk_id=$1 AND account='clientMoney'",
    [deskId]
  );
  return Number(r.rows[0].sum ?? 0);
}
async function vehicleMoneyState(db, deskId, vehicleId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney'),0) AS deposit,
            COALESCE(SUM(amount_pennies) FILTER (WHERE account='refundsDue'),0) AS balance
     FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2`,
    [deskId, vehicleId]
  );
  return { depositPaid: Number(r.rows[0].deposit), balancePaid: Number(r.rows[0].balance) };
}
function paymentStateFor(vehicles) {
  let paid = 0;
  let totalDue = 0;
  let depositsDue = 0;
  for (const v of vehicles) {
    paid += v.depositPaid + v.balancePaid;
    totalDue += v.total;
    depositsDue += v.deposit;
  }
  const owed = Math.max(0, totalDue - paid);
  const credit = Math.max(0, paid - totalDue);
  let paymentState = "nothingPaid";
  const allDepositsPaid = vehicles.length > 0 && vehicles.every((v) => v.depositPaid >= v.deposit);
  const allPaid = vehicles.length > 0 && vehicles.every((v) => v.depositPaid + v.balancePaid >= v.total);
  if (allPaid) paymentState = "paidInFull";
  else if (allDepositsPaid && owed > 0) paymentState = "depositPaid";
  else if (vehicles.some((v) => v.depositPaid > 0)) paymentState = paid >= depositsDue ? "depositPaid" : "depositPartPaid";
  if (allPaid) paymentState = "paidInFull";
  return { paid, owed, credit, paymentState };
}
async function writeMovement(tx2, deskId, hireId, movementId, vehicleId, amount, description) {
  await tx2.query(
    `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, vehicle_id, account, amount_pennies, at, description) VALUES
     ($1,$2,$3,$4,$5,'clientMoney',$6,NOW(),$7),
     ($8,$2,$3,$4,$5,'hireIncome',$9,NOW(),$7)`,
    [movementId + "-A", deskId, hireId, movementId, vehicleId, String(amount), description, movementId + "-B", String(-amount)]
  );
}
function nowIso() {
  return isoInstant(/* @__PURE__ */ new Date());
}
function foldedDriverTelephone(tel) {
  return foldTelephone(tel);
}
var init_repo = __esm({
  "src/server/repo.ts"() {
    "use strict";
    init_errors();
    init_domain();
    init_auth();
    init_money();
    init_dates();
  }
});

// src/server/api/auth.ts
function parseCookie(raw, secret) {
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const v = part.slice(eq + 1).trim();
    const dot = v.lastIndexOf(".");
    if (dot === -1) continue;
    const body = v.slice(0, dot);
    const sig = v.slice(dot + 1);
    const expect = (0, import_node_crypto2.createHmac)("sha256", secret).update(body).digest("base64url");
    if (expect.length !== sig.length) continue;
    try {
      if (!(0, import_node_crypto2.timingSafeEqual)(Buffer.from(expect), Buffer.from(sig))) continue;
    } catch {
      continue;
    }
    try {
      const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (typeof j.deskId === "string" && Number.isInteger(j.generation) && typeof j.exp === "number") return j;
    } catch {
      continue;
    }
  }
  return null;
}
function signCookie(secret, deskId, generation, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ deskId, generation, exp: Date.now() + ttlSeconds * 1e3 }), "utf8").toString("base64url");
  const sig = (0, import_node_crypto2.createHmac)("sha256", secret).update(body).digest("base64url");
  return `${SESSION_COOKIE}=${body}.${sig}; Path=/; HttpOnly; SameSite=Lax`;
}
function sessionMiddleware(ctx) {
  return (req, _res, next) => {
    const claim = parseCookie(req.headers.cookie, ctx.cfg.sessionSecret);
    if (!claim) {
      next();
      return;
    }
    deskById(ctx.db, claim.deskId).then(async (desk) => {
      if (!desk || claim.exp <= Date.now()) {
        req.authEnded = true;
        next();
        return;
      }
      const gen = await ctx.db.query("SELECT generation FROM desks_generation WHERE desk_id=$1", [claim.deskId]);
      const generation = gen.rows[0]?.generation ?? 0;
      if (claim.generation !== generation) {
        req.authEnded = true;
        next();
        return;
      }
      const session = await ctx.db.query("SELECT expires_at FROM sessions WHERE desk_id=$1 AND expires_at > NOW() LIMIT 1", [claim.deskId]);
      if (!session.rows[0]) {
        req.authEnded = true;
        next();
        return;
      }
      req.deskId = desk.id;
      next();
    }).catch(next);
  };
}
function requireAuth(req) {
  const r = req;
  if (r.authEnded) throw errors.sessionEnded();
  if (!r.deskId) throw errors.notSignedIn();
  return r.deskId;
}
function pageAuthError(req) {
  const r = req;
  if (r.deskId) return "none";
  if (r.authEnded) return "ended";
  return "missing";
}
function registerAuthApi(app, ctx) {
  app.post("/api/auth/sign-up", async (req, res) => {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fieldErrors2 = {};
    if (!name) fieldErrors2.name = "Enter your name.";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors2.email = "Enter a real email address.";
    if (password.length < 8) fieldErrors2.password = "Enter at least 8 characters.";
    if (Object.keys(fieldErrors2).length === 0 && email) {
      const existing = await deskByEmail(ctx.db, email);
      if (existing) throw errors.state("emailTaken", "That email is taken.");
    }
    if (Object.keys(fieldErrors2).length) throw errors.invalid(fieldErrors2);
    const hash = hashPassword(password);
    const desk = await createDesk(ctx.db, name, email, hash);
    await ctx.db.query("INSERT INTO desks_generation (desk_id, generation) VALUES ($1,0) ON CONFLICT (desk_id) DO NOTHING", [desk.id]);
    await ctx.db.query("INSERT INTO sessions (token, desk_id, created_at, expires_at) VALUES ($1,$2,NOW(),NOW() + ($3 || ' seconds')::interval)", [
      newSessionToken(),
      desk.id,
      String(ctx.cfg.sessionSeconds)
    ]);
    res.setHeader("Set-Cookie", signCookie(ctx.cfg.sessionSecret, desk.id, 0, ctx.cfg.sessionSeconds));
    res.status(201).json({ desk: { id: desk.id, name: desk.name, email: desk.email } });
  });
  app.post("/api/auth/sign-in", async (req, res) => {
    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const desk = email ? await deskByEmail(ctx.db, email) : null;
    if (!desk || !desk.passwordHash || !verifyPassword(password, desk.passwordHash)) throw errors.wrongPassword();
    await ctx.db.query("INSERT INTO desks_generation (desk_id, generation) VALUES ($1,0) ON CONFLICT (desk_id) DO NOTHING", [desk.id]);
    const gen = await ctx.db.query("SELECT generation FROM desks_generation WHERE desk_id=$1", [desk.id]);
    const generation = gen.rows[0]?.generation ?? 0;
    await ctx.db.query("INSERT INTO sessions (token, desk_id, created_at, expires_at) VALUES ($1,$2,NOW(),NOW() + ($3 || ' seconds')::interval)", [
      newSessionToken(),
      desk.id,
      String(ctx.cfg.sessionSeconds)
    ]);
    res.setHeader("Set-Cookie", signCookie(ctx.cfg.sessionSecret, desk.id, generation, ctx.cfg.sessionSeconds));
    res.json({ desk: { id: desk.id, name: desk.name, email: desk.email } });
  });
  app.post("/api/auth/sign-out", async (req, res) => {
    const claim = parseCookie(req.headers.cookie, ctx.cfg.sessionSecret);
    if (claim) {
      await ctx.db.query("DELETE FROM sessions WHERE desk_id=$1", [claim.deskId]);
    }
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
  });
  app.get("/api/auth/session", async (req, res) => {
    const deskId = requireAuth(req);
    const desk = await deskById(ctx.db, deskId);
    if (!desk) throw errors.sessionEnded();
    res.json({ desk: { id: desk.id, name: desk.name, email: desk.email } });
  });
  app.post("/api/auth/password", async (req, res) => {
    const deskId = requireAuth(req);
    const desk = await deskById(ctx.db, deskId);
    if (!desk || !desk.passwordHash) throw errors.sessionEnded();
    const body = await readJson(req);
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!verifyPassword(current, desk.passwordHash)) throw errors.wrongPassword();
    if (next.length < 8) throw errors.invalid({ newPassword: "Enter at least 8 characters." });
    const hash = hashPassword(next);
    await ctx.db.query("UPDATE desks SET password_hash=$1 WHERE id=$2", [hash, deskId]);
    await ctx.db.query(
      "INSERT INTO desks_generation (desk_id, generation) VALUES ($1,1) ON CONFLICT (desk_id) DO UPDATE SET generation=desks_generation.generation+1",
      [deskId]
    );
    const gen = await ctx.db.query("SELECT generation FROM desks_generation WHERE desk_id=$1", [deskId]);
    const generation = gen.rows[0]?.generation ?? 0;
    res.setHeader("Set-Cookie", signCookie(ctx.cfg.sessionSecret, deskId, generation, ctx.cfg.sessionSeconds));
    res.status(204).end();
  });
}
var import_node_crypto2;
var init_auth2 = __esm({
  "src/server/api/auth.ts"() {
    "use strict";
    import_node_crypto2 = require("crypto");
    init_errors();
    init_http();
    init_auth();
    init_repo();
  }
});

// src/server/services.ts
function transport(cfg2) {
  if (!transporter) {
    transporter = import_nodemailer.default.createTransport({
      host: cfg2.smtpHost,
      port: cfg2.smtpPort,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 5e3,
      greetingTimeout: 5e3,
      socketTimeout: 5e3
    });
  }
  return transporter;
}
async function sendMail(cfg2, m) {
  try {
    await transport(cfg2).sendMail({
      from: cfg2.mailFrom,
      to: m.to,
      subject: m.subject,
      text: m.text
    });
  } catch {
    throw errors.provider("The mail service is unavailable right now. Nothing was sent.");
  }
}
async function wireGet(cfg2, path) {
  try {
    const res = await (0, import_undici.request)(cfg2.wiremockUrl + path, { bodyTimeout: TIMEOUT, headersTimeout: TIMEOUT });
    const text = await res.body.text();
    if (res.statusCode !== 200) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function wirePost(cfg2, path, body) {
  try {
    const res = await (0, import_undici.request)(cfg2.wiremockUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      bodyTimeout: TIMEOUT,
      headersTimeout: TIMEOUT
    });
    const text = await res.body.text();
    if (res.statusCode !== 200) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function getFlight(cfg2, code, date) {
  return wireGet(cfg2, `/v1/flights/${encodeURIComponent(code)}?date=${date}`);
}
async function fetchDirectory(cfg2) {
  const out = [];
  let cursor = null;
  let guard = 0;
  for (; ; ) {
    const path = `/v2/operators${cursor ? `?cursor=${cursor}` : ""}`;
    const page = await wireGet(cfg2, path);
    if (!page) return null;
    out.push(...page.operators);
    cursor = page.nextCursor ?? null;
    guard++;
    if (guard > 10 || !cursor) return out;
  }
}
async function renderPdf(cfg2, html) {
  try {
    const boundary = "----wayticketform" + (0, import_node_crypto3.randomBytes)(8).toString("hex");
    const head = Buffer.from(
      `--${boundary}\r
Content-Disposition: form-data; name="index.html"; filename="index.html"\r
Content-Type: text/html\r
\r
`
    );
    const tail = Buffer.from(`\r
--${boundary}--\r
`);
    const body = Buffer.concat([head, Buffer.from(html, "utf8"), tail]);
    const res = await (0, import_undici.request)(`${cfg2.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      bodyTimeout: 3e4,
      headersTimeout: 3e4
    });
    if (res.statusCode !== 200) throw new Error("render");
    const chunks = [];
    for await (const c of res.body) chunks.push(Buffer.from(c));
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) throw new Error("empty");
    return buf;
  } catch {
    throw errors.provider("The PDF service is unavailable right now. Nothing was saved.");
  }
}
async function notifyDriver(cfg2, telephoneDigits, title, message) {
  try {
    const res = await (0, import_undici.request)(`${cfg2.ntfyUrl}/driver-${telephoneDigits}`, {
      method: "POST",
      body: message,
      headers: {
        Title: title,
        ...cfg2.ntfyUsername ? { Authorization: "Basic " + Buffer.from(cfg2.ntfyUsername + ":" + cfg2.ntfyPassword).toString("base64") } : {}
      },
      bodyTimeout: TIMEOUT,
      headersTimeout: TIMEOUT
    });
    await res.body.text();
    return res.statusCode >= 200 && res.statusCode < 300;
  } catch {
    return false;
  }
}
var import_nodemailer, import_undici, import_node_crypto3, TIMEOUT, transporter;
var init_services = __esm({
  "src/server/services.ts"() {
    "use strict";
    import_nodemailer = __toESM(require("nodemailer"), 1);
    import_undici = require("undici");
    import_node_crypto3 = require("crypto");
    init_errors();
    TIMEOUT = 5e3;
    transporter = null;
  }
});

// src/server/validation.ts
function parseLocalDate(v, field) {
  if (!v || typeof v !== "object") throw errors.invalid({ [field]: "Enter a date as DD/MM/YYYY." });
  const o = v;
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw errors.invalid({ [field]: "Enter a date as DD/MM/YYYY." });
  if (typeof o.time !== "string" || !/^\d{2}:\d{2}$/.test(o.time)) throw errors.invalid({ [field]: "Choose an hour and minutes." });
  let repeatedHour;
  if (o.repeatedHour !== void 0 && o.repeatedHour !== null) {
    if (o.repeatedHour !== "first" && o.repeatedHour !== "second") throw errors.invalid({ [field]: "Choose which time you mean." });
    repeatedHour = o.repeatedHour;
  }
  const r = ukToInstant(o.date, o.time, repeatedHour === "second");
  if (!r.exists) throw errors.invalid({ [field]: `${o.time.slice(0, 5)} does not exist on ${o.date}, when the clocks go forward. Choose another time.` }, `${o.time.slice(0, 5)} does not exist on ${o.date}, when the clocks go forward. Choose another time.`);
  if (r.repeated && !repeatedHour) throw errors.invalid({ [field]: `Choose which ${o.time} you mean.` });
  return { date: o.date, time: o.time, instant: r.instant, repeatedHour };
}
function parseParty(v) {
  const o = v ?? {};
  const num2 = (x) => {
    if (x === void 0 || x === null || x === "") return null;
    const n = Number(x);
    return Number.isInteger(n) ? n : null;
  };
  const people = num2(o.people);
  if (people === null || people < 1 || people > 400) throw errors.invalid({ people: "Enter between 1 and 400 people." });
  const large = num2(o.large) ?? 0;
  const medium = num2(o.medium) ?? 0;
  const hand = num2(o.hand) ?? 0;
  const wheelchairs = num2(o.wheelchairs) ?? 0;
  if (large < 0 || large > 40) throw errors.invalid({ large: "Enter between 0 and 40 bags." });
  if (medium < 0 || medium > 40) throw errors.invalid({ medium: "Enter between 0 and 40 bags." });
  if (hand < 0 || hand > 40) throw errors.invalid({ hand: "Enter between 0 and 40 bags." });
  if (wheelchairs < 0 || wheelchairs > 10) throw errors.invalid({ wheelchairs: "Enter between 0 and 10 wheelchair users." });
  return { people, large, medium, hand, wheelchairs };
}
function validOccasion(v) {
  return v === "school" || v === "weddings" || v === "company" || v === "festivals";
}
function validJourneyType(v) {
  return v === "oneWay" || v === "return" || v === "sameDayReturn" || v === "severalStops";
}
function validEmail(v) {
  return typeof v === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 254;
}
function validTelephone(v) {
  if (typeof v !== "string" || v.length > 30) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}
function serverNowMinute() {
  const d = /* @__PURE__ */ new Date();
  return new Date(Math.floor(d.getTime() / 6e4) * 6e4);
}
var init_validation = __esm({
  "src/server/validation.ts"() {
    "use strict";
    init_errors();
    init_domain();
    init_uktime();
  }
});

// src/server/api/trip-helpers.ts
function partyFromEnquiry(e) {
  return { people: e.people, large: e.large, medium: e.medium, hand: e.hand, wheelchairs: e.wheelchairs };
}
function legRow(r) {
  return { km: String(r.km), minutes: Number(r.minutes), miles: String(r.miles) };
}
async function ensureLegs(ctx, deskId, e) {
  const existing = await ctx.db.query("SELECT 1 FROM legs WHERE enquiry_id=$1 LIMIT 1", [e.id]);
  if (existing.rows.length) return;
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [e.id]);
  if (stops.rows.length < 2) return;
  const plan = await ctx.db.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
  const sizes = plan.rows[0]?.sizes ?? [49];
  const answer = await wirePost(ctx.cfg, "/v1/route", {
    vehicleClass: vehicleClassFor(sizes),
    stops: stops.rows.map((x) => ({ text: String(x.text) }))
  });
  if (!answer) return;
  await ctx.db.query("DELETE FROM legs WHERE enquiry_id=$1", [e.id]);
  for (let i = 0; i < answer.legs.length; i++) {
    const km = answer.legs[i].km;
    const miles = (Number(km) * 0.621371 * 10 + 0.5) / 10;
    await ctx.db.query("INSERT INTO legs (enquiry_id, desk_id, position, km, miles, minutes) VALUES ($1,$2,$3,$4,$5,$6)", [
      e.id,
      deskId,
      i,
      km,
      miles.toFixed(1),
      answer.legs[i].minutes
    ]);
  }
}
var init_trip_helpers = __esm({
  "src/server/api/trip-helpers.ts"() {
    "use strict";
    init_services();
    init_rules();
  }
});

// src/server/s3.ts
function sha256Hex(data) {
  return (0, import_node_crypto4.createHash)("sha256").update(data).digest("hex");
}
function hmac(key, data) {
  return (0, import_node_crypto4.createHmac)("sha256", key).update(data).digest();
}
async function s3Call(cfg2, method, key, body, contentType) {
  const u = new URL(cfg2.s3Endpoint);
  const hostHeader = u.host;
  const bucketHost = cfg2.s3PathStyle ? hostHeader : `${cfg2.s3Bucket}.${hostHeader}`;
  const pathPrefix = cfg2.s3PathStyle ? `/${cfg2.s3Bucket}` : "";
  const canonicalUri = `${pathPrefix}/${key}`.replace(/\/{2,}/g, "/");
  const target = `http://${bucketHost}${canonicalUri}`;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const now = /* @__PURE__ */ new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    host: bucketHost,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeadersList = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}
`).join("");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeadersList, payloadHash].join("\n");
  const scope = `${dateStamp}/${cfg2.s3Region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + cfg2.s3SecretAccessKey, dateStamp);
  const kRegion = hmac(kDate, cfg2.s3Region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = (0, import_node_crypto4.createHmac)("sha256", kSigning).update(stringToSign).digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${cfg2.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
  try {
    const res = await (0, import_undici2.request)(target, {
      method,
      headers: { ...headers, Authorization: auth },
      body: payload.length ? payload : void 0,
      bodyTimeout: TIMEOUT_MS,
      headersTimeout: TIMEOUT_MS
    });
    const chunks = [];
    for await (const c of res.body) chunks.push(Buffer.from(c));
    return { statusCode: res.statusCode, body: Buffer.concat(chunks) };
  } catch {
    throw errors.provider("The file store is unavailable right now. Nothing was saved.");
  }
}
async function s3Put(cfg2, key, body, contentType) {
  const r = await s3Call(cfg2, "PUT", key, body, contentType);
  if (r.statusCode !== 200) throw errors.provider("The file store is unavailable right now. Nothing was saved.");
}
async function s3Get(cfg2, key) {
  const r = await s3Call(cfg2, "GET", key);
  if (r.statusCode === 200) return r.body;
  if (r.statusCode === 404) return null;
  throw errors.provider("The file store is unavailable right now. Nothing was saved.");
}
async function s3Delete(cfg2, key) {
  const r = await s3Call(cfg2, "DELETE", key);
  if (r.statusCode !== 204 && r.statusCode !== 404) {
    throw errors.provider("The file store is unavailable right now. Nothing was saved.");
  }
}
function objectKeyForPaper(deskId, operatorId, kind, paperId) {
  return `desks/${deskId}/operators/${operatorId}/${kind}/${paperId}`;
}
function objectKeyForPassengers(deskId, hireId, listId) {
  listId = listId.endsWith(".csv") ? listId : listId + ".csv";
  return `desks/${deskId}/passengers/${hireId}/${listId}`;
}
function objectKeyForDocument(deskId, documentId) {
  return `desks/${deskId}/documents/${documentId}.pdf`;
}
var import_node_crypto4, import_undici2, TIMEOUT_MS;
var init_s3 = __esm({
  "src/server/s3.ts"() {
    "use strict";
    import_node_crypto4 = require("crypto");
    import_undici2 = require("undici");
    init_errors();
    TIMEOUT_MS = 5e3;
  }
});

// src/server/api/operators.ts
function paperLabel(kind) {
  return PAPER_LABEL[kind] ?? kind;
}
async function operatorClearForLastDay(db, deskId, operatorId, occasion, lastDay) {
  const op = await db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, operatorId]);
  if (!op.rows[0]) return { clear: false, reason: "We can't find that." };
  if (!op.rows[0].listed) return { clear: false, reason: "No longer listed" };
  const papers = await db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [deskId, operatorId]);
  const licence = papers.rows.find((p) => p.kind === "operatorLicence");
  const cover = papers.rows.find((p) => p.kind === "publicLiabilityCover");
  if (!licence) return { clear: false, reason: "Operator licence is missing." };
  if (String(licence.ends_on).slice(0, 10) < lastDay) {
    return { clear: false, reason: `Operator licence ends ${longDate(String(licence.ends_on).slice(0, 10))}, before this hire's last day.` };
  }
  if (!cover) return { clear: false, reason: "Public liability cover is missing." };
  if (String(cover.ends_on).slice(0, 10) < lastDay) {
    return { clear: false, reason: `Public liability cover ends ${longDate(String(cover.ends_on).slice(0, 10))}, before this hire's last day.` };
  }
  if (occasion === "school") {
    const dbs = op.rows[0].dbs_checked_on ? String(op.rows[0].dbs_checked_on).slice(0, 10) : null;
    if (!dbs) return { clear: false, reason: "Driver DBS check is missing." };
    const cutoff = addDays(lastDay, -365 * 3 - (needsLeapAdjust(lastDay) ? 1 : 0));
    if (dbs <= cutoff) return { clear: false, reason: "Driver DBS check is older than three years on this hire's last day." };
  }
  return { clear: true, reason: null };
}
function needsLeapAdjust(_lastDay) {
  return false;
}
function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]} ${y}`;
}
function registerOperatorApi(app, ctx) {
  app.get("/api/operators", async (req, res) => {
    const deskId = requireAuth(req);
    const r = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 ORDER BY id", [deskId]);
    res.json({ operators: await Promise.all(r.rows.map((x) => operatorOut(ctx, x))) });
  });
  app.post("/api/operators/refresh", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const dir = await fetchDirectory(ctx.cfg);
    if (!dir) {
      throw errors.state("directory", "The directory could not be read. Your list has not changed.");
    }
    await tx(ctx.db, async (client) => {
      const current = await client.query("SELECT id FROM operators WHERE desk_id=$1", [deskId]);
      const ids = new Set(current.rows.map((x) => String(x.id)));
      for (const op of dir) {
        if (ids.has(op.id)) {
          await client.query(
            "UPDATE operators SET name=$2, town=$3, email=$4, telephone=$5, sizes=$6, listed=TRUE WHERE desk_id=$1 AND id=$7",
            [deskId, op.name, op.town, op.email, op.telephone, op.sizes, op.id]
          );
          ids.delete(op.id);
        } else {
          await client.query(
            "INSERT INTO operators (desk_id, id, name, town, email, telephone, sizes, listed) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)",
            [deskId, op.id, op.name, op.town, op.email, op.telephone, op.sizes]
          );
        }
      }
      for (const missing of ids) {
        await client.query("UPDATE operators SET listed=FALSE WHERE desk_id=$1 AND id=$2", [deskId, missing]);
      }
    });
    const r = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 ORDER BY id", [deskId]);
    res.json({ operators: await Promise.all(r.rows.map((x) => operatorOut(ctx, x))) });
  });
  app.post("/api/operators/:id/papers", async (req, res) => {
    const deskId = requireAuth(req);
    const opId = req.params.id;
    const op = await ctx.db.query("SELECT id FROM operators WHERE desk_id=$1 AND id=$2", [deskId, opId]);
    if (!op.rows[0]) throw errors.notFound();
    const { fields, fileBuffer } = await readMultipart(req);
    const kind = fields.get("kind") ?? "";
    if (kind !== "operatorLicence" && kind !== "publicLiabilityCover") {
      throw errors.invalid({ kind: "This file is not a PDF, JPEG or PNG." });
    }
    const endsOn = fields.get("endsOn") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw errors.invalid({ endsOn: "Enter a date as DD/MM/YYYY." });
    if (!fileBuffer || fileBuffer.length === 0) throw errors.invalid({ file: "This file is not a PDF, JPEG or PNG." });
    const type = sniffType(fileBuffer);
    if (!type) throw errors.invalid({ file: "This file is not a PDF, JPEG or PNG." });
    const existing = await ctx.db.query("SELECT paper_id FROM papers WHERE desk_id=$1 AND operator_id=$2 AND kind=$3", [deskId, opId, kind]);
    const paperId = existing.rows[0]?.paper_id ?? "PP-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    const key = objectKeyForPaper(deskId, opId, kind, paperId);
    await s3Put(ctx.cfg, key, fileBuffer, type);
    await ctx.db.query(
      `INSERT INTO papers (desk_id, operator_id, kind, ends_on, stored, object_key, stored_type, paper_id) VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7)
       ON CONFLICT (desk_id, operator_id, kind) DO UPDATE SET ends_on=$4, stored=TRUE, object_key=$5, stored_type=$6`,
      [deskId, opId, kind, endsOn, key, type, paperId]
    );
    const after = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2 AND kind=$3", [deskId, opId, kind]);
    res.status(201).json(paperOut(after.rows[0]));
  });
  app.get("/api/operators/:id/papers/:kind/file", async (req, res) => {
    const deskId = requireAuth(req);
    const kind = req.params.kind;
    if (kind !== "operatorLicence" && kind !== "publicLiabilityCover") throw errors.notFound();
    const r = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2 AND kind=$3", [deskId, req.params.id, kind]);
    if (!r.rows[0] || !r.rows[0].object_key) throw errors.notFound();
    const bytes = await s3Get(ctx.cfg, String(r.rows[0].object_key));
    if (!bytes) throw errors.provider("The file store is unavailable right now. Nothing was saved.");
    res.setHeader("Content-Type", String(r.rows[0].stored_type ?? "application/octet-stream"));
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  });
  app.put("/api/operators/:id/dbs", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const checkedOn = typeof body.checkedOn === "string" ? body.checkedOn : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) throw errors.invalid({ checkedOn: "Enter a date as DD/MM/YYYY." });
    const r = await ctx.db.query("UPDATE operators SET dbs_checked_on=$3 WHERE desk_id=$1 AND id=$2 RETURNING *", [deskId, req.params.id, checkedOn]);
    if (!r.rows[0]) throw errors.notFound();
    res.json(await operatorOut(ctx, r.rows[0]));
  });
  app.get("/api/hires/:id/operators", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const occasion = String(hire.rows[0].occasion);
    const lastDay = await lastDayOfHire(ctx, deskId, hire.rows[0]);
    const asked = await ctx.db.query("SELECT operator_id FROM bids WHERE desk_id=$1 AND enquiry_id=$2", [deskId, hire.rows[0].reference]);
    const rows = [];
    for (const opId of asked.rows.map((x) => String(x.operator_id))) {
      const op = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, opId]);
      if (!op.rows[0]) continue;
      const c = await operatorClearForLastDay(ctx.db, deskId, opId, occasion, lastDay);
      rows.push({ id: opId, name: String(op.rows[0].name), clear: c.clear, reason: c.reason });
    }
    res.json({ operators: rows });
  });
}
async function lastDayOfHire(_ctx, _deskId, hire) {
  const ret = hire.return_instant;
  const dep = hire.depart_instant;
  const instant = ret ?? dep;
  return isoDate(new Date(instant));
}
async function operatorOut(ctx, row) {
  const papers = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [row.desk_id, row.id]);
  return {
    id: String(row.id),
    name: String(row.name),
    town: row.town ? String(row.town) : null,
    email: row.email ? String(row.email) : null,
    telephone: row.telephone ? String(row.telephone) : null,
    sizes: row.sizes ?? [],
    listed: Boolean(row.listed),
    papers: papers.rows.map(paperOut),
    dbsCheckedOn: row.dbs_checked_on ? isoDate(row.dbs_checked_on) : null
  };
}
function paperOut(p) {
  return {
    kind: String(p.kind),
    endsOn: isoDate(p.ends_on),
    stored: Boolean(p.stored),
    objectKey: p.object_key ? String(p.object_key) : null
  };
}
function sniffType(buf) {
  if (buf.length < 4) return null;
  if (buf[0] === 37 && buf[1] === 80 && buf[2] === 68 && buf[3] === 70) return "application/pdf";
  if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return "image/jpeg";
  if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) return "image/png";
  return null;
}
async function readMultipart(req) {
  const type = req.headers["content-type"] ?? "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
  if (!m) throw errors.unsupportedType();
  const boundary = "--" + (m[1] ?? m[2]);
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    const b = import_node_buffer.Buffer.from(c);
    total += b.length;
    if (total > 51e5) throw errors.tooLarge();
    chunks.push(b);
  }
  const body = import_node_buffer.Buffer.concat(chunks);
  const fields = /* @__PURE__ */ new Map();
  let fileBuffer = null;
  let fileName = null;
  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    const next = body.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    const part = body.slice(idx + boundary.length + 2, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      idx = next;
      continue;
    }
    const head = part.slice(0, headerEnd).toString("utf8");
    const content = part.slice(headerEnd + 4);
    const nameM = /name="([^"]*)"/.exec(head);
    const fileM = /filename="([^"]*)"/.exec(head);
    if (fileM) {
      fileName = fileM[1];
      fileBuffer = import_node_buffer.Buffer.from(content);
      if (fileBuffer.length > 5e6) throw errors.tooLarge();
    } else if (nameM) {
      fields.set(nameM[1], content.toString("utf8"));
    }
    idx = next;
  }
  return { fields, fileBuffer, fileName };
}
var import_node_buffer, PAPER_LABEL, MONTHS, DAYS;
var init_operators = __esm({
  "src/server/api/operators.ts"() {
    "use strict";
    import_node_buffer = require("buffer");
    init_auth2();
    init_errors();
    init_http();
    init_services();
    init_s3();
    init_uktime();
    init_repo();
    PAPER_LABEL = {
      operatorLicence: "Operator licence",
      publicLiabilityCover: "Public liability cover"
    };
    MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  }
});

// src/server/api/rate-helpers.ts
async function rateTableFor(ctx, deskId, on) {
  const r = await ctx.db.query(
    "SELECT * FROM rate_tables WHERE desk_id=$1 AND effective_from <= (NOW() AT TIME ZONE 'Europe/London')::date ORDER BY effective_from DESC LIMIT 1",
    [deskId]
  );
  const row = r.rows[0];
  if (!row) {
    return {
      id: "",
      effectiveFrom: "2000-01-01",
      defaultMarginPercent: "15",
      waitingRatePennies: 2e3,
      secondDriverPennies: 15e3,
      deposits: { minibus: 5e3, minibusHigher: 1e4, coach: 1e4, coachHigher: 15e3, minibusHigherAt: 75e3, coachHigherAt: 1e5 }
    };
  }
  return rowToRate(row);
}
async function rateTableForDate(ctx, deskId, date) {
  const r = await ctx.db.query("SELECT * FROM rate_tables WHERE desk_id=$1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1", [deskId, date]);
  const row = r.rows[0];
  if (!row) {
    return {
      id: "",
      effectiveFrom: "2000-01-01",
      defaultMarginPercent: "15",
      waitingRatePennies: 2e3,
      secondDriverPennies: 15e3,
      deposits: { minibus: 5e3, minibusHigher: 1e4, coach: 1e4, coachHigher: 15e3, minibusHigherAt: 75e3, coachHigherAt: 1e5 }
    };
  }
  return rowToRate(row);
}
function rowToRate(row) {
  return {
    id: String(row.id),
    effectiveFrom: isoDate(row.effective_from),
    defaultMarginPercent: String(row.default_margin_percent),
    waitingRatePennies: Number(row.waiting_rate_pennies),
    secondDriverPennies: Number(row.second_driver_pennies),
    deposits: {
      minibus: Number(row.deposit_minibus),
      minibusHigher: Number(row.deposit_minibus_higher),
      coach: Number(row.deposit_coach),
      coachHigher: Number(row.deposit_coach_higher),
      minibusHigherAt: 75e3,
      coachHigherAt: 1e5
    }
  };
}
function quoteEndFor2(sentAt, quoteValidSeconds) {
  if (quoteValidSeconds !== null) {
    return new Date(Math.floor(sentAt.getTime() / 1e3) * 1e3 + quoteValidSeconds * 1e3 - 1e3);
  }
  const sentDay = ukDayString(sentAt);
  const endDay = addDays(sentDay, 5);
  const r = ukToInstant(endDay, "23:59");
  return new Date(r.instant.getTime() + 59999);
}
function ukDayString(d) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [dd, mm, yyyy] = f.split("/");
  return `${yyyy}-${mm}-${dd}`;
}
var init_rate_helpers = __esm({
  "src/server/api/rate-helpers.ts"() {
    "use strict";
    init_repo();
    init_uktime();
  }
});

// src/server/api/bids.ts
function parseBidPrice(text) {
  const t = String(text ?? "").trim();
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(t) && !/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return parseMoneyToPennies(t);
}
function registerBidApi(app, ctx) {
  app.post("/api/enquiries/:id/bids/ask", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const plan = await ctx.db.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    if (!plan.rows[0] || !plan.rows[0].sizes?.length) throw errors.state("noPlan", "Save a plan before asking operators.");
    const award = await ctx.db.query("SELECT 1 FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    if (award.rows[0]) throw errors.state("alreadyAwarded", "Already awarded.");
    const body = await readJson(req);
    const operatorIds = Array.isArray(body.operatorIds) ? body.operatorIds.map(String) : [];
    if (operatorIds.length === 0) throw errors.invalid({ operatorIds: "We can't find that." });
    const sizes = plan.rows[0].sizes;
    const asks = [];
    const now = /* @__PURE__ */ new Date();
    const closesAt = new Date(Math.floor(now.getTime() / 1e3) * 1e3 + ctx.cfg.bidWindowSeconds * 1e3);
    for (const opId of operatorIds) {
      const op = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, opId]);
      if (!op.rows[0]) throw errors.notFound();
      const existing = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [deskId, e.id, opId]);
      if (existing.rows[0]) {
        asks.push({
          operatorId: opId,
          bidPath: String(existing.rows[0].ask_path),
          sentAt: isoInstant(existing.rows[0].asked_at),
          closesAt: isoInstant(existing.rows[0].closes_at)
        });
        continue;
      }
      const token = "b" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      await ctx.db.query(
        `INSERT INTO bids (desk_id, enquiry_id, operator_id, ask_path, asked_at, closes_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [deskId, e.id, opId, token, now, closesAt]
      );
      await ctx.db.query("INSERT INTO bid_tokens (token, desk_id, enquiry_id, operator_id, created_at) VALUES ($1,$2,$3,$4,$5)", [
        token,
        deskId,
        e.id,
        opId,
        now
      ]);
      const sent = await sendAskMail(ctx, e, sizes, op.rows[0], token, closesAt);
      if (!sent) throw errors.provider("We couldn't reach the mail service.");
      asks.push({ operatorId: opId, bidPath: token, sentAt: isoInstant(now), closesAt: isoInstant(closesAt) });
    }
    res.status(201).json({ asks });
  });
  app.get("/api/enquiries/:id/bids", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const sort = req.query.sort === "priceHighest" ? "priceHighest" : "priceLowest";
    const now = /* @__PURE__ */ new Date();
    const bids = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    const awardedAt = award.rows[0] ? award.rows[0].awarded_at : null;
    const plan = await ctx.db.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    const vehicleCount = plan.rows[0]?.sizes?.length ?? 0;
    const rows = [];
    for (const b of bids.rows) {
      const op = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, b.operator_id]);
      const closes = b.closes_at;
      const live = hasLivePrice(b, closes, now, awardedAt);
      const status = bidStatus(b, closes, now, awardedAt);
      const clear = await operatorClearForLastDay(ctx.db, deskId, String(b.operator_id), e.occasion, await hireLastDay(ctx, deskId, e));
      rows.push({
        operatorId: String(b.operator_id),
        operatorName: op.rows[0] ? String(op.rows[0].name) : String(b.operator_id),
        status,
        clear: clear.clear,
        reason: clear.reason,
        prices: live ? b.prices ?? [] : [],
        total: live ? (b.prices ?? []).reduce((s, p) => s + Number(p) * 100, 0) / 100 : null,
        receivedAt: b.received_at ? isoInstant(b.received_at) : null,
        closesAt: isoInstant(closes)
      });
    }
    rows.sort((a, b) => {
      const aLive = a.prices.length > 0;
      const bLive = b.prices.length > 0;
      if (aLive !== bLive) return aLive ? -1 : 1;
      if (aLive) {
        const at = a.total ?? 0;
        const bt = b.total ?? 0;
        if (at !== bt) return sort === "priceLowest" ? at - bt : bt - at;
        const ar = a.receivedAt ?? "";
        const br = b.receivedAt ?? "";
        if (ar !== br) return ar < br ? -1 : 1;
      }
      return String(a.operatorId).localeCompare(String(b.operatorId));
    });
    res.json({ bids: rows, awarded: award.rows[0] ? { operatorId: String(award.rows[0].operator_id), at: isoInstant(awardedAt) } : null, vehicles: vehicleCount });
  });
  app.post("/api/enquiries/:id/award", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = await readJson(req);
    const opId = typeof body.operatorId === "string" ? body.operatorId : "";
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    if (award.rows[0]) {
      const op = await ctx.db.query("SELECT name FROM operators WHERE desk_id=$1 AND id=$2", [deskId, award.rows[0].operator_id]);
      throw errors.state("alreadyAwarded", `Already awarded to ${op.rows[0]?.name ?? opId} at ${ukTimeHM(award.rows[0].awarded_at)}.`);
    }
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [deskId, e.id, opId]);
    if (!bid.rows[0]) throw errors.state("noBid", `${opId} has no price on this hire.`);
    const b = bid.rows[0];
    const now = /* @__PURE__ */ new Date();
    const closes = b.closes_at;
    const live = hasLivePrice(b, closes, now, null);
    if (!live) throw errors.state("noBid", `${opId} has no price on this hire.`);
    const clear = await operatorClearForLastDay(ctx.db, deskId, opId, e.occasion, await hireLastDay(ctx, deskId, e));
    if (!clear.clear) throw errors.state("operatorNotClear", clear.reason ?? "We can't find that.");
    const prices = b.prices ?? [];
    const rate = await rateTableFor(ctx, deskId, /* @__PURE__ */ new Date());
    await createHireFromAward(ctx, deskId, e, opId, prices, rate);
    res.json({ awarded: { operatorId: opId, at: isoInstant(now) } });
  });
  app.get("/api/b/:token", async (req, res) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const enquiryId = String(t.rows[0].enquiry_id);
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id)
    ]);
    if (!bid.rows[0]) throw errors.notFound();
    const now = /* @__PURE__ */ new Date();
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const awardedAt = award.rows[0] ? award.rows[0].awarded_at : null;
    const ended = endedAt(bid.rows[0], now, awardedAt);
    if (ended) throw errors.ended();
    const e = await enquiryById(ctx.db, deskId, enquiryId);
    if (!e) throw errors.notFound();
    const plan = await ctx.db.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const stops = (await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [enquiryId])).rows.map(
      (x) => String(x.text)
    );
    res.json({
      route: { stops },
      dates: {
        departAt: { date: e.departDate, time: e.departTime },
        returnAt: e.returnDate && e.returnTime ? { date: e.returnDate, time: e.returnTime } : null,
        departInstant: isoInstant(e.departInstant),
        returnInstant: e.returnInstant ? isoInstant(e.returnInstant) : null
      },
      vehicles: (plan.rows[0]?.sizes ?? []).map((seats, i) => ({ index: i + 1, seats })),
      partySize: e.people,
      closesAt: isoInstant(bid.rows[0].closes_at),
      bid: liveBidPrices(bid.rows[0])
    });
  });
  app.put("/api/b/:token/bid", async (req, res) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const enquiryId = String(t.rows[0].enquiry_id);
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id)
    ]);
    if (!bid.rows[0]) throw errors.notFound();
    const now = /* @__PURE__ */ new Date();
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const awardedAt = award.rows[0] ? award.rows[0].awarded_at : null;
    if (endedAt(bid.rows[0], now, awardedAt)) {
      const closes = bid.rows[0].closes_at;
      const at = awardedAt ?? closes;
      throw errors.state("bidsClosed", `Bids closed at ${ukTimeHM(at)}. Your price was not sent.`);
    }
    const body = await readJson(req);
    const prices = Array.isArray(body.prices) ? body.prices.map(String) : [];
    const plan = await ctx.db.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const sizes = plan.rows[0]?.sizes ?? [];
    if (prices.length !== sizes.length) throw errors.invalid({ prices: "Enter the price in pounds and pence." }, "Enter the price in pounds and pence.");
    const pennies = [];
    for (const p of prices) {
      const v = parseBidPrice(p);
      if (v === null) throw errors.invalid({ prices: "Enter the price in pounds and pence." }, "Enter the price in pounds and pence.");
      pennies.push(v);
    }
    await ctx.db.query("UPDATE bids SET prices=$1, received_at=NOW(), withdrawn_at=NULL WHERE desk_id=$2 AND enquiry_id=$3 AND operator_id=$4", [
      pennies.map(penniesToString),
      deskId,
      enquiryId,
      String(t.rows[0].operator_id)
    ]);
    const state = await ctx.db.query("SELECT state FROM enquiries WHERE desk_id=$1 AND id=$2", [deskId, enquiryId]);
    if (state.rows[0] && state.rows[0].state === "new") {
      await ctx.db.query("UPDATE enquiries SET state='priced' WHERE desk_id=$1 AND id=$2", [deskId, enquiryId]);
    }
    const after = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id)
    ]);
    res.json({ bid: { prices: after.rows[0].prices ?? [], receivedAt: isoInstant(after.rows[0].received_at) } });
  });
  app.delete("/api/b/:token/bid", async (req, res) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const enquiryId = String(t.rows[0].enquiry_id);
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id)
    ]);
    if (!bid.rows[0]) throw errors.notFound();
    const now = /* @__PURE__ */ new Date();
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const awardedAt = award.rows[0] ? award.rows[0].awarded_at : null;
    if (endedAt(bid.rows[0], now, awardedAt)) {
      const closes = bid.rows[0].closes_at;
      const at = awardedAt ?? closes;
      throw errors.state("bidsClosed", `Bids closed at ${ukTimeHM(at)}. Your price was not sent.`);
    }
    if (!hasLivePrice(bid.rows[0], bid.rows[0].closes_at, now, awardedAt)) {
      throw errors.state("noBid", "We can't find that.");
    }
    await ctx.db.query("UPDATE bids SET withdrawn_at=NOW(), prices='{}' WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id)
    ]);
    res.status(204).end();
  });
}
function liveBidPrices(b) {
  if (!b.received_at || b.withdrawn_at) return null;
  return { prices: b.prices ?? [], receivedAt: isoInstant(b.received_at) };
}
function hasLivePrice(b, _closes, _now, _awardedAt) {
  if (!b.received_at || b.withdrawn_at) return false;
  return true;
}
function endedAt(b, now, awardedAt) {
  if (awardedAt && now.getTime() >= awardedAt.getTime() + 1e3) return awardedAt;
  const closes = b.closes_at;
  if (now.getTime() >= closes.getTime() + 1e3) return closes;
  return null;
}
function bidStatus(b, _closes, now, awardedAt) {
  if (endedAt(b, now, awardedAt)) return "closed";
  if (b.withdrawn_at) return "withdrawn";
  if (b.received_at) return "open";
  return "asked";
}
async function sendAskMail(ctx, e, sizes, op, token, closesAt) {
  const stops = (await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [e.id])).rows.map((x) => String(x.text));
  const text = [
    `Price request ${e.reference}`,
    "",
    "Route:",
    ...stops.map((s) => `- ${s}`),
    "",
    `Departure: ${e.departDate} ${e.departTime} UK time`,
    e.returnDate ? `Return: ${e.returnDate} ${e.returnTime} UK time` : null,
    "",
    "Vehicles:",
    ...sizes.map((s, i) => `- Vehicle ${i + 1}: ${s} seats`),
    "",
    `Party size: ${e.people}`,
    "",
    `Price this hire: ${ctx.cfg.appPublicUrl}/b/${token}`,
    "",
    `Prices close at ${ukTimeHM(closesAt)} UK time.`,
    ""
  ].filter((x) => x !== null).join("\n");
  try {
    await sendMail(ctx.cfg, { to: String(op.email), subject: `Price request ${e.reference}`, text });
    return true;
  } catch {
    return false;
  }
}
async function hireLastDay(ctx, deskId, e) {
  const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND reference=$2", [deskId, e.reference]);
  if (hire.rows[0]) return lastDayOfHire(ctx, deskId, hire.rows[0]);
  return e.returnDate ?? e.departDate;
}
async function createHireFromAward(ctx, deskId, e, opId, prices, rate) {
  const party = partyFromEnquiry(e);
  const suggested = suggestPlan(party);
  const hireId = "HR-" + e.reference;
  const now = /* @__PURE__ */ new Date();
  const closesAt = null;
  await tx(ctx.db, async (client) => {
    await client.query("INSERT INTO awards (desk_id, enquiry_id, operator_id, awarded_at, mailed) VALUES ($1,$2,$3,$4,0)", [
      deskId,
      e.id,
      opId,
      now
    ]);
    const customer = await client.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, e.customerId]);
    const customerId = customer.rows[0]?.id ?? await ensureCustomer(client, deskId, e);
    await client.query(
      `INSERT INTO hires (id, desk_id, reference, customer_id, occasion, stage, enquiry_state, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, quote_version, rate_table_id, created_at)
       VALUES ($1,$2,$3,$4,$5,'accepted','won',$6,$7,$8,$9,$10,$11,1,$12,$13)
       ON CONFLICT (desk_id, reference) DO NOTHING`,
      [
        hireId,
        deskId,
        e.reference,
        customerId,
        e.occasion,
        e.departDate,
        e.departTime,
        e.departInstant,
        e.returnDate,
        e.returnTime,
        e.returnInstant,
        rate.id,
        now
      ]
    );
    let position = 0;
    for (const p of prices) {
      position++;
      const seats = (await client.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id])).rows[0]?.sizes?.[position - 1] ?? 49;
      const bought = parseMoneyToPennies(p) ?? 0;
      const money2 = quoteVehicleMoney(bought, rate.defaultMarginPercent, seats, rate.deposits);
      const vid = "VH-" + e.reference + "-" + position;
      await client.query(
        `INSERT INTO vehicles (id, desk_id, hire_id, seats, position, operator_id, bought_pennies, margin_percent, selling_pennies, vat_pennies, total_pennies, deposit_pennies, deposit_fixed, depart_date, depart_time, depart_instant)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,$13,$14,$15)`,
        [vid, deskId, hireId, seats, position, opId, bought, rate.defaultMarginPercent, money2.selling, money2.vat, money2.total, money2.deposit, e.departDate, e.departTime, e.departInstant]
      );
      const num2 = await client.query("SELECT COALESCE(MAX(number),0)+1 AS next FROM runs WHERE desk_id=$1", [deskId]);
      const runId = "RN-" + num2.rows[0].next;
      const sheetToken = "r" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      await client.query(
        `INSERT INTO runs (id, desk_id, number, hire_id, vehicle_id, depart_date, depart_time, depart_instant, sheet_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [runId, deskId, num2.rows[0].next, hireId, vid, e.departDate, e.departTime, e.departInstant, sheetToken]
      );
      await client.query("INSERT INTO run_tokens (token, desk_id, run_id, created_at) VALUES ($1,$2,$3,$4)", [sheetToken, deskId, runId, now]);
      const stops = await client.query("SELECT id FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [e.id]);
      for (const s of stops.rows) {
      }
    }
    await client.query("UPDATE enquiries SET state='won' WHERE desk_id=$1 AND id=$2", [deskId, e.id]);
  });
  const others = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id<>$3", [deskId, e.id, opId]);
  for (const b of others.rows) {
    const op = await ctx.db.query("SELECT email FROM operators WHERE desk_id=$1 AND id=$2", [deskId, b.operator_id]);
    if (!op.rows[0]?.email) continue;
    try {
      await sendMail(ctx.cfg, { to: String(op.rows[0].email), subject: `Hire ${e.reference} has closed`, text: `Hire ${e.reference} has closed` });
    } catch {
    }
  }
}
async function ensureCustomer(client, deskId, e) {
  if (!e.email) {
    const byTel = await client.query("SELECT id FROM customers WHERE desk_id=$1 AND telephone_folded=$2", [deskId, e.telephone ?? ""]);
    if (byTel.rows[0]) return String(byTel.rows[0].id);
  } else {
    const r = await client.query("SELECT id FROM customers WHERE desk_id=$1 AND email_folded=$2", [deskId, foldEmail(e.email)]);
    if (r.rows[0]) return String(r.rows[0].id);
  }
  const id = "CU-" + Date.now().toString(36).toUpperCase();
  await client.query(
    "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
    [id, deskId, e.name ?? "", e.email, e.telephone, e.language, e.email ? foldEmail(e.email) : null, e.telephone ? foldTelephone(e.telephone) : null]
  );
  return id;
}
var init_bids = __esm({
  "src/server/api/bids.ts"() {
    "use strict";
    init_auth2();
    init_errors();
    init_http();
    init_repo();
    init_services();
    init_money();
    init_domain();
    init_operators();
    init_rules();
    init_trip_helpers();
    init_trip_helpers();
    init_rate_helpers();
  }
});

// src/server/api/hires.ts
var hires_exports = {};
__export(hires_exports, {
  hireAnswer: () => hireAnswer,
  quoteAnswer: () => quoteAnswer,
  quoteStringsFor: () => quoteStringsFor,
  registerHireApi: () => registerHireApi,
  sendQuoteMail: () => sendQuoteMail,
  validMargin: () => validMargin,
  validUntilFrom: () => validUntilFrom,
  vehicleMoney: () => vehicleMoney
});
function rateOut(row) {
  return {
    id: String(row.id),
    effectiveFrom: isoDate(row.effective_from),
    defaultMarginPercent: String(row.default_margin_percent),
    waitingRatePerHour: penniesToString(Number(row.waiting_rate_pennies)),
    secondDriverCharge: penniesToString(Number(row.second_driver_pennies)),
    depositMinibus: penniesToString(Number(row.deposit_minibus)),
    depositMinibusHigher: penniesToString(Number(row.deposit_minibus_higher)),
    depositCoach: penniesToString(Number(row.deposit_coach)),
    depositCoachHigher: penniesToString(Number(row.deposit_coach_higher))
  };
}
function registerHireApi(app, ctx) {
  app.get("/api/rates", async (req, res) => {
    const deskId = requireAuth(req);
    const tables = await ctx.db.query("SELECT * FROM rate_tables WHERE desk_id=$1 ORDER BY effective_from", [deskId]);
    const inForce = await rateTableFor(ctx, deskId, /* @__PURE__ */ new Date());
    res.json({ tables: tables.rows.map(rateOut), inForce: inForce.id || null });
  });
  app.post("/api/rates", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const f = {};
    const effectiveFrom = typeof body.effectiveFrom === "string" ? body.effectiveFrom : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) f.effectiveFrom = "Enter a date as DD/MM/YYYY.";
    const margin = typeof body.defaultMarginPercent === "string" ? body.defaultMarginPercent : "";
    const wait = typeof body.waitingRatePerHour === "string" ? body.waitingRatePerHour : "";
    const second = typeof body.secondDriverCharge === "string" ? body.secondDriverCharge : "";
    const dep = ["depositMinibus", "depositMinibusHigher", "depositCoach", "depositCoachHigher"].map((k) => [
      k,
      typeof body[k] === "string" ? body[k] : ""
    ]);
    if (Object.keys(f).length === 0) {
      const today = ukDateString(/* @__PURE__ */ new Date());
      if (effectiveFrom < today) throw errors.invalid({ effectiveFrom: "A rate table can't start before today." }, "A rate table can't start before today.");
      const same = await ctx.db.query("SELECT 1 FROM rate_tables WHERE desk_id=$1 AND effective_from=$2", [deskId, effectiveFrom]);
      if (same.rows[0]) throw errors.state("sameDate", `A rate table already starts on ${effectiveFrom}.`);
    }
    const money2 = (v) => parseMoneyToPennies(v);
    const waitP = money2(wait);
    const secondP = money2(second);
    const depP = dep.map(([, v]) => money2(v));
    if (waitP === null || secondP === null || depP.some((x) => x === null)) {
      throw errors.invalid({ waitingRatePerHour: "Enter the amount in pounds and pence." }, "Enter the amount in pounds and pence.");
    }
    if (Object.keys(f).length) throw errors.invalid(f);
    const id = "RT-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await ctx.db.query(
      `INSERT INTO rate_tables (id, desk_id, effective_from, default_margin_percent, waiting_rate_pennies, second_driver_pennies, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, deskId, effectiveFrom, margin || "15", waitP, secondP, depP[0], depP[1], depP[2], depP[3]]
    );
    const after = await ctx.db.query("SELECT * FROM rate_tables WHERE id=$1", [id]);
    res.status(201).json(rateOut(after.rows[0]));
  });
  app.post("/api/hires", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const stage = body.stage === "enquiry" || body.stage === "quoted" || body.stage === "accepted" ? body.stage : null;
    if (!stage) throw errors.invalid({ stage: "We can't find that." });
    const occasion = typeof body.occasion === "string" ? body.occasion : "";
    if (!["school", "weddings", "company", "festivals"].includes(occasion)) throw errors.invalid({ occasion: "Choose an occasion." });
    const stops = Array.isArray(body.stops) ? body.stops.map(String) : [];
    if (stops.length < 2) throw errors.invalid({ stops: "Enter the pick-up address." });
    const departAt = parseLocalDate(body.departAt ?? {}, "departAt");
    const returnAt = body.returnAt ? parseLocalDate(body.returnAt, "returnAt") : null;
    const party = partyFromBody(body.party);
    const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
    let operatorId = null;
    const vehicles = [];
    for (const v of vehiclesIn) {
      const o = v ?? {};
      const seats = Number(o.seats);
      if (!Number.isInteger(seats) || ![8, 12, 16, 31, 49, 56, 70].includes(seats)) {
        throw errors.invalid({ vehicles: "Choose sizes from 8, 12, 16, 31, 49, 56 and 70." });
      }
      const opId = typeof o.operatorId === "string" ? o.operatorId : null;
      const bought = typeof o.boughtPrice === "string" ? parseBidPrice(o.boughtPrice) : null;
      if (o.boughtPrice !== void 0 && bought === null) throw errors.invalid({ vehicles: "Enter the price in pounds and pence." });
      const margin = typeof o.marginPercent === "string" ? o.marginPercent : null;
      vehicles.push({ seats, bought, margin: margin ?? "15" });
      if (opId) operatorId = opId;
    }
    if (operatorId) {
      const op = await ctx.db.query("SELECT 1 FROM operators WHERE desk_id=$1 AND id=$2", [deskId, operatorId]);
      if (!op.rows[0]) throw errors.notFound();
    }
    if (stage !== "enquiry" && vehicles.length === 0) throw errors.invalid({ vehicles: "Choose sizes from 8, 12, 16, 31, 49, 56 and 70." });
    const customerBody = body.customer ?? {};
    const customerId = await findOrCreateCustomer2(ctx, deskId, customerBody);
    const reference = await nextReference(ctx, deskId);
    const now = /* @__PURE__ */ new Date();
    const rate = await rateTableFor(ctx, deskId, now);
    const quoteSentAt = body.quoteSentAt ? parseLocalDate(body.quoteSentAt, "quoteSentAt").instant : now;
    const endsAt = stage === "enquiry" ? null : quoteEndFor2(quoteSentAt, ctx.cfg.quoteValidSeconds);
    const token = stage === "enquiry" ? null : "q" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const hireId = "HR-" + reference;
    const enquiryState = stage === "accepted" ? "won" : stage === "quoted" ? "quoted" : "new";
    await tx(ctx.db, async (client) => {
      await client.query(
        `INSERT INTO hires (id, desk_id, reference, customer_id, occasion, stage, enquiry_state, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, quote_version, quote_sent_at, quote_ends_at, quote_path, quote_mailed, rate_table_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$16,$17,$18,$19)`,
        [
          hireId,
          deskId,
          reference,
          customerId,
          occasion,
          stage,
          enquiryState,
          departAt.date,
          departAt.time,
          departAt.instant,
          returnAt?.date ?? null,
          returnAt?.time ?? null,
          returnAt?.instant ?? null,
          stage === "enquiry" ? null : quoteSentAt,
          endsAt,
          token,
          stage === "quoted",
          rate.id,
          now
        ]
      );
      await client.query(
        `INSERT INTO enquiries (id, desk_id, customer_id, reference, occasion, state, journey_type, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, people, large, medium, hand, wheelchairs, name, email, telephone, language, created_at, merged_references)
         VALUES ($1,$2,$3,$4,$5,$6,'oneWay',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,(SELECT name FROM customers WHERE id=$3),(SELECT email FROM customers WHERE id=$3),(SELECT telephone FROM customers WHERE id=$3),(SELECT language FROM customers WHERE id=$3),$18,'{}')
         ON CONFLICT (desk_id, reference) DO NOTHING`,
        [reference, deskId, customerId, reference, occasion, enquiryState, departAt.date, departAt.time, departAt.instant, returnAt?.date ?? null, returnAt?.time ?? null, returnAt?.instant ?? null, party.people, party.large, party.medium, party.hand, party.wheelchairs, now]
      );
      for (let i = 0; i < stops.length; i++) {
        await client.query("INSERT INTO enquiry_stops (id, enquiry_id, desk_id, position, text, checked) VALUES ($1,$2,$3,$4,$5,FALSE)", [
          "ST-" + reference + "-" + i,
          reference,
          deskId,
          i,
          stops[i]
        ]);
      }
      await client.query(
        `INSERT INTO plan_saves (desk_id, enquiry_id, sizes, suggested, larger_than_needed) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (desk_id, enquiry_id) DO UPDATE SET sizes=$3, suggested=$4, larger_than_needed=$5`,
        [deskId, reference, vehicles.map((v) => v.seats), suggestPlan(party), vehicles.length > 0 ? false : false]
      );
      let position = 0;
      for (const v of vehicles) {
        position++;
        const money2 = v.bought !== null ? quoteVehicleMoney(v.bought, v.margin, v.seats, rate.deposits) : null;
        const vid = "VH-" + reference + "-" + position;
        await client.query(
          `INSERT INTO vehicles (id, desk_id, hire_id, seats, position, operator_id, bought_pennies, margin_percent, selling_pennies, vat_pennies, total_pennies, deposit_pennies, deposit_fixed, depart_date, depart_time, depart_instant)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            vid,
            deskId,
            hireId,
            v.seats,
            position,
            operatorId,
            v.bought,
            v.margin,
            money2?.selling ?? 0,
            money2?.vat ?? 0,
            money2?.total ?? 0,
            money2?.deposit ?? 0,
            stage !== "enquiry",
            departAt.date,
            departAt.time,
            departAt.instant
          ]
        );
        if (stage === "accepted") {
          const num2 = (await client.query("SELECT COALESCE(MAX(number),0)+1 AS next FROM runs WHERE desk_id=$1", [deskId])).rows[0].next;
          const runId = "RN-" + num2;
          const sheetToken = "r" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
          await client.query(
            `INSERT INTO runs (id, desk_id, number, hire_id, vehicle_id, depart_date, depart_time, depart_instant, sheet_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [runId, deskId, num2, hireId, vid, departAt.date, departAt.time, departAt.instant, sheetToken]
          );
          await client.query("INSERT INTO run_tokens (token, desk_id, run_id, created_at) VALUES ($1,$2,$3,$4)", [sheetToken, deskId, runId, now]);
        }
      }
      if (token) {
        await client.query("INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,1,$4)", [token, deskId, hireId, quoteSentAt]);
      }
    });
    const hire = await hireAnswer(ctx, deskId, hireId);
    res.status(201).json(hire);
  });
  app.get("/api/hires/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await hireAnswer(ctx, deskId, String(hire.rows[0].id)));
  });
  app.get("/api/hires/:id/quote", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await quoteAnswer(ctx, deskId, hire.rows[0]));
  });
  app.post("/api/hires/:id/quote/preview", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    const list = Array.isArray(body.vehicles) ? body.vehicles : [];
    const rate = await rateTableForDate(ctx, deskId, isoDate(hire.rows[0].quote_sent_at ? hire.rows[0].quote_sent_at : /* @__PURE__ */ new Date()));
    const out = [];
    let total = 0;
    let depositTotal = 0;
    for (const v of list) {
      const o = v ?? {};
      const seats = Number(o.seats);
      if (!Number.isInteger(seats) || ![8, 12, 16, 31, 49, 56, 70].includes(seats)) {
        throw errors.invalid({ vehicles: "Choose sizes from 8, 12, 16, 31, 49, 56 and 70." });
      }
      const bought = typeof o.boughtPrice === "string" ? parseBidPrice(o.boughtPrice) : null;
      if (bought === null) throw errors.invalid({ vehicles: "Enter the price in pounds and pence." });
      const margin = typeof o.marginPercent === "string" ? o.marginPercent : rate.defaultMarginPercent;
      if (!validMargin(margin)) throw errors.invalid({ marginPercent: "Margin is 0 to 60 in steps of 0.5." }, "Margin is 0 to 60 in steps of 0.5.");
      const m = quoteVehicleMoney(bought, margin, seats, rate.deposits);
      out.push({ seats, sellingPrice: penniesToString(m.selling), vat: penniesToString(m.vat), total: penniesToString(m.total), deposit: penniesToString(m.deposit) });
      total += m.total;
      depositTotal += m.deposit;
    }
    res.json({ vehicles: out, total: penniesToString(total), depositTotal: penniesToString(depositTotal) });
  });
  app.put("/api/hires/:id/quote", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    const version = Number(body.version);
    if (!Number.isInteger(version)) throw errors.staleEdit("Someone changed this quote. Your edit is still here. Reload to see theirs.");
    if (hire.rows[0].stage === "accepted") throw errors.state("quoteLocked", "This quote is accepted. Use Changes instead.");
    if (version < Number(hire.rows[0].quote_version)) {
      throw errors.staleEdit(`Someone changed this quote at ${ukTimeHM(hire.rows[0].quote_version_changed_at ?? /* @__PURE__ */ new Date())}. Your edit is still here. Reload to see theirs.`);
    }
    const list = Array.isArray(body.vehicles) ? body.vehicles : [];
    const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.rows[0].id));
    const byId = new Map(vehicles.map((v) => [v.id, v]));
    const updated = /* @__PURE__ */ new Map();
    for (const v of list) {
      const o = v ?? {};
      const id = typeof o.id === "string" ? o.id : "";
      const target = byId.get(id);
      if (!target) throw errors.notFound();
      const margin = typeof o.marginPercent === "string" ? o.marginPercent : target.margin ?? "15";
      if (!validMargin(margin)) throw errors.invalid({ marginPercent: "Margin is 0 to 60 in steps of 0.5." }, "Margin is 0 to 60 in steps of 0.5.");
      updated.set(id, margin);
    }
    const rate = await rateTableForDate(ctx, deskId, isoDate(hire.rows[0].quote_sent_at ? hire.rows[0].quote_sent_at : /* @__PURE__ */ new Date()));
    await tx(ctx.db, async (client) => {
      for (const [id, margin] of updated) {
        const v = byId.get(id);
        const m = quoteVehicleMoney(v.bought ?? 0, margin, v.seats, rate.deposits);
        await client.query(
          "UPDATE vehicles SET margin_percent=$1, selling_pennies=$2, vat_pennies=$3, total_pennies=$4 WHERE id=$5",
          [margin, m.selling, m.vat, m.total, id]
        );
      }
      await client.query(
        "UPDATE hires SET quote_version = $1 + 1, quote_version_changed_at = NOW() WHERE desk_id=$2 AND id=$3",
        [version, deskId, hire.rows[0].id]
      );
    });
    const after = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hire.rows[0].id]);
    res.json(await quoteAnswer(ctx, deskId, after.rows[0]));
  });
  app.post("/api/hires/:id/quote/send", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    if (hire.rows[0].stage === "enquiry") throw errors.state("notAwarded", "We can't find that.");
    const customer = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, hire.rows[0].customer_id]);
    if (!customer.rows[0]) throw errors.notFound();
    const now = /* @__PURE__ */ new Date();
    let sentAt = hire.rows[0].quote_sent_at ? hire.rows[0].quote_sent_at : null;
    let endsAt = hire.rows[0].quote_ends_at ? hire.rows[0].quote_ends_at : null;
    let path = hire.rows[0].quote_path ? String(hire.rows[0].quote_path) : null;
    const rateAtSend = await rateTableFor(ctx, deskId, sentAt ?? now);
    if (!sentAt || !hire.rows[0].quote_mailed) {
      sentAt = sentAt ?? now;
      endsAt = quoteEndFor2(sentAt, ctx.cfg.quoteValidSeconds);
      path = path ?? "q" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      await ctx.db.query(
        "UPDATE hires SET quote_sent_at=$1, quote_ends_at=$2, quote_path=$3, quote_mailed=TRUE, stage=CASE WHEN stage='quoted' THEN 'quoted' ELSE stage END, enquiry_state=CASE WHEN enquiry_state IN ('new','priced') THEN 'quoted' ELSE enquiry_state END WHERE id=$4",
        [sentAt, endsAt, path, hire.rows[0].id]
      );
      await ctx.db.query(
        `INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (token) DO NOTHING`,
        [path, deskId, hire.rows[0].id, Number(hire.rows[0].quote_version), sentAt]
      );
      const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.rows[0].id));
      let total = 0;
      for (const v of vehicles) total += v.total;
      const lang = String(customer.rows[0].language ?? "en");
      const ok = await sendQuoteMail(ctx, String(customer.rows[0].email), String(hire.rows[0].reference), lang, total, endsAt, path);
      if (!ok) throw errors.provider("The mail service is unavailable right now. Nothing was sent.");
    } else {
    }
    const after = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hire.rows[0].id]);
    res.json(await quoteAnswer(ctx, deskId, after.rows[0]));
  });
}
function validMargin(m) {
  const v = Number(m);
  return Number.isFinite(v) && v >= 0 && v <= 60 && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
}
function partyFromBody(v) {
  const o = v ?? {};
  return {
    people: Number(o.people ?? 1),
    large: Number(o.large ?? 0),
    medium: Number(o.medium ?? 0),
    hand: Number(o.hand ?? 0),
    wheelchairs: Number(o.wheelchairs ?? 0)
  };
}
async function nextReference(ctx, deskId) {
  const { newReference: newReference2 } = await Promise.resolve().then(() => (init_repo(), repo_exports));
  return newReference2(ctx.db, deskId);
}
async function findOrCreateCustomer2(ctx, deskId, body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const telephone = typeof body.telephone === "string" ? body.telephone.trim() : "";
  const language = body.language === "pl" || body.language === "ur" ? body.language : "en";
  const existing = email ? await ctx.db.query("SELECT id FROM customers WHERE desk_id=$1 AND email_folded=$2", [deskId, foldEmail(email)]) : await ctx.db.query("SELECT id FROM customers WHERE desk_id=$1 AND telephone_folded=$2", [deskId, foldTelephone(telephone)]);
  if (existing.rows[0]) return String(existing.rows[0].id);
  const id = "CU-" + Date.now().toString(36).toUpperCase();
  await ctx.db.query(
    "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
    [id, deskId, name, email || null, telephone || null, language, email ? foldEmail(email) : null, telephone ? foldTelephone(telephone) : null]
  );
  return id;
}
async function hireAnswer(ctx, deskId, hireId) {
  const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND id=$2", [deskId, hireId]);
  const h = hire.rows[0];
  const vehicles = await vehiclesFor(ctx.db, deskId, hireId);
  const runs = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND hire_id=$2 ORDER BY number", [deskId, hireId]);
  const money2 = await vehicleMoney(ctx, deskId, vehicles);
  const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, h.reference]);
  return {
    id: String(h.id),
    reference: String(h.reference),
    customerId: String(h.customer_id),
    stage: String(h.stage),
    enquiryState: String(h.enquiry_state),
    quotePath: h.quote_path ? String(h.quote_path) : null,
    sentAt: h.quote_sent_at ? isoInstant(h.quote_sent_at) : null,
    validUntil: h.quote_ends_at ? validUntilFrom(h.quote_ends_at) : null,
    endsAt: h.quote_ends_at ? isoInstant(h.quote_ends_at) : null,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      seats: v.seats,
      operatorId: v.operatorId,
      boughtPrice: v.bought === null ? null : penniesToString(v.bought),
      marginPercent: v.margin,
      sellingPrice: penniesToString(v.selling),
      vat: penniesToString(v.vat),
      total: penniesToString(v.total),
      deposit: penniesToString(v.deposit),
      departAt: v.departDate ? { date: v.departDate, time: v.departTime } : null,
      departInstant: v.departInstant ? isoInstant(v.departInstant) : null,
      runId: runs.rows.find((r) => r.vehicle_id === v.id)?.id ?? null
    })),
    runs: runs.rows.map((r) => ({ id: String(r.id), number: Number(r.number), sheetPath: String(r.sheet_path) })),
    paymentState: money2.paymentState,
    paid: penniesToString(money2.paid),
    owed: penniesToString(money2.owed),
    credit: penniesToString(money2.credit),
    balanceDueOn: null,
    awarded: award.rows[0] ? { operatorId: String(award.rows[0].operator_id), at: isoInstant(award.rows[0].awarded_at) } : null
  };
}
async function vehicleMoney(ctx, deskId, vehicles) {
  const states = [];
  let paid = 0;
  let totalDue = 0;
  let depositsDue = 0;
  for (const v of vehicles) {
    const r = await ctx.db.query(
      `SELECT
        COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='deposit'),0) AS deposit,
        COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='balance'),0) AS balance,
        COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='credit'),0) AS credit
       FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2`,
      [deskId, v.id]
    );
    const depositPaid = Number(r.rows[0].deposit);
    const balancePaid = Number(r.rows[0].balance);
    const creditPaid = Number(r.rows[0].credit);
    states.push({ total: v.total, deposit: v.deposit, depositPaid: depositPaid + creditPaid, balancePaid });
    paid += depositPaid + balancePaid + creditPaid;
    totalDue += v.total;
    depositsDue += v.deposit;
  }
  const owed = Math.max(0, totalDue - paid);
  const credit = Math.max(0, paid - totalDue);
  const allDeposits = vehicles.length > 0 && states.every((s) => s.depositPaid >= s.deposit);
  const allPaid = vehicles.length > 0 && states.every((s) => s.depositPaid + s.balancePaid >= s.total);
  let paymentState = "nothingPaid";
  if (allPaid) paymentState = "paidInFull";
  else if (allDeposits) paymentState = "depositPaid";
  else if (states.some((s) => s.depositPaid > 0)) paymentState = paid < depositsDue ? "depositPartPaid" : "depositPaid";
  return { paid, owed, credit, paymentState };
}
function validUntilFrom(endsAt) {
  const day = new Date(endsAt.getTime() - 1e3);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
  const [dd, mm, yyyy] = f.split("/");
  return `${yyyy}-${mm}-${dd}`;
}
async function quoteAnswer(ctx, deskId, h) {
  const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
  let total = 0;
  let depositTotal = 0;
  for (const v of vehicles) {
    total += v.total;
    depositTotal += v.deposit;
  }
  return {
    version: Number(h.quote_version),
    sentAt: h.quote_sent_at ? isoInstant(h.quote_sent_at) : null,
    validUntil: h.quote_ends_at ? validUntilFrom(h.quote_ends_at) : null,
    endsAt: h.quote_ends_at ? isoInstant(h.quote_ends_at) : null,
    quotePath: h.quote_path ? String(h.quote_path) : null,
    rateTableId: h.rate_table_id ? String(h.rate_table_id) : null,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      seats: v.seats,
      boughtPrice: v.bought === null ? null : penniesToString(v.bought),
      marginPercent: v.margin,
      sellingPrice: penniesToString(v.selling),
      vat: penniesToString(v.vat),
      total: penniesToString(v.total),
      deposit: penniesToString(v.deposit)
    })),
    total: penniesToString(total),
    depositTotal: penniesToString(depositTotal)
  };
}
async function sendQuoteMail(ctx, to, reference, language, total, endsAt, token) {
  const t = quoteStringsFor(language);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(endsAt.getTime() - 1e3));
  const [dd, mm, yyyy] = day.split("/");
  const validUntil = language === "pl" ? `${dd}.${mm}.${yyyy}` : language === "ur" ? `${dd}/${mm}/${yyyy}` : longUkDate(new Date(endsAt.getTime() - 1e3));
  const text = [
    `${t.yourQuote} ${reference}`,
    "",
    `${t.total} \xA3${(total / 100).toFixed(2)}`,
    `${t.validUntil} ${validUntil}`,
    "",
    `${ctx.cfg.appPublicUrl}/q/${token}`,
    ""
  ].join("\n");
  try {
    await sendMail(ctx.cfg, { to, subject: `${t.yourQuote} ${reference}`, text });
    return true;
  } catch {
    return false;
  }
}
function longUkDate(d) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).formatToParts(d);
  const get = (t) => f.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${Number(get("day"))} ${get("month")} ${get("year")}`;
}
function quoteStringsFor(language) {
  if (language === "pl") return { yourQuote: "Twoja wycena", total: "Razem", validUntil: "Wa\u017Cna do" };
  if (language === "ur") return { yourQuote: "\u0622\u067E \u06A9\u0627 \u06A9\u0648\u0679\u06CC\u0634\u0646", total: "\u06A9\u0644 \u0631\u0642\u0645", validUntil: "\u062A\u06A9 \u06A9\u0627\u0631\u0622\u0645\u062F" };
  return { yourQuote: "Your quote", total: "Total", validUntil: "Valid until" };
}
var init_hires = __esm({
  "src/server/api/hires.ts"() {
    "use strict";
    init_auth2();
    init_errors();
    init_http();
    init_repo();
    init_domain();
    init_money();
    init_rules();
    init_rate_helpers();
    init_validation();
    init_services();
    init_uktime();
    init_bids();
  }
});

// src/server/hours.ts
function judgeSingleRun(duty, excludeSecondDriver) {
  let driving = 0;
  let spread = 0;
  for (const b of duty.blocks) spread += b.minutes;
  let sinceBreak = 0;
  let minute = 0;
  let driveStartMinute = 0;
  let breach = null;
  let split15 = false;
  let split30 = false;
  const clearBreak = () => {
    sinceBreak = 0;
    split15 = false;
    split30 = false;
  };
  for (const b of duty.blocks) {
    if (b.kind === "drive") {
      const before = sinceBreak;
      sinceBreak += b.minutes;
      driving += b.minutes;
      if (!excludeSecondDriver && !breach && before < 270 && sinceBreak > 270) {
        breach = { rule: "drivingBeforeBreak", atMinute: driveStartMinute + (270 - before + 1) };
      }
      driveStartMinute = minute + b.minutes;
      minute += b.minutes;
    } else {
      minute += b.minutes;
      if (b.kind === "break") {
        if (b.minutes >= 45) clearBreak();
        else if (b.minutes >= 30) {
          split30 = true;
          if (split15) clearBreak();
        } else if (b.minutes >= 15) {
          split15 = true;
          if (split30) clearBreak();
        }
      }
    }
  }
  if (!excludeSecondDriver && !breach && spread > 780) breach = { rule: "spread", atMinute: 781 };
  return { drivingMinutes: driving, spreadMinutes: spread, breach };
}
function localAtMinute(startInstant, minute) {
  const f = ukFieldsOf(startInstant, minute);
  return f;
}
function ukFieldsOf(start, minute) {
  const t = new Date(start.getTime() + minute * 6e4);
  const d = ukDateString(t);
  const o = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  return { date: d, time: o === "24:00" ? "00:00" : o };
}
function judgeRun(duty, secondDriver, sameDriverDayDriving, sameDriverWeekDaysOver540) {
  const single = judgeSingleRun(duty, secondDriver);
  const breaches = [];
  if (single.breach) {
    const at = single.breach.atMinute;
    breaches.push({ rule: single.breach.rule, atMinute: at, atLocal: localAtMinute(duty.startInstant, at) });
  }
  if (!secondDriver) {
    const driving = single.drivingMinutes;
    const dayOthers = sameDriverDayDriving;
    const dayTotal = dayOthers + driving;
    if (dayTotal > 540) {
      const remaining = 540 - dayOthers;
      const at = remaining < 0 ? 1 : remaining + 1;
      if (driving > remaining) {
        breaches.push({ rule: "dailyDriving", atMinute: at, atLocal: localAtMinute(duty.startInstant, at) });
      }
    }
  }
  return { drivingMinutes: single.drivingMinutes, spreadMinutes: single.spreadMinutes, breaches };
}
function cancellationDays(departDate, noticeDate) {
  const d = toDays(departDate);
  const n = toDays(noticeDate);
  return d - n;
}
function toDays(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return civil(y, m, d);
}
function civil(y, m, d) {
  y += m <= 2 ? -1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function cancellationCharge(days, total, deposit) {
  let rate = 1;
  if (days >= 30) rate = 0;
  else if (days >= 15) rate = 0.25;
  else if (days >= 8) rate = 0.5;
  else rate = 1;
  if (rate === 0) return deposit;
  const pct = fractionOf(total, rate * 100);
  return Math.max(deposit, Math.min(total, pct));
}
function seatGridFor(size) {
  const seats = [];
  if (size === 8) {
    let row2 = 1;
    let col2 = 0;
    const cols2 = ["A", "B", "C"];
    for (let i = 0; i < size; i++) {
      seats.push(`${row2}${cols2[col2]}`);
      col2++;
      if (col2 === 3) {
        col2 = 0;
        row2++;
      }
    }
    return seats;
  }
  const cols = ["A", "B", "C", "D"];
  let row = 1;
  let col = 0;
  for (let i = 0; i < size; i++) {
    seats.push(`${row}${cols[col]}`);
    col++;
    if (col === 4) {
      col = 0;
      row++;
    }
  }
  return seats;
}
function adultsNeeded(pupils) {
  return Math.ceil(pupils / 15);
}
var WHEELCHAIR_SEATS;
var init_hours = __esm({
  "src/server/hours.ts"() {
    "use strict";
    init_uktime();
    init_money();
    WHEELCHAIR_SEATS = ["2A", "2B"];
  }
});

// src/server/api/documents-helpers.ts
async function fileRateLimited(ctx, deskId, now, action) {
  const windowSeconds = ctx.cfg.fileRateWindowSeconds;
  const rows = await ctx.db.query(
    "SELECT at FROM file_rate WHERE desk_id=$1 AND action=$2 AND at > NOW() - ($3 || ' seconds')::interval ORDER BY at",
    [deskId, action, String(windowSeconds)]
  );
  if (rows.rows.length >= 5) {
    const retryAt = new Date(rows.rows[0].at.getTime() + windowSeconds * 1e3);
    const seconds = Math.ceil((retryAt.getTime() - now.getTime()) / 1e3);
    return { seconds: Math.max(1, seconds), message: `You have downloaded several files. Try again after ${ukTimeHM(retryAt)}.` };
  }
  await ctx.db.query("INSERT INTO file_rate (desk_id, at, action) VALUES ($1,NOW(),$2)", [deskId, action]);
  return null;
}
var init_documents_helpers = __esm({
  "src/server/api/documents-helpers.ts"() {
    "use strict";
    init_domain();
  }
});

// src/server/api/aftercare.ts
function heldToFor(foundOn) {
  const [y, m] = foundOn.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isLastDay = Number(foundOn.slice(8, 10)) === last;
  if (m === 12) {
    const ny = y + 1;
    const janLast = 31;
    const target = new Date(Date.UTC(ny, 0 + 1, 0)).getUTCDate();
    const day2 = Number(foundOn.slice(8, 10));
    const nextLast = new Date(Date.UTC(ny, 1, 0)).getUTCDate();
    return clampToMonth(y, m, day2);
  }
  const day = Number(foundOn.slice(8, 10));
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const lastOfNext = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, lastOfNext)).padStart(2, "0")}`;
}
function clampToMonth(y, m, day) {
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const lastOfNext = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, lastOfNext)).padStart(2, "0")}`;
}
function isPastHolding(heldTo, today) {
  return today > heldTo;
}
async function holidayListFor(ctx, deskId) {
  const cached = await ctx.db.query(
    "SELECT dates, ok, fetched_at FROM holiday_cache WHERE desk_id=$1",
    [deskId]
  );
  const now = /* @__PURE__ */ new Date();
  if (cached.rows[0]) {
    const fetchedAt = cached.rows[0].fetched_at;
    if (now.getTime() - fetchedAt.getTime() < ctx.cfg.holidayCacheSeconds * 1e3) {
      return { dates: cached.rows[0].dates ?? [], ok: Boolean(cached.rows[0].ok) };
    }
  }
  const raw = await wireGet(ctx.cfg, "/bank-holidays.json");
  const dates = raw?.["england-and-wales"]?.events?.map((e) => String(e.date)) ?? null;
  if (dates === null) {
    if (cached.rows[0]) return { dates: cached.rows[0].dates ?? [], ok: Boolean(cached.rows[0].ok) };
    await ctx.db.query(
      `INSERT INTO holiday_cache (desk_id, dates, fetched_at, ok) VALUES ($1,'[]',NOW(),FALSE)
       ON CONFLICT (desk_id) DO UPDATE SET fetched_at=NOW(), ok=FALSE`,
      [deskId]
    );
    return { dates: [], ok: false };
  }
  await ctx.db.query(
    `INSERT INTO holiday_cache (desk_id, dates, fetched_at, ok) VALUES ($1,$2::jsonb,NOW(),TRUE)
     ON CONFLICT (desk_id) DO UPDATE SET dates=$2::jsonb, fetched_at=NOW(), ok=TRUE`,
    [deskId, JSON.stringify(dates)]
  );
  return { dates, ok: true };
}
function replyDueFor(receivedAt, holidays, ok) {
  const holidaySet = new Set(holidays);
  let date = ukDateOf(receivedAt);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(receivedAt));
  const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", minute: "2-digit" }).format(receivedAt));
  const after1700 = hour > 17 || hour === 17 && minute > 0;
  const weekend = ukDayOfWeek(date) === 0 || ukDayOfWeek(date) === 6;
  const isHoliday = holidaySet.has(date);
  let remaining = 3;
  if (after1700 || weekend || isHoliday) {
    date = nextWorkingDay(date, holidaySet);
  }
  while (remaining > 0) {
    date = nextWorkingDay(date, holidaySet);
    remaining--;
  }
  return date;
}
function nextWorkingDay(date, holidays) {
  let d = addDays(date, 1);
  while (ukDayOfWeek(d) === 0 || ukDayOfWeek(d) === 6 || holidays.has(d)) {
    d = addDays(d, 1);
  }
  return d;
}
function ukDateOf(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("/").reverse().join("-");
}
function registerAftercareApi(app, ctx) {
  app.post("/api/complaints", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const customerId = typeof body.customerId === "string" ? body.customerId : "";
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    const receivedAt = parseLocalDate(body.receivedAt ?? {}, "receivedAt");
    const customer = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2 AND state='active'", [deskId, customerId]);
    if (!customer.rows[0]) throw errors.notFound();
    if (!summary) throw errors.invalid({ summary: "We can't find that." });
    const holidays = await holidayListFor(ctx, deskId);
    const replyDue = replyDueFor(receivedAt.instant, holidays.dates, holidays.ok);
    const id = "CM-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await ctx.db.query("INSERT INTO complaints (id, desk_id, customer_id, summary, received_at, reply_due, holiday_line) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
      id,
      deskId,
      customerId,
      summary,
      receivedAt.instant,
      replyDue,
      holidays.ok ? null : "Bank holidays unavailable. Weekends only."
    ]);
    res.status(201).json({
      id,
      customerId,
      summary,
      receivedAt: isoInstant(receivedAt.instant),
      replyDue,
      holidayLine: holidays.ok ? null : "Bank holidays unavailable. Weekends only."
    });
  });
  app.get("/api/complaints", async (req, res) => {
    const deskId = requireAuth(req);
    const rows = await ctx.db.query("SELECT * FROM complaints WHERE desk_id=$1 ORDER BY received_at DESC", [deskId]);
    res.json({
      complaints: rows.rows.map((x) => ({
        id: String(x.id),
        customerId: String(x.customer_id),
        summary: String(x.summary),
        receivedAt: isoInstant(x.received_at),
        replyDue: isoDate(x.reply_due),
        holidayLine: x.holiday_line ? String(x.holiday_line) : null
      }))
    });
  });
  app.post("/api/lost-property", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const foundOn = typeof body.foundOn === "string" ? body.foundOn : "";
    if (!description) throw errors.invalid({ description: "We can't find that." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(foundOn)) throw errors.invalid({ foundOn: "Enter a date as DD/MM/YYYY." });
    const heldTo = heldToFor(foundOn);
    const id = "LP-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await ctx.db.query("INSERT INTO lost_items (id, desk_id, description, found_on, held_to, state) VALUES ($1,$2,$3,$4,$5,'held')", [
      id,
      deskId,
      description,
      foundOn,
      heldTo
    ]);
    res.status(201).json({ id, description, foundOn, heldTo, state: "held" });
  });
  app.get("/api/lost-property", async (req, res) => {
    const deskId = requireAuth(req);
    const rows = await ctx.db.query("SELECT * FROM lost_items WHERE desk_id=$1 ORDER BY found_on DESC", [deskId]);
    const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date()).split("/").reverse().join("-");
    res.json({
      items: rows.rows.map((x) => ({
        id: String(x.id),
        description: String(x.description),
        foundOn: isoDate(x.found_on),
        heldTo: isoDate(x.held_to),
        state: x.returned_at ? "returned" : isPastHolding(String(x.held_to).slice(0, 10), today) ? "pastHoldingDate" : "held"
      }))
    });
  });
  app.post("/api/lost-property/:id/return", async (req, res) => {
    const deskId = requireAuth(req);
    const item = await ctx.db.query("SELECT * FROM lost_items WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!item.rows[0]) throw errors.notFound();
    if (item.rows[0].returned_at) throw errors.state("alreadyReturned", "We can't find that.");
    const body = await readJson(req);
    const ownerDetails = typeof body.ownerDetails === "string" ? body.ownerDetails.trim() : "";
    if (!ownerDetails) throw errors.invalid({ ownerDetails: "Record the owner's details before returning this." });
    await ctx.db.query("UPDATE lost_items SET owner_details=$2, returned_at=NOW(), state='returned' WHERE id=$1", [item.rows[0].id, ownerDetails]);
    res.json({
      id: String(item.rows[0].id),
      description: String(item.rows[0].description),
      foundOn: String(item.rows[0].found_on).slice(0, 10),
      heldTo: String(item.rows[0].held_to).slice(0, 10),
      state: "returned",
      charge: "5.00"
    });
  });
}
var init_aftercare = __esm({
  "src/server/api/aftercare.ts"() {
    "use strict";
    init_auth2();
    init_errors();
    init_http();
    init_domain();
    init_services();
    init_uktime();
    init_validation();
    init_repo();
  }
});

// src/server/api/documents.ts
var documents_exports = {};
__export(documents_exports, {
  documentHtml: () => documentHtml,
  escapeHtml: () => escapeHtml,
  isoDate: () => isoDate,
  kindLabel: () => kindLabel,
  registerAftercareApi: () => registerAftercareApi,
  registerDocumentApi: () => registerDocumentApi,
  ukTimeHM: () => ukTimeHM
});
function kindLabel(kind) {
  return KIND_LABEL[kind] ?? kind;
}
function registerDocumentApi(app, ctx) {
  app.get("/api/documents", async (req, res) => {
    const deskId = requireAuth(req);
    const docs = await ctx.db.query("SELECT * FROM documents WHERE desk_id=$1 ORDER BY created_at DESC", [deskId]);
    const year = Number(ukDateString(/* @__PURE__ */ new Date()).slice(0, 4));
    const invoice = await ctx.db.query("SELECT COALESCE(MAX(last_number),0) AS last FROM document_numbers WHERE desk_id=$1 AND kind_prefix='INV' AND year=$2", [deskId, year]);
    const credit = await ctx.db.query("SELECT COALESCE(MAX(last_number),0) AS last FROM document_numbers WHERE desk_id=$1 AND kind_prefix='CN' AND year=$2", [deskId, year]);
    const issuedInvoices = await ctx.db.query("SELECT number FROM documents WHERE desk_id=$1 AND kind='invoice' AND number IS NOT NULL", [deskId]);
    const issuedCredits = await ctx.db.query("SELECT number FROM documents WHERE desk_id=$1 AND kind='creditNote' AND number IS NOT NULL", [deskId]);
    const maxIssued = (rows, prefix) => {
      let max = 0;
      for (const r of rows) {
        const m = new RegExp(`^${prefix}-\\d{4}-(\\d{4})$`).exec(String(r.number));
        if (m) max = Math.max(max, Number(m[1]));
      }
      return max;
    };
    const nextInvoice = `INV-${year}-${String(Math.max(maxIssued(issuedInvoices.rows, "INV"), Number(invoice.rows[0].last)) + 1).padStart(4, "0")}`;
    const nextCredit = `CN-${year}-${String(Math.max(maxIssued(issuedCredits.rows, "CN"), Number(credit.rows[0].last)) + 1).padStart(4, "0")}`;
    res.json({ documents: docs.rows.map(documentOut), nextInvoice, nextCreditNote: nextCredit });
  });
  app.post("/api/hires/:id/documents", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    const kind = typeof body.kind === "string" ? body.kind : "";
    if (!["quote", "confirmationLetter", "invoice", "creditNote", "seatPlan"].includes(kind)) {
      throw errors.invalid({ kind: "We can't find that." });
    }
    if ((kind === "invoice" || kind === "confirmationLetter" || kind === "creditNote") && hire.rows[0].stage === "quoted") {
      throw errors.state("noAcceptedQuote", "This hire has no accepted quote yet.");
    }
    const id = "DC-" + Math.random().toString(36).slice(2, 12).toUpperCase();
    const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
    const now = /* @__PURE__ */ new Date();
    await ctx.db.query(
      `INSERT INTO documents (id, desk_id, hire_id, kind, state, number, object_key, customer_name, created_at, history)
       VALUES ($1,$2,$3,$4,'waiting',NULL,NULL,$5,$6,$7)`,
      [id, deskId, hire.rows[0].id, kind, customer.rows[0] ? String(customer.rows[0].name) : "", now.toISOString(), JSON.stringify([{ at: isoInstant(now), who: "Arranger", what: "Issued" }])]
    );
    try {
      const html = await documentHtml(ctx, deskId, hire.rows[0], kind, id);
      await ctx.db.query("UPDATE documents SET state='rendering' WHERE id=$1", [id]);
      const pdf = await renderPdf(ctx.cfg, html);
      const key = objectKeyForDocument(deskId, id);
      await s3Put(ctx.cfg, key, pdf, "application/pdf");
      const number = await takeNumber(ctx, deskId, kind, now);
      await ctx.db.query("UPDATE documents SET state='stored', number=$2, object_key=$3, history = history || $4::jsonb WHERE id=$1", [
        id,
        number,
        key,
        JSON.stringify([{ at: isoInstant(/* @__PURE__ */ new Date()), who: "Arranger", what: "Stored" }])
      ]);
      const after = await ctx.db.query("SELECT * FROM documents WHERE id=$1", [id]);
      res.status(201).json(documentOut(after.rows[0]));
    } catch (e) {
      await ctx.db.query("DELETE FROM documents WHERE id=$1", [id]);
      throw e;
    }
  });
  app.get("/api/documents/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const doc = await ctx.db.query("SELECT * FROM documents WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!doc.rows[0]) throw errors.notFound();
    res.json(documentOut(doc.rows[0]));
  });
  app.get("/api/documents/:id/file", async (req, res) => {
    const deskId = requireAuth(req);
    const doc = await ctx.db.query("SELECT * FROM documents WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!doc.rows[0]) throw errors.notFound();
    if (String(doc.rows[0].state) !== "stored") throw errors.notFound();
    const bytes = await s3Get(ctx.cfg, String(doc.rows[0].object_key));
    if (!bytes) throw errors.provider("The file store is unavailable right now. Nothing was saved.");
    const limit = await fileRateLimited(ctx, deskId, /* @__PURE__ */ new Date(), "download");
    if (limit) throw errors.rateLimited(limit.seconds, limit.message);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  });
}
function documentOut(d) {
  return {
    id: String(d.id),
    kind: String(d.kind),
    hireId: String(d.hire_id),
    state: String(d.state),
    number: d.number ? String(d.number) : null,
    objectKey: d.object_key ? String(d.object_key) : null,
    customerName: d.customer_name ? String(d.customer_name) : null,
    createdAt: isoInstant(new Date(String(d.created_at))),
    history: d.history ?? []
  };
}
async function takeNumber(ctx, deskId, kind, now) {
  const prefix = kind === "invoice" ? "INV" : kind === "creditNote" ? "CN" : null;
  if (!prefix) return "";
  const year = Number(ukDateString(now).slice(0, 4));
  return tx(ctx.db, async (client) => {
    await client.query(
      "INSERT INTO document_numbers (desk_id, kind_prefix, year, last_number) VALUES ($1,$2,$3,0) ON CONFLICT (desk_id, kind_prefix, year) DO NOTHING",
      [deskId, prefix, year]
    );
    const r = await client.query(
      "UPDATE document_numbers SET last_number = last_number + 1 WHERE desk_id=$1 AND kind_prefix=$2 AND year=$3 RETURNING last_number AS next",
      [deskId, prefix, year]
    );
    return `${prefix}-${year}-${String(r.rows[0].next).padStart(4, "0")}`;
  });
}
async function documentHtml(ctx, deskId, hire, kind, id) {
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.customer_id]);
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [hire.reference]);
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hire.id]);
  const name = customer.rows[0] ? String(customer.rows[0].name) : "";
  const rows = vehicles.map((v) => `<tr><td>${v.seats} seats</td><td>${penniesToString(v.total)}</td><td>${penniesToString(v.deposit)}</td></tr>`).join("");
  let total = 0;
  for (const v of vehicles) total += v.total;
  let body = "";
  if (kind === "seatPlan") {
    const seatsHtml = vehicles.map((v) => {
      const grid = seatGridFor(v.seats);
      const seated = /* @__PURE__ */ new Map();
      for (const p of passengers.rows) if (p.vehicle_id === v.id && p.seat) seated.set(String(p.seat), String(p.name));
      return `<h3>${v.seats}-seat vehicle</h3><table>${grid.map((s) => `<tr><td>${s}</td><td>${seated.get(s) ?? ""}</td></tr>`).join("")}</table>`;
    }).join("");
    body = `<h2>Seat plan</h2>${seatsHtml}`;
  } else {
    body = `<h2>${kindLabel(kind)}</h2>
    <p>${escapeHtml(name)}</p>
    <p>Reference: ${escapeHtml(String(hire.reference))}</p>
    <p>Departure: ${escapeHtml(String(hire.depart_date))} ${escapeHtml(String(hire.depart_time))}</p>
    <p>Route:</p>
    <ul>${stops.rows.map((s) => `<li>${escapeHtml(String(s.text))}</li>`).join("")}</ul>
    <table><tr><th>Vehicle</th><th>Total</th><th>Deposit</th></tr>${rows}</table>
    <p>Total: ${penniesToString(total)}</p>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${kindLabel(kind)}</title>
  <style>
    @page { margin: 0; }
    body { font-family: 'Noto Sans', sans-serif; margin: 0; padding: 24px; }
    h1, h2, h3 { font-family: 'Noto Sans', sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #333; padding: 6px; text-align: left; }
  </style></head><body>
  <h1>Merrowfield Coach Hire</h1>
  ${body}
  </body></html>`;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var KIND_LABEL;
var init_documents = __esm({
  "src/server/api/documents.ts"() {
    "use strict";
    init_auth2();
    init_errors();
    init_http();
    init_services();
    init_s3();
    init_repo();
    init_domain();
    init_money();
    init_hours();
    init_uktime();
    init_documents_helpers();
    init_aftercare();
    KIND_LABEL = {
      quote: "Quote",
      confirmationLetter: "Confirmation letter",
      invoice: "Invoice",
      creditNote: "Credit note",
      seatPlan: "Seat plan"
    };
  }
});

// src/server/app.ts
var import_express2 = __toESM(require("express"), 1);
var import_pg = __toESM(require("pg"), 1);
var import_node_crypto6 = require("crypto");
var import_node_fs2 = require("fs");

// src/server/config.ts
function num(v, d) {
  if (v === void 0 || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function loadConfig() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3Endpoint: process.env.S3_ENDPOINT ?? "",
    s3Region: process.env.S3_REGION ?? "us-east-1",
    s3Bucket: process.env.S3_BUCKET ?? "",
    s3PathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    smtpHost: process.env.SMTP_HOST ?? "localhost",
    smtpPort: num(process.env.SMTP_PORT, 1025),
    mailFrom: process.env.MAIL_FROM ?? "desk@wayticket.example",
    wiremockUrl: process.env.WIREMOCK_URL ?? "",
    gotenbergUrl: process.env.GOTENBERG_URL ?? "",
    ntfyUrl: process.env.NTFY_URL ?? "",
    ntfyUsername: process.env.NTFY_USERNAME ?? "",
    ntfyPassword: process.env.NTFY_PASSWORD ?? "",
    appPublicPort: num(process.env.APP_PUBLIC_PORT, 4173),
    appPublicUrl: process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:4173`,
    publicDeskEmail: process.env.PUBLIC_DESK_EMAIL ?? "maria@merrowfield.example",
    enquiryRateWindowSeconds: num(process.env.ENQUIRY_RATE_WINDOW_SECONDS, 3600),
    bidWindowSeconds: num(process.env.BID_WINDOW_SECONDS, 172800),
    quoteValidSeconds: process.env.QUOTE_VALID_SECONDS ? num(process.env.QUOTE_VALID_SECONDS, 0) : null,
    fileRateWindowSeconds: num(process.env.FILE_RATE_WINDOW_SECONDS, 3600),
    closureWaitSeconds: num(process.env.CLOSURE_WAIT_SECONDS, 604800),
    holidayCacheSeconds: num(process.env.HOLIDAY_CACHE_SECONDS, 86400),
    dailyRunAt: process.env.DAILY_RUN_AT ?? "09:00",
    sessionSeconds: num(process.env.SESSION_SECONDS, 43200)
  };
}

// src/server/migrate.ts
async function applySchema(pool) {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto").catch(() => {
  });
  const schema = (await Promise.resolve().then(() => (init_schema(), schema_exports))).SCHEMA_SQL;
  await pool.query(schema);
}

// src/server/seed.ts
init_auth();
init_domain();
init_uktime();
init_rules();
var cfg = loadConfig();
var BOOT_INSTANT = /* @__PURE__ */ new Date();
var B = ukDateString(BOOT_INSTANT);
function nextClockChangeDate(from) {
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
  }
  return addDays(from, 180);
}
var C = nextClockChangeDate(B);
async function seedOnce(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const done = await client.query(
      "SELECT EXISTS (SELECT 1 FROM desks WHERE email_folded = $1) AS seeded",
      [foldEmail("maria@merrowfield.example")]
    );
    if (done.rows[0].seeded) {
      await client.query("COMMIT");
      return;
    }
    await seedAll(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function seedAll(db) {
  const { desks, customers } = await seedDesksAndCustomers(db);
  await seedRateTables(db);
  await seedOperators(db);
  await seedHires(db, desks, customers);
}
async function seedDesksAndCustomers(db) {
  const mariaId = await insertDesk(db, {
    name: "Merrowfield Coach Hire",
    email: "maria@merrowfield.example",
    password: "Merrowfield-Desk-2027",
    isPublic: true
  });
  await insertDesk(db, {
    name: "Zieli\u0144ski Hire",
    email: "tomasz@zielinski-hire.example",
    password: "Zielinski-Desk-2027",
    isPublic: false
  });
  const mariaCustomers = [
    ["CU-1001", "CHELMSLEYWOODANDKINGSHURSTUNITEDFEDERATIONOFPRIMARYSCHOOLSTRUSTS", "office@chelmsleywood-federation.example", "01632 960101", "en"],
    ["CU-1002", "Agnieszka Wi\u015Bniewska", "agnieszka@wisniewska.example", "01632 960102", "pl"],
    ["CU-1003", "\u0634\u0627\u0632\u06CC\u06C1 \u0645\u0644\u06A9", "shazia@malik.example", "01632 960103", "ur"],
    ["CU-1004", "Jack O'Rourke", "jack@orourke.example", "01632 960155", "en"],
    ["CU-1005", "Foleshill Tool Makers", "office@foleshill-tools.example", "01632 960105", "en"],
    ["CU-1006", "Stoke Aldermoor Bowls Club", "secretary@aldermoor-bowls.example", "01632 960106", "en"]
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
async function insertDesk(db, d) {
  const id = "DK-" + Math.abs(hashString(d.email)).toString(36).slice(0, 8).toUpperCase() + "-SEED";
  await db.query(
    `INSERT INTO desks (id, name, email, email_folded, password_hash, public) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, d.name, d.email, foldEmail(d.email), hashPassword(d.password), d.isPublic]
  );
  return id;
}
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
  return h;
}
async function deskIdByEmail(db, email) {
  const r = await db.query("SELECT id FROM desks WHERE email_folded = $1", [foldEmail(email)]);
  return r.rows[0].id;
}
async function seedRateTables(db) {
  for (const deskRow of (await db.query("SELECT id FROM desks")).rows) {
    await db.query(
      `INSERT INTO rate_tables (id, desk_id, effective_from, default_margin_percent, waiting_rate_pennies, second_driver_pennies, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
       VALUES ($1,$2,'2000-01-01','15',2000,15000,5000,10000,10000,15000)`,
      ["RT-DEFAULT-" + deskRow.id, deskRow.id]
    );
  }
}
async function seedOperators(db) {
  const mariaId = await deskIdByEmail(db, "maria@merrowfield.example");
  const rows = [
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
    ["OP-1024", "Hereford Cider Mill Travel", "Hereford", "desk@op-1024.example", "01632 960223", [56, 70]]
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
var STOPS = ["Coventry station, Coventry CV1 2GT", "NEC, Birmingham B40 1NT"];
async function seedHires(db, desks, customers) {
  const mariaId = await deskIdByEmail(db, "maria@merrowfield.example");
  const tomaszId = await deskIdByEmail(db, "tomasz@zielinski-hire.example");
  await seedTomaszEnquiry(db, tomaszId);
  const def = (await db.query("SELECT id FROM rate_tables WHERE desk_id=$1 AND effective_from='2000-01-01'", [mariaId])).rows[0].id;
  const sends = [
    { ref: "CV-7K2M4", customerId: "CU-1004", occasion: "company", state: "new", stage: "enquiry", depart: { date: addDays(B, 60), time: "08:00" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-D2Q5Y", customerId: "CU-1001", occasion: "school", state: "new", stage: "enquiry", depart: { date: addDays(B, 70), time: "09:00" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-3H9QR", customerId: "CU-1001", occasion: "school", state: "priced", stage: "enquiry", depart: { date: addDays(B, 45), time: "08:30" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [], openBids: [
      { operatorId: "OP-1001", price: "1006.30" },
      { operatorId: "OP-1002", price: "1040.00" }
    ] },
    { ref: "CV-8T4VX", customerId: "CU-1002", occasion: "weddings", state: "quoted", stage: "quoted", depart: { date: addDays(B, 50), time: "13:00" }, vehicles: [{ seats: 49, operatorId: "OP-1002", bought: 86957, margin: "15" }], people: 47, quoteSentAt: BOOT_INSTANT, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-5N6WZ", customerId: "CU-1003", occasion: "weddings", state: "quoted", stage: "quoted", depart: { date: addDays(B, 40), time: "12:00" }, vehicles: [{ seats: 8, operatorId: "OP-1003", bought: 52175, margin: "15" }], people: 8, quoteSentAt: new Date(BOOT_INSTANT.getTime() - 10 * 864e5), quoteMailed: true, payments: [], runs: [] },
    { ref: "CV-9D3JS", customerId: "CU-1006", occasion: "festivals", state: "lost", stage: "enquiry", depart: { date: addDays(B, 30), time: "10:00" }, vehicles: [], people: 47, quoteSentAt: null, quoteMailed: false, payments: [], runs: [] },
    { ref: "CV-2P7GB", customerId: "CU-1005", occasion: "company", state: "won", stage: "accepted", depart: { date: addDays(C, -1), time: "08:00" }, vehicles: [{ seats: 49, operatorId: "OP-1001", bought: 100630, margin: "15" }], people: 47, quoteSentAt: null, quoteMailed: true, payments: [], runs: [{ driver: ["Ewan Price", "01632 960301"], blocks: [["drive", 270], ["break", 45], ["drive", 120]] }] },
    { ref: "CV-A4F6C", customerId: "CU-1006", occasion: "festivals", state: "won", stage: "accepted", depart: { date: C, time: "08:00" }, vehicles: [{ seats: 12, operatorId: "OP-1004", bought: 65217, margin: "15" }], people: 12, quoteSentAt: null, quoteMailed: true, payments: [2500], runs: [{ driver: ["Marek Zaj\u0105c", "01632 960302"], blocks: [["drive", 271], ["break", 45], ["drive", 60]] }] },
    { ref: "CV-B8H3K", customerId: "CU-1001", occasion: "school", state: "won", stage: "accepted", depart: { date: addDays(C, 7), time: "09:15" }, vehicles: [{ seats: 49, operatorId: "OP-1005", bought: 86956, margin: "15" }], people: 47, quoteSentAt: null, quoteMailed: true, payments: [1e4], runs: [{ driver: ["Ewan Price", "01632 960301"], blocks: [["drive", 120]] }], seatsPlan: [
      { name: "Agnieszka Wi\u015Bniewska", group: "Adult", seat: "12A" },
      { name: "Jack O'Rourke", group: "Adult", seat: "3C" },
      { name: "Maja Kowalska", group: "Year 5", seat: "1A" },
      { name: "Ibrahim Malik", group: "Year 5", seat: "1B" },
      { name: "Tom Bennett", group: "Year 5", seat: "1C" }
    ] },
    { ref: "CV-C6M9T", customerId: "CU-1002", occasion: "weddings", state: "won", stage: "accepted", depart: { date: addDays(C, -8), time: "07:30" }, vehicles: [{ seats: 8, operatorId: "OP-1003", bought: 52175, margin: "15" }], people: 8, quoteSentAt: null, quoteMailed: true, payments: [5e3, 67001], runs: [{ driver: ["Marek Zaj\u0105c", "01632 960302"], blocks: [["drive", 120]] }] }
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
      const money2 = quoteVehicleMoney(v.bought, v.margin, v.seats, {
        minibus: 5e3,
        minibusHigher: 1e4,
        coach: 1e4,
        coachHigher: 15e3,
        minibusHigherAt: 75e3,
        coachHigherAt: 1e5
      });
      const vid = "VH-" + h.ref + "-" + position;
      await db.query(
        `INSERT INTO vehicles (id, desk_id, hire_id, seats, position, operator_id, bought_pennies, margin_percent, selling_pennies, vat_pennies, total_pennies, deposit_pennies, deposit_fixed, depart_date, depart_time, depart_instant)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13,$14,$15)`,
        [vid, mariaId, hireId, v.seats, position, v.operatorId, v.bought, v.margin, money2.selling, money2.vat, money2.total, money2.deposit, h.depart.date, h.depart.time, depart]
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
        const runId = "RN-" + String(1e3 + runNumber);
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
      const closesAt = new Date(Math.floor(askedAt.getTime() / 1e3) * 1e3 + cfg.bidWindowSeconds * 1e3);
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
          askedAt
        ]);
      }
    }
    if (h.quoteSentAt) {
      await db.query(`INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,1,$4)`, ["q" + tokenFor(h.ref), mariaId, hireId, h.quoteSentAt]);
    } else if (h.stage === "accepted") {
      const sentAt = new Date(BOOT_INSTANT.getTime() - 20 * 864e5);
      const endsAt2 = new Date(Math.floor(sentAt.getTime() / 1e3) * 1e3 + 5 * 864e5 - 1e3);
      await db.query(`UPDATE hires SET quote_sent_at=$1, quote_ends_at=$2, quote_path=$3 WHERE id=$4`, [
        sentAt,
        endsAt2,
        "q" + tokenFor(h.ref),
        hireId
      ]);
      await db.query(`INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,1,$4)`, ["q" + tokenFor(h.ref), mariaId, hireId, sentAt]);
    }
  }
  await seedInvoice(db, mariaId);
}
function tokenFor(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(0, 22);
}
function quoteEndFor(sentAt) {
  if (cfg.quoteValidSeconds) return new Date(Math.floor(sentAt.getTime() / 1e3) * 1e3 + cfg.quoteValidSeconds * 1e3 - 1e3);
  const d = ukDateString(sentAt);
  const endDay = addDays(d, 5);
  const r = ukToInstant(endDay, "23:59:59".slice(0, 5));
  return new Date(r.instant.getTime() + 59999);
}
async function savePlan(db, deskId, enquiryId, sizes) {
  const party = { people: 47, large: 0, medium: 0, hand: 0, wheelchairs: 0 };
  await db.query(
    `INSERT INTO plan_saves (desk_id, enquiry_id, sizes, suggested, larger_than_needed) VALUES ($1,$2,$3,$4,$5)`,
    [deskId, enquiryId, sizes, suggestPlan(party), false]
  );
}
async function recordPayment(db, deskId, hireId, vehicleId, pennies, at, kind) {
  const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  await db.query(
    `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
     ($1,$2,$3,$4,$10,$5,'clientMoney',$6,$7,'Statement'),($8,$2,$3,$4,$10,$5,'hireIncome',$9,$7,'Statement')`,
    [movementId + "-A", deskId, hireId, movementId, vehicleId, String(pennies), at.toISOString(), movementId + "-B", String(-pennies), kind]
  );
}
async function seedInvoice(db, deskId) {
  const year = Number(B.slice(0, 4));
  const hireId = "HR-CV-C6M9T";
  await db.query(
    `INSERT INTO documents (id, desk_id, hire_id, kind, state, number, object_key, customer_name, created_at, history)
     VALUES ($1,$2,$3,'invoice','waiting',NULL,NULL,'Agnieszka Wi\u015Bniewska',$4,$5)`,
    ["DC-SEED-INVOICE-1", deskId, hireId, BOOT_INSTANT.toISOString(), JSON.stringify([{ at: isoInstant(BOOT_INSTANT), who: "Maria Whitcombe", what: "Issued" }])]
  );
  await db.query(
    `INSERT INTO document_numbers (desk_id, kind_prefix, year, last_number) VALUES ($1,'INV',$2,0) ON CONFLICT DO NOTHING`,
    [deskId, year]
  );
}
async function seedTomaszEnquiry(db, deskId) {
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

// src/server/prepare.ts
async function prepareDatabase(pool) {
  await applySchema(pool);
  await seedOnce(pool);
}

// src/server/app.ts
init_auth2();
init_auth2();

// src/server/api/public.ts
init_errors();
init_http();

// src/server/search.ts
var PUBLIC_PAGES = [
  {
    path: "/",
    title: "Coaches and minibuses with a driver",
    headings: ["Arranged for you from Coventry", "One desk, one person, every detail checked", "Start your quote"],
    paras: [
      "Coaches and minibuses with a driver, arranged for you from Coventry by Merrowfield Coach Hire.",
      "We ask partner operators for their prices so you do not have to chase several companies yourself.",
      "Partner operators asked for you. Papers checked for your last day. Drivers' hours checked before you travel. One private page for your quote.",
      "School trips, weddings, company travel, festivals and sport: choose your occasion and the quote form opens with it already chosen.",
      "Start your quote and we will collect prices from operators who are clear to run your hire on its last day."
    ]
  },
  {
    path: "/occasions/school",
    title: "School trips",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "School trips by coach and minibus, from a morning at a museum to a week away.",
      "Every operator we ask holds an operator licence and public liability cover, and for a school hire we also check the driver's DBS date covers your last day.",
      "Tell us the pick-up and destination, the dates, the party size and any wheelchair users, and we will collect prices.",
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "How early should we ask? The earlier the better, and we can often help at short notice.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side."
    ]
  },
  {
    path: "/occasions/weddings",
    title: "Weddings",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "Weddings and the guests around them: one minibus for the close family or coaches for the whole day.",
      "We check every operator's papers so the vehicles are properly covered on your last day.",
      "Tell us the pick-up, the ceremony and the reception, the times and the party size.",
      "A deposit holds the seats and the balance is due in the week before the day.",
      "How early should we ask? Popular Saturdays go early, so ask as soon as the venue is fixed.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side."
    ]
  },
  {
    path: "/occasions/company",
    title: "Company travel",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "Company travel: shuttles between sites, a day at a conference, or the Christmas party run.",
      "One desk collects the prices and one invoice follows, with a credit note if a run changes.",
      "Tell us the route, the dates and the numbers, and we will collect prices from clear operators.",
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "How early should we ask? Ask as soon as the dates are fixed and we will do the rest.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side."
    ]
  },
  {
    path: "/occasions/festivals",
    title: "Festivals and sport",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "Festivals and sport: the coach that waits, or the minibuses that shuttle all weekend.",
      "Waiting time and comfort stops are worked out per stop and shown before you accept them.",
      "Tell us the pick-up, the ground, the times and the party size.",
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "How early should we ask? Festival weekends fill early, so ask as soon as you know the date.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side."
    ]
  },
  {
    path: "/fleet",
    title: "Our fleet",
    headings: ["Our fleet"],
    paras: [
      "Our fleet of seven sizes, from an 8-seat minibus to a 70-seat coach.",
      "The 8-seat minibus takes 8 people and 16 bag units. The 12-seat minibus takes 12 people and 24 bag units. The 16-seat minibus takes 16 people and 32 bag units.",
      "The 31-seat coach takes 31 people and 62 bag units. The 49-seat coach takes 49 people and 98 bag units. The 56-seat coach takes 56 people and 112 bag units. The 70-seat coach takes 70 people and 140 bag units.",
      "The 16-seat and 49-seat vehicles carry a lift, each taking two wheelchair users."
    ]
  },
  {
    path: "/terms",
    title: "Terms",
    headings: ["Terms"],
    paras: [
      "Terms of hire. These terms set out what Merrowfield Coach Hire arranges and what you agree to.",
      "We arrange coaches and minibuses operated by partner operators. We are not the operator and we own no vehicles.",
      "A quote is valid for five days from the day it is sent. A deposit holds the seats. The balance is due seven days before departure.",
      "A cancellation by you is charged by the calendar days between your written notice and the departure: thirty days or more takes the deposit only, fifteen to twenty-nine days takes a quarter, eight to fourteen days takes half, and seven days or fewer takes the whole amount.",
      "Complaints are answered within three working days in England and Wales. Found property is held for one calendar month."
    ]
  }
];
function searchPublicPages(q) {
  const needle = q.trim().toLowerCase();
  if (needle === "") return [];
  const hits = [];
  for (const p of PUBLIC_PAGES) {
    const blocks = [p.title, ...p.headings, ...p.paras];
    let found = false;
    let excerpt = "";
    for (const b of blocks) {
      const low = b.toLowerCase();
      const idx = low.indexOf(needle);
      if (idx !== -1) {
        found = true;
        excerpt = b;
        break;
      }
    }
    if (found) {
      hits.push({ title: p.title, path: p.path, excerpt });
      continue;
    }
    const words = needle.split(/\s+/).filter(Boolean);
    if (words.length && blocks.some((b) => words.every((w) => b.toLowerCase().includes(w)))) {
      hits.push({ title: p.title, path: p.path, excerpt: p.paras[0] });
    }
  }
  return hits;
}

// src/server/api/public.ts
init_services();

// src/server/csv.ts
function formatUkPostcode(raw) {
  const t = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  if (!t) return null;
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(t);
  if (!m) return raw || null;
  return `${m[1]} ${m[2]}`;
}
function csvEscape(value) {
  const v = value === null || value === void 0 ? "" : String(value);
  const needs = /[",\r\n;]/.test(v);
  const body = v.replace(/^-/, "-");
  return needs ? '"' + v.replace(/"/g, '""') + '"' : body;
}
function csvCell(value) {
  const v = value === null || value === void 0 ? "" : String(value);
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return csvEscape(v);
}
function splitCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}
function parseCsv(text, expectedHeader) {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r\n|\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return null;
  const first = lines[0];
  const delim = [";", ","].find((d) => splitCsvLine(first, d).length >= 2) ?? ",";
  const header = splitCsvLine(first, delim).map((h) => h.trim().toLowerCase());
  const want = expectedHeader.map((h) => h.toLowerCase());
  const sameSet = header.length === want.length && want.every((h) => header.includes(h)) && header.every((h) => want.includes(h));
  if (!sameSet) return null;
  const rows = [];
  const rowNumbers = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === "") continue;
    const cells = splitCsvLine(raw, delim);
    while (cells.length < header.length) cells.push("");
    rows.push(cells);
    rowNumbers.push(i + 1);
  }
  return { header, rows, rowNumbers, delimiter: delim };
}
function csvBody(header, rows) {
  const h = header.map((x) => csvEscape(x)).join(",");
  const b = rows.map((r) => r.map((c) => csvCell(c)).join(",")).join("\r\n");
  const body = rows.length ? h + "\r\n" + b : h;
  return "\uFEFF" + body + "\r\n";
}
function fileHeaders(baseName, ext) {
  const asciiFallback = baseName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const full = `${baseName}.${ext}`;
  const ascii = `${asciiFallback}.${ext}`;
  const hdr = `attachment; filename="${ascii.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(full)}`;
  return { "Content-Disposition": hdr };
}

// src/server/api/public.ts
init_validation();

// src/server/api/enquiry-create.ts
init_errors();
init_validation();
init_domain();
init_uktime();
init_repo();
var MISSING = "Choose an hour and minutes.";
function fieldErrors(fields) {
  throw errors.invalid(fields);
}
function validateEnquiry(input) {
  const f = {};
  if (!validOccasion(input.occasion)) f.occasion = "Choose an occasion.";
  if (!validJourneyType(input.journeyType)) f.journeyType = "Choose a journey type.";
  const stops = [];
  if (Array.isArray(input.stops)) {
    let i = 0;
    for (const s of input.stops) {
      if (!s || typeof s !== "object" || typeof s.text !== "string" || s.text.trim() === "") {
        f.stops = i === 0 ? "Enter the pick-up address." : "Enter the destination.";
        break;
      }
      const o = s;
      stops.push({ text: String(o.text).trim(), checked: o.checked === true });
      i++;
    }
  }
  if (stops.length < 2) f.stops = stops.length === 0 ? "Enter the pick-up address." : "Enter the destination.";
  if (stops.length > 7) f.stops = "Enter between 2 and 7 stops.";
  if (!input.name) f.name = "Enter your name.";
  if (!validEmail(input.email)) f.email = "Enter a real email address.";
  if (!validTelephone(input.telephone)) f.telephone = "Enter a UK telephone number.";
  if (input.journeyType === "severalStops" && (input.details === null || input.details.trim() === "")) {
    f.details = "Describe the stops in up to 2,000 characters.";
  }
  if (input.details !== null && input.details.length > 2e3) f.details = "Describe the stops in up to 2,000 characters.";
  const needsReturn = input.journeyType === "return" || input.journeyType === "sameDayReturn";
  let departAt = null;
  let returnAt = null;
  if (!input.depart || typeof input.depart !== "object") {
    f.departAt = "Enter a date as DD/MM/YYYY.";
  } else {
    const o = input.depart;
    if (typeof o.time === "string" && !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(o.time)) {
      throw errors.invalid({ departAt: MISSING });
    }
    try {
      const parsed = parseLocalDate(o, "departAt");
      departAt = parsed;
      if (needsReturn) {
        if (input.journeyType === "sameDayReturn") {
          returnAt = parsed;
        } else if (input.return && typeof input.return === "object") {
          const ro = input.return;
          if (typeof ro.time === "string" && !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(ro.time)) {
            throw errors.invalid({ returnAt: MISSING });
          }
          returnAt = parseLocalDate(ro, "returnAt");
        } else {
          f.returnAt = "Enter a date as DD/MM/YYYY.";
        }
      }
      if (returnAt && returnAt.instant.getTime() <= departAt.instant.getTime()) {
        f.returnAt = "The return has to be after the pick-up.";
      }
    } catch (e) {
      if (e && typeof e === "object" && "status" in e) throw e;
      f.departAt = f.departAt ?? "Enter a date as DD/MM/YYYY.";
    }
  }
  if (Object.keys(f).length) fieldErrors(f);
  const now = serverNowMinute();
  const today = ukDateString(now);
  const dep = departAt;
  if (dep.date < today) {
    throw errors.invalid({ departAt: "That date has passed. Choose today or a later date." });
  }
  if (dep.date === today) {
    const nowMins = nowUKMinutes();
    const pickMins = Number(dep.time.slice(0, 2)) * 60 + Number(dep.time.slice(3, 5));
    if (pickMins < nowMins) throw errors.invalid({ departAt: "No more pick-ups today." });
    if (pickMins - nowMins < 30) throw errors.invalid({ departAt: "We need at least 30 minutes' notice for a pick-up." });
  }
  return {
    occasion: input.occasion,
    journeyType: input.journeyType,
    stops,
    departAt: dep,
    returnAt,
    name: input.name,
    email: input.email,
    telephone: input.telephone,
    language: input.language,
    details: input.details
  };
}
function nowUKMinutes() {
  const now = serverNowMinute();
  const o = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return Number(o.slice(0, 2)) * 60 + Number(o.slice(3, 5));
}
async function createEnquiryFromRequest(ctx, deskId, input, publicRoute) {
  if (input.isTrap) {
    return { reference: "CV-" + trapReference(), receivedAt: /* @__PURE__ */ new Date(), stored: false };
  }
  const v = validateEnquiry(input);
  if (publicRoute) {
    await checkRateLimit(ctx, deskId, v.email);
  }
  const reference = await newReference(ctx.db, deskId);
  const customerId = await findOrCreateCustomer(ctx, deskId, v.name, v.email, v.telephone, v.language);
  await tx(ctx.db, async (client) => {
    await client.query(
      `INSERT INTO enquiries (id, desk_id, customer_id, reference, occasion, state, journey_type, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, details, people, large, medium, hand, wheelchairs, name, email, telephone, language, submitted_body, created_at, merged_references)
       VALUES ($1,$2,$3,$4,$5,'new',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'{}')`,
      [
        reference,
        deskId,
        customerId,
        reference,
        v.occasion,
        v.journeyType,
        v.departAt.date,
        v.departAt.time,
        v.departAt.instant,
        v.returnAt?.date ?? null,
        v.returnAt?.time ?? null,
        v.returnAt?.instant ?? null,
        v.details,
        input.party.people,
        input.party.large,
        input.party.medium,
        input.party.hand,
        input.party.wheelchairs,
        v.name,
        v.email,
        v.telephone,
        v.language,
        JSON.stringify(input.raw),
        /* @__PURE__ */ new Date()
      ]
    );
    let position = 0;
    for (const s of v.stops) {
      await client.query("INSERT INTO enquiry_stops (id, enquiry_id, desk_id, position, text, checked) VALUES ($1,$2,$3,$4,$5,$6)", [
        "ST-" + reference + "-" + position,
        reference,
        deskId,
        position,
        s.text,
        s.checked
      ]);
      position++;
    }
    if (publicRoute) {
      await client.query("INSERT INTO enquiry_rate_limit (desk_id, email_folded, created_at) VALUES ($1,$2,NOW())", [deskId, foldEmail(v.email)]);
    }
  });
  return { reference, receivedAt: /* @__PURE__ */ new Date(), stored: true };
}
function trapReference() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
async function checkRateLimit(ctx, deskId, email) {
  const folded = foldEmail(email);
  const windowSeconds = ctx.cfg.enquiryRateWindowSeconds;
  const r = await ctx.db.query(
    "SELECT created_at FROM enquiry_rate_limit WHERE desk_id=$1 AND email_folded=$2 AND created_at > NOW() - ($3 || ' seconds')::interval ORDER BY created_at",
    [deskId, folded, String(windowSeconds)]
  );
  if (r.rows.length >= 5) {
    const oldest = r.rows[0].created_at;
    const retryAt = new Date(oldest.getTime() + windowSeconds * 1e3);
    const o = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(retryAt);
    const minutes = Math.ceil((retryAt.getTime() - Date.now()) / 1e3);
    throw errors.rateLimited(Math.max(1, minutes), `Try again after ${o}.`);
  }
}
async function findOrCreateCustomer(ctx, deskId, name, email, telephone, language) {
  const existing = await ctx.db.query(
    "SELECT id FROM customers WHERE desk_id=$1 AND ((email_folded IS NOT NULL AND email_folded=$2) OR (telephone_folded IS NOT NULL AND telephone_folded=$3)) LIMIT 1",
    [deskId, foldEmail(email), foldTelephone(telephone)]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = "CU-" + Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  await ctx.db.query(
    "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
    [id, deskId, name, email, telephone, language, foldEmail(email), foldTelephone(telephone)]
  );
  return id;
}

// src/server/api/public.ts
init_domain();
init_auth2();
function registerPublicApi(app, ctx) {
  app.get("/api/public/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.trim() === "") throw errors.invalid({ q: "Nothing found for that search." }, "Nothing found for that search.");
    if (q.length > 200) throw errors.invalid({ q: "Search text can be up to 200 characters." });
    const results = searchPublicPages(q);
    res.json({ results });
  });
  app.get("/api/public/address/find", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.length < 3) throw errors.invalid({ q: "Enter at least 3 characters." });
    const r = await wireGet(ctx.cfg, `/v1/find?q=${encodeURIComponent(q)}`);
    if (!r) throw errors.provider("We could not check this address. You can carry on and type it in full.");
    res.json({ suggestions: (r.suggestions ?? []).slice(0, 6) });
  });
  app.get("/api/public/address/get/:id", async (req, res) => {
    const r = await wireGet(ctx.cfg, `/v1/get/${encodeURIComponent(req.params.id)}`);
    if (!r) throw errors.provider("We could not check this address. You can carry on and type it in full.");
    const line1 = String(r.line1 ?? "");
    const town = String(r.town ?? "");
    const postcode = formatUkPostcode(String(r.postcode ?? "")) ?? "";
    res.json({ id: req.params.id, line1, town, postcode, text: `${line1}, ${town} ${postcode}`.trim() });
  });
  app.post("/api/public/enquiries", async (req, res) => {
    const input = await enquiryInput(req);
    const desk = await ctx.db.query("SELECT id FROM desks WHERE email_folded=$1", [foldEmail(ctx.cfg.publicDeskEmail)]);
    const deskId = desk.rows[0]?.id;
    if (!deskId) throw errors.provider("We can't find that.");
    const created = await createEnquiryFromRequest(ctx, deskId, input, true);
    res.status(201).json({ reference: created.reference, receivedAt: isoInstant(created.receivedAt) });
  });
  app.post("/api/enquiries", async (req, res) => {
    const deskId = requireAuth(req);
    const input = await enquiryInput(req);
    const created = await createEnquiryFromRequest(ctx, deskId, input, false);
    res.status(201).json({ reference: created.reference, receivedAt: isoInstant(created.receivedAt) });
  });
}
async function enquiryInput(req) {
  const raw = await readJson(req);
  const website = typeof raw.website === "string" ? raw.website : "";
  const depart = raw.departAt ?? null;
  const ret = raw.returnAt ?? null;
  return {
    raw,
    website,
    occasion: raw.occasion,
    journeyType: raw.journeyType,
    stops: Array.isArray(raw.stops) ? raw.stops : [],
    party: parseParty(raw.party ?? {}),
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    email: typeof raw.email === "string" ? raw.email.trim() : "",
    telephone: typeof raw.telephone === "string" ? raw.telephone.trim() : "",
    language: raw.language === "pl" || raw.language === "ur" ? raw.language : "en",
    details: typeof raw.details === "string" ? raw.details : null,
    depart,
    return: ret,
    isTrap: website.trim().length > 0
  };
}

// src/server/api/customers.ts
init_auth2();
init_errors();
init_http();
init_domain();
init_repo();
init_uktime();
function registerCustomerApi(app, ctx) {
  app.get("/api/customers", async (req, res) => {
    const deskId = requireAuth(req);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const state = typeof req.query.state === "string" ? req.query.state : "active";
    const params = [deskId];
    let where = "desk_id=$1 AND state=$2";
    params.push(state);
    if (q.length > 200) throw errors.invalid({ q: "Search text can be up to 200 characters." });
    if (q) {
      where += " AND (LOWER(name) LIKE $3 OR LOWER(COALESCE(email,'')) LIKE $3)";
      params.push("%" + q.toLowerCase() + "%");
    }
    const r = await ctx.db.query(`SELECT * FROM customers WHERE ${where} ORDER BY name LIMIT 200`, params);
    res.json({ customers: r.rows.map(customerOut) });
  });
  app.post("/api/customers", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const telephone = typeof body.telephone === "string" ? body.telephone.trim() : "";
    const language = body.language === "pl" || body.language === "ur" ? body.language : "en";
    const f = {};
    if (!name) f.name = "Enter your name.";
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) f.email = "Enter a real email address.";
    if (telephone && telephone.replace(/\D/g, "").length < 10) f.telephone = "Enter a UK telephone number.";
    if (Object.keys(f).length) throw errors.invalid(f);
    const id = "CU-" + Date.now().toString(36).toUpperCase();
    await ctx.db.query(
      "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
      [id, deskId, name, email || null, telephone || null, language, email ? foldEmail(email) : null, telephone ? foldTelephone(telephone) : null]
    );
    res.status(201).json(customerOut({ id, name, email, telephone, language, state: "active" }));
  });
  app.get("/api/customers/review", async (req, res) => {
    const deskId = requireAuth(req);
    const r = await ctx.db.query("SELECT row_number AS row, message FROM sheet_review WHERE desk_id=$1 ORDER BY created_at DESC LIMIT 100", [deskId]);
    res.json({ reviewList: r.rows.map((x) => ({ row: Number(x.row), message: String(x.message) })) });
  });
  app.get("/api/customers/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!r.rows[0] || r.rows[0].state === "erased") throw errors.notFound();
    res.json(customerOut(r.rows[0]));
  });
  app.patch("/api/customers/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw errors.invalid({ name: "Enter your name." });
    const r = await ctx.db.query("UPDATE customers SET name=$3 WHERE desk_id=$1 AND id=$2 RETURNING *", [deskId, req.params.id, name]);
    if (!r.rows[0]) throw errors.notFound();
    res.json(customerOut(r.rows[0]));
  });
  app.delete("/api/customers/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const id = req.params.id;
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, id]);
    if (!r.rows[0]) throw errors.notFound();
    const hire = await ctx.db.query("SELECT 1 FROM hires WHERE desk_id=$1 AND customer_id=$2", [deskId, id]);
    if (hire.rows.length) throw errors.state("customerHasHire", "This customer has a hire, so it can't be removed.");
    await ctx.db.query("DELETE FROM customers WHERE desk_id=$1 AND id=$2", [deskId, id]);
    res.status(204).end();
  });
  app.post("/api/customers/:id/close", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!r.rows[0]) throw errors.notFound();
    if (r.rows[0].state !== "active") throw errors.state("alreadyClosed", "Customer closed.");
    const waitSeconds = ctx.cfg.closureWaitSeconds;
    await ctx.db.query("UPDATE customers SET state='closed', closed_at=NOW(), erase_at=NOW() + ($1 || ' seconds')::interval WHERE desk_id=$2 AND id=$3", [
      String(waitSeconds),
      deskId,
      req.params.id
    ]);
    const after = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    res.json(customerOut(after.rows[0]));
  });
  app.post("/api/customers/:id/bring-back", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!r.rows[0]) throw errors.notFound();
    if (r.rows[0].state === "active") throw errors.state("alreadyActive", "Customer brought back.");
    if (r.rows[0].state !== "closed") throw errors.state("waitOver", "The wait is over. This customer can't be brought back.");
    await ctx.db.query("UPDATE customers SET state='active', closed_at=NULL, erase_at=NULL WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    const after = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    res.json(customerOut(after.rows[0]));
  });
  app.post("/api/customers/import", async (req, res) => {
    const deskId = requireAuth(req);
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "text/csv") throw errors.unsupportedType();
    const text = await readText(req, 2e6);
    const parsed = parseCsv(text, ["Name", "Email", "Telephone", "Notes"]);
    if (!parsed) throw errors.invalid({ file: "The first line has to read Name,Email,Telephone,Notes." }, "The first line has to read Name,Email,Telephone,Notes.");
    let added = 0;
    let filled = 0;
    const reviewList = [];
    await tx(ctx.db, async (client) => {
      for (let i = 0; i < parsed.rows.length; i++) {
        const cells = parsed.rows[i];
        const name = (cells[0] ?? "").trim();
        const email = (cells[1] ?? "").trim();
        const telephone = (cells[2] ?? "").trim();
        const notes = (cells[3] ?? "").trim();
        if (!name && !email && !telephone) continue;
        const matches = await client.query(
          "SELECT * FROM customers WHERE desk_id=$1 AND ((email_folded IS NOT NULL AND email_folded=$2) OR (telephone_folded IS NOT NULL AND telephone_folded=$3)) AND state<>'erased'",
          [deskId, email ? foldEmail(email) : "", telephone ? foldTelephone(telephone) : ""]
        );
        if (matches.rows.length === 0) {
          const id = "CU-" + Date.now().toString(36).toUpperCase() + i;
          await client.query(
            "INSERT INTO customers (id, desk_id, name, email, telephone, notes, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
            [id, deskId, name, email || null, telephone || null, notes || null, email ? foldEmail(email) : null, telephone ? foldTelephone(telephone) : null]
          );
          added++;
        } else if (matches.rows.length === 1) {
          const row = matches.rows[0];
          const updates = [];
          const params = [];
          if (!row.email && email) {
            updates.push("email=$" + (params.push(email) + 2));
            updates.push("email_folded=$" + (params.push(foldEmail(email)) + 1));
          }
          if (!row.telephone && telephone) {
            updates.push("telephone=$" + (params.push(telephone) + 2));
            updates.push("telephone_folded=$" + (params.push(foldTelephone(telephone)) + 1));
          }
          if (updates.length) {
            await client.query(`UPDATE customers SET ${updates.join(", ")} WHERE id=$1`, [row.id, ...params]);
            filled++;
          }
        } else {
          reviewList.push({ row: parsed.rowNumbers[i], message: "Matches two customers" });
          await client.query("INSERT INTO sheet_review (desk_id, row_number, message) VALUES ($1,$2,'Matches two customers') ON CONFLICT DO NOTHING", [
            deskId,
            parsed.rowNumbers[i]
          ]);
        }
      }
    });
    res.json({ added, filled, reviewList });
  });
}
function customerOut(r) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    email: r.email ?? null,
    telephone: r.telephone ?? null,
    language: String(r.language ?? "en"),
    notes: r.notes ?? null,
    state: String(r.state ?? "active"),
    closedAt: r.closed_at ? r.closed_at.toISOString().replace(/\.\d{3}Z$/, "Z") : null,
    eraseAt: r.erase_at ? r.erase_at.toISOString().replace(/\.\d{3}Z$/, "Z") : null
  };
}

// src/server/api/enquiries.ts
init_auth2();
init_errors();
init_http();
init_repo();
init_domain();
init_domain();
function registerEnquiryApi(app, ctx) {
  app.get("/api/enquiries", async (req, res) => {
    const deskId = requireAuth(req);
    const state = typeof req.query.state === "string" && req.query.state ? req.query.state : "";
    const occasion = typeof req.query.occasion === "string" && req.query.occasion ? req.query.occasion : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const after = typeof req.query.after === "string" ? req.query.after : "";
    const before = typeof req.query.before === "string" ? req.query.before : "";
    if (q.length > 200) throw errors.invalid({ q: "Search text can be up to 200 characters." });
    if (state && !["new", "priced", "quoted", "won", "lost"].includes(state)) throw errors.invalid({ state: "We can't find that." });
    const params = [deskId];
    let where = "e.desk_id=$1";
    if (state) {
      params.push(state);
      where += ` AND e.state=$${params.length}`;
    }
    if (occasion) {
      params.push(occasion);
      where += ` AND e.occasion=$${params.length}`;
    }
    if (q) {
      params.push("%" + q.toLowerCase() + "%");
      where += ` AND (LOWER(e.reference) LIKE $${params.length} OR LOWER(COALESCE(c.name,'')) LIKE $${params.length} OR LOWER(COALESCE(e.email,'')) LIKE $${params.length})`;
    }
    const orderBy = "ORDER BY e.created_at DESC, e.reference DESC";
    let cursorWhere = "";
    if (after) {
      const [aAt, aRef] = decodeCursor(after);
      params.push(new Date(aAt), aRef);
      cursorWhere += ` AND (e.created_at, e.reference) < ($${params.length - 1}, $${params.length})`;
    }
    if (before) {
      const [bAt, bRef] = decodeCursor(before);
      params.push(new Date(bAt), bRef);
      cursorWhere += ` AND (e.created_at, e.reference) > ($${params.length - 1}, $${params.length})`;
    }
    const r = await ctx.db.query(
      `SELECT e.*, c.name AS customer_name FROM enquiries e LEFT JOIN customers c ON c.id=e.customer_id AND c.desk_id=e.desk_id
       WHERE ${where}${cursorWhere} ${orderBy} LIMIT 26`,
      params
    );
    const rows = r.rows.map((x) => ({ ...x, reference: String(x.reference) }));
    const page = rows.slice(0, 25).map(enquiryListOut);
    let nextCursor = null;
    let prevCursor = null;
    if (rows.length === 26) {
      const last = rows[24];
      nextCursor = encodeCursor(String(last.created_at.toISOString()), String(last.reference));
    }
    if (after) {
      const first = rows[0];
      if (first) prevCursor = encodeCursor(String(first.created_at.toISOString()), String(first.reference));
    }
    res.json({ enquiries: page, nextCursor, prevCursor });
  });
  app.get("/api/enquiries/merge", (_req, res) => {
    res.json({ enquiries: [] });
  });
  app.get("/api/enquiries/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const stops = await stopsForEnquiry(ctx.db, e.id);
    const customer = e.customerId ? await ctx.db.query("SELECT name, email, telephone, language FROM customers WHERE desk_id=$1 AND id=$2", [deskId, e.customerId]) : null;
    res.json({
      id: e.id,
      reference: e.reference,
      customerName: customer?.rows[0]?.name ?? e.name ?? "",
      occasion: e.occasion,
      state: e.state,
      journeyType: e.journeyType,
      stops,
      departAt: { date: e.departDate, time: e.departTime },
      departInstant: isoInstant(e.departInstant),
      returnAt: e.returnDate && e.returnTime ? { date: e.returnDate, time: e.returnTime } : null,
      returnInstant: e.returnInstant ? isoInstant(e.returnInstant) : null,
      party: { people: e.people, large: e.large, medium: e.medium, hand: e.hand, wheelchairs: e.wheelchairs },
      details: e.details,
      email: e.email ?? customer?.rows[0]?.email ?? null,
      telephone: e.telephone ?? customer?.rows[0]?.telephone ?? null,
      language: e.language,
      submittedBody: e.submittedBody,
      mergedReferences: e.mergedReferences,
      duplicates: e.duplicates,
      createdAt: isoInstant(e.createdAt)
    });
  });
  app.patch("/api/enquiries/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = await readJson(req);
    const state = typeof body.state === "string" ? body.state : "";
    if (!["new", "priced", "quoted", "won", "lost"].includes(state)) throw errors.invalid({ state: "We can't find that." });
    if (state === e.state) {
      res.json(enquiryListOutFrom(e));
      return;
    }
    const legal = {
      new: ["priced", "lost"],
      priced: ["new", "quoted", "lost"],
      quoted: ["priced", "won", "lost"],
      won: ["lost"],
      lost: ["new"]
    };
    if (!(legal[e.state] ?? []).includes(state)) {
      throw errors.state("illegalChange", "That did not save. Try again.");
    }
    await ctx.db.query("UPDATE enquiries SET state=$1 WHERE desk_id=$2 AND id=$3", [state, deskId, e.id]);
    const hire = await ctx.db.query("SELECT id FROM hires WHERE desk_id=$1 AND reference=$2", [deskId, e.reference]);
    if (hire.rows[0]) await ctx.db.query("UPDATE hires SET enquiry_state=$1 WHERE desk_id=$2 AND reference=$3", [state, deskId, e.reference]);
    const after = await enquiryById(ctx.db, deskId, e.id);
    res.json(enquiryListOutFrom(after ?? e));
  });
  app.post("/api/enquiries/merge", async (req, res) => {
    const deskId = requireAuth(req);
    const body = await readJson(req);
    const ids = Array.isArray(body.enquiryIds) ? body.enquiryIds.map(String) : [];
    if (ids.length !== 2) throw errors.invalid({ enquiryIds: "We can't find that." });
    const a = await enquiryById(ctx.db, deskId, ids[0]);
    const b = await enquiryById(ctx.db, deskId, ids[1]);
    if (!a || !b || a.id === b.id) throw errors.notFound();
    const sameEmail = !!a.email && foldEmail(a.email) === foldEmail(b.email ?? "");
    const sameTel = !!a.telephone && foldTelephone(a.telephone) === foldTelephone(b.telephone ?? "");
    if (!sameEmail && !sameTel) throw errors.state("notDuplicates", "We can't find that.");
    const earlier = a.createdAt <= b.createdAt ? a : b;
    const later = a.createdAt <= b.createdAt ? b : a;
    await ctx.db.query(
      "UPDATE enquiries SET merged_references = array_append(merged_references, $1) WHERE desk_id=$2 AND id=$3",
      [later.reference, deskId, earlier.id]
    );
    await ctx.db.query("DELETE FROM enquiry_stops WHERE enquiry_id=$1", [later.id]);
    await ctx.db.query("DELETE FROM enquiries WHERE desk_id=$1 AND id=$2", [deskId, later.id]);
    res.json({ kept: earlier.reference, merged: [later.reference] });
  });
}
function enquiryListOut(r) {
  return {
    id: String(r.id),
    reference: String(r.reference),
    customerName: String(r.customer_name ?? r.name ?? ""),
    occasion: String(r.occasion),
    state: String(r.state),
    departAt: { date: isoDate(r.depart_date), time: String(r.depart_time) },
    departInstant: isoInstant(r.depart_instant),
    createdAt: isoInstant(r.created_at)
  };
}
function enquiryListOutFrom(e) {
  return {
    id: e.id,
    reference: e.reference,
    customerName: e.name ?? "",
    occasion: e.occasion,
    state: e.state,
    departAt: { date: e.departDate, time: e.departTime },
    departInstant: isoInstant(e.departInstant),
    createdAt: isoInstant(e.createdAt)
  };
}
function encodeCursor(at, reference) {
  return Buffer.from(`${at}|${reference}`).toString("base64url");
}
function decodeCursor(cursor) {
  const parts2 = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts2.length !== 2) throw errors.invalid({ cursor: "We can't find that." });
  return [parts2[0], parts2[1]];
}

// src/server/api/trip.ts
init_auth2();
init_errors();
init_http();
init_repo();
init_services();
init_rules();
init_trip_helpers();
function registerTripApi(app, ctx) {
  app.get("/api/enquiries/:id/trip", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    await ensureLegs(ctx, deskId, e);
    res.json(await tripAnswer(ctx, deskId, e));
  });
  app.put("/api/enquiries/:id/trip/stops", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = await readJson(req);
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    const stops = await stopsForEnquiry(ctx.db, e.id);
    if (order.length !== stops.length || new Set(order).size !== order.length) throw errors.invalid({ order: "We can't find that." });
    for (const id of order) if (!stops.some((s) => s.id === id)) throw errors.invalid({ order: "We can't find that." });
    for (let i = 0; i < order.length; i++) {
      await ctx.db.query("UPDATE enquiry_stops SET position=$1 WHERE enquiry_id=$2 AND id=$3", [i, e.id, order[i]]);
    }
    const route = await routeCall(ctx, deskId, e, order);
    if (!route) throw errors.provider("Route not updated. Showing the last good route.");
    await writeLegs(ctx, deskId, e.id, route);
    res.json(await tripAnswer(ctx, deskId, e, true));
  });
  app.post("/api/enquiries/:id/trip/route", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const stops = await stopsForEnquiry(ctx.db, e.id);
    const route = await routeCall(ctx, deskId, e, stops.map((s) => s.id));
    if (!route) throw errors.provider("Route not updated. Showing the last good route.");
    await writeLegs(ctx, deskId, e.id, route);
    res.json(await tripAnswer(ctx, deskId, e, true));
  });
  app.put("/api/enquiries/:id/trip/plan", async (req, res) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = await readJson(req);
    const sizes = Array.isArray(body.sizes) ? body.sizes.map(Number) : [];
    const party = partyFromEnquiry(e);
    const check = checkPlan(sizes, party);
    if (!check.ok) {
      let message = "We can't find that.";
      if (check.badSize) {
        message = "Choose sizes from 8, 12, 16, 31, 49, 56 and 70.";
      } else if (check.seatsShort !== void 0) {
        message = check.seatsShort === 1 ? "This plan leaves 1 person without a seat." : `This plan leaves ${check.seatsShort} people without a seat.`;
      } else if (check.bagsShort !== void 0) {
        message = check.bagsShort === 1 ? "Bags need 1 more unit of space." : `Bags need ${check.bagsShort} more units of space.`;
      } else if (check.wheelchairsShort !== void 0) {
        message = check.wheelchairsShort === 1 ? "This plan has no lift for 1 wheelchair user." : `This plan has no lift for ${check.wheelchairsShort} wheelchair users.`;
      }
      throw errors.invalid({ sizes: message }, message);
    }
    const suggested = suggestPlan(party);
    const larger = largerThanNeeded(sizes, suggested);
    await ctx.db.query(
      `INSERT INTO plan_saves (desk_id, enquiry_id, sizes, suggested, larger_than_needed) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (desk_id, enquiry_id) DO UPDATE SET sizes=$3, suggested=$4, larger_than_needed=$5`,
      [deskId, e.id, sizes, suggested, larger]
    );
    res.json(await tripAnswer(ctx, deskId, e));
  });
}
async function routeCall(ctx, deskId, e, order) {
  const stops = await stopsForEnquiry(ctx.db, e.id);
  const byId = new Map(stops.map((s) => [s.id, s]));
  const texts = order.map((id) => byId.get(id)?.text ?? "").filter(Boolean);
  if (texts.length < 2) return null;
  const plan = await ctx.db.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
  const sizes = plan.rows[0]?.sizes ?? [49];
  return wirePost(ctx.cfg, "/v1/route", {
    vehicleClass: vehicleClassFor(sizes),
    stops: texts.map((text) => ({ text }))
  });
}
async function writeLegs(ctx, deskId, enquiryId, route) {
  await ctx.db.query("DELETE FROM legs WHERE enquiry_id=$1", [enquiryId]);
  for (let i = 0; i < route.legs.length; i++) {
    const km = route.legs[i].km;
    const miles = (Number(km) * 0.621371 * 10 + 0.5) / 10;
    await ctx.db.query("INSERT INTO legs (enquiry_id, desk_id, position, km, miles, minutes) VALUES ($1,$2,$3,$4,$5,$6)", [
      enquiryId,
      deskId,
      i,
      km,
      miles.toFixed(1),
      route.legs[i].minutes
    ]);
  }
}
async function tripAnswer(ctx, deskId, e, markOutOfDate = false) {
  const stops = await stopsForEnquiry(ctx.db, e.id);
  const legRows = (await ctx.db.query("SELECT * FROM legs WHERE enquiry_id=$1 ORDER BY position", [e.id])).rows.map(legRow);
  const plan = await ctx.db.query(
    "SELECT sizes, suggested, larger_than_needed FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2",
    [deskId, e.id]
  );
  const party = partyFromEnquiry(e);
  const suggested = suggestPlan(party);
  const hasPlan = plan.rows.length > 0;
  const outOfDate = legRows.length === 0;
  return {
    stops,
    legs: legRows,
    planOutOfDate: markOutOfDate ? false : outOfDate,
    plan: {
      sizes: hasPlan ? plan.rows[0].sizes : null,
      suggested,
      largerThanNeeded: hasPlan ? plan.rows[0].larger_than_needed : false
    }
  };
}

// src/server/app.ts
init_operators();
init_bids();
init_hires();

// src/server/api/payments.ts
var import_node_crypto5 = require("crypto");
init_auth2();
init_errors();
init_http();
init_repo();
init_money();
init_domain();
init_hires();
var REF_RE = /CV[-\s]?([0123456789ABCDEFGHJKMNPQRSTVWXYZOIloi]{5})(?![A-Za-z0-9])/gi;
function findReference(description) {
  const matches = [...description.matchAll(REF_RE)];
  if (matches.length === 0) return null;
  const raw = matches[0][1].toUpperCase().replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1");
  if (raw.length !== 5) return null;
  return "CV-" + raw;
}
function registerPaymentApi(app, ctx) {
  app.post("/api/payments/statements/preview", async (req, res) => {
    const deskId = requireAuth(req);
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "text/csv") throw errors.unsupportedType();
    const text = await readText(req, 2e6);
    const parsed = parseCsv(text, ["Date", "Description", "Amount", "Balance"]);
    if (!parsed) throw errors.invalid({ file: "The first line has to read Date,Description,Amount,Balance." }, "The first line has to read Date,Description,Amount,Balance.");
    if (parsed.rows.length > 2e3) throw errors.invalid({ file: "This file has more than 2,000 rows." }, "This file has more than 2,000 rows.");
    const matched = [];
    const unmatched = [];
    const moneyOut = [];
    const alreadySeen = [];
    const refused = [];
    const fingerprintRows = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const cells = parsed.rows[i];
      const rowNumber = parsed.rowNumbers[i];
      const dateText = (cells[0] ?? "").trim();
      const description = (cells[1] ?? "").trim();
      const amountText = (cells[2] ?? "").trim().replace(/^"|"$/g, "");
      const balanceText = (cells[3] ?? "").trim().replace(/^"|"$/g, "");
      const iso = parseDDMMYYYY(dateText);
      if (!iso) {
        refused.push({ row: rowNumber, message: `Row ${rowNumber}: ${dateText} is not a real date.` });
        continue;
      }
      const amount = parseStatementAmount(amountText);
      if (amount === null) {
        refused.push({ row: rowNumber, message: `Row ${rowNumber}: ${amountText} is not an amount.` });
        continue;
      }
      const balance = balanceText === "" ? null : parseStatementAmount(balanceText);
      const base = { row: rowNumber, date: iso, description, amount: penniesToString(amount), balance: balance === null ? null : penniesToString(balance) };
      fingerprintRows.push(`${iso}|${description}|${amount}|${balance ?? ""}`);
      const seen = await ctx.db.query(
        "SELECT 1 FROM statement_rows WHERE desk_id=$1 AND date=$2 AND description=$3 AND amount_pennies=$4 AND COALESCE(balance_pennies::text,'')=COALESCE($5,'')",
        [deskId, iso, description, String(amount), balance === null ? "" : String(balance)]
      );
      const reference = amount > 0 ? findReference(description) : null;
      if (seen.rows[0]) {
        alreadySeen.push({ ...base, reference });
      } else if (amount > 0 && reference) {
        matched.push({ ...base, reference });
      } else if (amount > 0) {
        unmatched.push(base);
      } else {
        moneyOut.push(base);
      }
    }
    const fingerprint = (0, import_node_crypto5.createHash)("sha256").update(deskId + "|" + fingerprintRows.join("\n")).digest("hex");
    const previewId = "PV-" + fingerprint.slice(0, 12);
    await ctx.db.query(
      `INSERT INTO statement_previews (id, desk_id, fingerprint, payload, created_at) VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (id) DO UPDATE SET payload=$4, created_at=NOW()`,
      [previewId, deskId, fingerprint, JSON.stringify({ matched, unmatched, moneyOut, alreadySeen, refused })]
    );
    res.json({ previewId, matched, unmatched, moneyOut, alreadySeen, refused });
  });
  app.post("/api/payments/statements/:previewId/bring-in", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const preview = await ctx.db.query("SELECT * FROM statement_previews WHERE desk_id=$1 AND id=$2", [deskId, req.params.previewId]);
    if (!preview.rows[0]) throw errors.notFound();
    const statementId = "ST-" + String(preview.rows[0].fingerprint).slice(0, 16);
    const already = await ctx.db.query("SELECT 1 FROM statements WHERE desk_id=$1 AND id=$2", [deskId, statementId]);
    if (already.rows[0]) {
      res.json({ broughtIn: 0, moneyHeld: penniesToString(await moneyHeld(ctx.db, deskId)) });
      return;
    }
    const payloadRows = preview.rows[0].payload ?? { matched: [] };
    const rows = payloadRows.matched ?? [];
    let brought = 0;
    await tx(ctx.db, async (client) => {
      await client.query("INSERT INTO statements (id, desk_id, fingerprint, brought_at) VALUES ($1,$2,$3,NOW())", [statementId, deskId, preview.rows[0].fingerprint]);
      for (const r of rows) {
        const seen = await client.query(
          "SELECT 1 FROM statement_rows WHERE desk_id=$1 AND date=$2 AND description=$3 AND amount_pennies=$4 AND COALESCE(balance_pennies::text,'')=COALESCE($5,'')",
          [deskId, r.date, r.description, String(Math.round(Number(r.amount) * 100)), r.balance === null ? "" : String(Math.round(Number(r.balance) * 100))]
        );
        if (seen.rows[0]) continue;
        await client.query(
          "INSERT INTO statement_rows (desk_id, statement_id, row_number, date, description, amount_pennies, balance_pennies, reference, already_seen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)",
          [deskId, statementId, r.row, r.date, r.description, String(Math.round(Number(r.amount) * 100)), r.balance === null ? null : String(Math.round(Number(r.balance) * 100)), r.reference]
        );
        const hire = await client.query("SELECT * FROM hires WHERE desk_id=$1 AND reference=$2", [deskId, r.reference]);
        if (!hire.rows[0]) continue;
        await allocateToVehicles(client, deskId, hire.rows[0], Math.round(Number(r.amount) * 100), r.description);
        brought++;
      }
    });
    res.json({ broughtIn: brought, moneyHeld: penniesToString(await moneyHeld(ctx.db, deskId)) });
  });
  app.get("/api/payments", async (req, res) => {
    const deskId = requireAuth(req);
    const held = await moneyHeld(ctx.db, deskId);
    const hires = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND stage<>'enquiry' ORDER BY depart_instant", [deskId]);
    const bookings = [];
    for (const h of hires.rows) {
      const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
      const money2 = await vehicleMoney(ctx, deskId, vehicles);
      const customer = await ctx.db.query("SELECT name FROM customers WHERE id=$1", [h.customer_id]);
      bookings.push({
        id: String(h.id),
        reference: String(h.reference),
        customerName: customer.rows[0]?.name ?? "",
        paymentState: money2.paymentState,
        paid: penniesToString(money2.paid),
        owed: penniesToString(money2.owed),
        credit: penniesToString(money2.credit)
      });
    }
    res.json({ moneyHeld: penniesToString(held), bookings });
  });
  app.get("/api/hires/:id/ledger", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const lines = await ctx.db.query("SELECT * FROM ledger_lines WHERE desk_id=$1 AND hire_id=$2 ORDER BY at, id", [deskId, hire.rows[0].id]);
    const ACCOUNT_LABEL = {
      clientMoney: "Client money",
      hireIncome: "Hire income",
      refundsDue: "Refunds due",
      operatorOwed: "Operator owed"
    };
    const sum = lines.rows.reduce((s, x) => s + Number(x.amount_pennies), 0);
    res.json({
      lines: lines.rows.map((x) => ({
        id: String(x.id),
        movementId: String(x.movement_id),
        account: ACCOUNT_LABEL[String(x.account)] ?? String(x.account),
        amount: penniesToString(Number(x.amount_pennies)),
        at: x.at.toISOString().replace(/\.\d{3}Z$/, "Z"),
        vehicleId: x.vehicle_id ? String(x.vehicle_id) : null
      })),
      sum: penniesToString(sum)
    });
  });
  app.post("/api/hires/:id/refunds", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const amount = typeof body.amount === "string" ? Math.round(Number(body.amount) * 100) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) throw errors.invalid({ amount: "Enter the amount in pounds and pence." });
    const vehicle = await ctx.db.query("SELECT * FROM vehicles WHERE desk_id=$1 AND id=$2 AND hire_id=$3", [deskId, vehicleId, hire.rows[0].id]);
    if (!vehicle.rows[0]) throw errors.notFound();
    const due = await refundsDueFor(ctx, deskId, vehicleId, vehicle.rows[0]);
    if (amount > due) throw errors.state("aboveDue", "We can't find that.");
    const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await tx(ctx.db, async (client) => {
      await client.query(
        `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
         ($1,$2,$3,$4,'refundPaid',$5,'clientMoney',$6,NOW(),'Refund paid'),
         ($7,$2,$3,$4,'refundPaid',$5,'refundsDue',$8,NOW(),'Refund paid')`,
        [movementId + "-A", deskId, hire.rows[0].id, movementId, vehicleId, String(-amount), movementId + "-B", String(amount)]
      );
    });
    res.status(201).json({ id: movementId });
  });
  app.get("/api/payments/download", async (req, res) => {
    const deskId = requireAuth(req);
    const lines = await ctx.db.query(
      "SELECT l.*, v.seats AS vehicle_seats FROM ledger_lines l LEFT JOIN vehicles v ON v.id=l.vehicle_id WHERE l.desk_id=$1 ORDER BY l.at, l.id",
      [deskId]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.set(fileHeaders("payments", "csv"));
    res.send(paymentCsv(lines.rows));
  });
  app.get("/api/hires/:id/payments/download", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const customer = await ctx.db.query("SELECT name FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
    const lines = await ctx.db.query(
      "SELECT l.*, v.seats AS vehicle_seats FROM ledger_lines l LEFT JOIN vehicles v ON v.id=l.vehicle_id WHERE l.desk_id=$1 AND l.hire_id=$2 ORDER BY l.at, l.id",
      [deskId, hire.rows[0].id]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.set(fileHeaders(String(customer.rows[0]?.name ?? "customer") + " payments", "csv"));
    res.send(paymentCsv(lines.rows));
  });
}
function parseStatementAmount(text) {
  const t = text.trim().replace(/,/g, "");
  const m = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const whole = Number(m[1]) * 100;
  const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return t.startsWith("-") ? -(whole + frac) : whole + frac;
}
async function allocateToVehicles(client, deskId, hire, amount, description) {
  const vehicles = (await client.query("SELECT * FROM vehicles WHERE desk_id=$1 AND hire_id=$2 ORDER BY depart_instant, position", [deskId, hire.id])).rows;
  const states = [];
  for (const v of vehicles) {
    const r = await client.query(
      `SELECT COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='deposit'),0) AS deposit,
              COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='balance'),0) AS balance
       FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2`,
      [deskId, v.id]
    );
    states.push({
      id: String(v.id),
      deposit: Number(v.deposit_pennies),
      total: Number(v.total_pennies),
      depositPaid: Number(r.rows[0].deposit),
      balancePaid: Number(r.rows[0].balance)
    });
  }
  let left = amount;
  for (const s of states) {
    if (left <= 0) break;
    const depositOwed = Math.max(0, s.deposit - s.depositPaid);
    const take = Math.min(left, depositOwed);
    if (take > 0) {
      await writeMovementLines(client, deskId, String(hire.id), s.id, take, "deposit", description);
      left -= take;
    }
  }
  for (const s of states) {
    if (left <= 0) break;
    const balanceOwed = Math.max(0, s.total - s.deposit - s.balancePaid);
    const take = Math.min(left, balanceOwed);
    if (take > 0) {
      await writeMovementLines(client, deskId, String(hire.id), s.id, take, "balance", description);
      left -= take;
    }
  }
  if (left > 0) {
    await writeMovementLines(client, deskId, String(hire.id), null, left, "credit", description);
  }
}
async function writeMovementLines(client, deskId, hireId, vehicleId, amount, kind, description) {
  const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase() + "-" + kind;
  await client.query(
    `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
     ($1,$2,$3,$4,$10,$5,'clientMoney',$6,NOW(),$7),
     ($8,$2,$3,$4,$10,$5,'hireIncome',$9,NOW(),$7)`,
    [movementId + "-A", deskId, hireId, movementId, vehicleId, String(amount), description, movementId + "-B", String(-amount), kind]
  );
}
async function refundsDueFor(ctx, deskId, vehicleId, vehicle) {
  const r = await ctx.db.query(
    `SELECT COALESCE(SUM(amount_pennies),0) AS due FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2 AND account='refundsDue'`,
    [deskId, vehicleId]
  );
  const paid = await ctx.db.query(
    `SELECT COALESCE(SUM(amount_pennies),0) AS p FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2 AND account='clientMoney'`,
    [deskId, vehicleId]
  );
  return Math.max(0, Number(paid.rows[0].p) - Number(vehicle.total_pennies ?? 0) + Number(r.rows[0].due));
}
function paymentCsv(rows) {
  const ACCOUNT = {
    clientMoney: "Client money",
    hireIncome: "Hire income",
    refundsDue: "Refunds due",
    operatorOwed: "Operator owed"
  };
  const out = rows.map((x) => [
    x.at.toISOString().slice(0, 10),
    "",
    "",
    x.vehicle_seats ? String(x.vehicle_seats) : "",
    ACCOUNT[String(x.account)] ?? String(x.account),
    (Number(x.amount_pennies) / 100).toFixed(2),
    String(x.description ?? "")
  ]);
  return csvBody(["Date", "Reference", "Customer", "Vehicle", "Account", "Amount", "Description"], out);
}

// src/server/api/runs.ts
init_auth2();
init_errors();
init_http();
init_domain();
init_services();
init_uktime();
init_hours();
init_rate_helpers();
init_rules();
init_money();
init_operators();
init_validation();
function registerRunApi(app, ctx) {
  app.get("/api/diary", async (req, res) => {
    const deskId = requireAuth(req);
    const week = typeof req.query.week === "string" && /^\d{4}-W\d{2}$/.test(req.query.week) ? req.query.week : null;
    if (!week) throw errors.invalid({ week: "We can't find that." });
    const [year, wn] = week.split("-W").map(Number);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = (jan4.getUTCDay() + 6) % 7;
    const monday = new Date(jan4.getTime() - dayOfWeek * 864e5 + (wn - 1) * 7 * 864e5);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 864e5);
      const iso = d.toISOString().slice(0, 10);
      const hours2 = dayHours(iso);
      days.push({ date: iso, hours: hours2, label: hours2 === 23 ? "Clocks go forward 01:00" : hours2 === 25 ? "Clocks go back 02:00" : null });
    }
    const from = ukToInstant(days[0].date, "00:00").instant;
    const to = ukToInstant(days[6].date, "23:59").instant;
    const rows = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND depart_instant BETWEEN $2 AND $3 ORDER BY depart_instant", [deskId, from, new Date(to.getTime() + 59999)]);
    const out = [];
    for (const r of rows.rows) {
      const hire = await ctx.db.query("SELECT reference FROM hires WHERE id=$1", [r.hire_id]);
      out.push({
        runId: String(r.id),
        number: Number(r.number),
        hireId: String(r.hire_id),
        seats: Number((await ctx.db.query("SELECT seats FROM vehicles WHERE id=$1", [r.vehicle_id])).rows[0]?.seats ?? 0),
        driver: r.driver_name ? { name: String(r.driver_name), telephone: String(r.driver_telephone) } : null,
        departAt: { date: isoDateOf(r.depart_instant), time: String(r.depart_time) },
        departInstant: isoInstant(r.depart_instant),
        reference: hire.rows[0]?.reference ?? ""
      });
    }
    res.json({ week, days, rows: out });
  });
  app.get("/api/runs/:id", async (req, res) => {
    const deskId = requireAuth(req);
    const r = await runById(ctx, deskId, String(req.params.id));
    res.json(await runOut(ctx, deskId, r));
  });
  app.put("/api/runs/:id/departure", async (req, res) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = await readJson(req);
    const depart = parseLocalDate(body.departAt ?? {}, "departAt");
    const clash = await driverClash(ctx, deskId, run, depart.instant);
    if (clash) {
      throw errors.state("driverClash", `That driver is already on Run ${clash.number} at ${ukTimeHM(clash.depart_instant)}.`);
    }
    const hadDriver = run.driver_name && run.told_at;
    await ctx.db.query("UPDATE runs SET depart_date=$1, depart_time=$2, depart_instant=$3, told_at=NULL WHERE id=$4", [
      depart.date,
      depart.time,
      depart.instant,
      run.id
    ]);
    await syncVehicleDepartures(ctx, deskId, String(run.hire_id), String(run.id), depart);
    let message = null;
    if (hadDriver) {
      const ok = await publishChange(ctx, deskId, String(run.id));
      if (!ok) message = "We couldn't reach the driver's phone. Nothing was marked as told.";
      else {
        await ctx.db.query("UPDATE runs SET told_at=NOW() WHERE id=$1", [run.id]);
      }
    }
    const after = await runById(ctx, deskId, String(run.id));
    const out = await runOut(ctx, deskId, after);
    if (message) out.driverNotice = message;
    res.json(out);
  });
  app.put("/api/runs/:id/driver", async (req, res) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const telephone = typeof body.telephone === "string" ? body.telephone.trim() : "";
    if (!name) throw errors.invalid({ name: "Enter the driver's name." });
    if (!telephone) throw errors.invalid({ telephone: "Enter a UK telephone number." });
    const folded = foldTelephone(telephone);
    const clash = await driverClash(ctx, deskId, run, run.depart_instant, folded);
    if (clash && clash.id !== run.id) {
      throw errors.state("driverClash", `That driver is already on Run ${clash.number} at ${ukTimeHM(clash.depart_instant)}.`);
    }
    await ctx.db.query("UPDATE runs SET driver_name=$1, driver_telephone=$2, driver_folded=$3 WHERE id=$4", [name, telephone, folded, run.id]);
    const ok = await publishTell(ctx, deskId, String(run.id));
    if (!ok) {
      const after2 = await runById(ctx, deskId, String(run.id));
      res.json(await runOut(ctx, deskId, after2));
      return;
    }
    await ctx.db.query("UPDATE runs SET told_at=NOW() WHERE id=$1", [run.id]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });
  app.post("/api/runs/:id/tell", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    if (!run.driver_name) throw errors.state("noDriver", "We can't find that.");
    const ok = await publishTell(ctx, deskId, String(run.id));
    if (!ok) throw errors.provider("We couldn't reach the driver's phone. Nothing was marked as told.");
    await ctx.db.query("UPDATE runs SET told_at=NOW() WHERE id=$1", [run.id]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });
  app.put("/api/runs/:id/blocks", async (req, res) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = await readJson(req);
    const _startAt = parseLocalDate(body.startAt ?? {}, "startAt");
    const blocksIn = Array.isArray(body.blocks) ? body.blocks : [];
    const blocks = [];
    for (const b of blocksIn) {
      const o = b ?? {};
      const kind = o.kind;
      const minutes = Number(o.minutes);
      if (!["drive", "break", "wait", "rest"].includes(String(kind)) || !Number.isInteger(minutes) || minutes <= 0) {
        throw errors.invalid({ blocks: "We can't find that." });
      }
      blocks.push({ kind, minutes });
    }
    await ctx.db.query("DELETE FROM duty_blocks WHERE run_id=$1", [run.id]);
    for (let i = 0; i < blocks.length; i++) {
      await ctx.db.query("INSERT INTO duty_blocks (run_id, desk_id, position, kind, minutes) VALUES ($1,$2,$3,$4,$5)", [
        run.id,
        deskId,
        i,
        blocks[i].kind,
        blocks[i].minutes
      ]);
    }
    const answer = await hoursAnswerFor(ctx, deskId, String(run.id));
    res.json(answer);
  });
  app.get("/api/runs/:id/hours", async (req, res) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    res.json(await hoursAnswerFor(ctx, deskId, String(run.id)));
  });
  app.post("/api/runs/:id/second-driver", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    if (!run.second_driver) {
      const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.hire_id]);
      const rate = await rateTableForDate(ctx, deskId, isoDateOf(hire.rows[0].quote_sent_at ? hire.rows[0].quote_sent_at : /* @__PURE__ */ new Date()));
      const charge = rate.secondDriverPennies;
      await ctx.db.query("UPDATE runs SET second_driver=TRUE WHERE id=$1", [run.id]);
      const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase() + "-second";
      await ctx.db.query(
        `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
         ($1,$2,$3,$4,'secondDriver',$5,'operatorOwed',$6,NOW(),'Second driver'),
         ($7,$2,$3,$4,'secondDriver',$5,'hireIncome',$8,NOW(),'Second driver')`,
        [movementId + "-A", deskId, run.hire_id, movementId, run.vehicle_id, String(-charge), movementId + "-B", String(charge)]
      );
      await ctx.db.query("UPDATE vehicles SET total_pennies = total_pennies + $1 WHERE id=$2", [charge, run.vehicle_id]);
    }
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });
  app.post("/api/runs/:id/confirm", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    const answer = await hoursAnswerFor(ctx, deskId, String(run.id));
    if (answer.breaches.length) {
      throw errors.state("overTheLimit", "This run is over the limit. Move a break or add a second driver.");
    }
    await ctx.db.query("UPDATE runs SET confirmed=TRUE WHERE id=$1", [run.id]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });
  app.put("/api/runs/:id/stops/:stopId/flight", async (req, res) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = await readJson(req);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[A-Za-z]{2}\d{2,4}$/.test(code)) throw errors.invalid({ code: "We can't find that." });
    await ctx.db.query("UPDATE enquiry_stops SET flight_code=$1 WHERE id=$2 AND enquiry_id=(SELECT reference FROM hires WHERE id=$3)", [
      code.toUpperCase(),
      req.params.stopId,
      run.hire_id
    ]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });
  app.post("/api/runs/:id/accept-charges", async (req, res) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    const pending = await ctx.db.query("SELECT * FROM run_charges WHERE run_id=$1 AND accepted=FALSE", [String(run.id)]);
    let added = 0;
    for (const c of pending.rows) {
      await ctx.db.query("UPDATE run_charges SET accepted=TRUE, accepted_at=NOW() WHERE id=$1", [c.id]);
      const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase() + "-charge";
      await ctx.db.query(
        `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
         ($1,$2,$3,$4,'chargeAccepted',$5,'operatorOwed',$6,NOW(),'Charge accepted'),
         ($7,$2,$3,$4,'chargeAccepted',$5,'hireIncome',$8,NOW(),'Charge accepted')`,
        [movementId + "-A", deskId, run.hire_id, movementId, run.vehicle_id, String(-Number(c.amount_pennies)), movementId + "-B", String(c.amount_pennies)]
      );
      await ctx.db.query("UPDATE vehicles SET total_pennies = total_pennies + $1 WHERE id=$2", [Number(c.amount_pennies), run.vehicle_id]);
      added += Number(c.amount_pennies);
    }
    const vehicle = await ctx.db.query("SELECT * FROM vehicles WHERE id=$1", [run.vehicle_id]);
    res.json({ added: penniesToString(added), vehicleTotal: penniesToString(Number(vehicle.rows[0].total_pennies)) });
  });
  app.get("/api/r/:token", async (req, res) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM run_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [String(t.rows[0].run_id)]);
    if (!run.rows[0]) throw errors.notFound();
    const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.rows[0].hire_id]);
    if (hire.rows[0] && hire.rows[0].cancelled) throw errors.ended();
    const customer = hire.rows[0] ? await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.rows[0].customer_id]) : null;
    if (customer && customer.rows[0] && customer.rows[0].state === "erased") throw errors.ended();
    const answer = await runSheetAnswer(ctx, deskId, run.rows[0]);
    res.json(answer);
  });
  app.post("/api/r/:token/presses", async (req, res) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM run_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [String(t.rows[0].run_id)]);
    if (!run.rows[0]) throw errors.notFound();
    const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.rows[0].hire_id]);
    if (hire.rows[0] && hire.rows[0].cancelled) throw errors.ended();
    const body = await readJson(req);
    const stopId = typeof body.stopId === "string" ? body.stopId : "";
    const kind = typeof body.kind === "string" ? body.kind : "";
    const secondsAgo = Number(body.secondsAgo ?? 0);
    const repeatKey = typeof body.repeatKey === "string" ? body.repeatKey : "";
    if (!["arrived", "boarded", "left", "comfortStop", "backOnTheRoad"].includes(kind)) throw errors.invalid({ kind: "We can't find that." });
    if (!Number.isFinite(secondsAgo) || secondsAgo < 0) throw errors.invalid({ secondsAgo: "We can't find that." });
    if (!repeatKey) throw errors.invalid({ repeatKey: "We can't find that." });
    const seen = await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1 AND repeat_key=$2", [run.rows[0].id, repeatKey]);
    if (seen.rows[0]) {
      const same = String(seen.rows[0].stop_id) === stopId && String(seen.rows[0].kind) === kind;
      if (!same) throw errors.state("repeatKeyConflict", "We can't find that.");
      res.status(Number(seen.rows[0].status_code ?? 201)).json({ pressId: String(seen.rows[0].id), at: isoInstant(seen.rows[0].at) });
      return;
    }
    const at = new Date(Date.now() - Math.round(secondsAgo) * 1e3);
    const order = ["arrived", "boarded", "left"];
    const previous = await ctx.db.query("SELECT kind FROM run_presses WHERE run_id=$1 AND stop_id=$2 AND kind IN ('arrived','boarded','left') ORDER BY at", [run.rows[0].id, stopId]);
    const pressedKinds = new Set(previous.rows.map((x) => String(x.kind)));
    if (["arrived", "boarded", "left"].includes(kind)) {
      const expected = order.find((k) => !pressedKinds.has(k));
      if (expected !== kind || pressedKinds.has(kind)) {
        throw errors.state("pressOutOfOrder", "We can't find that.");
      }
    }
    const id = "PR-" + Math.random().toString(36).slice(2, 12);
    await ctx.db.query("INSERT INTO run_presses (id, run_id, stop_id, kind, at, repeat_key) VALUES ($1,$2,$3,$4,$5,$6)", [
      id,
      run.rows[0].id,
      stopId,
      kind,
      at,
      repeatKey
    ]);
    await recomputeCharges(ctx, deskId, run.rows[0]);
    res.status(201).json({ pressId: id, at: isoInstant(at) });
  });
}
function isoDateOf(d) {
  return d.toISOString().slice(0, 10);
}
function dayHours(iso) {
  const noon = ukToInstant(iso, "12:00").instant;
  const start = ukToInstant(iso, "00:00").instant;
  const end = ukToInstant(addDays(iso, 1), "00:00").instant;
  return Math.round((end.getTime() - start.getTime()) / 36e5);
}
async function runById(ctx, deskId, id) {
  const r = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND id=$2", [deskId, id]);
  if (!r.rows[0]) throw errors.notFound();
  return r.rows[0];
}
async function driverClash(ctx, deskId, run, departInstant, foldedOverride) {
  const folded = foldedOverride ?? (run.driver_folded ? String(run.driver_folded) : null);
  if (!folded) return null;
  const others = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND id<>$2 AND driver_folded=$3", [deskId, run.id, folded]);
  const myStart = departInstant;
  const myEnd = new Date(myStart.getTime() + await dutySpan(ctx, String(run.id)) * 6e4);
  for (const other of others.rows) {
    const otherStart = other.depart_instant;
    const otherEnd = new Date(otherStart.getTime() + await dutySpan(ctx, String(other.id)) * 6e4);
    if (myStart < otherEnd && otherStart < myEnd) return other;
  }
  return null;
}
async function dutySpan(ctx, runId) {
  const blocks = await ctx.db.query("SELECT minutes FROM duty_blocks WHERE run_id=$1 ORDER BY position", [runId]);
  if (blocks.rows.length === 0) return 60;
  return blocks.rows.reduce((s, x) => s + Number(x.minutes), 0);
}
async function syncVehicleDepartures(ctx, deskId, hireId, runId, depart) {
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  if (!run.rows[0]) return;
  await ctx.db.query("UPDATE vehicles SET depart_date=$1, depart_time=$2, depart_instant=$3 WHERE id=$4", [
    depart.date,
    depart.time,
    depart.instant,
    run.rows[0].vehicle_id
  ]);
  const anyEarlier = await ctx.db.query(
    "SELECT COUNT(*) AS c FROM runs r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.hire_id=$1 AND v.depart_instant < $2",
    [hireId, depart.instant]
  );
}
async function publishTell(ctx, _deskId, runId) {
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  const r = run.rows[0];
  if (!r || !r.driver_telephone) return false;
  const first = await ctx.db.query(
    "SELECT text FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position LIMIT 1",
    [r.hire_id]
  );
  const firstText = first.rows[0]?.text ? String(first.rows[0].text).split(",")[0] : "";
  const message = `Run ${r.number}: ${String(r.depart_time)} ${longDate(String(r.depart_date))}, ${firstText}.`;
  return notifyDriver(ctx.cfg, foldTelephone(String(r.driver_telephone)), `Run ${r.number}`, message);
}
async function publishChange(ctx, deskId, runId) {
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  const r = run.rows[0];
  if (!r || !r.driver_telephone) return false;
  const first = await ctx.db.query(
    "SELECT text FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position LIMIT 1",
    [r.hire_id]
  );
  const firstText = first.rows[0]?.text ? String(first.rows[0].text).split(",")[0] : "";
  const message = `Run ${r.number} changed: ${String(r.depart_time)} ${longDate(String(r.depart_date))}, ${firstText}.`;
  return notifyDriver(ctx.cfg, foldTelephone(String(r.driver_telephone)), `Run ${r.number}`, message);
}
async function hoursAnswerFor(ctx, deskId, runId) {
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  const r = run.rows[0];
  const blocks = (await ctx.db.query("SELECT * FROM duty_blocks WHERE run_id=$1 ORDER BY position", [runId])).rows.map(
    (x) => ({ kind: String(x.kind), minutes: Number(x.minutes) })
  );
  const duty = { startInstant: r.depart_instant, blocks };
  let sameDayDriving = 0;
  let weekDaysOver = 0;
  if (r.driver_folded && !r.second_driver) {
    const others = await ctx.db.query(
      "SELECT * FROM runs WHERE desk_id=$1 AND driver_folded=$2 AND id<>$3 AND depart_date=$4 AND second_driver=FALSE",
      [deskId, r.driver_folded, runId, r.depart_date]
    );
    for (const other of others.rows) {
      const otherBlocks = (await ctx.db.query("SELECT minutes, kind FROM duty_blocks WHERE run_id=$1", [other.id])).rows;
      sameDayDriving += otherBlocks.filter((b) => b.kind === "drive").reduce((s, b) => s + Number(b.minutes), 0);
    }
    const weekStart = mondayOf(String(r.depart_date));
    const weekRuns = await ctx.db.query(
      "SELECT DISTINCT depart_date FROM runs WHERE desk_id=$1 AND driver_folded=$2 AND depart_date BETWEEN $3 AND $4",
      [deskId, r.driver_folded, weekStart, String(r.depart_date)]
    );
    for (const d of weekRuns.rows) {
      const dayRuns = await ctx.db.query(
        "SELECT id FROM runs WHERE desk_id=$1 AND driver_folded=$2 AND depart_date=$3 AND second_driver=FALSE",
        [deskId, r.driver_folded, String(d.depart_date)]
      );
      let dayDriving = 0;
      for (const dr of dayRuns.rows) {
        const b = await ctx.db.query("SELECT minutes, kind FROM duty_blocks WHERE run_id=$1", [dr.id]);
        dayDriving += b.rows.filter((x) => x.kind === "drive").reduce((s, x) => s + Number(x.minutes), 0);
      }
      if (dayDriving > 540) weekDaysOver++;
    }
  }
  const answer = judgeRun(duty, Boolean(r.second_driver), sameDayDriving, weekDaysOver);
  return { drivingMinutes: answer.drivingMinutes, spreadMinutes: answer.spreadMinutes, breaches: answer.breaches };
}
function mondayOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  return new Date(dt.getTime() - (dow + 6) % 7 * 864e5).toISOString().slice(0, 10);
}
async function runOut(ctx, _deskId, r) {
  const stops = await ctx.db.query(
    "SELECT * FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position",
    [r.hire_id]
  );
  const charges = await ctx.db.query("SELECT * FROM run_charges WHERE run_id=$1", [r.id]);
  const hire = await ctx.db.query("SELECT reference FROM hires WHERE id=$1", [r.hire_id]);
  return {
    id: String(r.id),
    number: Number(r.number),
    hireId: String(r.hire_id),
    reference: hire.rows[0]?.reference,
    vehicleId: String(r.vehicle_id),
    seats: Number((await ctx.db.query("SELECT seats FROM vehicles WHERE id=$1", [r.vehicle_id])).rows[0]?.seats ?? 0),
    driver: r.driver_name ? { name: String(r.driver_name), telephone: String(r.driver_telephone) } : null,
    toldAt: r.told_at ? isoInstant(r.told_at) : null,
    confirmed: Boolean(r.confirmed),
    sheetPath: String(r.sheet_path),
    departAt: { date: String(r.depart_date), time: String(r.depart_time) },
    departInstant: isoInstant(r.depart_instant),
    secondDriver: Boolean(r.second_driver),
    stops: stops.rows.map((s) => ({ id: String(s.id), text: String(s.text), flightCode: s.flight_code ? String(s.flight_code) : null })),
    charges: charges.rows.map((c) => ({
      stopId: c.stop_id ? String(c.stop_id) : null,
      kind: String(c.kind),
      minutes: Number(c.minutes),
      amount: penniesToString(Number(c.amount_pennies)),
      accepted: Boolean(c.accepted)
    })),
    chargesTotal: penniesToString(charges.rows.reduce((s, c) => s + (c.accepted ? Number(c.amount_pennies) : 0), 0))
  };
}
async function runSheetAnswer(ctx, deskId, r) {
  const base = await runOut(ctx, deskId, r);
  const presses = await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1 ORDER BY at", [r.id]);
  const stops = base.stops.map((s) => ({
    id: s.id,
    text: s.text,
    presses: {
      arrived: pressAt(presses.rows, s.id, "arrived"),
      boarded: pressAt(presses.rows, s.id, "boarded"),
      left: pressAt(presses.rows, s.id, "left")
    }
  }));
  return {
    number: base.number,
    departAt: base.departAt,
    departInstant: base.departInstant,
    stops,
    flightLine: null,
    charges: base.charges
  };
}
function pressAt(rows, stopId, kind) {
  const found = rows.find((x) => String(x.stop_id) === stopId && String(x.kind) === kind);
  return found ? isoInstant(found.at) : null;
}
async function recomputeCharges(ctx, deskId, r) {
  const runId = String(r.id);
  await ctx.db.query("DELETE FROM run_charges WHERE run_id=$1 AND accepted=FALSE", [runId]);
  const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [r.hire_id]);
  const rate = await rateTableForDate(ctx, deskId, isoDateOf(hire.rows[0].quote_sent_at ? hire.rows[0].quote_sent_at : /* @__PURE__ */ new Date()));
  const perHour = rate.waitingRatePennies;
  const stops = await ctx.db.query("SELECT * FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position", [r.hire_id]);
  const presses = await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1 ORDER BY at", [runId]);
  for (const stop of stops.rows) {
    const arrived = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "arrived");
    const boarded = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "boarded");
    if (arrived && boarded) {
      const minutes = Math.floor((boarded.at.getTime() - arrived.at.getTime()) / 6e4);
      let from = arrived.at;
      if (stop.flight_code) {
        const flight = await getFlight(ctx.cfg, String(stop.flight_code), String(r.depart_date));
        if (flight && flight.actualArrival) {
          from = new Date(flight.actualArrival);
        } else {
          from = null;
        }
      }
      const base = from ?? r.depart_instant;
      const mins = Math.max(0, Math.floor((boarded.at.getTime() - base.getTime()) / 6e4));
      const charge = stop.flight_code && from ? waitingPennies(mins, perHour) : waitingPennies(minutes, perHour);
      if (charge > 0) {
        const existing = await ctx.db.query("SELECT 1 FROM run_charges WHERE run_id=$1 AND stop_id=$2 AND kind='waiting' AND accepted=FALSE", [runId, stop.id]);
        if (!existing.rows[0]) {
          await ctx.db.query("INSERT INTO run_charges (id, run_id, stop_id, kind, minutes, amount_pennies) VALUES ($1,$2,$3,'waiting',$4,$5)", [
            "CH-" + Math.random().toString(36).slice(2, 12),
            runId,
            stop.id,
            mins,
            charge
          ]);
        }
      }
    }
    const comfort = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "comfortStop");
    const back = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "backOnTheRoad");
    if (comfort && back) {
      const minutes = Math.floor((back.at.getTime() - comfort.at.getTime()) / 6e4);
      const charge = comfortCharge(minutes, perHour);
      if (charge > 0) {
        const existing = await ctx.db.query("SELECT 1 FROM run_charges WHERE run_id=$1 AND stop_id=$2 AND kind='comfortStop' AND accepted=FALSE", [runId, stop.id]);
        if (!existing.rows[0]) {
          await ctx.db.query("INSERT INTO run_charges (id, run_id, stop_id, kind, minutes, amount_pennies) VALUES ($1,$2,$3,'comfortStop',$4,$5)", [
            "CH-" + Math.random().toString(36).slice(2, 12),
            runId,
            stop.id,
            minutes,
            charge
          ]);
        }
      }
    }
  }
}

// src/server/api/sheets.ts
init_auth2();
init_errors();
init_http();
init_repo();
init_domain();
init_money();
init_hours();
init_s3();
init_hires();
init_bids();
init_validation();
init_uktime();
init_hires();
init_rate_helpers();
var STR = {
  en: {
    yourQuote: "Your quote",
    quoteSent: "Quote sent",
    accepted: "Accepted",
    deposit: "Deposit",
    balance: "Balance",
    travel: "Travel",
    route: "Route",
    out: "Out",
    return: "Return",
    party: "Party",
    vehicles: "Vehicles",
    total: "Total",
    depositDue: "Deposit due",
    validUntil: "Valid until",
    payBy: "Pay by bank transfer quoting",
    accept: "Accept",
    acceptThisQuote: "Accept this quote",
    yourFullName: "Your full name",
    confirmAcceptance: "Confirm acceptance",
    close: "Close",
    nameMismatch: "That name does not match this quote.",
    quoteAccepted: "Quote accepted.",
    sentDeposit: "I've sent the deposit",
    checkingPayment: "We're checking your payment",
    endedLine: "This quote ended on",
    askUs: "Ask us for a new one.",
    cancelled: "This booking was cancelled.",
    downloadQuote: "Download quote",
    language: "Language",
    ended: "This page has ended.",
    person: "person",
    people: "people",
    vehicle: "vehicle",
    vehiclesWord: "vehicles"
  },
  pl: {
    yourQuote: "Twoja wycena",
    quoteSent: "Wycena wys\u0142ana",
    accepted: "Zaakceptowana",
    deposit: "Zaliczka",
    balance: "Pozosta\u0142a kwota",
    travel: "Podr\xF3\u017C",
    route: "Trasa",
    out: "Wyjazd",
    return: "Powr\xF3t",
    party: "Grupa",
    vehicles: "Pojazdy",
    total: "Razem",
    depositDue: "Zaliczka do zap\u0142aty",
    validUntil: "Wa\u017Cna do",
    payBy: "Zap\u0142a\u0107 przelewem, podaj\u0105c numer",
    accept: "Akceptuj\u0119",
    acceptThisQuote: "Akceptacja wyceny",
    yourFullName: "Imi\u0119 i nazwisko",
    confirmAcceptance: "Potwierdzam",
    close: "Zamknij",
    nameMismatch: "To nazwisko nie zgadza si\u0119 z t\u0105 wycen\u0105.",
    quoteAccepted: "Wycena zaakceptowana.",
    sentDeposit: "Zaliczka wys\u0142ana",
    checkingPayment: "Sprawdzamy Twoj\u0105 p\u0142atno\u015B\u0107",
    endedLine: "Ta wycena wygas\u0142a",
    askUs: "Popro\u015B nas o now\u0105.",
    cancelled: "Ta rezerwacja zosta\u0142a anulowana.",
    downloadQuote: "Pobierz wycen\u0119",
    language: "J\u0119zyk",
    ended: "Ta strona wygas\u0142a.",
    person: "osoba",
    people: "osoby",
    vehicle: "pojazd",
    vehiclesWord: "pojazdy"
  },
  ur: {
    yourQuote: "\u0622\u067E \u06A9\u0627 \u06A9\u0648\u0679\u06CC\u0634\u0646",
    quoteSent: "\u06A9\u0648\u0679\u06CC\u0634\u0646 \u0628\u06BE\u06CC\u062C \u062F\u06CC\u0627 \u06AF\u06CC\u0627",
    accepted: "\u0642\u0628\u0648\u0644 \u06A9\u0631 \u0644\u06CC\u0627 \u06AF\u06CC\u0627",
    deposit: "\u067E\u06CC\u0634\u06AF\u06CC \u0631\u0642\u0645",
    balance: "\u0628\u0642\u0627\u06CC\u0627 \u0631\u0642\u0645",
    travel: "\u0633\u0641\u0631",
    route: "\u0631\u0627\u0633\u062A\u06C1",
    out: "\u0631\u0648\u0627\u0646\u06AF\u06CC",
    return: "\u0648\u0627\u067E\u0633\u06CC",
    party: "\u0645\u0633\u0627\u0641\u0631",
    vehicles: "\u06AF\u0627\u0691\u06CC\u0627\u06BA",
    total: "\u06A9\u0644 \u0631\u0642\u0645",
    depositDue: "\u0648\u0627\u062C\u0628 \u0627\u0644\u0627\u062F\u0627 \u067E\u06CC\u0634\u06AF\u06CC \u0631\u0642\u0645",
    validUntil: "\u062A\u06A9 \u06A9\u0627\u0631\u0622\u0645\u062F",
    payBy: "\u06A9\u0627 \u062D\u0648\u0627\u0644\u06C1 \u062F\u06D2 \u06A9\u0631 \u0628\u06CC\u0646\u06A9 \u0679\u0631\u0627\u0646\u0633\u0641\u0631 \u0633\u06D2 \u0627\u062F\u0627\u0626\u06CC\u06AF\u06CC \u06A9\u0631\u06CC\u06BA",
    accept: "\u0642\u0628\u0648\u0644 \u06A9\u0631\u06CC\u06BA",
    acceptThisQuote: "\u06CC\u06C1 \u06A9\u0648\u0679\u06CC\u0634\u0646 \u0642\u0628\u0648\u0644 \u06A9\u0631\u06CC\u06BA",
    yourFullName: "\u0622\u067E \u06A9\u0627 \u067E\u0648\u0631\u0627 \u0646\u0627\u0645",
    confirmAcceptance: "\u0642\u0628\u0648\u0644\u06CC\u062A \u06A9\u06CC \u062A\u0635\u062F\u06CC\u0642 \u06A9\u0631\u06CC\u06BA",
    close: "\u0628\u0646\u062F \u06A9\u0631\u06CC\u06BA",
    nameMismatch: "\u06CC\u06C1 \u0646\u0627\u0645 \u0627\u0633 \u06A9\u0648\u0679\u06CC\u0634\u0646 \u0633\u06D2 \u0645\u0637\u0627\u0628\u0642\u062A \u0646\u06C1\u06CC\u06BA \u0631\u06A9\u06BE\u062A\u0627\u06D4",
    quoteAccepted: "\u06A9\u0648\u0679\u06CC\u0634\u0646 \u0642\u0628\u0648\u0644 \u06A9\u0631 \u0644\u06CC \u06AF\u0626\u06CC\u06D4",
    sentDeposit: "\u0645\u06CC\u06BA \u0646\u06D2 \u067E\u06CC\u0634\u06AF\u06CC \u0631\u0642\u0645 \u0628\u06BE\u06CC\u062C \u062F\u06CC \u06C1\u06D2",
    checkingPayment: "\u06C1\u0645 \u0622\u067E \u06A9\u06CC \u0627\u062F\u0627\u0626\u06CC\u06AF\u06CC \u06A9\u06CC \u062C\u0627\u0646\u0686 \u06A9\u0631 \u0631\u06C1\u06D2 \u06C1\u06CC\u06BA",
    endedLine: "\u06CC\u06C1 \u06A9\u0648\u0679\u06CC\u0634\u0646 \u062E\u062A\u0645 \u06C1\u0648 \u06AF\u06CC\u0627",
    askUs: "\u06C1\u0645 \u0633\u06D2 \u0646\u06CC\u0627 \u06A9\u0648\u0679\u06CC\u0634\u0646 \u0645\u0627\u0646\u06AF\u06CC\u06BA\u06D4",
    cancelled: "\u06CC\u06C1 \u0628\u06A9\u0646\u06AF \u0645\u0646\u0633\u0648\u062E \u06A9\u0631 \u062F\u06CC \u06AF\u0626\u06CC\u06D4",
    downloadQuote: "\u06A9\u0648\u0679\u06CC\u0634\u0646 \u0688\u0627\u0624\u0646 \u0644\u0648\u0688 \u06A9\u0631\u06CC\u06BA",
    language: "\u0632\u0628\u0627\u0646",
    ended: "\u06CC\u06C1 \u0635\u0641\u062D\u06C1 \u062E\u062A\u0645 \u06C1\u0648 \u0686\u06A9\u0627 \u06C1\u06D2\u06D4",
    person: "\u0641\u0631\u062F",
    people: "\u0627\u0641\u0631\u0627\u062F",
    vehicle: "\u06AF\u0627\u0691\u06CC",
    vehiclesWord: "\u06AF\u0627\u0691\u06CC\u0627\u06BA"
  }
};
function stringsFor(lang) {
  return STR[lang] ?? STR.en;
}
function englishCount(n, one, many) {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}
function urduCount(n, one, many) {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}
function dateForLang(lang, date) {
  const [y, m, d] = date.split("-");
  if (lang === "pl") return `${d}.${m}.${y}`;
  if (lang === "ur") return `${d}/${m}/${y}`;
  const MONTHS2 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS2 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return `${DAYS2[dt.getUTCDay()]} ${Number(d)} ${MONTHS2[Number(m) - 1]} ${y}`;
}
function registerSheetApi(app, ctx) {
  app.get("/api/q/:token", async (req, res) => {
    const token = req.params.token;
    const answer = await quotePageAnswer(ctx, token, null);
    res.json(answer);
  });
  app.post("/api/q/:token/accept", async (req, res) => {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const answer = await quotePageAnswer(ctx, req.params.token, (data) => {
      if (foldName(name) !== foldName(String(data.customer.name ?? ""))) {
        throw errors.invalid({ name: stringsFor(data.language).nameMismatch }, stringsFor(data.language).nameMismatch);
      }
    });
    if (answer.cancelled) throw errors.state("bookingCancelled", stringsFor(answer.language).cancelled);
    const now = /* @__PURE__ */ new Date();
    const endsAt = answer.endsAt ? new Date(answer.endsAt) : null;
    const alreadyAccepted = answer.state === "accepted";
    if (!alreadyAccepted && endsAt && now.getTime() > endsAt.getTime()) {
      throw errors.state(
        "quoteEnded",
        `${stringsFor(answer.language).endedLine} ${dateForLang(answer.language, String(answer.endedLineDate))}. ${stringsFor(answer.language).askUs}`
      );
    }
    if (!alreadyAccepted) {
      await ctx.db.query("UPDATE hires SET stage='accepted', enquiry_state='won' WHERE id=$1", [answer.hireId]);
      await ctx.db.query("UPDATE enquiries SET state='won' WHERE desk_id=$1 AND reference=$2", [answer.deskId, answer.reference]);
    }
    const after = await quotePageAnswer(ctx, req.params.token, null);
    res.json(after);
  });
  app.post("/api/q/:token/deposit-sent", async (req, res) => {
    void req.body;
    const answer = await quotePageAnswer(ctx, req.params.token, null);
    if (answer.cancelled) throw errors.state("bookingCancelled", stringsFor(answer.language).cancelled);
    if (answer.state !== "accepted") {
      throw errors.state("quoteEnded", stringsFor(answer.language).ended);
    }
    await ctx.db.query("UPDATE hires SET deposit_said_sent=NOW() WHERE id=$1", [answer.hireId]);
    const after = await quotePageAnswer(ctx, req.params.token, null);
    res.json(after);
  });
  app.post("/api/hires/:id/passengers/import", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "text/csv") throw errors.unsupportedType();
    const text = await readText(req, 1e6);
    const parsed = parseCsv(text, ["Name", "Group", "Needs"]);
    if (!parsed) throw errors.invalid({ file: "The first line has to read Name,Group,Needs." });
    if (parsed.rows.length > 500) throw errors.invalid({ file: "This file has more than 500 rows." }, "This file has more than 500 rows.");
    const nameIdx = parsed.header.indexOf("name");
    const groupIdx = parsed.header.indexOf("group");
    const needsIdx = parsed.header.indexOf("needs");
    const listId = "LS-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    let position = 0;
    for (const cells of parsed.rows) {
      const name = (cells[nameIdx] ?? "").trim();
      if (!name) continue;
      const group = (cells[groupIdx] ?? "").trim();
      const needs = (cells[needsIdx] ?? "").trim();
      const folded = foldName(name);
      const listedTwice = seen.has(folded);
      seen.add(folded);
      position++;
      const id = "PS-" + hire.rows[0].reference + "-" + position + "-" + Math.random().toString(36).slice(2, 6);
      const wheelchair = /wheelchair/i.test(needs);
      await ctx.db.query(
        `INSERT INTO passengers (id, desk_id, hire_id, name, "group", needs, listed_twice, wheelchair, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, deskId, hire.rows[0].id, name, group, needs, listedTwice, wheelchair, position]
      );
      out.push({ id, name, group, needs, listedTwice, wheelchair });
    }
    const key = objectKeyForPassengers(deskId, String(hire.rows[0].id), listId);
    try {
      await s3Put(ctx.cfg, key, Buffer.from(text, "utf8"), "text/csv");
    } catch {
      throw errors.provider("The file store is unavailable right now. Nothing was saved.");
    }
    await ctx.db.query("INSERT INTO passenger_files (id, desk_id, hire_id, object_key, created_at) VALUES ($1,$2,$3,$4,NOW())", [
      listId,
      deskId,
      hire.rows[0].id,
      key
    ]);
    await autoSeatPassengers(ctx, deskId, String(hire.rows[0].id));
    res.status(201).json({ listId, objectKey: key, passengers: out });
  });
  app.post("/api/hires/:id/passengers", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const group = typeof body.group === "string" ? body.group : "";
    const needs = typeof body.needs === "string" ? body.needs : "";
    if (!name) throw errors.invalid({ name: "Enter your name." });
    const all = await ctx.db.query("SELECT name FROM passengers WHERE desk_id=$1 AND hire_id=$2", [deskId, hire.rows[0].id]);
    const listedTwice = all.rows.some((x) => foldName(String(x.name)) === foldName(name));
    const wheelchair = /wheelchair/i.test(needs);
    const position = all.rows.length + 1;
    const id = "PS-" + hire.rows[0].reference + "-" + position + "-" + Math.random().toString(36).slice(2, 6);
    await ctx.db.query(
      `INSERT INTO passengers (id, desk_id, hire_id, name, "group", needs, listed_twice, wheelchair, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, deskId, hire.rows[0].id, name, group, needs, listedTwice, wheelchair, position]
    );
    await autoSeatPassengers(ctx, deskId, String(hire.rows[0].id));
    res.status(201).json({ id, name, group, needs, listedTwice, wheelchair });
  });
  app.get("/api/hires/:id/passengers", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await passengersAnswer(ctx, deskId, String(hire.rows[0].id), String(hire.rows[0].occasion)));
  });
  app.get("/api/hires/:id/seats", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await seatsAnswer(ctx, deskId, String(hire.rows[0].id)));
  });
  app.put("/api/hires/:id/seats", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const passengerId = typeof body.passengerId === "string" ? body.passengerId : "";
    const seat = typeof body.seat === "string" ? body.seat : "";
    const vehicle = await ctx.db.query("SELECT * FROM vehicles WHERE desk_id=$1 AND id=$2 AND hire_id=$3", [deskId, vehicleId, hire.rows[0].id]);
    if (!vehicle.rows[0]) throw errors.notFound();
    const passenger = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND id=$2 AND hire_id=$3", [deskId, passengerId, hire.rows[0].id]);
    if (!passenger.rows[0]) throw errors.notFound();
    const grid = seatGridFor(Number(vehicle.rows[0].seats));
    if (!grid.includes(seat)) throw errors.invalid({ seat: "We can't find that." });
    if (passenger.rows[0].wheelchair && !WHEELCHAIR_SEATS.includes(seat)) {
      throw errors.state("wheelchairSeat", "Wheelchair users sit only in 2A and 2B.");
    }
    const occupied = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND vehicle_id=$2 AND seat=$3 AND id<>$4", [
      deskId,
      vehicleId,
      seat,
      passengerId
    ]);
    if (occupied.rows[0]) {
      const other = occupied.rows[0];
      const oldSeat = passenger.rows[0].seat;
      await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [vehicleId, String(oldSeat ?? ""), other.id]);
    }
    await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [vehicleId, seat, passengerId]);
    res.json(await seatsAnswer(ctx, deskId, String(hire.rows[0].id)));
  });
  app.get("/api/hires/:id/passengers/download", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const customer = await ctx.db.query("SELECT name FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
    const passengers = await ctx.db.query("SELECT p.*, v.seats AS vehicle_seats FROM passengers p LEFT JOIN vehicles v ON v.id=p.vehicle_id WHERE p.desk_id=$1 AND p.hire_id=$2 ORDER BY p.position", [deskId, hire.rows[0].id]);
    const rows = passengers.rows.map((x) => [String(x.name), String(x.group ?? ""), String(x.needs ?? ""), x.vehicle_seats ? String(x.vehicle_seats) : "", x.seat ? String(x.seat) : ""]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.set(fileHeaders(String(customer.rows[0]?.name ?? "customer") + " passengers", "csv"));
    res.send(csvBody(["Name", "Group", "Needs", "Vehicle", "Seat"], rows));
  });
  app.post("/api/hires/:id/changes/preview", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    res.json(await changesAnswer(ctx, deskId, hire.rows[0], body, true));
  });
  app.post("/api/hires/:id/changes", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    if (hire.rows[0].stage !== "accepted") throw errors.state("beforeAcceptance", "This hire has no accepted quote yet.");
    const preview = await changesAnswer(ctx, deskId, hire.rows[0], body, false);
    await applyChange(ctx, deskId, hire.rows[0], body);
    const after = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hire.rows[0].id]);
    res.status(201).json({ ...preview, id: String(after.rows[0].id), quotePath: after.rows[0].quote_path ? String(after.rows[0].quote_path) : null });
  });
  app.get("/api/hires/:id/changes", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const changes = await ctx.db.query("SELECT * FROM hire_changes WHERE desk_id=$1 AND hire_id=$2 ORDER BY at", [deskId, hire.rows[0].id]);
    res.json({ changes: changes.rows.map(changeOut), cancellation: null });
  });
  app.post("/api/hires/:id/cancel/preview", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = await readJson(req);
    res.json(await cancellationAnswer(ctx, deskId, hire.rows[0], body));
  });
  app.post("/api/hires/:id/cancel", async (req, res) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    if (hire.rows[0].cancelled) {
      const existing = await ctx.db.query("SELECT * FROM cancellations WHERE desk_id=$1 AND hire_id=$2", [deskId, hire.rows[0].id]);
      res.json({ cancellation: cancellationOut(existing.rows[0]) });
      return;
    }
    const body = await readJson(req);
    const answer = (await cancellationAnswer(ctx, deskId, hire.rows[0], body)).cancellation;
    await ctx.db.query("UPDATE hires SET cancelled=TRUE, cancelled_at=NOW() WHERE id=$1", [hire.rows[0].id]);
    await ctx.db.query("INSERT INTO cancellations (id, desk_id, hire_id, notice_at, by, lines) VALUES ($1,$2,$3,$4,$5,$6)", [
      answer.id,
      deskId,
      hire.rows[0].id,
      new Date(String(answer.noticeAt)),
      answer.by,
      JSON.stringify(answer.lines)
    ]);
    res.json({ cancellation: answer });
  });
}
function changeOut(r) {
  return {
    id: String(r.id),
    at: isoInstant(r.at),
    old: r.old_data,
    new: r.new_data,
    priceMoved: Boolean(r.price_moved)
  };
}
function cancellationOut(r) {
  return {
    id: String(r.id),
    noticeAt: isoInstant(r.notice_at),
    by: String(r.by),
    lines: r.lines
  };
}
async function quotePageAnswer(ctx, token, check) {
  const t = await ctx.db.query("SELECT * FROM quote_tokens WHERE token=$1", [token]);
  if (!t.rows[0]) throw errors.notFound();
  const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [t.rows[0].hire_id]);
  if (!hire.rows[0]) throw errors.notFound();
  if (t.rows[0].replaced_at) throw errors.ended();
  const deskId = String(t.rows[0].desk_id);
  const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
  if (!customer.rows[0] || customer.rows[0].state === "erased") throw errors.ended();
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [hire.rows[0].reference]);
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.rows[0].id));
  const money2 = await vehicleMoney(ctx, deskId, vehicles);
  const now = /* @__PURE__ */ new Date();
  const endsAt = hire.rows[0].quote_ends_at ? hire.rows[0].quote_ends_at : null;
  const accepted = hire.rows[0].stage === "accepted" || hire.rows[0].stage === "deposit" || hire.rows[0].stage === "balance";
  const stageValue = stageFor(hire.rows[0], money2.paymentState, vehicles, now);
  const language = String(customer.rows[0].language ?? "en");
  let state;
  if (accepted) state = "accepted";
  else if (endsAt && now.getTime() > endsAt.getTime()) state = "ended";
  else state = "open";
  let total = 0;
  let depositTotal = 0;
  for (const v of vehicles) {
    total += v.total;
    depositTotal += v.deposit;
  }
  const departInstant = hire.rows[0].depart_instant;
  const data = {
    hireId: String(hire.rows[0].id),
    deskId,
    customer: { name: String(customer.rows[0].name) },
    language
  };
  if (check) check(data);
  return {
    hireId: data.hireId,
    deskId: data.deskId,
    reference: String(hire.rows[0].reference),
    language,
    state,
    stage: stageValue,
    stops: stops.rows.map((x) => String(x.text)),
    departAt: { date: String(hire.rows[0].depart_date), time: String(hire.rows[0].depart_time) },
    departInstant: isoInstant(departInstant),
    returnAt: hire.rows[0].return_date ? { date: String(hire.rows[0].return_date), time: String(hire.rows[0].return_time) } : null,
    returnInstant: hire.rows[0].return_instant ? isoInstant(hire.rows[0].return_instant) : null,
    people: Number((await ctx.db.query("SELECT people FROM enquiries WHERE desk_id=$1 AND reference=$2", [deskId, hire.rows[0].reference])).rows[0]?.people ?? 0),
    vehicles: vehicles.map((v) => ({ seats: v.seats, total: penniesToString(v.total), deposit: penniesToString(v.deposit) })),
    total: penniesToString(total),
    depositTotal: penniesToString(depositTotal),
    validUntil: endsAt ? ukDateString(new Date(endsAt.getTime() - 1e3)) : null,
    endsAt: endsAt ? isoInstant(endsAt) : null,
    depositSaidSent: Boolean(hire.rows[0].deposit_said_sent),
    cancelled: Boolean(hire.rows[0].cancelled),
    endedLineDate: endsAt ? ukDateString(new Date(endsAt.getTime() - 1e3)) : null
  };
}
function stageFor(hire, paymentState, vehicles, now) {
  if (vehicles.some((v) => v.departInstant && v.departInstant.getTime() <= now.getTime())) return "travel";
  if (hire.stage === "accepted" || hire.stage === "deposit" || hire.stage === "balance") {
    if (paymentState === "paidInFull") return "balance";
    if (paymentState === "depositPaid") return "deposit";
    return "accepted";
  }
  return "quoteSent";
}
async function autoSeatPassengers(ctx, deskId, hireId) {
  const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hireId]);
  if (!hire.rows[0]) return;
  const vehicles = await vehiclesFor(ctx.db, deskId, hireId);
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  const seated = new Set(
    (await ctx.db.query("SELECT vehicle_id, seat FROM passengers WHERE desk_id=$1 AND hire_id=$2 AND seat IS NOT NULL", [deskId, hireId])).rows.map(
      (x) => `${x.vehicle_id}|${x.seat}`
    )
  );
  let vehicleIndex = 0;
  for (const p of passengers.rows) {
    if (p.seat) continue;
    const wheelchair = Boolean(p.wheelchair);
    if (wheelchair) {
      const v = vehicles.find((x) => x.seats === 16 || x.seats === 49) ?? vehicles[0];
      if (!v) continue;
      for (const s of WHEELCHAIR_SEATS) {
        if (!seated.has(`${v.id}|${s}`)) {
          await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [v.id, s, p.id]);
          seated.add(`${v.id}|${s}`);
          break;
        }
      }
      continue;
    }
    while (vehicleIndex < vehicles.length) {
      const v = vehicles[vehicleIndex];
      const grid = seatGridFor(v.seats);
      let placed = false;
      for (const s of grid) {
        if (WHEELCHAIR_SEATS.includes(s) && (v.seats === 16 || v.seats === 49)) continue;
        if (!seated.has(`${v.id}|${s}`)) {
          await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [v.id, s, p.id]);
          seated.add(`${v.id}|${s}`);
          placed = true;
          break;
        }
      }
      if (placed) break;
      vehicleIndex++;
    }
  }
}
async function passengersAnswer(ctx, deskId, hireId, occasion) {
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  const rows = passengers.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    group: x.group ? String(x.group) : "",
    needs: x.needs ? String(x.needs) : "",
    listedTwice: Boolean(x.listed_twice),
    wheelchair: Boolean(x.wheelchair)
  }));
  let adultsNeededCount = 0;
  let adults = 0;
  let pupils = 0;
  if (occasion === "school") {
    for (const r of rows) {
      if (String(r.group).toLowerCase() === "adult") adults++;
      else pupils++;
    }
    adultsNeededCount = adultsNeeded(pupils);
  }
  const adultsShort = Math.max(0, adultsNeededCount - adults);
  return { passengers: rows, adultsNeeded: adultsNeededCount, adultsShort };
}
async function seatsAnswer(ctx, deskId, hireId) {
  const vehicles = await vehiclesFor(ctx.db, deskId, hireId);
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  const byId = new Map(passengers.rows.map((x) => [String(x.id), x]));
  const out = [];
  for (const v of vehicles) {
    const grid = seatGridFor(v.seats);
    const seated = /* @__PURE__ */ new Map();
    for (const p of passengers.rows) {
      if (p.vehicle_id === v.id && p.seat) seated.set(String(p.seat), String(p.id));
    }
    const gridOut = grid.map((s) => ({ seat: s, passengerId: seated.get(s) ?? null }));
    const seatedIds = [...seated.values()];
    const seatedRows = seatedIds.map((id) => byId.get(id)).filter(Boolean);
    const split = splitEvenly(v.total, seatedRows.length);
    out.push({
      id: v.id,
      seats: v.seats,
      grid: gridOut,
      split: seatedRows.map((p, i) => ({ passengerId: String(p.id), name: String(p.name), amount: penniesToString(split[i] ?? 0) }))
    });
  }
  return { vehicles: out };
}
async function changesAnswer(ctx, deskId, hire, body, preview) {
  if (hire.stage !== "accepted" && hire.stage !== "deposit" && hire.stage !== "balance") {
    throw errors.state("beforeAcceptance", "This hire has no accepted quote yet.");
  }
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [hire.reference]);
  const oldAnswer = {
    departAt: { date: String(hire.depart_date), time: String(hire.depart_time) },
    stops: stops.rows.map((x) => String(x.text)),
    vehicles: vehicles.map((v) => ({ id: v.id, boughtPrice: v.bought === null ? null : penniesToString(v.bought), marginPercent: v.margin, total: penniesToString(v.total), deposit: penniesToString(v.deposit) })),
    total: penniesToString(vehicles.reduce((s, v) => s + v.total, 0))
  };
  const departAt = body.departAt ? parseLocalDate(body.departAt, "departAt") : null;
  const newStops = Array.isArray(body.stops) ? body.stops.map(String) : null;
  const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
  const rate = await rateTableForDate(ctx, deskId, String(hire.depart_date));
  const newVehicles = [];
  const priceMovedList = [];
  for (const v of vehicles) {
    const change = vehiclesIn.find((x) => typeof x.id === "string" && String(x.id) === v.id);
    const bought = change && typeof change.boughtPrice === "string" ? parseBidPrice(change.boughtPrice) : v.bought;
    const margin = change && typeof change.marginPercent === "string" ? change.marginPercent : v.margin ?? "15";
    const { quoteVehicleMoney: quoteVehicleMoney2 } = await Promise.resolve().then(() => (init_rules(), rules_exports));
    const money2 = bought !== null ? quoteVehicleMoney2(bought, margin, v.seats, rate.deposits) : null;
    const newTotal = money2?.total ?? v.total;
    const paid = await paidFor(ctx, deskId, v.id);
    const depositOld = v.deposit;
    const refundsDue = Math.max(0, paid - Math.max(newTotal, depositOld));
    const owed = Math.max(0, newTotal - paid);
    newVehicles.push({
      id: v.id,
      boughtPrice: bought === null ? null : penniesToString(bought),
      marginPercent: margin,
      total: penniesToString(newTotal),
      deposit: penniesToString(money2?.deposit ?? depositOld)
    });
    priceMovedList.push({ vehicleId: v.id, refundsDue, owed });
  }
  const priceMoved = newVehicles.some((nv, i) => String(nv.total) !== penniesToString(vehicles[i].total)) || departAt !== null || newStops !== null;
  return {
    old: oldAnswer,
    new: {
      departAt: departAt ? { date: departAt.date, time: departAt.time } : oldAnswer.departAt,
      stops: newStops ?? oldAnswer.stops,
      vehicles: newVehicles,
      total: penniesToString(newVehicles.reduce((s, v) => s + Math.round(Number(v.total) * 100), 0))
    },
    priceMoved,
    lines: priceMovedList,
    preview
  };
}
async function paidFor(ctx, deskId, vehicleId) {
  const r = await ctx.db.query("SELECT COALESCE(SUM(amount_pennies),0) AS s FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2 AND account='clientMoney'", [deskId, vehicleId]);
  return Number(r.rows[0].s);
}
async function applyChange(ctx, deskId, hire, body) {
  const departAt = body.departAt ? parseLocalDate(body.departAt, "departAt") : null;
  if (departAt) {
    await ctx.db.query("UPDATE hires SET depart_date=$1, depart_time=$2, depart_instant=$3 WHERE id=$4", [departAt.date, departAt.time, departAt.instant, hire.id]);
    await ctx.db.query("UPDATE runs SET depart_date=$1, depart_time=$2, depart_instant=$3, told_at=NULL WHERE hire_id=$4", [departAt.date, departAt.time, departAt.instant, hire.id]);
    await ctx.db.query("UPDATE vehicles SET depart_date=$1, depart_time=$2, depart_instant=$3 WHERE hire_id=$4", [departAt.date, departAt.time, departAt.instant, hire.id]);
  }
  const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
  const rate = await rateTableForDate(ctx, deskId, isoDate(hire.depart_date));
  const { quoteVehicleMoney: quoteVehicleMoney2 } = await Promise.resolve().then(() => (init_rules(), rules_exports));
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const changedIds = /* @__PURE__ */ new Set();
  for (const v of vehicles) {
    const change = vehiclesIn.find((x) => typeof x.id === "string" && String(x.id) === v.id);
    if (!change) continue;
    changedIds.add(v.id);
    const bought = typeof change.boughtPrice === "string" ? parseBidPrice(change.boughtPrice) : v.bought;
    const margin = typeof change.marginPercent === "string" ? change.marginPercent : v.margin ?? "15";
    const money2 = bought !== null ? quoteVehicleMoney2(bought, margin, v.seats, rate.deposits) : null;
    await ctx.db.query(
      "UPDATE vehicles SET bought_pennies=$1, margin_percent=$2, selling_pennies=$3, vat_pennies=$4, total_pennies=$5, deposit_pennies=$6 WHERE id=$7",
      [bought, margin, money2?.selling ?? v.selling, money2?.vat ?? v.vat, money2?.total ?? v.total, money2?.deposit ?? v.deposit, v.id]
    );
  }
  await ctx.db.query("INSERT INTO hire_changes (id, desk_id, hire_id, at, old_data, new_data, price_moved) VALUES ($1,$2,$3,NOW(),$4,$5,$6)", [
    "CH-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    deskId,
    hire.id,
    JSON.stringify(body.old ?? null),
    JSON.stringify(body.new ?? null),
    Boolean(body.priceMoved)
  ]);
  const priceMoved = changedIds.size > 0 || departAt !== null;
  if (priceMoved) {
    await ctx.db.query("UPDATE quote_tokens SET replaced_at=NOW() WHERE desk_id=$1 AND hire_id=$2 AND replaced_at IS NULL", [deskId, hire.id]);
    const token = "q" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const now = /* @__PURE__ */ new Date();
    const endsAt = quoteEndFor2(now, ctx.cfg.quoteValidSeconds);
    await ctx.db.query("UPDATE hires SET quote_path=$1, quote_sent_at=$2, quote_ends_at=$3 WHERE id=$4", [token, now, endsAt, hire.id]);
    await ctx.db.query("INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,$4,$5)", [
      token,
      deskId,
      hire.id,
      Number(hire.quote_version),
      now
    ]);
    const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.customer_id]);
    const vehicles2 = await vehiclesFor(ctx.db, deskId, String(hire.id));
    const total = vehicles2.reduce((s, v) => s + v.total, 0);
    await sendQuoteMail(ctx, String(customer.rows[0]?.email ?? ""), String(hire.reference), String(customer.rows[0]?.language ?? "en"), total, endsAt, token);
  }
}
async function cancellationAnswer(ctx, deskId, hire, body) {
  const notice = parseLocalDate(body.noticeAt ?? {}, "noticeAt");
  const by = body.by === "arranger" ? "arranger" : "customer";
  const departDate = String(hire.depart_date);
  const now = serverNowMinute();
  const departInstant = hire.depart_instant;
  if (notice.instant.getTime() >= departInstant.getTime() && departInstant.getTime() <= now.getTime()) {
    throw errors.state("departureGone", "This departure has already gone.");
  }
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const lines = [];
  for (const v of vehicles) {
    const days = cancellationDays(departDate, notice.date);
    const paid = await paidFor(ctx, deskId, v.id);
    let charge;
    let refundsDue = 0;
    let owed = 0;
    if (by === "arranger") {
      charge = 0;
      refundsDue = paid;
    } else {
      charge = cancellationCharge(days, v.total, v.deposit);
      if (paid > charge) refundsDue = paid - charge;
      if (paid < charge) owed = charge - paid;
    }
    lines.push({ vehicleId: v.id, days, charge: penniesToString(charge), paid: penniesToString(paid), refundsDue: penniesToString(refundsDue), owed: penniesToString(owed) });
  }
  return {
    cancellation: {
      id: "CX-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
      noticeAt: isoInstant(notice.instant),
      by,
      lines
    }
  };
}

// src/server/app.ts
init_documents();
init_aftercare();

// src/server/pages.ts
var import_express = __toESM(require("express"), 1);
init_auth2();
init_errors();
init_http();
var import_node_fs = require("fs");
var import_node_path = require("path");

// src/server/pages/html.ts
function escapeHtml2(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function attr(s) {
  return escapeHtml2(s === null || s === void 0 ? "" : String(s));
}
var APP_CSS = "/assets/app.css";
var APP_JS = "/assets/client.js";

// src/server/pages/shell.ts
var NAV = [
  { path: "/", label: "Home" },
  { path: "/occasions/school", label: "School trips" },
  { path: "/occasions/weddings", label: "Weddings" },
  { path: "/occasions/company", label: "Company travel" },
  { path: "/occasions/festivals", label: "Festivals and sport" },
  { path: "/fleet", label: "Fleet" },
  { path: "/terms", label: "Terms" }
];
function shell(meta, body, opts = {}) {
  const lang = opts.lang ?? "en";
  const dir = opts.dir ?? "ltr";
  const current = NAV.find((n) => n.path === meta.path);
  const navLinks = NAV.map(
    (n) => `<a href="${n.path}"${n.path === meta.path ? ' aria-current="page"' : ""}>${escapeHtml2(n.label)}</a>`
  ).join("");
  const announce = `<div role="region" aria-label="Announcements" data-part="announcements" class="announcements" aria-live="polite"></div>`;
  const header = opts.public ? `
  <header class="masthead" data-part="masthead">
    <div class="masthead-inner">
      <a class="wordmark" href="/">Merrowfield<span>Coach Hire</span></a>
      <svg class="coach-mark" viewBox="0 0 220 90" aria-hidden="true" focusable="false"><rect x="4" y="16" width="200" height="56" fill="var(--plum)"/><rect x="4" y="16" width="200" height="10" fill="var(--cyan-bright)"/><circle cx="44" cy="74" r="12" fill="var(--ink)"/><circle cx="168" cy="74" r="12" fill="var(--ink)"/><rect x="18" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="52" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="86" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="120" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="154" y="30" width="30" height="16" fill="var(--cyan)"/></svg>
      <div class="call-block">
        <span class="call-label">Talk to the desk</span>
        <a class="call-link" href="tel:01632960140">Call 01632 960140</a>
        <a class="quote-link" href="/quote/route">Get a free quote</a>
      </div>
    </div>
    <nav class="underline-nav" aria-label="Main">${navLinks}</nav>
  </header>
  <div class="phone-top-bar" data-part="phone-top-bar">
    <a class="wordmark" href="/">Merrowfield<span>Coach Hire</span></a>
    <a class="phone-call" href="tel:01632960140">Call 01632 960140</a>
    <button type="button" class="menu-button" data-open="menu" aria-haspopup="dialog" aria-expanded="false">Menu</button>
  </div>
  <div class="slim-bar" data-part="slim-bar" hidden>
    <a class="wordmark" href="/">Merrowfield<span>Coach Hire</span></a>
    <nav aria-label="Main">${navLinks}</nav>
    <a class="quote-link" href="/quote/route">Get a free quote</a>
  </div>
  <div class="overlay-menu" data-overlay="menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>
    <button type="button" class="close" data-close="menu">Close</button>
    <nav aria-label="Main">${navLinks}<a href="tel:01632960140">Call 01632 960140</a></nav>
  </div>` : "";
  const search = opts.public ? `
  <button type="button" class="search-button" data-open="search" aria-haspopup="dialog" aria-expanded="false">Search</button>
  <div class="overlay-search" data-overlay="search" role="dialog" aria-modal="true" aria-label="Search" hidden>
    <button type="button" class="close" data-close="search">Close</button>
    <form action="/search" method="get" data-search>
      <label class="field"><span class="label">Search the site</span><input type="search" name="q" class="search-input" autocomplete="off"></label>
      <button type="submit">Search</button>
    </form>
    <ul class="search-results" role="list" aria-label="Search results" data-results></ul>
  </div>` : "";
  const floating = opts.public ? `
  <a class="message-us" href="mailto:maria@merrowfield.example" aria-label="Message us" data-part="message-us"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" stroke-width="2"/></svg></a>
  <button type="button" class="back-to-top" data-back-to-top hidden>Back to top</button>` : "";
  const footer = opts.public ? `
  <footer class="footer">
    <p><a href="/terms">Terms</a> | <a href="/fleet">Fleet</a></p>
    <p>Merrowfield Coach Hire, Coventry</p>
  </footer>` : "";
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml2(meta.title)}</title>
<link rel="stylesheet" href="${APP_CSS}">
<script src="${APP_JS}" defer></script>
</head>
<body data-page="${attr(meta.path)}">
${announce}
${header}
${search}
<main id="main">
${body}
</main>
${footer}
${floating}
</body>
</html>`;
}
function deskShell(meta, _deskName, body) {
  const navLinks = [
    ["Enquiries", "/enquiries"],
    ["Operators", "/operators"],
    ["Payments", "/payments"],
    ["Diary", "/diary"],
    ["Documents", "/documents"],
    ["Rate tables", "/rates"],
    ["Customers", "/customers"],
    ["Complaints", "/aftercare/complaints"],
    ["Lost property", "/aftercare/lost-property"]
  ].map(([label, path]) => `<a href="${path}"${meta.path === path ? ' aria-current="page"' : ""}>${escapeHtml2(label)}</a>`).join("");
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml2(meta.title)}</title>
<link rel="stylesheet" href="${APP_CSS}">
<script src="${APP_JS}" defer></script>
</head>
<body data-page="${attr(meta.path)}" data-desk-shell>
<div role="region" aria-label="Announcements" data-part="announcements" class="announcements" aria-live="polite"></div>
<header class="desk-band">
  <div class="desk-band-inner">
    <div class="desk-top">
      <a class="wordmark" href="/enquiries">Wayticket</a>
      <div class="desk-tools">
        <button type="button" class="menu-button" data-open="desk-menu" aria-haspopup="dialog" aria-expanded="false">Menu</button>
        <button type="button" data-action="change-password">Change password</button>
        <button type="button" data-action="sign-out">Sign out</button>
      </div>
    </div>
    <h1>${escapeHtml2(meta.h1)}</h1>
    <nav class="desk-nav" aria-label="Desk">${navLinks}</nav>
  </div>
</header>
<div class="phone-desk-bar">
  <a class="wordmark" href="/enquiries">Wayticket</a>
  <button type="button" class="menu-button" data-open="desk-menu" aria-expanded="false">Menu</button>
</div>
<div class="overlay-menu desk-overlay" data-overlay="desk-menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>
  <button type="button" class="close" data-close="desk-menu">Close</button>
  <nav aria-label="Desk">${navLinks}</nav>
  <button type="button" data-action="change-password">Change password</button>
  <button type="button" data-action="sign-out">Sign out</button>
</div>
<div class="refresh-line" data-part="refresh-line" hidden>Couldn't refresh. Trying again.</div>
<main id="main">
${body}
</main>
<div class="dialog-holder" data-dialogs></div>
<div class="bottom-bar" data-bottom-bar></div>
</body>
</html>`;
}
function notFoundShell(title, h1, lang = "en", dir = "ltr", ended = false) {
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml2(title)}</title>
<link rel="stylesheet" href="${APP_CSS}">
</head>
<body data-page="notfound" class="plain-page">
<main id="main" class="plain-main">
<h1>${escapeHtml2(h1)}</h1>
${ended ? '<p class="ended-copy">This page has ended.</p>' : `<p class="notfound-copy">We can't find that.</p>`}
</main>
</body>
</html>`;
}

// src/server/pages/public.ts
function homeBody() {
  return `
<section class="hero" data-part="hero">
  <div class="hero-inner">
    <h1>Coaches and minibuses with a driver</h1>
    <p class="hero-sub">Arranged for you from Coventry</p>
  </div>
</section>
<section class="client-marks" data-part="client-marks" aria-label="Client marks">
  <button type="button" data-marks="earlier" class="marks-button">Earlier</button>
  <ul class="marks-list" data-marks-list>
    <li>Aldermoor Primary</li><li>Foleshill Tools</li><li>Kenilworth Keep</li><li>Ardenside FC</li><li>Walsall Lock</li>
  </ul>
  <button type="button" data-marks="later" class="marks-button">Later</button>
</section>
<section class="promise" data-part="promise">
  <div class="promise-inner">
    <h2>One desk, one person, every detail checked</h2>
    <svg class="promise-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="M8 20h34v22H8z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M42 28h8l6 6v8h-14z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="44" r="5" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="42" cy="44" r="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M30 8v12" fill="none" stroke="currentColor" stroke-width="3"/></svg>
    <ul class="promise-lines">
      <li>Partner operators asked for you</li>
      <li>Papers checked for your last day</li>
      <li>Drivers' hours checked before you travel</li>
      <li>One private page for your quote</li>
    </ul>
    <a class="quote-link promise-quote" href="/quote/route">Get a free quote</a>
  </div>
</section>
<section class="split-panels">
  <div class="split-panel">
    <div class="split-drawing">${coachSvg(1)}</div>
    <div class="split-text"><h3>School trips</h3><p>From a morning at a museum to a week away, with the DBS dates checked.</p><a href="/occasions/school">Read about school trips</a></div>
  </div>
  <div class="split-panel reverse">
    <div class="split-text"><h3>Weddings</h3><p>One minibus for the close family, or coaches for the whole day.</p><a href="/occasions/weddings">Read about weddings</a></div>
    <div class="split-drawing">${coachSvg(2)}</div>
  </div>
</section>
<section class="occasion-cards" aria-label="Occasions">
  <a class="occasion-card" href="/occasions/school"><span class="card-drawing">${coachSvg(3)}</span><h3>School<br>trips</h3><ul><li>DBS dates checked</li><li>Seat plan printed</li><li>One invoice for the office</li></ul></a>
  <a class="occasion-card" href="/occasions/weddings"><span class="card-drawing">${coachSvg(4)}</span><h3>Weddings</h3><ul><li>Guests moved on time</li><li>Polish or Urdu quote</li><li>Waiting charges shown</li></ul></a>
  <a class="occasion-card" href="/occasions/company"><span class="card-drawing">${coachSvg(5)}</span><h3>Company<br>travel</h3><ul><li>Shuttles and day hires</li><li>Credit notes kept straight</li><li>Invoice by calendar year</li></ul></a>
  <a class="occasion-card" href="/occasions/festivals"><span class="card-drawing">${coachSvg(6)}</span><h3>Festivals<br>and sport</h3><ul><li>Waiting worked out per stop</li><li>Comfort stops charged fairly</li><li>Driver run sheet on a phone</li></ul></a>
</section>
<section class="quote-form-band">
  <div class="quote-form-inner">
    <h2>Start your quote</h2>
    <p class="quote-form-copy">Tell us the route, the day and the party. We ask clear operators for their prices and send one private page with your quote.</p>
    <a class="quote-link quote-form-link" href="/quote/route">Start your quote</a>
  </div>
</section>`;
}
function coachSvg(variant) {
  const body = variant % 3 === 0 ? "coach" : "minibus";
  const len = body === "coach" ? 210 : 120;
  const windows = body === "coach" ? 5 : 2;
  let win = "";
  for (let i = 0; i < windows; i++) win += `<rect x="${16 + i * 30}" y="30" width="22" height="16" fill="var(--cyan)"/>`;
  return `<svg class="coach-svg" viewBox="0 0 230 90" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet"><rect x="6" y="16" width="${len}" height="56" fill="var(--plum)"/><rect x="6" y="16" width="${len}" height="8" fill="var(--cyan-bright)"/>${win}<circle cx="46" cy="74" r="11" fill="var(--ink)"/><circle cx="${len - 24}" cy="74" r="11" fill="var(--ink)"/></svg>`;
}
var OCCASIONS = {
  school: {
    slug: "school",
    title: "School trips",
    intro: "School trips by coach and minibus, from a morning at a museum to a week away. Every operator we ask holds an operator licence and public liability cover, and for a school hire we also check the driver's DBS date covers your last day.",
    arrange: [
      "Day trips and residentials by coach or minibus.",
      "Operators whose papers cover your last day, not just today.",
      "A seat plan printed for the party list.",
      "One invoice for the school office, with a credit note if a run changes."
    ],
    tell: [
      "The pick-up and the destination, with any stops between.",
      "The out date and time, and a return if there is one.",
      "How many people, how many bags and any wheelchair users.",
      "A name, an email and a telephone number."
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "Your quote is one private page, in English, Polish or Urdu.",
      "Say you have sent the deposit and the desk matches it to the bank statement."
    ],
    answer: "We answer within three working days in England and Wales."
  },
  weddings: {
    slug: "weddings",
    title: "Weddings",
    intro: "Weddings and the guests around them: one minibus for the close family or coaches for the whole day. The quote reaches you in English, Polish or Urdu, and waiting charges are shown before the balance is due.",
    arrange: [
      "Guests moved on time, with the driver's hours checked before the day.",
      "One private page holding the quote, the party and the vehicles.",
      "Waiting charged per stop and only after the desk accepts it."
    ],
    tell: [
      "The pick-up, the ceremony and the reception.",
      "The times, including which side of a clock change.",
      "The party size, bags and any wheelchair users."
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before the day.",
      "Your quote is one private page, in English, Polish or Urdu.",
      "A cancellation is charged by UK calendar days between your notice and the day."
    ],
    answer: "Popular Saturdays go early, so ask as soon as the venue is fixed."
  },
  company: {
    slug: "company",
    title: "Company travel",
    intro: "Company travel: shuttles between sites, a day at a conference, or the Christmas party run. One desk collects the prices and one invoice follows, with a credit note if a run changes.",
    arrange: [
      "Shuttles, day hires and multi-day runs.",
      "Operators clear for the hire's last day.",
      "Invoices numbered without gaps by calendar year."
    ],
    tell: [
      "The route and the stops in order.",
      "The dates and the times.",
      "The numbers travelling and any wheelchair users."
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "One invoice follows the hire, with a credit note if a run changes.",
      "A bank statement brings the money in, matched to the booking."
    ],
    answer: "Ask as soon as the dates are fixed and we will do the rest."
  },
  festivals: {
    slug: "festivals",
    title: "Festivals and sport",
    intro: "Festivals and sport: the coach that waits, or the minibuses that shuttle all weekend. Waiting time and comfort stops are worked out per stop and shown before you accept them.",
    arrange: [
      "Coaches that wait at the gate and minibuses that shuttle.",
      "Waiting counted from the flight when the stop is an airport.",
      "The driver's run sheet on a phone, working with no signal."
    ],
    tell: [
      "The pick-up and the ground.",
      "The times, and the flight number for an airport pick-up.",
      "The party size and any wheelchair users."
    ],
    payment: [
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "Waiting and comfort charges are shown before the balance is asked for.",
      "A cancellation is charged by UK calendar days between your notice and the day."
    ],
    answer: "Festival weekends fill early, so ask as soon as you know the date."
  }
};
function occasionBody(slug) {
  const o = OCCASIONS[slug];
  return `
<div class="occ-hero">
  <h1>${escapeHtml2(o.title)}</h1>
  <a class="quote-link occ-quote" href="/quote?occasion=${attr(slug)}">Get a free quote</a>
</div>
<nav class="on-this-page" aria-label="On this page" data-rail>
  <h2>On this page</h2>
  <ul>
    <li><a href="#what-we-arrange" data-rail-link>What we arrange</a></li>
    <li><a href="#what-to-tell-us" data-rail-link>What to tell us</a></li>
    <li><a href="#how-payment-works" data-rail-link>How payment works</a></li>
    <li><a href="#questions" data-rail-link>Questions</a></li>
  </ul>
</nav>
<section id="what-we-arrange" class="occ-section" data-observe>
  <h2>What we arrange</h2>
  <p>${escapeHtml2(o.intro)}</p>
  <ul class="checklist">${o.arrange.map((x) => `<li>${escapeHtml2(x)}</li>`).join("")}</ul>
</section>
<section id="what-to-tell-us" class="occ-section" data-observe>
  <h2>What to tell us</h2>
  <ul class="checklist">${o.tell.map((x) => `<li>${escapeHtml2(x)}</li>`).join("")}</ul>
</section>
<section id="how-payment-works" class="occ-section" data-observe>
  <h2>How payment works</h2>
  <ul class="checklist">${o.payment.map((x) => `<li>${escapeHtml2(x)}</li>`).join("")}</ul>
</section>
<section id="questions" class="occ-section" data-observe>
  <h2>Questions</h2>
  <div class="accordion" data-accordion>
    <h3 class="accordion-heading"><button type="button" aria-expanded="false" aria-controls="how-early" id="how-early-button">How early should we ask?</button></h3>
    <div class="accordion-panel" id="how-early" role="region" aria-labelledby="how-early-button" hidden><p>${escapeHtml2(o.answer)}</p></div>
  </div>
  <div class="accordion" data-accordion>
    <h3 class="accordion-heading"><button type="button" aria-expanded="false" aria-controls="who-checks" id="who-checks-button">Who checks the driver?</button></h3>
    <div class="accordion-panel" id="who-checks" role="region" aria-labelledby="who-checks-button" hidden><p>We do, against the operator's papers and the drivers' hours rules, before the run is confirmed.</p></div>
  </div>
  <div class="accordion" data-accordion>
    <h3 class="accordion-heading"><button type="button" aria-expanded="false" aria-controls="plans-change" id="plans-change-button">What happens if plans change?</button></h3>
    <div class="accordion-panel" id="plans-change" role="region" aria-labelledby="plans-change-button" hidden><p>We reprice and show you the change side by side, and a written cancellation is charged by UK calendar days.</p></div>
  </div>
</section>`;
}
var FLEET = [
  [8, 16, false],
  [12, 24, false],
  [16, 32, true],
  [31, 62, false],
  [49, 98, true],
  [56, 112, false],
  [70, 140, false]
];
function fleetBody() {
  const rows = FLEET.map(
    ([seats, bags, lift]) => `<div class="fleet-row">
  <span class="fleet-drawing">${coachSvg(seats)}</span>
  <p><strong>${seats} seats</strong> \xB7 ${bags} bag units${lift ? " \xB7 lift for two wheelchair users" : ""}</p>
</div>`
  ).join("");
  return `<h1>Our fleet</h1><p class="fleet-lead">Seven sizes, from an 8-seat minibus to a 70-seat coach, with the seats and the bag units for each.</p>${rows}`;
}
function termsBody() {
  return `<h1>Terms</h1>
<div class="terms-text">
<p>Terms of hire. These terms set out what Merrowfield Coach Hire arranges and what you agree to.</p>
<p>We arrange coaches and minibuses operated by partner operators. We are not the operator and we own no vehicles.</p>
<p>A quote is valid for five days from the day it is sent. A deposit holds the seats. The balance is due seven days before departure.</p>
<p>A cancellation by you is charged by the calendar days between your written notice and the departure: thirty days or more takes the deposit only, fifteen to twenty-nine days takes a quarter, eight to fourteen days takes half, and seven days or fewer takes the whole amount.</p>
<p>Complaints are answered within three working days in England and Wales. Found property is held for one calendar month.</p>
</div>`;
}

// src/server/pages/quote-form.ts
var TICKET_LINES = [
  { key: "occasion", label: "Occasion" },
  { key: "journey", label: "Journey" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "stops", label: "Stops" },
  { key: "details", label: "Details" },
  { key: "out", label: "Out" },
  { key: "return", label: "Return" },
  { key: "people", label: "People" },
  { key: "bags", label: "Bags" },
  { key: "wheelchairs", label: "Wheelchair users" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "telephone", label: "Telephone" }
];
function ticketHtml(step) {
  const showing = {
    route: ["occasion", "journey", "from", "to", "stops", "details"],
    when: ["occasion", "journey", "from", "to", "stops", "details", "out", "return", "people", "bags", "wheelchairs"],
    details: ["occasion", "journey", "from", "to", "stops", "details", "out", "return", "people", "bags", "wheelchairs", "name", "email", "telephone"]
  };
  const rows = TICKET_LINES.filter((l) => showing[step].includes(l.key)).map(
    (l) => `<li class="ticket-line" data-ticket-line="${l.key}"${l.key === "stops" || l.key === "details" || l.key === "return" ? " hidden" : ""}><span class="ticket-label">${escapeHtml2(l.label)}</span><span class="ticket-value" data-ticket-value="${l.key}">Not yet given</span></li>`
  ).join("");
  const lines = `<ul class="ticket-lines">${rows}</ul>`;
  return `
<aside class="journey-ticket" aria-label="Journey ticket" data-ticket>
  <h2>Journey ticket</h2>
  ${lines}
</aside>
<div class="ticket-bar" data-ticket-bar>
  <button type="button" class="ticket-open" data-open="ticket-sheet">Journey ticket, <span data-answered-count>0</span> answered</button>
</div>
<div class="sheet ticket-sheet" data-overlay="ticket-sheet" role="dialog" aria-modal="true" aria-label="Journey ticket" hidden>
  <button type="button" class="close" data-close="ticket-sheet">Close</button>
  <h2>Journey ticket</h2>
  ${lines}
</div>`;
}
function addressField(id, label, autocomplete) {
  return `
<div class="field" data-combobox="${id}">
  <label class="field-label" for="${id}">${escapeHtml2(label)}</label>
  <input id="${id}" name="${id}" type="text" class="input" autocomplete="${autocomplete}" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-list" data-address>
  <ul class="combo-list" id="${id}-list" role="listbox" hidden></ul>
</div>`;
}
function quoteFormBody(step, occasion) {
  const headings = {
    route: "Route",
    when: "When and who",
    details: "Your details"
  };
  const h1 = headings[step];
  const routeStep = `
<section class="quote-step" data-step="route" ${step === "route" ? "" : "hidden"}>
  <h2 class="step-h">Route</h2>
  <fieldset class="step-fields">
    <legend class="visually-hidden">Route</legend>
    <div class="field">
      <span class="field-label" id="occasion-label">Occasion</span>
      <div class="radios" role="radiogroup" aria-labelledby="occasion-label" data-occasion>
        <label class="radio"><input type="radio" name="occasion" value="school"${occasion === "school" ? " checked" : ""}><span>School</span></label>
        <label class="radio"><input type="radio" name="occasion" value="weddings"${occasion === "weddings" ? " checked" : ""}><span>Weddings</span></label>
        <label class="radio"><input type="radio" name="occasion" value="company"${occasion === "company" ? " checked" : ""}><span>Company</span></label>
        <label class="radio"><input type="radio" name="occasion" value="festivals"${occasion === "festivals" ? " checked" : ""}><span>Festivals and sport</span></label>
      </div>
    </div>
    <div class="field">
      <span class="field-label" id="journey-label">Journey type</span>
      <div class="journey-type" role="radiogroup" aria-labelledby="journey-label" data-journey-type>
        <label class="segment"><input type="radio" name="journeyType" value="oneWay" checked><span>One way</span></label>
        <label class="segment"><input type="radio" name="journeyType" value="return"><span>Return</span></label>
        <label class="segment"><input type="radio" name="journeyType" value="sameDayReturn"><span>Same day return</span></label>
        <label class="segment"><input type="radio" name="journeyType" value="severalStops"><span>Several stops</span></label>
      </div>
    </div>
    ${addressField("from", "From", "street-address")}
    ${addressField("to", "To", "street-address")}
    <div class="stops-holder" data-stops>
      <button type="button" class="add-stop" data-add-stop>Add a stop</button>
    </div>
    <div class="field" data-stop-details hidden>
      <label class="field-label" for="details">Stop details</label>
      <textarea id="details" name="details" class="input" rows="4" maxlength="2000"></textarea>
    </div>
  </fieldset>
</section>`;
  const whenStep = `
<section class="quote-step" data-step="when" ${step === "when" ? "" : "hidden"}>
  <h2 class="step-h">When and who</h2>
  <fieldset class="step-fields">
    <legend class="visually-hidden">When and who</legend>
    <div class="quick-days">
      <button type="button" class="quick-day" data-quick-day="today" aria-pressed="false">Today</button>
      <button type="button" class="quick-day" data-quick-day="tomorrow" aria-pressed="false">Tomorrow</button>
    </div>
    <div class="field">
      <label class="field-label" for="outDate">Out date</label>
      <div class="date-row">
        <input id="outDate" name="outDate" type="text" inputmode="numeric" class="input date-input" placeholder="DD/MM/YYYY" autocomplete="off">
        <button type="button" class="calendar-open" data-open="out-calendar" aria-haspopup="dialog" aria-expanded="false">Choose out date</button>
      </div>
    </div>
    <div class="time-row">
      <div class="field"><label class="field-label" for="outHour">Out hour</label><select id="outHour" name="outHour" class="input">${hours()}</select></div>
      <div class="field"><label class="field-label" for="outMinutes">Out minutes</label><select id="outMinutes" name="outMinutes" class="input">${minutes15()}</select></div>
    </div>
    <div class="field" data-which-hour hidden>
      <span class="field-label" id="which-label">Which time?</span>
      <div class="radios" role="radiogroup" aria-labelledby="which-label" data-which-hour>
        <label class="radio"><input type="radio" name="repeatedHour" value="first"><span></span></label>
        <label class="radio"><input type="radio" name="repeatedHour" value="second"><span></span></label>
      </div>
    </div>
    <div class="field" data-return-date-holder hidden>
      <label class="field-label" for="returnDate">Return date</label>
      <div class="date-row">
        <input id="returnDate" name="returnDate" type="text" inputmode="numeric" class="input date-input" placeholder="DD/MM/YYYY" autocomplete="off">
        <button type="button" class="calendar-open" data-open="return-calendar" aria-haspopup="dialog" aria-expanded="false">Choose return date</button>
      </div>
    </div>
    <div class="time-row" data-return-time hidden>
      <div class="field"><label class="field-label" for="returnHour">Return hour</label><select id="returnHour" name="returnHour" class="input">${hours()}</select></div>
      <div class="field"><label class="field-label" for="returnMinutes">Return minutes</label><select id="returnMinutes" name="returnMinutes" class="input">${minutes15()}</select></div>
    </div>
    <div class="field"><label class="field-label" for="people">People</label><input id="people" name="people" type="number" min="1" max="400" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="large">Large (23 kg)</label><input id="large" name="large" type="number" min="0" max="40" value="0" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="medium">Medium (15 kg)</label><input id="medium" name="medium" type="number" min="0" max="40" value="0" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="hand">Hand (7 kg)</label><input id="hand" name="hand" type="number" min="0" max="40" value="0" class="input" inputmode="numeric"></div>
    <div class="field"><label class="field-label" for="wheelchairs">Wheelchair users</label><input id="wheelchairs" name="wheelchairs" type="number" min="0" max="10" value="0" class="input" inputmode="numeric"></div>
  </fieldset>
</section>`;
  const detailsStep = `
<section class="quote-step" data-step="details" ${step === "details" ? "" : "hidden"}>
  <h2 class="step-h">Your details</h2>
  <fieldset class="step-fields">
    <legend class="visually-hidden">Your details</legend>
    <div class="field"><label class="field-label" for="name">Name</label><input id="name" name="name" type="text" class="input" autocomplete="name"></div>
    <div class="field"><label class="field-label" for="email">Email</label><input id="email" name="email" type="email" class="input" autocomplete="email"></div>
    <div class="field"><label class="field-label" for="telephone">Telephone</label><input id="telephone" name="telephone" type="tel" class="input" autocomplete="tel"></div>
    <div class="field"><label class="field-label" for="language">Language for your quote</label><select id="language" name="language" class="input"><option value="en" selected>English</option><option value="pl">Polski</option><option value="ur">\u0627\u0631\u062F\u0648</option></select></div>
    <div class="trap" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  </fieldset>
</section>`;
  const back = step === "route" ? "" : `<button type="button" class="back" data-nav="back">Back</button>`;
  const next = step === "details" ? `<button type="button" class="primary" data-action="send-request">Send request</button>` : `<button type="button" class="primary" data-nav="next">Next</button>`;
  return `
<div class="quote-form-wrap" data-quote-form data-step-name="${step}">
  <div class="quote-form-panel">
    <p class="quote-kicker">Get a free quote</p>
    <h1 class="quote-form-title">${escapeHtml2(h1)}</h1>
    <form data-quote-form-form novalidate>
      <div class="group problems" data-problems hidden>
        <h2 class="problems-h">Problems</h2>
        <ul class="problems-list" data-problems-list></ul>
      </div>
      ${routeStep}
      ${whenStep}
      ${detailsStep}
      <div class="step-actions">
        ${back}
        ${next}
      </div>
    </form>
    <div class="calendar" data-overlay="out-calendar" role="dialog" aria-modal="true" aria-label="Choose a date" hidden>
      <div class="calendar-grid" role="grid" aria-label="Choose a date"></div>
      <div class="calendar-nav">
        <button type="button" data-calendar="prev">Previous month</button>
        <button type="button" data-calendar="next">Next month</button>
        <button type="button" class="close" data-close="out-calendar">Close</button>
      </div>
    </div>
    <div class="calendar" data-overlay="return-calendar" role="dialog" aria-modal="true" aria-label="Choose a date" hidden>
      <div class="calendar-grid" role="grid" aria-label="Choose a date"></div>
      <div class="calendar-nav">
        <button type="button" data-calendar="prev">Previous month</button>
        <button type="button" data-calendar="next">Next month</button>
        <button type="button" class="close" data-close="return-calendar">Close</button>
      </div>
    </div>
  </div>
  ${ticketHtml(step)}
</div>`;
}
function hours() {
  let out = "";
  for (let i = 0; i < 24; i++) out += `<option value="${String(i).padStart(2, "0")}">${String(i).padStart(2, "0")}</option>`;
  return out;
}
function minutes15() {
  return ["00", "15", "30", "45"].map((m) => `<option value="${m}">${m}</option>`).join("");
}
function thanksBody(reference) {
  return `<div class="thanks"><h1>Thank you</h1><p class="thanks-copy">Request sent. Your reference is <strong>${escapeHtml2(reference)}</strong>.</p><p><a href="/">Back to the home page</a></p></div>`;
}

// src/server/pages/private.ts
function langFromQuery(q, fallback) {
  return q === "pl" || q === "ur" ? String(q) : fallback;
}
function moneyFormat(v) {
  const n = Number(v);
  const sign = n < 0 ? "-" : "";
  return `${sign}\xA3${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function peopleText(lang, n) {
  if (lang === "pl") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (n === 1) return `${n} osoba`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} osoby`;
    return `${n} os\xF3b`;
  }
  if (lang === "ur") return urduCount(n, "\u0641\u0631\u062F", "\u0627\u0641\u0631\u0627\u062F");
  return englishCount(n, "person", "people");
}
function vehiclesText(lang, n) {
  if (lang === "pl") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (n === 1) return `${n} pojazd`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} pojazdy`;
    return `${n} pojazd\xF3w`;
  }
  if (lang === "ur") return urduCount(n, "\u06AF\u0627\u0691\u06CC", "\u06AF\u0627\u0691\u06CC\u0627\u06BA");
  return englishCount(n, "vehicle", "vehicles");
}
function quotePageBody(v, lang) {
  const s = stringsFor(lang);
  const dir = lang === "ur" ? "rtl" : "ltr";
  const title = `${s.yourQuote} ${v.reference}`;
  const steps = [s.quoteSent, s.accepted, s.deposit, s.balance, s.travel];
  const stageIndex = ["quoteSent", "accepted", "deposit", "balance", "travel"].indexOf(v.stage);
  const stepper = `<ol class="stepper" role="list" aria-label="Progress" data-part="stepper">${steps.map((label, i) => `<li class="stepper-step${i === stageIndex ? ' aria-current="step"' : ""}"${i === stageIndex ? " data-current" : ""}>${escapeHtml2(label)}</li>`).join("")}</ol>`;
  const outLine = v.departAt ? `<p class="q-line"><strong>${s.out}:</strong> ${dateForLang(lang, v.departAt.date)} ${escapeHtml2(v.departAt.time)}</p>` : "";
  const returnLine = v.returnAt ? `<p class="q-line"><strong>${s.return}:</strong> ${dateForLang(lang, v.returnAt.date)} ${escapeHtml2(v.returnAt.time)}</p>` : "";
  const cancelledLine = v.cancelled ? `<p class="q-cancelled">${s.cancelled}</p>` : "";
  const endedLine = !v.cancelled && v.state !== "accepted" && v.endsAt && /* @__PURE__ */ new Date() > new Date(v.endsAt) ? `<p class="q-ended">${s.endedLine} ${dateForLang(lang, String(v.endedLineDate ?? ""))}. ${s.askUs}</p>` : "";
  const action = v.cancelled ? "" : v.state === "accepted" ? `<button type="button" class="primary" data-action="deposit-sent">${s.sentDeposit}</button>` : `<button type="button" class="primary" data-action="accept">${s.accept}</button>`;
  const saidLine = v.depositSaidSent ? `<p class="q-checking">${s.checkingPayment}</p>` : "";
  const body = `
<div class="q-page" data-q-page data-token-placehold>
  <h1>${escapeHtml2(title)}</h1>
  ${stepper}
  ${cancelledLine}
  ${endedLine}
  <h2 class="q-section">${s.route}</h2>
  <ul class="q-stops">${v.stops.map((x) => `<li>${escapeHtml2(x)}</li>`).join("")}</ul>
  <h2 class="q-section">${s.travel}</h2>
  ${outLine}
  ${returnLine}
  <p class="q-line"><strong>${s.party}:</strong> ${peopleText(lang, v.people)}</p>
  <p class="q-line"><strong>${s.vehicles}:</strong> ${vehiclesText(lang, v.vehicles.length)}</p>
  <h2 class="q-section">${s.total}</h2>
  <ul class="q-vehicles">${v.vehicles.map((x) => `<li>${x.seats} \u2014 ${moneyFormat(x.total)}</li>`).join("")}</ul>
  <p class="q-total">${escapeHtml2(s.total)} ${moneyFormat(v.total)}</p>
  <p class="q-deposit">${escapeHtml2(s.depositDue)} ${moneyFormat(v.depositTotal)}</p>
  ${v.validUntil ? `<p class="q-valid">${escapeHtml2(s.validUntil)} ${dateForLang(lang, v.validUntil)}</p>` : ""}
  <p class="q-pay">${escapeHtml2(s.payBy)} ${escapeHtml2(v.reference)}</p>
  ${saidLine}
  <div class="language-switch">
    <label class="field-label" for="langSelect">${escapeHtml2(s.language)}</label>
    <select id="langSelect" class="input" data-language>
      <option value="en"${lang === "en" ? " selected" : ""}>English</option>
      <option value="pl"${lang === "pl" ? " selected" : ""}>Polski</option>
      <option value="ur"${lang === "ur" ? " selected" : ""}>\u0627\u0631\u062F\u0648</option>
    </select>
  </div>
  <a class="q-download" href="pdf">${escapeHtml2(s.downloadQuote)}</a>
</div>
<div class="dialog-holder" data-dialogs>
  <div class="dialog q-dialog" data-overlay="accept" role="dialog" aria-modal="true" aria-labelledby="accept-title" hidden>
    <h2 id="accept-title">${escapeHtml2(s.acceptThisQuote)}</h2>
    <p class="dialog-message" data-message hidden></p>
    <div class="field"><label class="field-label" for="acceptName">${escapeHtml2(s.yourFullName)}</label><input id="acceptName" class="input" type="text" autocomplete="name"></div>
    <div class="dialog-actions">
      <button type="button" class="primary" data-action="confirm-accept">${escapeHtml2(s.confirmAcceptance)}</button>
      <button type="button" data-close="accept">${escapeHtml2(s.close)}</button>
    </div>
  </div>
</div>
<div class="bottom-bar" data-bottom-bar>${action}</div>`;
  return { title, h1: title, body, dir };
}
function bidPageBody(v) {
  const rows = v.vehicles.map(
    (x) => `<div class="field"><label class="field-label" for="price-${x.index}">Price for vehicle ${x.index}</label><input id="price-${x.index}" class="input" data-price-index="${x.index}" inputmode="decimal"></div>`
  ).join("");
  const shown = v.bid ? `<p class="bid-sent">Price sent.</p><button type="button" class="primary" data-action="change-price">Change price</button> <button type="button" data-action="withdraw">Withdraw bid</button>` : `<button type="button" class="primary" data-action="send-price">Send price</button>`;
  return `
<div class="b-page" data-b-page>
  <h1>Price this hire</h1>
  <p class="b-copy">Enter one price per vehicle. Prices close at ${escapeHtml2((v.closesAt ?? "").replace("T", " ").replace("Z", ""))}.</p>
  <h2 class="q-section">Route</h2>
  <ul class="q-stops">${v.route.map((x) => `<li>${escapeHtml2(x)}</li>`).join("")}</ul>
  <h2 class="q-section">Dates</h2>
  ${v.departAt ? `<p class="q-line"><strong>Out:</strong> ${attr(v.departAt.date)} ${attr(v.departAt.time)}</p>` : ""}
  ${v.returnAt ? `<p class="q-line"><strong>Return:</strong> ${attr(v.returnAt.date)} ${attr(v.returnAt.time)}</p>` : ""}
  <h2 class="q-section">Vehicles</h2>
  <ul class="q-vehicles">${v.vehicles.map((x) => `<li>Vehicle ${x.index} \u2014 ${x.seats} seats</li>`).join("")}</ul>
  <p class="q-line"><strong>Party size:</strong> ${attr(v.partySize)}</p>
  <h2 class="q-section">Your prices</h2>
  <form data-bid-form novalidate>
    <div class="group problems" data-problems hidden>
      <h2 class="problems-h">Problems</h2>
      <ul class="problems-list" data-problems-list></ul>
    </div>
    ${rows}
    <div class="dialog-actions">${shown}</div>
  </form>
</div>
<div class="dialog-holder" data-dialogs>
  <div class="dialog" data-overlay="withdraw" role="dialog" aria-modal="true" aria-labelledby="withdraw-title" hidden>
    <h2 id="withdraw-title">Withdraw bid</h2>
    <p>Withdrawing your price leaves you free to price again while the window is open.</p>
    <div class="dialog-actions">
      <button type="button" class="primary" data-action="confirm-withdraw">Confirm withdrawal</button>
      <button type="button" data-close="withdraw">Close</button>
    </div>
  </div>
</div>`;
}
function runSheetBody(v, lang) {
  const pl = lang === "pl";
  const s = {
    run: pl ? "Kurs" : "Run",
    stopOf: (i, n2) => pl ? `Przystanek ${i} z ${n2}` : `Stop ${i} of ${n2}`,
    arrived: pl ? "Na miejscu" : "Arrived",
    boarded: pl ? "Wsiedli" : "Boarded",
    left: pl ? "Odjazd" : "Left",
    comfort: pl ? "Post\xF3j" : "Comfort stop",
    back: pl ? "W trasie" : "Back on the road",
    details: pl ? "Szczeg\xF3\u0142y kursu" : "Run details",
    close: pl ? "Zamknij" : "Close",
    waiting: (n2) => pl ? `Do wys\u0142ania: ${n2}` : `${n2} waiting to send`,
    allSent: pl ? "Wszystko wys\u0142ane" : "All sent",
    language: pl ? "J\u0119zyk" : "Language",
    refresh: pl ? "Nie uda\u0142o si\u0119 od\u015Bwie\u017Cy\u0107. Pr\xF3bujemy ponownie." : "Couldn't refresh. Trying again."
  };
  const n = v.stops.length;
  const stops = v.stops.map((stop, i) => {
    const group = pl ? `Przystanek ${i + 1} z ${n}` : `Stop ${i + 1} of ${n}`;
    const presses = stop.presses;
    const btn = (kind, label) => presses[kind] ? `<button type="button" class="press big-press" data-press="${kind}" data-stop="${attr(stop.id)}" disabled aria-disabled="true">${escapeHtml2(label)}</button>` : `<button type="button" class="press big-press" data-press="${kind}" data-stop="${attr(stop.id)}">${escapeHtml2(label)}</button>`;
    return `<div class="run-stop" data-run-stop="${attr(stop.id)}" role="group" aria-label="${escapeHtml2(group)}">
  <h2 class="stop-h">${escapeHtml2(group)}</h2>
  <p class="stop-text">${escapeHtml2(stop.text)}</p>
  ${btn("arrived", s.arrived)}
  ${btn("boarded", s.boarded)}
  ${btn("left", s.left)}
</div>`;
  }).join("");
  const title = `${s.run} ${v.number}`;
  const body = `
<div class="r-page" data-r-page data-run-number="${attr(v.number)}">
  <h1>${escapeHtml2(title)}</h1>
  <div class="refresh-line run-refresh" data-part="refresh-line" hidden>${escapeHtml2(s.refresh)}</div>
  <p class="r-meta">${attr(v.departAt.date)} ${attr(v.departAt.time)} UK time</p>
  ${v.flightLine ? `<p class="r-flight">${escapeHtml2(v.flightLine)}</p>` : ""}
  ${stops}
  <p class="r-waiting" data-waiting-line hidden></p>
  <div class="language-switch">
    <label class="field-label" for="langSelect">${escapeHtml2(s.language)}</label>
    <select id="langSelect" class="input" data-language>
      <option value="en"${pl ? "" : " selected"}>English</option>
      <option value="pl"${pl ? " selected" : ""}>Polski</option>
    </select>
  </div>
  <button type="button" class="run-details" data-open="run-details">${escapeHtml2(s.details)}</button>
</div>
<div class="sheet run-sheet" data-overlay="run-details" role="dialog" aria-modal="true" aria-label="${escapeHtml2(s.details)}" hidden>
  <button type="button" class="close" data-close="run-details">${escapeHtml2(s.close)}</button>
  <h2>${escapeHtml2(s.details)}</h2>
  <p>${attr(v.departAt.date)} ${attr(v.departAt.time)} UK time</p>
  <ul class="r-stops-list">${v.stops.map((x) => `<li>${escapeHtml2(x.text)}</li>`).join("")}</ul>
</div>
<div class="bottom-bar r-bottom-bar" data-bottom-bar></div>`;
  return { title, body, dir: "ltr" };
}

// src/server/pages.ts
init_uktime();

// src/server/pages/desk.ts
function deskScreenBody(path) {
  const map = {
    "/enquiries": "enquiries",
    "/operators": "operators",
    "/payments": "payments",
    "/diary": "diary",
    "/documents": "documents",
    "/rates": "rates",
    "/customers": "customers",
    "/aftercare/complaints": "complaints",
    "/aftercare/lost-property": "lost"
  };
  const screen = map[path] ?? "enquiries";
  return `<div class="desk-screen" data-screen="${screen}"><div class="desk-main"></div></div>`;
}
function enquiryDetailBody(ref) {
  return `<div class="desk-screen" data-screen="enquiry" data-ref="${ref}"><div class="desk-main"></div></div>`;
}
function tripBody(ref) {
  return `<div class="desk-screen" data-screen="trip" data-ref="${ref}"><div class="desk-main"></div></div>`;
}
function bidsBody(ref) {
  return `<div class="desk-screen" data-screen="bids" data-ref="${ref}"><div class="desk-main"></div></div>`;
}
function hireScreenBody(suffix, ref) {
  const map = {
    "/quote": "quote",
    "/hours": "hours",
    "/seats": "seats",
    "/changes": "changes"
  };
  const screen = map[suffix] ?? "quote";
  return `<div class="desk-screen" data-screen="${screen}" data-ref="${ref}"><div class="desk-main"></div></div>`;
}

// src/server/pages.ts
var BUILD_PUBLIC = (0, import_node_path.resolve)("build/public");
function file(name) {
  const p = (0, import_node_path.resolve)(BUILD_PUBLIC, name);
  if (!p.startsWith(BUILD_PUBLIC)) return null;
  if (!(0, import_node_fs.existsSync)(p)) return null;
  return (0, import_node_fs.readFileSync)(p);
}
var MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8"
};
function sendAsset(res, name) {
  const buf = file("assets/" + name);
  if (!buf) {
    res.status(404).end();
    return;
  }
  const ext = name.slice(name.lastIndexOf("."));
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.send(buf);
}
var DESK_SCREENS = {
  "/enquiries": ["Enquiries", "Enquiries | Wayticket"],
  "/operators": ["Operators", "Operators | Wayticket"],
  "/payments": ["Payments", "Payments | Wayticket"],
  "/diary": ["Diary", "Diary | Wayticket"],
  "/documents": ["Documents", "Documents | Wayticket"],
  "/rates": ["Rate tables", "Rate tables | Wayticket"],
  "/customers": ["Customers", "Customers | Wayticket"],
  "/aftercare/complaints": ["Complaints", "Complaints | Wayticket"],
  "/aftercare/lost-property": ["Lost property", "Lost property | Wayticket"]
};
function registerPageRoutes(app, ctx) {
  app.get("/assets/app.css", (_req, res) => sendAsset(res, "app.css"));
  app.get("/assets/client.js", (_req, res) => sendAsset(res, "client.js"));
  app.get("/assets/fonts.css", (_req, res) => sendAsset(res, "fonts.css"));
  app.get("/assets/fonts/:name", (req, res) => sendAsset(res, "fonts/" + String(req.params.name)));
  app.use("/assets", (req, res) => {
    res.status(404).end();
  });
  app.get("/sw.js", (_req, res) => {
    const buf = file("sw.js");
    if (!buf) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Service-Worker-Allowed", "/");
    res.send(buf);
  });
  app.get("/", (_req, res) => {
    res.type("html").send(shell({ title: "Coach and minibus hire from Coventry | Merrowfield Coach Hire", h1: "Coaches and minibuses with a driver", path: "/" }, homeBody(), { public: true }));
  });
  app.get("/occasions/:slug", (req, res) => {
    const slug = String(req.params.slug);
    if (!OCCASIONS[slug]) {
      res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
      return;
    }
    const o = OCCASIONS[slug];
    res.type("html").send(
      shell({ title: `${o.title} | Merrowfield Coach Hire`, h1: o.title, path: `/occasions/${slug}` }, occasionBody(slug), { public: true })
    );
  });
  app.get("/fleet", (_req, res) => {
    res.type("html").send(shell({ title: "Our fleet | Merrowfield Coach Hire", h1: "Our fleet", path: "/fleet" }, fleetBody(), { public: true }));
  });
  app.get("/terms", (_req, res) => {
    res.type("html").send(shell({ title: "Terms | Merrowfield Coach Hire", h1: "Terms", path: "/terms" }, termsBody(), { public: true }));
  });
  const quoteStep = (req) => {
    const p = req.path.replace("/quote/", "");
    if (p === "when" || p === "details") return p;
    return "route";
  };
  app.get(["/quote", "/quote/route", "/quote/when", "/quote/details"], (req, res) => {
    const step = quoteStep(req);
    const occasion = typeof req.query.occasion === "string" && OCCASIONS[req.query.occasion] ? req.query.occasion : null;
    const titles = {
      route: "Route | Get a free quote",
      when: "When and who | Get a free quote",
      details: "Your details | Get a free quote"
    };
    const h1s = { route: "Route", when: "When and who", details: "Your details" };
    res.type("html").send(shell({ title: titles[step], h1: h1s[step], path: `/quote/${step}` }, quoteFormBody(step, occasion), { public: true }));
  });
  app.get("/quote/thanks", (req, res) => {
    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    const body = thanksBody(ref);
    res.type("html").send(
      shell({ title: "Thank you | Get a free quote", h1: "Thank you", path: "/quote/thanks" }, body, { public: true })
    );
  });
  app.get("/sign-in", (req, res) => {
    const ended = req.query.ended === "1" || pageAuthError(req) === "ended";
    const returnTo = typeof req.query.return === "string" ? req.query.return : "";
    const endedLine = ended ? `<p class="session-ended" data-session-ended>Your session ended. Sign in again to keep going \u2014 what you typed is still here.</p>` : "";
    const body = `
<div class="auth-page">
  <h1>Sign in</h1>
  ${endedLine}
  <form data-sign-in novalidate>
    <input type="hidden" name="return" value="${escapeHtml2(returnTo)}">
    <div class="group problems" data-problems hidden><h2 class="problems-h">Problems</h2><ul class="problems-list" data-problems-list></ul></div>
    <div class="field"><label class="field-label" for="email">Email</label><input id="email" name="email" type="email" class="input" autocomplete="email"></div>
    <div class="field"><label class="field-label" for="password">Password</label><input id="password" name="password" type="password" class="input" autocomplete="current-password"></div>
    <button type="submit" class="primary">Sign in</button>
    <p class="auth-alt"><a href="/sign-up">Start a desk</a></p>
  </form>
</div>`;
    res.type("html").send(shell({ title: "Sign in | Wayticket", h1: "Sign in", path: "/sign-in" }, body));
  });
  app.get("/sign-up", (_req, res) => {
    const body = `
<div class="auth-page">
  <h1>Start a desk</h1>
  <form data-sign-up novalidate>
    <div class="group problems" data-problems hidden><h2 class="problems-h">Problems</h2><ul class="problems-list" data-problems-list></ul></div>
    <div class="field"><label class="field-label" for="deskName">Desk name</label><input id="deskName" name="name" type="text" class="input" autocomplete="organization"></div>
    <div class="field"><label class="field-label" for="email">Email</label><input id="email" name="email" type="email" class="input" autocomplete="email"></div>
    <div class="field"><label class="field-label" for="password">Password</label><input id="password" name="password" type="password" class="input" autocomplete="new-password"></div>
    <button type="submit" class="primary">Start desk</button>
    <p class="auth-alt"><a href="/sign-in">Sign in</a></p>
  </form>
</div>`;
    res.type("html").send(shell({ title: "Start a desk | Wayticket", h1: "Start a desk", path: "/sign-up" }, body));
  });
  const deskGuard = (req, res, render) => {
    const auth = pageAuthError(req);
    if (auth !== "none") {
      const target = encodeURIComponent(req.originalUrl);
      res.redirect(303, `/sign-in?return=${target}${auth === "ended" ? "" : ""}`);
      return;
    }
    res.type("html").send(render());
  };
  for (const [path, [h1, title]] of Object.entries(DESK_SCREENS)) {
    app.get(path, (req, res) => {
      deskGuard(req, res, () => deskShell({ title, h1, path }, "", deskScreenBody(path)));
    });
  }
  app.get("/enquiries/:id", (req, res) => {
    deskGuard(req, res, () => {
      const ref = String(req.params.id);
      const title = `Enquiry ${ref} | Wayticket`;
      return deskShell({ title, h1: `Enquiry ${ref}`, path: "/enquiries" }, "", enquiryDetailBody(ref));
    });
  });
  app.get("/enquiries/:id/trip", (req, res) => {
    deskGuard(req, res, () => {
      const ref = String(req.params.id);
      const title = `Trip plan ${ref} | Wayticket`;
      return deskShell({ title, h1: `Trip plan ${ref}`, path: "/enquiries" }, "", tripBody(ref));
    });
  });
  app.get("/enquiries/:id/bids", (req, res) => {
    deskGuard(req, res, () => {
      const ref = String(req.params.id);
      const title = `Operator bids ${ref} | Wayticket`;
      return deskShell({ title, h1: `Operator bids ${ref}`, path: "/enquiries" }, "", bidsBody(ref));
    });
  });
  const hireScreens = [
    ["/quote", (ref) => `Quote ${ref} | Wayticket`, (ref) => `Quote ${ref}`],
    ["/hours", (ref) => `Drivers' hours ${ref} | Wayticket`, (ref) => `Drivers' hours ${ref}`],
    ["/seats", (ref) => `Seat plan ${ref} | Wayticket`, (ref) => `Seat plan ${ref}`],
    ["/changes", (ref) => `Changes ${ref} | Wayticket`, (ref) => `Changes ${ref}`]
  ];
  for (const [suffix, title, h1] of hireScreens) {
    app.get(`/hires/:id${suffix}`, (req, res) => {
      deskGuard(req, res, () => {
        const ref = String(req.params.id);
        return deskShell({ title: title(ref), h1: h1(ref), path: suffix.slice(1) }, "", hireScreenBody(suffix, ref));
      });
    });
  }
  app.get("/q/:token", async (req, res) => {
    try {
      const data = await quotePageAnswer(ctx, String(req.params.token), null);
      const lang = langFromQuery(req.query.lang, String(data.language));
      const view = {
        reference: String(data.reference),
        language: String(data.language),
        state: String(data.state),
        stage: String(data.stage),
        stops: data.stops ?? [],
        departAt: data.departAt ?? null,
        returnAt: data.returnAt ?? null,
        people: Number(data.people ?? 0),
        vehicles: data.vehicles ?? [],
        total: String(data.total ?? "0.00"),
        depositTotal: String(data.depositTotal ?? "0.00"),
        validUntil: data.validUntil ? String(data.validUntil) : null,
        endsAt: data.endsAt ? String(data.endsAt) : null,
        depositSaidSent: Boolean(data.depositSaidSent),
        cancelled: Boolean(data.cancelled),
        endedLineDate: data.endedLineDate ? String(data.endedLineDate) : null
      };
      const v = quotePageBody(view, lang);
      const html = privateShell(`${v.title} | Merrowfield Coach Hire`, v.title, v.body, lang, v.dir, String(req.params.token));
      res.status(200).type("html").send(html);
    } catch (e) {
      privatePageError(res, e, req.params.token, "q");
    }
  });
  app.get("/b/:token", async (req, res, next) => {
    try {
      const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [String(req.params.token)]);
      if (!t.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const deskId = String(t.rows[0].desk_id);
      const enquiryId = String(t.rows[0].enquiry_id);
      const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [deskId, enquiryId, String(t.rows[0].operator_id)]);
      if (!bid.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
      const awardedAt = award.rows[0] ? award.rows[0].awarded_at : null;
      const closes = bid.rows[0].closes_at;
      const now = /* @__PURE__ */ new Date();
      const ended = awardedAt && now.getTime() >= awardedAt.getTime() + 1e3 || now.getTime() >= closes.getTime() + 1e3;
      if (ended) {
        res.status(410).type("html").send(notFoundShell("This bid page has closed", "This bid page has closed"));
        return;
      }
      const stops = (await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [enquiryId])).rows.map((x) => String(x.text));
      const plan = await ctx.db.query("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
      const enquiry = await ctx.db.query("SELECT * FROM enquiries WHERE desk_id=$1 AND id=$2", [deskId, enquiryId]);
      const view = {
        route: stops,
        departAt: enquiry.rows[0] ? { date: String(enquiry.rows[0].depart_date), time: String(enquiry.rows[0].depart_time) } : null,
        returnAt: enquiry.rows[0]?.return_date ? { date: String(enquiry.rows[0].return_date), time: String(enquiry.rows[0].return_time) } : null,
        vehicles: (plan.rows[0]?.sizes ?? []).map((seats, i) => ({ index: i + 1, seats })),
        partySize: Number(enquiry.rows[0]?.people ?? 0),
        closesAt: new Date(closes).toISOString(),
        bid: bid.rows[0].received_at && !bid.rows[0].withdrawn_at ? { prices: bid.rows[0].prices ?? [], receivedAt: String(bid.rows[0].received_at) } : null
      };
      res.status(200).type("html").send(privateShell("Price this hire | Wayticket", "Price this hire", bidPageBody(view), "en", "ltr", String(req.params.token)));
    } catch (e) {
      next(e);
    }
  });
  app.get("/r/:token", async (req, res, next) => {
    try {
      const t = await ctx.db.query("SELECT * FROM run_tokens WHERE token=$1", [String(req.params.token)]);
      if (!t.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [String(t.rows[0].run_id)]);
      if (!run.rows[0]) {
        res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
        return;
      }
      const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.rows[0].hire_id]);
      if (hire.rows[0]?.cancelled) {
        res.status(410).type("html").send(notFoundShell("This page has ended.", "This page has ended."));
        return;
      }
      const customer = hire.rows[0] ? await ctx.db.query("SELECT state FROM customers WHERE id=$1", [hire.rows[0].customer_id]) : null;
      if (customer?.rows[0]?.state === "erased") {
        res.status(410).type("html").send(notFoundShell("This page has ended.", "This page has ended."));
        return;
      }
      const lang = req.query.lang === "pl" ? "pl" : "en";
      const deskId = String(t.rows[0].desk_id);
      const stops = (await ctx.db.query("SELECT * FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position", [run.rows[0].hire_id])).rows;
      const presses = (await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1", [String(run.rows[0].id)])).rows;
      const charges = (await ctx.db.query("SELECT * FROM run_charges WHERE run_id=$1", [String(run.rows[0].id)])).rows;
      const view = {
        number: Number(run.rows[0].number),
        departAt: { date: String(run.rows[0].depart_date), time: String(run.rows[0].depart_time) },
        stops: stops.map((s) => ({
          id: String(s.id),
          text: String(s.text),
          presses: {
            arrived: pressAt2(presses, String(s.id), "arrived"),
            boarded: pressAt2(presses, String(s.id), "boarded"),
            left: pressAt2(presses, String(s.id), "left")
          }
        })),
        flightLine: null,
        charges: charges.map((c) => ({
          stopId: c.stop_id ? String(c.stop_id) : null,
          kind: String(c.kind),
          minutes: Number(c.minutes),
          amount: String(c.amount_pennies),
          accepted: Boolean(c.accepted)
        }))
      };
      const v = runSheetBody(view, lang);
      res.status(200).type("html").send(privateShell(`${v.title} | Wayticket`, v.title, v.body, lang, v.dir, String(req.params.token)));
    } catch (e) {
      next(e);
    }
  });
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      sendError(res, errors.unknownRoute());
      return;
    }
    res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
  });
}
function pressAt2(rows, stopId, kind) {
  const found = rows.find((x) => String(x.stop_id) === stopId && String(x.kind) === kind);
  return found ? new Date(found.at).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}
function privateShell(title, _h1, body, lang, dir, token) {
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml2(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/client.js" defer></script>
</head>
<body data-page="private" data-token="${escapeHtml2(token)}">
<div role="region" aria-label="Announcements" data-part="announcements" class="announcements" aria-live="polite"></div>
<main id="main">
${body}
</main>
</body>
</html>`;
}
function privatePageError(res, e, token, kind) {
  if (e && typeof e === "object" && "status" in e) {
    const err = e;
    if (err.status === 404) {
      res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
      return;
    }
    if (err.status === 410) {
      const lang = kind === "q" ? "en" : "en";
      res.status(410).type("html").send(notFoundShell("This page has ended.", "This page has ended.", lang, "ltr", true));
      return;
    }
  }
  res.status(404).type("html").send(notFoundShell("Page not found", "Page not found"));
}

// src/server/jobs.ts
init_services();
init_s3();
init_services();
init_uktime();
init_money();
init_operators();
init_operators();
init_repo();
function startJobs(ctx) {
  let lastRunDay = "";
  const daily = async () => {
    try {
      const today = ukDateString(/* @__PURE__ */ new Date());
      const desks = await ctx.db.query("SELECT id, email FROM desks");
      for (const desk of desks.rows) {
        await paperChecks(ctx, String(desk.id), String(desk.email));
        await balanceReminders(ctx, String(desk.id));
      }
      if (today !== lastRunDay) {
        lastRunDay = today;
      }
      await eraseCustomers(ctx);
      await retrySeedInvoice(ctx);
    } catch {
    }
  };
  const intervalMs = ctx.cfg.dailyRunAt === "any" ? 2e3 : 6e4;
  const timer = setInterval(daily, intervalMs);
  const hourly = setInterval(async () => {
    try {
      await eraseCustomers(ctx);
      await retrySeedInvoice(ctx);
    } catch {
    }
  }, 2e3);
  setTimeout(daily, 500);
}
async function paperChecks(ctx, deskId, deskEmail) {
  const operators = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1", [deskId]);
  const hires = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND cancelled=FALSE", [deskId]);
  const today = ukDateString(/* @__PURE__ */ new Date());
  for (const h of hires.rows) {
    const ret = h.return_instant;
    const lastDay = ukDateString(ret ?? h.depart_instant);
    const papers = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [deskId, String(h.reference)]).catch(() => null);
    const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
    const operatorIds = new Set(vehicles.map((v) => v.operatorId).filter(Boolean));
    for (const op of operators.rows) {
      if (!operatorIds.has(String(op.id))) continue;
      const opPapers = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [deskId, String(op.id)]);
      for (const p of opPapers.rows) {
        const endsOn = isoDate(p.ends_on);
        const days = dayDiff(endsOn, today);
        if (days < 0 || days > 30) continue;
        const key = `${deskId}|${op.id}|${p.kind}|${endsOn}`;
        const already = await ctx.db.query("SELECT 1 FROM daily_runs WHERE desk_id=$1 AND day=$2 AND hire_id=$3 AND kind=$4", [
          deskId,
          key,
          String(h.id),
          "paper"
        ]);
        if (already.rows[0]) continue;
        await ctx.db.query("INSERT INTO daily_runs (desk_id, day, hire_id, kind, done) VALUES ($1,$2,$3,'paper',TRUE) ON CONFLICT DO NOTHING", [
          deskId,
          key,
          String(h.id)
        ]);
        try {
          await sendMail(ctx.cfg, {
            to: deskEmail,
            subject: `${paperLabel(String(p.kind))} for ${String(op.name)} ends on ${longDate(endsOn)}`,
            text: `${paperLabel(String(p.kind))} for ${String(op.name)} ends on ${longDate(endsOn)}`
          });
        } catch {
          await ctx.db.query("DELETE FROM daily_runs WHERE desk_id=$1 AND day=$2 AND hire_id=$3 AND kind='paper'", [deskId, key, String(h.id)]);
        }
      }
    }
  }
}
function dayDiff(a, b) {
  const toDays2 = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 864e5;
  };
  return Math.round(toDays2(a) - toDays2(b));
}
async function balanceReminders(ctx, deskId) {
  const today = ukDateString(/* @__PURE__ */ new Date());
  const hires = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND cancelled=FALSE AND stage<>'quoted'", [deskId]);
  for (const h of hires.rows) {
    const departDate = String(h.depart_date);
    const daysToDeparture = dayDiff(departDate, today);
    if (daysToDeparture > 10 || daysToDeparture <= 7) continue;
    const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
    const money2 = await (await Promise.resolve().then(() => (init_hires(), hires_exports))).vehicleMoney(ctx, deskId, vehicles);
    if (money2.owed <= 0) continue;
    const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [h.customer_id]);
    for (const v of vehicles) {
      const already = await ctx.db.query("SELECT 1 FROM reminders WHERE desk_id=$1 AND hire_id=$2 AND vehicle_id=$3", [deskId, h.id, v.id]);
      if (already.rows[0]) continue;
      const owedForVehicle = Math.max(0, v.total - v.deposit);
      if (owedForVehicle <= 0) continue;
      const dueOn = addDays(departDate, -7);
      try {
        await sendMail(ctx.cfg, {
          to: String(customer.rows[0]?.email ?? ""),
          subject: `Balance reminder ${String(h.reference)}`,
          text: `Balance reminder ${String(h.reference)}

Amount owed: \xA3${penniesToString(money2.owed)}
Due date: ${longDate(dueOn)}
Quote reference: ${String(h.reference)}`
        });
        await ctx.db.query("INSERT INTO reminders (desk_id, hire_id, vehicle_id, sent_at) VALUES ($1,$2,$3,NOW())", [deskId, h.id, v.id]);
      } catch {
      }
    }
  }
}
async function eraseCustomers(ctx) {
  const due = await ctx.db.query(
    "SELECT * FROM customers WHERE state='closed' AND erase_at IS NOT NULL AND erase_at <= NOW()",
    []
  );
  for (const c of due.rows) {
    const deskId = String(c.desk_id);
    await ctx.db.query("UPDATE customers SET state='erasing' WHERE id=$1", [c.id]);
    try {
      const papers = await ctx.db.query("SELECT object_key FROM papers WHERE desk_id=$1", [deskId]);
      const files = await ctx.db.query("SELECT object_key FROM passenger_files WHERE desk_id=$1", [deskId]);
      const docs = await ctx.db.query("SELECT object_key FROM documents WHERE desk_id=$1 AND customer_name=$2", [deskId, c.name]);
      const keys = [...papers.rows, ...files.rows, ...docs.rows].map((x) => String(x.object_key)).filter(Boolean);
      const probe = keys.length ? await Promise.all(keys.map((k) => s3Get(ctx.cfg, k))) : await s3Get(ctx.cfg, "desks/probe/none");
      await Promise.all(keys.map((k) => s3Delete(ctx.cfg, k)));
      await ctx.db.query("DELETE FROM passengers WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2)", [deskId, c.id]);
      await ctx.db.query("UPDATE quote_tokens SET ended_at=NOW() WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2)", [deskId, c.id]);
      await ctx.db.query("UPDATE run_tokens SET created_at=created_at WHERE desk_id=$1 AND run_id IN (SELECT id FROM runs WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2))", [deskId, c.id]);
      await ctx.db.query("UPDATE documents SET customer_name='Erased customer' WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2)", [deskId, c.id]);
      await ctx.db.query(
        "UPDATE customers SET name='', email=NULL, telephone=NULL, notes=NULL, state='erased' WHERE id=$1",
        [c.id]
      );
    } catch {
    }
  }
}
async function retrySeedInvoice(ctx) {
  const pending = await ctx.db.query("SELECT * FROM documents WHERE state IN ('waiting','rendering')");
  for (const d of pending.rows) {
    try {
      const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [d.hire_id]);
      if (!hire.rows[0]) continue;
      const html = await (await Promise.resolve().then(() => (init_documents(), documents_exports))).documentHtml(ctx, String(d.desk_id), hire.rows[0], String(d.kind), String(d.id));
      const pdf = await renderPdf(ctx.cfg, html);
      const key = objectKeyForDocument(String(d.desk_id), String(d.id));
      await s3Put(ctx.cfg, key, pdf, "application/pdf");
      const number = await takeNumber2(ctx, String(d.desk_id), String(d.kind));
      await ctx.db.query("UPDATE documents SET state='stored', number=$2, object_key=$3, history = history || $4::jsonb WHERE id=$1", [
        String(d.id),
        number,
        key,
        JSON.stringify([{ at: (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"), who: "Arranger", what: "Stored" }])
      ]);
    } catch {
    }
  }
}
async function takeNumber2(ctx, deskId, kind) {
  const prefix = kind === "invoice" ? "INV" : kind === "creditNote" ? "CN" : null;
  if (!prefix) return "";
  const year = Number(ukDateString(/* @__PURE__ */ new Date()).slice(0, 4));
  const client = await ctx.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO document_numbers (desk_id, kind_prefix, year, last_number) VALUES ($1,$2,$3,0) ON CONFLICT (desk_id, kind_prefix, year) DO NOTHING",
      [deskId, prefix, year]
    );
    const r = await client.query(
      "UPDATE document_numbers SET last_number = last_number + 1 WHERE desk_id=$1 AND kind_prefix=$2 AND year=$3 RETURNING last_number AS next",
      [deskId, prefix, year]
    );
    await client.query("COMMIT");
    return `${prefix}-${year}-${String(r.rows[0].next).padStart(4, "0")}`;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw e;
  } finally {
    client.release();
  }
}

// src/server/app.ts
init_errors();
init_http();
init_uktime();
init_domain();
var WRITE_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function buildApp(ctx) {
  const app = (0, import_express2.default)();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.set("query parser", "simple");
  const autoAsync = (register) => {
    return (...args) => {
      const handlers = args.slice(1).map(
        (h) => typeof h === "function" && h.constructor?.name === "AsyncFunction" ? (req, res, next) => {
          h(req, res).catch(next);
        } : h
      );
      register(...args.slice(0, 1), ...handlers);
    };
  };
  const wrapVerb = (verb) => {
    const raw = app[verb].bind(app);
    app[verb] = autoAsync(raw);
  };
  wrapVerb("get");
  wrapVerb("post");
  wrapVerb("put");
  wrapVerb("patch");
  wrapVerb("delete");
  app.use((req, _res, next) => {
    req.ctx = ctx;
    next();
  });
  app.use((req, res, next) => {
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const len = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(len) && len > 0) {
      if (type === "application/json" && len > JSON_LIMIT) return sendError(res, errors.tooLarge());
      if (type === "text/csv" && len > 2e6) return sendError(res, errors.tooLarge());
      if (type === "multipart/form-data" && len > 51e5) return sendError(res, errors.tooLarge());
    }
    if (WRITE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        try {
          const u = new URL(origin);
          const own = new URL(ctx.cfg.appPublicUrl);
          if (u.host !== own.host) return sendError(res, errors.foreignOrigin());
        } catch {
          return sendError(res, errors.foreignOrigin());
        }
      }
    }
    next();
  });
  app.use(sessionMiddleware(ctx));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/public/clock", (_req, res) => {
    const now = /* @__PURE__ */ new Date();
    const f = ukFields(now);
    res.json({
      date: ukDateString(now),
      time: `${String(f.hh).padStart(2, "0")}:${String(f.mm).padStart(2, "0")}`,
      instant: isoInstant(now)
    });
  });
  registerAuthApi(app, ctx);
  registerPublicApi(app, ctx);
  registerCustomerApi(app, ctx);
  registerEnquiryApi(app, ctx);
  registerTripApi(app, ctx);
  registerOperatorApi(app, ctx);
  registerBidApi(app, ctx);
  registerHireApi(app, ctx);
  registerPaymentApi(app, ctx);
  registerRunApi(app, ctx);
  registerSheetApi(app, ctx);
  registerAftercareApi(app, ctx);
  registerDocumentApi(app, ctx);
  registerPageRoutes(app, ctx);
  app.use("/api", (req, res) => {
    sendError(res, errors.unknownRoute());
  });
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      sendError(res, err);
      return;
    }
    sendError(res, errors.unknownRoute());
  });
  return app;
}
async function startServer() {
  const cfg2 = { ...loadConfig(), sessionSecret: process.env.SESSION_SECRET ?? readSessionSecret() };
  const db = new import_pg.default.Pool({ connectionString: cfg2.databaseUrl, max: 10 });
  await prepareDatabase(db);
  const ctx = { cfg: cfg2, db };
  const app = buildApp(ctx);
  const server = app.listen(cfg2.appPublicPort, "0.0.0.0");
  await new Promise((r) => server.once("listening", r));
  startJobs(ctx);
  console.log(`wayticket serving on ${cfg2.appPublicPort}`);
  return app;
}
function readSessionSecret() {
  const p = process.env.SESSION_SECRET_FILE ?? "/tmp/wayticket-session-secret";
  try {
    const existing = (0, import_node_fs2.readFileSync)(p, "utf8").trim();
    if (existing) return existing;
  } catch {
  }
  const secret = (0, import_node_crypto6.randomBytes)(24).toString("base64url");
  try {
    (0, import_node_fs2.writeFileSync)(p, secret, { mode: 384 });
    return secret;
  } catch {
    return secret;
  }
}

// src/server/main.ts
init_dates();
configureTypes().then(() => startServer()).catch((e) => {
  console.error(e);
  process.exit(1);
});
