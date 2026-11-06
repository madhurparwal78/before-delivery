var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src-server/core/money.ts
var money_exports = {};
__export(money_exports, {
  BAR_PRICE_CENTS: () => BAR_PRICE_CENTS,
  DROPSHIPPING_CENTS: () => DROPSHIPPING_CENTS,
  RATES: () => RATES,
  TRIO_LIST_CENTS: () => TRIO_LIST_CENTS,
  applyRate: () => applyRate,
  dropPrice: () => dropPrice,
  money: () => money,
  trioPrice: () => trioPrice
});
function money(cents) {
  return { cents, currency: "CAD" };
}
function applyRate(base, rateHundredThousandths) {
  return Math.floor((base * rateHundredThousandths + 5e4) / 1e5);
}
function dropPrice(barCount, taxes) {
  const subtotal = money(barCount * BAR_PRICE_CENTS);
  const shipping = money(barCount === 0 ? 0 : DROPSHIPPING_CENTS);
  const preTax = money(subtotal.cents + shipping.cents);
  const taxLines2 = taxes.map((t) => ({ ...t, amount: money(applyRate(preTax.cents, t.rateHundredThousandths)) }));
  const total = money(preTax.cents + taxLines2.reduce((s, t) => s + t.amount.cents, 0));
  return { subtotal, discount: money(0), shipping, preTax, taxes: taxLines2, total };
}
function trioPrice(taxes) {
  const subtotal = money(TRIO_LIST_CENTS);
  const discount = money(applyRate(subtotal.cents, RATES.discount));
  const shipping = money(0);
  const preTax = money(subtotal.cents - discount.cents + shipping.cents);
  const taxLines2 = taxes.map((t) => ({ ...t, amount: money(applyRate(preTax.cents, t.rateHundredThousandths)) }));
  const total = money(preTax.cents + taxLines2.reduce((s, t) => s + t.amount.cents, 0));
  return { subtotal, discount, shipping, preTax, taxes: taxLines2, total };
}
var RATES, BAR_PRICE_CENTS, DROPSHIPPING_CENTS, TRIO_LIST_CENTS;
var init_money = __esm({
  "src-server/core/money.ts"() {
    "use strict";
    RATES = {
      discount: 12e3,
      GST: 5e3,
      QST: 9975,
      HST13: 13e3,
      HST14: 14e3,
      HST15: 15e3
    };
    BAR_PRICE_CENTS = 1100;
    DROPSHIPPING_CENTS = 900;
    TRIO_LIST_CENTS = 3 * BAR_PRICE_CENTS;
  }
});

// src-server/main.ts
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

// src-server/core/env.ts
import { randomBytes } from "node:crypto";
var DEFAULTS = {
  publicPort: 4173,
  holdTtlSeconds: 600,
  stepupCodeTtlSeconds: 300,
  stepupLockSeconds: 900,
  stepupRateLimit: 3,
  stepupRateWindowSeconds: 600,
  subscriptionLockHours: 48
};
function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}
function strEnv(name, fallback = "") {
  const value = process.env[name];
  return value === void 0 || value === "" ? fallback : value;
}
function readEnv() {
  const mailFrom = strEnv("MAIL_FROM", "Pain de Lune <bonjour@paindelune.example>");
  const fromMatch = /<([^>]*)>\s*$/.exec(mailFrom);
  return {
    databaseUrl: strEnv("DATABASE_URL", "postgresql://localhost:5432/loafline"),
    killbillUrl: strEnv("KILLBILL_URL", "http://localhost:8080").replace(/\/+$/, ""),
    killbillUsername: strEnv("KILLBILL_USERNAME"),
    killbillPassword: strEnv("KILLBILL_PASSWORD"),
    killbillApiKey: strEnv("KILLBILL_API_KEY"),
    killbillApiSecret: strEnv("KILLBILL_API_SECRET"),
    smtpHost: strEnv("SMTP_HOST", "localhost"),
    smtpPort: intEnv("SMTP_PORT", 1025, 1, 65535),
    mailFrom,
    mailFromAddress: fromMatch?.[1] ?? mailFrom,
    publicPort: intEnv("APP_PUBLIC_PORT", DEFAULTS.publicPort, 1, 65535),
    holdTtlSeconds: intEnv("HOLD_TTL_SECONDS", DEFAULTS.holdTtlSeconds, 10, 3600),
    stepupCodeTtlSeconds: intEnv("STEPUP_CODE_TTL_SECONDS", DEFAULTS.stepupCodeTtlSeconds, 10, 1e5),
    stepupLockSeconds: intEnv("STEPUP_LOCK_SECONDS", DEFAULTS.stepupLockSeconds, 1, 1e5),
    stepupRateLimit: intEnv("STEPUP_RATE_LIMIT", DEFAULTS.stepupRateLimit, 1, 1e4),
    stepupRateWindowSeconds: intEnv("STEPUP_RATE_WINDOW_SECONDS", DEFAULTS.stepupRateWindowSeconds, 1, 1e5),
    subscriptionLockHours: intEnv("SUBSCRIPTION_LOCK_HOURS", DEFAULTS.subscriptionLockHours, 1, 1e3),
    sessionSecret: strEnv("SESSION_SECRET") || cryptoRandomToken()
  };
}
function cryptoRandomToken() {
  return randomBytes(32).toString("base64url");
}

// src-server/db/schema.ts
import { createHash } from "node:crypto";
import { randomBytes as randomBytes2 } from "node:crypto";
import { Pool } from "pg";

// src-server/core/toronto.ts
var TORONTO_TZ = "America/Toronto";
function torontoOffsetMinutes(instant) {
  const dtf = torontoDateTimeFormat();
  const parts = dtf.formatToParts(instant);
  let offset = 0;
  const asLocal = new Date(
    Number(parts.find((p) => p.type === "year")?.value),
    monthIndex(parts),
    Number(parts.find((p) => p.type === "day")?.value),
    Number(parts.find((p) => p.type === "hour")?.value),
    Number(parts.find((p) => p.type === "minute")?.value),
    Number(parts.find((p) => p.type === "second")?.value)
  ).getTime();
  offset = Math.round((asLocal - instant.getTime()) / 6e4);
  return offset;
}
function monthIndex(parts) {
  const month = parts.find((p) => p.type === "month");
  if (!month) return 0;
  const dtfMonthNames = {
    "1": 0,
    "2": 1,
    "3": 2,
    "4": 3,
    "5": 4,
    "6": 5,
    "7": 6,
    "8": 7,
    "9": 8,
    "01": 0,
    "02": 1,
    "03": 2,
    "04": 3,
    "05": 4,
    "06": 5,
    "07": 6,
    "08": 7,
    "09": 8,
    "10": 9,
    "11": 10,
    "12": 11
  };
  if (dtfMonthNames[month.value] !== void 0) return dtfMonthNames[month.value];
  const named = {
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
    janvier: 0,
    "f\xE9vrier": 1,
    mars: 2,
    avril: 3,
    mai: 4,
    juin: 5,
    juillet: 6,
    "ao\xFBt": 7,
    septembre: 8,
    octobre: 9,
    novembre: 10,
    "d\xE9cembre": 11
  };
  return named[month.value] ?? 0;
}
var cachedDtf = null;
function torontoDateTimeFormat() {
  if (!cachedDtf) {
    cachedDtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: TORONTO_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }
  return cachedDtf;
}
function torontoParts(instant) {
  const parts = torontoDateTimeFormat().formatToParts(instant);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "0";
  const hour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    second: Number(get("second"))
  };
}
function dateToString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
function torontoDate(instant) {
  const p = torontoParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}
function torontoLocalMinute(instant) {
  const p = torontoParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}
function torontoLocalToInstant(local, choice = "first") {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return { instant: null, gap: false };
  const [, yS, moS, dS, hS, miS] = m;
  const y = Number(yS), mo = Number(moS), d = Number(dS), h = Number(hS), mi = Number(miS);
  const base = Date.UTC(y, mo - 1, d, h, mi);
  const candidates = [];
  for (const guess of [base - 5 * 36e5, base - 4 * 36e5, base - 4.5 * 36e5]) {
    const off = torontoOffsetMinutes(new Date(guess));
    if (!candidates.includes(off)) candidates.push(off);
  }
  const valid = candidates.map((off) => base - off * 6e4).filter((ms) => {
    const inst = new Date(ms);
    const p = torontoParts(inst);
    return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi;
  }).sort((a, b) => a - b);
  if (valid.length === 0) return { instant: null, gap: true };
  return { instant: new Date(choice === "first" ? valid[0] : valid[valid.length - 1]), gap: false };
}
function torontoMidnight(date) {
  return torontoLocalToInstant(`${date}T00:00`).instant;
}
function addDays(date, days) {
  const d = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dateDiffDays(a, b) {
  const da = (/* @__PURE__ */ new Date(`${a}T00:00:00Z`)).getTime();
  const db = (/* @__PURE__ */ new Date(`${b}T00:00:00Z`)).getTime();
  return Math.round((da - db) / 864e5);
}
function addMonths(date, months) {
  const [yS, mS, dS] = date.split("-");
  const y = Number(yS), m = Number(mS), d = Number(dS);
  const targetYear = y + Math.floor((m - 1 + months) / 12);
  const targetMonth = ((m - 1 + months) % 12 + 12) % 12 + 1;
  const last = lastDayOfMonth(targetYear, targetMonth);
  const targetDay = Math.min(d, last);
  return `${targetYear}-${pad2(targetMonth)}-${pad2(targetDay)}`;
}
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function nextInSeries(anchor, from, stepMonths) {
  const anchorDay = Number(anchor.slice(8, 10));
  let candidate = addMonths(from, stepMonths);
  const [, mS] = candidate.split("-");
  const [y, m] = [Number(candidate.slice(0, 4)), Number(mS)];
  if (anchorDay <= lastDayOfMonth(y, m)) {
    candidate = `${candidate.slice(0, 8)}${pad2(anchorDay)}`;
  }
  return candidate;
}
function torontoMonth(instant) {
  const d = torontoDate(instant);
  return d.slice(0, 7);
}
function torontoMonthStart(month) {
  return torontoMidnight(`${month}-01`);
}
function nextMonth(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const ny = y + Math.floor(m / 12);
  const nm = m % 12 + 1;
  return `${ny}-${pad2(nm)}`;
}

// src-server/db/schema.ts
var SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  locale text NOT NULL DEFAULT 'en-CA',
  killbill_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  code text PRIMARY KEY,
  scent text NOT NULL,
  state text NOT NULL,
  poured_on date NOT NULL,
  cure_days int NOT NULL,
  bars_cut int NOT NULL DEFAULT 0,
  drop_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id bigserial PRIMARY KEY,
  batch_code text NOT NULL,
  kind text NOT NULL,
  bars int[] NOT NULL,
  ref text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carts (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  cart_id uuid NOT NULL,
  batch_code text NOT NULL,
  bar int NOT NULL,
  status text NOT NULL,
  amount_cents int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL,
  status text NOT NULL,
  fulfilment text NOT NULL,
  placed_at timestamptz NOT NULL,
  ship_on date NOT NULL,
  locale text NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  line1 text NOT NULL,
  city text NOT NULL,
  province text NOT NULL,
  postal_code text NOT NULL,
  subtotal_cents int NOT NULL,
  shipping_cents int NOT NULL,
  taxes jsonb NOT NULL,
  total_cents int NOT NULL,
  refunded_cents int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 1,
  killbill_invoice_id text,
  killbill_payment_id text,
  kb_shipping_item_id text,
  kb_tax_items jsonb
);

CREATE TABLE IF NOT EXISTS order_lines (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL,
  batch_code text NOT NULL,
  scent text NOT NULL,
  bar int NOT NULL,
  unit_cents int NOT NULL,
  refunded boolean NOT NULL DEFAULT false,
  kb_invoice_item_id text
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL,
  state text NOT NULL,
  scent text NOT NULL,
  cadence text NOT NULL,
  pending_cadence text,
  anchor_date date NOT NULL,
  started_on date NOT NULL,
  next_bill_date date,
  skipped_bill_date date,
  paused_from date,
  name text NOT NULL,
  line1 text NOT NULL,
  city text NOT NULL,
  province text NOT NULL,
  postal_code text NOT NULL,
  version int NOT NULL DEFAULT 1,
  killbill_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  order_id bigint NOT NULL,
  status text NOT NULL,
  bars jsonb NOT NULL,
  restock boolean NOT NULL,
  amount_cents int NOT NULL,
  allocation jsonb NOT NULL,
  reason text NOT NULL,
  killbill_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credits (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  target text NOT NULL,
  customer_id bigint NOT NULL,
  status text NOT NULL,
  amount_cents int NOT NULL,
  reason text NOT NULL,
  killbill_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  role text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  reason text NOT NULL,
  amount jsonb NOT NULL,
  killbill_ref text,
  outcome text NOT NULL
);

CREATE TABLE IF NOT EXISTS stepup_codes (
  id bigserial PRIMARY KEY,
  sc_number text NOT NULL,
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stepup_requests (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stepup_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stepup_locks (
  email text PRIMARY KEY,
  until timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  customer_id bigint,
  staff_id bigint,
  kind text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status int NOT NULL,
  body text,
  in_progress boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, key)
);

CREATE TABLE IF NOT EXISTS notices (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  key text NOT NULL UNIQUE,
  kind text NOT NULL,
  to_email text NOT NULL,
  locale text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  attempts jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS contacts (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  topic text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
  id bigserial PRIMARY KEY,
  month text NOT NULL,
  lines jsonb NOT NULL,
  totals jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_accepts (
  id bigserial PRIMARY KEY,
  month text NOT NULL,
  line_key text NOT NULL,
  shop_cents int NOT NULL,
  killbill_cents int NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);
`;
var COUNTERS = ["order", "subscription", "refund", "credit", "contact", "notice", "sc", "batch"];
var STAFF_SEED = [
  { email: "maker@paindelune.example", name: "Odile Arsenault", password: "lune-maker-2026", role: "maker" },
  { email: "finance@paindelune.example", name: "Samir Boucher", password: "lune-finance-2026", role: "finance" },
  { email: "packing@paindelune.example", name: "Jade Poirier", password: "lune-packing-2026", role: "packing" }
];
function createPool(databaseUrl) {
  return new Pool({ connectionString: databaseUrl, max: 20 });
}
async function applySchema(pool) {
  await pool.query(SCHEMA_SQL);
  await seed(pool);
}
async function seed(pool) {
  for (const name of COUNTERS) {
    await pool.query(
      "INSERT INTO counters (name, value) VALUES ($1, 0) ON CONFLICT (name) DO NOTHING",
      [name]
    );
  }
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('packing_cutoff_local', '14:00') ON CONFLICT (key) DO NOTHING"
  );
  const staffCount = await pool.query("SELECT count(*)::int AS n FROM staff");
  if (staffCount.rows[0].n === 0) {
    for (const member of STAFF_SEED) {
      await pool.query(
        "INSERT INTO staff (email, name, password_hash, role) VALUES ($1, $2, $3, $4)",
        [member.email, member.name, hashPassword(member.password), member.role]
      );
    }
  }
  const batchCount = await pool.query("SELECT count(*)::int AS n FROM batches");
  if (batchCount.rows[0].n === 0) {
    const seedDay = torontoDate(/* @__PURE__ */ new Date());
    const drop1 = torontoInstant(addDays(seedDay, -1), "10:00");
    const drop2 = torontoInstant(addDays(seedDay, 7), "10:00");
    await pool.query(
      `INSERT INTO batches (code, scent, state, poured_on, cure_days, bars_cut, drop_at) VALUES
       ($1, $2, 'live', $3, 28, 12, $4),
       ($5, $6, 'scheduled', $7, 28, 10, $8),
       ($9, $10, 'curing', $11, 35, 14, NULL)`,
      [
        "B-0412",
        "lavender-oat",
        addDays(seedDay, -35),
        drop1,
        "B-0413",
        "smoked-birch",
        addDays(seedDay, -30),
        drop2,
        "B-0414",
        "wild-mint",
        addDays(seedDay, -3)
      ]
    );
    await pool.query(
      `INSERT INTO stock_movements (batch_code, kind, bars, ref)
       VALUES ('B-0412', 'cut', $1, NULL), ('B-0413', 'cut', $2, NULL), ('B-0414', 'cut', $3, NULL)`,
      [barNumbers(12), barNumbers(10), barNumbers(14)]
    );
    await pool.query("UPDATE counters SET value = 414 WHERE name = 'batch'");
  }
}
function barNumbers(cut) {
  return Array.from({ length: cut }, (_, i) => i + 1);
}
function torontoInstant(date, hhmm) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const base = (/* @__PURE__ */ new Date(`${date}T${hhmm}:00Z`)).getTime();
  for (const guess of [base - 5 * 36e5, base - 4 * 36e5]) {
    const offset = torontoOffset(dtf, new Date(guess));
    const inst = new Date(base - offset * 6e4);
    const parts = dtf.formatToParts(inst);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = hhmm.split(":").map(Number);
    if (Number(get("year")) === y && Number(get("month")) === m && Number(get("day")) === d && Number(get("hour")) === hh && Number(get("minute")) === mm) {
      return inst;
    }
  }
  return new Date(base - 5 * 36e5);
}
function torontoOffset(dtf, instant) {
  const parts = dtf.formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asLocal - instant.getTime()) / 6e4);
}
var STAFF_PEPPER = "loafline-staff-pepper";
function hashPassword(password) {
  const salt = randomBytes2(16).toString("hex");
  const digest = createHash("sha256").update(salt + password + STAFF_PEPPER).digest("hex");
  return `${salt}:${digest}`;
}
function verifyPassword(password, stored) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const check = createHash("sha256").update(salt + password + STAFF_PEPPER).digest("hex");
  return check === digest;
}

// src-server/services/killbill.ts
var KillBillError = class extends Error {
  constructor(status, body, timeout) {
    super(`Kill Bill ${status}`);
    this.status = status;
    this.body = body;
    this.timeout = timeout;
  }
};
function centsToKb(cents) {
  return Math.round(cents) / 100;
}
var AUTO_INVOICING_DRAFT_TAG_ID = "00000000-0000-0000-0000-000000000008";
var KillBillClient = class {
  constructor(env) {
    this.env = env;
  }
  async rawRequest(opts) {
    const url = new URL(this.env.killbillUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5e3);
    try {
      const auth = Buffer.from(`${this.env.killbillUsername}:${this.env.killbillPassword}`).toString("base64");
      const headers = {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": this.env.killbillApiKey,
        "X-Killbill-ApiSecret": this.env.killbillApiSecret,
        "X-Killbill-CreatedBy": opts.createdBy,
        Accept: "application/json"
      };
      if (opts.body !== void 0) headers["Content-Type"] = "application/json";
      const res = await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body === void 0 ? void 0 : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
        signal: controller.signal
      });
      const text = await res.text();
      const responseHeaders = {};
      res.headers.forEach((v, k) => responseHeaders[k.toLowerCase()] = v);
      return { status: res.status, body: text, headers: responseHeaders };
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
      throw new KillBillError(0, "", timeout);
    } finally {
      clearTimeout(timer);
    }
  }
  /** Request that must succeed with 2xx; returns parsed JSON when the body carries one. */
  async request(opts) {
    const res = await this.rawRequest(opts);
    if (res.status >= 200 && res.status < 300) {
      if (res.body === "") return {};
      return JSON.parse(res.body);
    }
    throw new KillBillError(res.status, res.body, false);
  }
  /** Availability check: succeeds when Kill Bill answers at all. */
  async ping() {
    try {
      const res = await this.rawRequest({
        method: "GET",
        path: "/1.0/kb/security/subject",
        createdBy: "loafline"
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }
  // ---- catalog ----
  async basePlans() {
    return this.request({
      method: "GET",
      path: "/1.0/kb/catalog/availableBasePlans",
      createdBy: "loafline"
    });
  }
  async createSimplePlan(input) {
    await this.request({
      method: "POST",
      path: "/1.0/kb/catalog/simplePlan",
      body: input,
      createdBy: "loafline"
    });
  }
  // ---- accounts ----
  async getAccountByKey(externalKey) {
    try {
      return await this.request({
        method: "GET",
        path: "/1.0/kb/accounts",
        query: { externalKey },
        createdBy: "loafline"
      });
    } catch (err) {
      if (err instanceof KillBillError && err.status === 404) return null;
      throw err;
    }
  }
  async createAccount(input) {
    await this.request({
      method: "POST",
      path: "/1.0/kb/accounts",
      body: input,
      createdBy: "loafline"
    });
    const account = await this.getAccountByKey(input.externalKey);
    if (!account) throw new KillBillError(500, "account not readable after creation", false);
    return account;
  }
  async tagAccountDraft(accountId) {
    await this.request({
      method: "POST",
      path: `/1.0/kb/accounts/${accountId}/tags`,
      body: [AUTO_INVOICING_DRAFT_TAG_ID],
      createdBy: "loafline"
    });
  }
  // ---- invoices: external charges, tax items, commit ----
  async createExternalCharges(accountId, items) {
    return this.request({
      method: "POST",
      path: `/1.0/kb/invoices/charges/${accountId}`,
      body: items,
      query: { autoCommit: "false" },
      createdBy: "loafline"
    });
  }
  async createTaxItems(accountId, items) {
    return this.request({
      method: "POST",
      path: `/1.0/kb/invoices/taxes/${accountId}`,
      body: items,
      query: { autoCommit: "false" },
      createdBy: "loafline"
    });
  }
  async commitInvoice(invoiceId) {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/invoices/${invoiceId}/commitInvoice`,
      createdBy: "loafline"
    });
  }
  /** Remove an auto-applied account-credit item, restoring the invoice balance. */
  async deleteCbaItem(invoiceId, invoiceItemId, accountId) {
    await this.request({
      method: "DELETE",
      path: `/1.0/kb/invoices/${invoiceId}/${invoiceItemId}/cba`,
      query: { accountId },
      createdBy: "loafline"
    });
  }
  async getInvoice(invoiceId) {
    return this.request({
      method: "GET",
      path: `/1.0/kb/invoices/${invoiceId}`,
      createdBy: "loafline"
    });
  }
  async getInvoices(accountId) {
    return this.request({
      method: "GET",
      path: `/1.0/kb/accounts/${accountId}/invoices`,
      createdBy: "loafline"
    });
  }
  // ---- payments ----
  async payInvoice(invoiceId, input, createdBy) {
    let payment = {};
    try {
      payment = await this.request({
        method: "POST",
        path: `/1.0/kb/invoices/${invoiceId}/payments`,
        body: input,
        query: { externalPayment: "true" },
        createdBy
      });
    } catch (err) {
      if (err instanceof KillBillError && err.status === 400) {
        payment = {};
      } else {
        throw err;
      }
    }
    if (payment.paymentId) return payment;
    for (let i = 0; i < 20; i++) {
      const payments = await this.getInvoicePayments(invoiceId);
      const found = payments.find((candidate) => candidate.paymentExternalKey === input.paymentExternalKey);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new KillBillError(404, "payment not found after purchase", false);
  }
  async getInvoicePayments(invoiceId) {
    return this.request({
      method: "GET",
      path: `/1.0/kb/invoices/${invoiceId}/payments`,
      createdBy: "loafline"
    });
  }
  async getPayment(paymentId) {
    return this.request({
      method: "GET",
      path: `/1.0/kb/payments/${paymentId}`,
      createdBy: "loafline"
    });
  }
  async getAccountPayments(accountId) {
    return this.request({
      method: "GET",
      path: `/1.0/kb/accounts/${accountId}/payments`,
      createdBy: "loafline"
    });
  }
  // ---- refunds ----
  async refundInvoicePayment(paymentId, input, createdBy) {
    await this.request({
      method: "POST",
      path: `/1.0/kb/invoicePayments/${paymentId}/refunds`,
      body: input,
      createdBy
    });
  }
  async refundPayment(paymentId, input, createdBy) {
    await this.request({
      method: "POST",
      path: `/1.0/kb/payments/${paymentId}/refunds`,
      body: input,
      createdBy
    });
  }
  // ---- subscriptions ----
  async createSubscription(input) {
    await this.request({
      method: "POST",
      path: "/1.0/kb/subscriptions",
      body: input,
      query: { callCompletion: "false" },
      createdBy: "loafline"
    });
  }
  async getSubscriptionByKey(externalKey) {
    return this.request({
      method: "GET",
      path: "/1.0/kb/subscriptions",
      query: { externalKey },
      createdBy: "loafline"
    });
  }
  async changePlan(subscriptionId, planName, requestedDate) {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/subscriptions/${subscriptionId}`,
      body: { planName },
      query: { requestedDate, callCompletion: "false" },
      createdBy: "loafline"
    });
  }
  async undoChangePlan(subscriptionId) {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/subscriptions/${subscriptionId}/undoChangePlan`,
      createdBy: "loafline"
    });
  }
  async cancelSubscription(subscriptionId, requestedDate) {
    await this.request({
      method: "DELETE",
      path: `/1.0/kb/subscriptions/${subscriptionId}`,
      query: {
        requestedDate,
        callCompletion: "false",
        entitlementPolicy: "END_OF_TERM",
        billingPolicy: "END_OF_TERM",
        useRequestedDateForBilling: "true"
      },
      createdBy: "loafline"
    });
  }
  async uncancelSubscription(subscriptionId) {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/subscriptions/${subscriptionId}/uncancel`,
      createdBy: "loafline"
    });
  }
  async addSubscriptionBlockingState(subscriptionId, input, requestedDate) {
    await this.request({
      method: "POST",
      path: `/1.0/kb/subscriptions/${subscriptionId}/block`,
      body: input,
      query: { requestedDate },
      createdBy: "loafline"
    });
  }
  async getBlockingStates(accountId) {
    return this.request({
      method: "GET",
      path: `/1.0/kb/accounts/${accountId}/block`,
      createdBy: "loafline"
    });
  }
  // ---- credits ----
  async createCredit(input, createdBy) {
    return this.request({
      method: "POST",
      path: "/1.0/kb/credits",
      body: [input],
      query: { autoCommit: "true" },
      createdBy
    });
  }
};

// src-server/services/outbox.ts
import "pg";

// src-server/services/mail.ts
import * as nodeNet from "node:net";
var MailDownError = class extends Error {
  constructor() {
    super("mail server unreachable");
  }
};
async function sendMail(env, message2) {
  const socket = await connect(env);
  try {
    await expectReply(socket, [220]);
    await command(socket, `HELO loafline`, [250]);
    await command(socket, `MAIL FROM:<${message2.fromAddress}>`, [250]);
    await command(socket, `RCPT TO:<${message2.to}>`, [250, 251]);
    await command(socket, `DATA`, [354]);
    const data = buildData(message2);
    await command(socket, `${data}\r
.`, [250]);
    await command(socket, `QUIT`, [221]);
  } finally {
    socket.destroy();
  }
}
async function pingMail(env) {
  try {
    const socket = await connect(env);
    const reply = await readReply(socket);
    socket.destroy();
    return reply.startsWith("220");
  } catch {
    return false;
  }
}
function buildData(message2) {
  const headers = [
    `From: ${message2.fromLine}`,
    `To: ${message2.to}`,
    `Subject: ${message2.subject}`,
    `Message-ID: <${message2.messageId}>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    ``
  ].join("\r\n");
  return `${headers}${message2.body.replace(/\n/g, "\r\n")}`;
}
function connect(env) {
  return new Promise((resolve, reject) => {
    const socket = nodeNet.createConnection({ host: env.smtpHost, port: env.smtpPort });
    socket.setTimeout(5e3);
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new MailDownError());
    });
    socket.once("error", (err) => {
      reject(err.code === "ECONNREFUSED" || err.code === "ECONNRESET" ? new MailDownError() : err);
    });
  });
}
function readReply(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf-8");
      if (/\r\n$/.test(buffer) && /^\d{3}/.test(buffer)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err.code === "ECONNRESET" ? new MailDownError() : err);
    };
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}
async function expectReply(socket, codes) {
  const reply = await readReply(socket);
  const code = Number(reply.slice(0, 3));
  if (!codes.includes(code)) {
    throw new Error(`unexpected SMTP reply: ${reply.trim()}`);
  }
  return reply;
}
async function command(socket, line, codes) {
  socket.write(`${line}\r
`);
  await expectReply(socket, codes);
}

// src-server/services/outbox.ts
var RETRY_DELAYS_SECONDS = [5, 15, 45];
var MAX_ATTEMPTS = 4;
var DASH_LINE = "----------";
function composeBody(notice) {
  const customerFirst = notice.locale === "fr-CA";
  const first = customerFirst ? notice.linesFr : notice.linesEn;
  const second = customerFirst ? notice.linesEn : notice.linesFr;
  return [...first, DASH_LINE, ...second].join("\n");
}
async function queueNotice(client, notice) {
  const res = await client.query(
    "UPDATE counters SET value = value + 1 WHERE name = 'notice' RETURNING value"
  );
  const number = `NT-${String(res.rows[0].value).padStart(6, "0")}`;
  const subject = notice.locale === "fr-CA" ? notice.subjectFr : notice.subjectEn;
  await client.query(
    `INSERT INTO notices (number, key, kind, to_email, locale, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
     ON CONFLICT (key) DO NOTHING`,
    [number, notice.key, notice.kind, notice.to, notice.locale, subject, composeBody(notice)]
  );
}
var Outbox = class {
  constructor(env, pool) {
    this.env = env;
    this.pool = pool;
  }
  draining = false;
  kickAgain = false;
  timer = null;
  wasDown = false;
  mailUp = true;
  lastCheckedAt = null;
  /** Check the mail server and drain everything that is due. */
  async tick() {
    try {
      const up = await pingMail(this.env);
      this.lastCheckedAt = /* @__PURE__ */ new Date();
      if (up) {
        this.mailUp = true;
        if (this.wasDown) {
          this.wasDown = false;
          await this.drain(true);
        } else {
          await this.drain(false);
        }
      } else {
        this.mailUp = false;
        this.wasDown = true;
      }
    } catch {
      this.mailUp = false;
      this.wasDown = true;
    }
  }
  /** Kick the outbox after an event queued a notice, for the first attempt inside 2 seconds. */
  kick() {
    if (this.draining) {
      this.kickAgain = true;
      return;
    }
    void this.drain(false);
  }
  schedule(ms) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain(false);
    }, ms);
  }
  /** Send due notices one at a time, strictly oldest first. */
  async drain(forceDue) {
    if (this.draining) return;
    this.draining = true;
    try {
      for (; ; ) {
        const notice = await this.nextDue();
        if (!notice) return;
        if (forceDue) {
          await this.attempt(notice);
          continue;
        }
        const waitMs = this.waitMs(notice);
        if (waitMs > 0) {
          this.schedule(Math.min(waitMs, 5e3));
          return;
        }
        await this.attempt(notice);
      }
    } finally {
      this.draining = false;
      if (this.kickAgain) {
        this.kickAgain = false;
        void this.drain(false);
      }
    }
  }
  async nextDue() {
    const res = await this.pool.query(
      `SELECT number, key, to_email, locale, subject, body, status, enqueued_at, attempts
       FROM notices WHERE status IN ('queued', 'retrying')
       ORDER BY enqueued_at ASC, number ASC
       LIMIT 1`
    );
    return res.rows[0] ?? null;
  }
  waitMs(notice) {
    if (notice.status === "queued" || notice.attempts.length === 0) return 0;
    const last = new Date(notice.attempts[notice.attempts.length - 1].at).getTime();
    const delayIndex = Math.min(notice.attempts.length - 1, RETRY_DELAYS_SECONDS.length - 1);
    const due = last + RETRY_DELAYS_SECONDS[delayIndex] * 1e3;
    return Math.max(0, due - Date.now());
  }
  async attempt(notice) {
    const at = /* @__PURE__ */ new Date();
    let outcome;
    try {
      await sendMail(this.env, {
        to: notice.to_email,
        fromAddress: this.env.mailFromAddress,
        fromLine: this.env.mailFrom,
        messageId: `${notice.key}@paindelune.example`,
        subject: notice.subject,
        body: notice.body
      });
      outcome = "sent";
      this.mailUp = true;
    } catch {
      outcome = "failed";
      this.mailUp = false;
      this.wasDown = true;
    }
    const attempts = [...notice.attempts, { at: at.toISOString(), outcome }];
    const status = outcome === "sent" ? "sent" : attempts.length >= MAX_ATTEMPTS ? "failed" : "retrying";
    await this.pool.query(
      "UPDATE notices SET status = $2, attempts = $3 WHERE number = $1",
      [notice.number, status, JSON.stringify(attempts)]
    );
  }
  /** Resend a failed notice: exactly one of N simultaneous calls succeeds. */
  async resend(number) {
    const res = await this.pool.query(
      `UPDATE notices
       SET status = 'queued', attempts = '[]', enqueued_at = now()
       WHERE number = $1 AND status = 'failed'
       RETURNING number, key, to_email, locale, subject, body, status, enqueued_at, attempts`,
      [number]
    );
    const row = res.rows[0];
    if (!row) return null;
    this.kick();
    return row;
  }
};

// src-server/background/background.ts
import "pg";

// src-server/domain/holds.ts
import { randomUUID } from "node:crypto";
import "pg";

// src-server/core/http.ts
import { createHmac, randomBytes as randomBytes3 } from "node:crypto";
var MAX_BODY_BYTES = 65536;
var ApiError = class extends Error {
  constructor(status, code, messageOverride = null, fields = null, headers = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.messageOverride = messageOverride;
    this.fields = fields;
    this.headers = headers;
  }
};
function readCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}
function cookieHeader(name, value, opts = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (opts.httpOnly !== false) cookie += "; HttpOnly";
  if (opts.maxAge !== void 0) cookie += `; Max-Age=${opts.maxAge}`;
  return cookie;
}
function resolveLocale(cookies, acceptLanguage) {
  const cookie = cookies["pdl_locale"];
  if (cookie === "fr-CA" || cookie === "en-CA") return cookie;
  if ((acceptLanguage ?? "").trim().toLowerCase().startsWith("fr")) return "fr-CA";
  return "en-CA";
}
function errorBody(err, locale) {
  const error = { code: err.code, message: err.messageOverride ?? "" };
  if (err.code === "invalid") {
    if (!err.messageOverride) {
      error.message = locale === "fr-CA" ? "V\xE9rifiez ces champs." : "Check these fields.";
    }
    if (err.fields) {
      const sorted = {};
      for (const key of Object.keys(err.fields).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
        sorted[key] = err.fields[key];
      }
      error.fields = sorted;
    }
  }
  return { status: err.status, body: JSON.stringify({ error }) };
}
async function readJsonBody(req) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return void 0;
  const hasBody = req.headers.get("content-length") !== null || req.headers.get("transfer-encoding") !== null;
  if (!hasBody) return {};
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type");
  }
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large");
  }
  const text = new TextDecoder().decode(buffer);
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(415, "unsupported_media_type");
  }
}
function checkOrigin(req) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin === null) return;
  let ownOrigin;
  try {
    ownOrigin = new URL(req.url).origin;
  } catch {
    return;
  }
  if (origin !== ownOrigin) {
    throw new ApiError(403, "cross_origin");
  }
}
function checkShape(body, spec) {
  const result = { values: {}, errors: {} };
  collect(body, spec, result, "");
  return result;
}
function collect(value, spec, result, prefix) {
  if (value === void 0 || value === null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    for (const [key, entry] of Object.entries(spec)) {
      if (entry.required) {
        result.errors[pathFor(prefix, key)] = "missing";
      }
    }
    return;
  }
  const obj = value;
  for (const key of Object.keys(obj).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    const entry = spec[key];
    const path = pathFor(prefix, key);
    if (!entry) {
      result.errors[path] = "cant_set";
      continue;
    }
    const kind = typeCheck(obj[key], entry);
    if (kind) {
      result.errors[path] = kind;
      continue;
    }
    const inner = obj[key];
    if (entry.type === "object" && entry.fields && typeof inner === "object" && inner !== null) {
      const sub = { values: {}, errors: {} };
      collect(inner, entry.fields, sub, path);
      for (const [subPath, subValue] of Object.entries(sub.values)) {
        result.values[subPath] = subValue;
      }
      for (const [subPath, subKind] of Object.entries(sub.errors)) {
        result.errors[subPath] = subKind;
      }
      result.values[path] = sub.values;
    } else if (entry.type === "array" && entry.items && Array.isArray(inner)) {
      const cleaned = [];
      inner.forEach((item, index) => {
        const itemPath = `${path}.${index}`;
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          result.errors[itemPath] = "wrong_type";
          return;
        }
        const sub = { values: {}, errors: {} };
        collect(item, entry.items, sub, itemPath);
        for (const [subPath, subKind] of Object.entries(sub.errors)) {
          result.errors[subPath] = subKind;
        }
        const plain = {};
        for (const [subPath, subValue] of Object.entries(sub.values)) {
          plain[subPath.slice(itemPath.length + 1)] = subValue;
        }
        cleaned.push(plain);
      });
      result.values[path] = cleaned;
    } else {
      result.values[path] = inner;
    }
  }
  for (const [key, entry] of Object.entries(spec)) {
    if (entry.required && obj[key] === void 0) {
      result.errors[pathFor(prefix, key)] = "missing";
    }
  }
}
function pathFor(prefix, key) {
  return prefix ? `${prefix}.${key}` : key;
}
function typeCheck(value, entry) {
  switch (entry.type) {
    case "string":
      return typeof value === "string" ? null : "wrong_type";
    case "number":
      return typeof value === "number" ? null : "wrong_type";
    case "boolean":
      return typeof value === "boolean" ? null : "wrong_type";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value) ? null : "wrong_type";
    case "array":
      return Array.isArray(value) ? null : "wrong_type";
  }
}
var SESSION_COOKIE_CUSTOMER = "pdl_session";
var SESSION_COOKIE_STAFF = "pdl_staff";
function signToken(raw, secret) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}
async function loadSessionByCookie(ctx, cookieName, kind) {
  const raw = ctx.cookies[cookieName];
  if (!raw) return null;
  const res = await ctx.pool.query(
    "SELECT * FROM sessions WHERE token = $1 AND kind = $2 AND expires_at > now()",
    [signToken(raw, ctx.env.sessionSecret), kind]
  );
  return res.rows[0] ?? null;
}
function loadCustomerSession(ctx) {
  return loadSessionByCookie(ctx, SESSION_COOKIE_CUSTOMER, "customer");
}
function loadStaffSession(ctx) {
  return loadSessionByCookie(ctx, SESSION_COOKIE_STAFF, "staff");
}
async function createSession(ctx, kind, customerId, staffId) {
  const raw = randomBytes3(32).toString("hex");
  await ctx.pool.query(
    "INSERT INTO sessions (token, customer_id, staff_id, kind, expires_at) VALUES ($1, $2, $3, $4, now() + interval '12 hours')",
    [signToken(raw, ctx.env.sessionSecret), customerId, staffId, kind]
  );
  return raw;
}
async function destroySession(ctx, cookieName, kind) {
  const raw = ctx.cookies[cookieName];
  if (!raw) return;
  await ctx.pool.query("DELETE FROM sessions WHERE token = $1 AND kind = $2", [
    signToken(raw, ctx.env.sessionSecret),
    kind
  ]);
}
var IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;
function idempotencyKey(ctx) {
  const header = ctx.req.headers.get("idempotency-key");
  if (header === null) {
    throw new ApiError(400, "idempotency_key_required");
  }
  if (!IDEMPOTENCY_RE.test(header)) {
    throw new ApiError(400, "idempotency_key_invalid");
  }
  return header;
}
function requestHash(body) {
  return createHmac("sha256", "idempotency").update(stableStringify(body)).digest("hex");
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}
async function beginIdempotency(ctx, scope, key, body) {
  const hash = requestHash(body);
  const res = await ctx.pool.query(
    "SELECT * FROM idempotency WHERE scope = $1 AND key = $2",
    [scope, key]
  );
  const row = res.rows[0];
  if (!row) {
    await ctx.pool.query(
      "INSERT INTO idempotency (scope, key, request_hash, status, body, in_progress) VALUES ($1, $2, $3, 0, NULL, true)",
      [scope, key, hash]
    );
    return null;
  }
  if (row.in_progress && Date.now() - row.created_at.getTime() < 6e4) {
    throw new ApiError(409, "request_in_progress");
  }
  if (row.request_hash !== hash) {
    throw new ApiError(409, "idempotency_key_reused");
  }
  if (row.status === 0 || row.body === null) {
    return null;
  }
  return JSON.stringify({ status: row.status, body: row.body });
}
async function finishIdempotency(ctx, scope, key, status, body) {
  const store = status >= 200 && status < 300 || status === 409 || status === 410 || status === 412 || status === 422;
  if (store) {
    await ctx.pool.query(
      "UPDATE idempotency SET status = $3, body = $4, in_progress = false WHERE scope = $1 AND key = $2",
      [scope, key, status, body]
    );
  } else {
    await ctx.pool.query("DELETE FROM idempotency WHERE scope = $1 AND key = $2", [scope, key]);
  }
}

// src-server/domain/stock.ts
init_money();
import "pg";
async function batchStock(client, code, now) {
  const movements = await client.query(
    "SELECT kind, bars FROM stock_movements WHERE batch_code = $1 ORDER BY id ASC",
    [code]
  );
  const rows = movements.rows;
  const cutBars = /* @__PURE__ */ new Set();
  const barState = /* @__PURE__ */ new Map();
  for (const row of rows) {
    for (const bar of row.bars) {
      if (row.kind === "cut") {
        cutBars.add(bar);
        barState.set(bar, "available");
      } else if (row.kind === "sale") {
        barState.set(bar, "sold");
      } else if (row.kind === "restock") {
        barState.set(bar, "available");
      }
    }
  }
  const holds = await client.query(
    `SELECT bar FROM holds WHERE batch_code = $1 AND status = 'active' AND expires_at > $2`,
    [code, now]
  );
  const heldBars = new Set(holds.rows.map((r) => r.bar));
  const bars = [];
  let sold = 0;
  let held = 0;
  let available = 0;
  for (const bar of [...cutBars].sort((a, b) => a - b)) {
    let status = barState.get(bar) ?? "available";
    if (heldBars.has(bar) && status === "available") {
      status = "held";
    }
    if (status === "sold") sold += 1;
    else if (status === "held") held += 1;
    else available += 1;
    bars.push({ number: bar, status });
  }
  return {
    counts: { cut: cutBars.size, sold, held, available },
    bars
  };
}
async function addMovement(client, code, kind, bars, ref) {
  await client.query(
    "INSERT INTO stock_movements (batch_code, kind, bars, ref) VALUES ($1, $2, $3, $4)",
    [code, kind, bars, ref]
  );
}
function taxLinesFromJson(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) => ({
    code: row.code,
    rateLabel: row.rate,
    rateHundredThousandths: rateToHundredThousandths(row.rate),
    amount: money(row.amount_cents)
  }));
}
function rateToHundredThousandths(rateLabel) {
  const pct = Number(rateLabel.replace("%", ""));
  return Math.round(pct * 1e3);
}
async function refreshBatchState(client, code, now) {
  const batchRes = await client.query("SELECT state, bars_cut FROM batches WHERE code = $1 FOR UPDATE", [code]);
  const batch = batchRes.rows[0];
  if (!batch) return;
  if (batch.state !== "live" && batch.state !== "sold_out") return;
  const stock = await batchStock(client, code, now);
  if (batch.state === "live" && stock.counts.sold === stock.counts.cut && stock.counts.cut > 0) {
    await client.query("UPDATE batches SET state = 'sold_out' WHERE code = $1", [code]);
  } else if (batch.state === "sold_out" && stock.counts.sold < stock.counts.cut) {
    await client.query("UPDATE batches SET state = 'live' WHERE code = $1", [code]);
  }
}

// src-server/domain/batches.ts
import "pg";

// src-server/core/catalog.ts
var DROP_SCENTS = [
  {
    slug: "lavender-oat",
    en: "Lavender & Oat",
    fr: "Lavande et avoine",
    tint: "lilac",
    notesEn: "Lavender, colloidal oat, a little honey",
    notesFr: "Lavande, avoine collo\xEFdale, un peu de miel"
  },
  {
    slug: "smoked-birch",
    en: "Smoked Birch",
    fr: "Bouleau fum\xE9",
    tint: "ash",
    notesEn: "Birch tar, cedar leaf, black pepper",
    notesFr: "Goudron de bouleau, feuille de c\xE8dre, poivre noir"
  },
  {
    slug: "wild-mint",
    en: "Wild Mint",
    fr: "Menthe sauvage",
    tint: "mint",
    notesEn: "Spearmint, nettle, green clay",
    notesFr: "Menthe verte, ortie, argile verte"
  },
  {
    slug: "rose-clay",
    en: "Rose Clay",
    fr: "Argile rose",
    tint: "rose",
    notesEn: "Rose geranium, pink kaolin",
    notesFr: "G\xE9ranium rosat, kaolin rose"
  }
];
var TRIO_SCENTS = [
  { slug: "oat-milk", en: "Oat Milk", fr: "Lait d'avoine" },
  { slug: "cedar-sage", en: "Cedar & Sage", fr: "C\xE8dre et sauge" },
  { slug: "unscented", en: "Unscented", fr: "Sans parfum" }
];
var CADENCE_MONTHS = { MONTHLY: 1, BIMESTRIAL: 2, QUARTERLY: 3 };
function cadenceLabel(cadence, locale) {
  if (locale === "fr-CA") {
    return cadence === "MONTHLY" ? "Chaque mois" : cadence === "BIMESTRIAL" ? "Tous les deux mois" : "Tous les trois mois";
  }
  return cadence === "MONTHLY" ? "Every month" : cadence === "BIMESTRIAL" ? "Every two months" : "Every three months";
}
function topicLabel(topic, locale) {
  if (locale === "fr-CA") {
    return topic === "order" ? "Question sur une commande" : topic === "subscription" ? "Abonnement" : topic === "wholesale" ? "Vente en gros" : "Autre chose";
  }
  return topic === "order" ? "Order question" : topic === "subscription" ? "Subscription" : topic === "wholesale" ? "Wholesale" : "Something else";
}
function batchStateLabel(state, locale) {
  const en = { poured: "Poured", curing: "Curing", scheduled: "Scheduled", live: "Live", sold_out: "Sold out", withdrawn: "Withdrawn" };
  const fr = { poured: "Coul\xE9", curing: "En cure", scheduled: "Programm\xE9", live: "En vente", sold_out: "\xC9puis\xE9", withdrawn: "Retir\xE9" };
  return locale === "fr-CA" ? fr[state] : en[state];
}

// src-server/core/copy.ts
var MESSAGES = {
  unsupported_media_type: ["Send the request as JSON.", "Envoyez la requ\xEAte en JSON."],
  payload_too_large: ["That request is too large.", "Cette requ\xEAte est trop volumineuse."],
  cross_origin: ["That request didn't come from this site.", "Cette requ\xEAte ne vient pas de ce site."],
  unauthenticated: ["Sign in to continue.", "Connectez-vous pour continuer."],
  not_found: ["We couldn't find that.", "Nous n'avons rien trouv\xE9."],
  forbidden: ["Your role can't do that.", "Votre r\xF4le ne permet pas cette action."],
  method_not_allowed: ["That method isn't allowed here.", "Cette m\xE9thode n'est pas permise ici."],
  audit_immutable: ["The audit log can't be changed.", "Le journal ne peut pas \xEAtre modifi\xE9."],
  idempotency_key_required: ["Send an Idempotency-Key header.", "Envoyez un en-t\xEAte Idempotency-Key."],
  idempotency_key_invalid: ["That idempotency key isn't valid.", "Cette cl\xE9 d'idempotence n'est pas valide."],
  idempotency_key_reused: ["That idempotency key was used with a different request.", "Cette cl\xE9 d'idempotence a \xE9t\xE9 utilis\xE9e avec une requ\xEAte diff\xE9rente."],
  request_in_progress: ["That request is still running.", "Cette requ\xEAte est toujours en cours."],
  precondition_required: ["Reload the record, then try again.", "Rechargez le dossier, puis r\xE9essayez."],
  stale_version: ["Someone else changed this record. Reload it and try again.", "Quelqu'un d'autre a modifi\xE9 ce dossier. Rechargez-le et r\xE9essayez."],
  invalid: ["Check these fields.", "V\xE9rifiez ces champs."],
  invalid_credentials: ["Email or password is incorrect.", "Courriel ou mot de passe incorrect."],
  rate_limited: ["Too many codes were requested for this email. Wait a few minutes, then try again.", "Trop de codes ont \xE9t\xE9 demand\xE9s pour ce courriel. Patientez quelques minutes, puis r\xE9essayez."],
  stepup_locked: ["Too many incorrect codes. Wait a few minutes, then request a new code.", "Trop de codes erron\xE9s. Patientez quelques minutes, puis demandez un nouveau code."],
  not_live: ["This batch isn't on sale yet.", "Ce lot n'est pas encore en vente."],
  hold_limit: ["You can hold up to 2 bars from one batch.", "Vous pouvez r\xE9server au plus 2 pains d'un m\xEAme lot."],
  sold_out: ["Sold out. The last bar is gone. You were not charged.", "\xC9puis\xE9. Le dernier pain est parti. Aucun montant n'a \xE9t\xE9 pr\xE9lev\xE9."],
  all_held: ["Every bar is held right now. A bar comes back if a hold ends without payment.", "Tous les pains sont r\xE9serv\xE9s pour le moment. Un pain revient si une r\xE9servation se termine sans paiement."],
  hold_not_active: ["That hold is no longer active.", "Cette r\xE9servation n'est plus active."],
  hold_expired: ["Your hold ended before payment. You were not charged.", "Votre r\xE9servation a pris fin avant le paiement. Aucun montant n'a \xE9t\xE9 pr\xE9lev\xE9."],
  hold_not_in_cart: ["That hold isn't in your cart.", "Cette r\xE9servation n'est pas dans votre panier."],
  subscription_exists: ["You already have a Trio. Manage it from your account.", "Vous avez d\xE9j\xE0 un Trio. G\xE9rez-le depuis votre compte."],
  cycle_locked: ["This cycle is locked. Changes open again after {date}.", "Ce cycle est verrouill\xE9. Les modifications rouvrent apr\xE8s le {date}."],
  invalid_transition: ["That change isn't possible right now.", "Cette modification n'est pas possible pour le moment."],
  already_skipped: ["The next delivery is already skipped.", "La prochaine livraison est d\xE9j\xE0 saut\xE9e."],
  not_skipped: ["The next delivery isn't skipped.", "La prochaine livraison n'est pas saut\xE9e."],
  already_shipped: ["{order} was already shipped.", "{order} a d\xE9j\xE0 \xE9t\xE9 exp\xE9di\xE9e."],
  order_refunded: ["{order} is fully refunded. Don't ship it.", "{order} est enti\xE8rement rembours\xE9e. Ne l'exp\xE9diez pas."],
  already_refunded: ["Those bars were already refunded.", "Ces pains ont d\xE9j\xE0 \xE9t\xE9 rembours\xE9s."],
  line_not_mismatched: ["That line isn't a mismatch.", "Cette ligne n'est pas un \xE9cart."],
  line_not_orphan: ["That line isn't an orphan payment.", "Cette ligne n'est pas un paiement orphelin."],
  notice_not_failed: ["{notice} isn't failed. It may already be queued again.", "{notice} n'est pas en \xE9chec. Il est peut-\xEAtre d\xE9j\xE0 remis en file."],
  billing_unavailable: ["Our billing system is unreachable. Nothing was changed.", "Notre syst\xE8me de facturation est injoignable. Rien n'a \xE9t\xE9 modifi\xE9."],
  billing_unavailable_checkout: ["Checkout is paused: our payment system is unreachable.", "Le paiement est en pause : notre syst\xE8me de paiement est injoignable."],
  billing_unavailable_subscription: ["Subscription changes are paused: our billing system is unreachable. Nothing has been changed.", "Les modifications d'abonnement sont en pause : notre syst\xE8me de facturation est injoignable. Rien n'a \xE9t\xE9 modifi\xE9."],
  invalid_batch_transition: ["A batch in state {state} can't {action}.", "Un lot \xE0 l'\xE9tat {state} ne peut pas {action}."]
};
function message(code, locale, params = {}) {
  const entry = MESSAGES[code] ?? MESSAGES.not_found;
  let text = locale === "fr-CA" ? entry[1] : entry[0];
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}
function batchTransitionMessage(state, action, locale) {
  const stateLabel = batchStateLabel(state, locale).toLocaleLowerCase(locale === "fr-CA" ? "fr-CA" : "en-CA");
  const actionsEn = { cut: "cut", schedule: "schedule", open: "open", withdraw: "withdraw" };
  const actionsFr = { cut: "\xEAtre coup\xE9", schedule: "\xEAtre programm\xE9", open: "ouvrir", withdraw: "\xEAtre retir\xE9" };
  const actionLabel = locale === "fr-CA" ? actionsFr[action] : actionsEn[action];
  return {
    code: "invalid_transition",
    message: locale === "fr-CA" ? `Un lot \xE0 l'\xE9tat ${stateLabel} ne peut pas ${actionLabel}.` : `A batch in state ${stateLabel} can't ${actionLabel}.`
  };
}
var FIELDS = {
  cant_set: ["This field can't be set.", "Ce champ ne peut pas \xEAtre d\xE9fini."],
  email: ["Enter an email address like name@example.ca.", "Entrez une adresse courriel comme nom@exemple.ca."],
  code: ["That code doesn't match or has expired. Request a new code.", "Ce code ne correspond pas ou a expir\xE9. Demandez un nouveau code."],
  name: ["Enter your full name.", "Entrez votre nom complet."],
  line1: ["Enter your street address.", "Entrez votre adresse."],
  city: ["Enter your city.", "Entrez votre ville."],
  postal_code: ["Enter a Canadian postal code like H2T 1S6.", "Entrez un code postal canadien comme H2T 1S6."],
  province: ["Choose a province or territory.", "Choisissez une province ou un territoire."],
  scent: ["Choose a scent.", "Choisissez un parfum."],
  cadence_missing: ["Choose how often your Trio arrives.", "Choisissez la fr\xE9quence de votre Trio."],
  cadence_same: ["That is already your cadence.", "C'est d\xE9j\xE0 votre fr\xE9quence."],
  bars_refund: ["Choose at least one bar from this order.", "Choisissez au moins un pain de cette commande."],
  bars_cut: ["Enter a bar count from 1 to 24.", "Entrez un nombre de pains de 1 \xE0 24."],
  restock: ["This batch was withdrawn; its bars can't go back on sale.", "Ce lot a \xE9t\xE9 retir\xE9; ses pains ne peuvent pas revenir en vente."],
  amount_cents: ["Enter an amount from $1.00 to $25.00.", `Entrez un montant de 1,00\xA0$ \xE0 25,00\xA0$.`],
  reason: ["Give a reason of 3 to 500 characters.", "Indiquez un motif de 3 \xE0 500 caract\xE8res."],
  topic: ["Choose a topic.", "Choisissez un sujet."],
  message: ["Write a message of 10 to 2,000 characters.", `\xC9crivez un message de 10 \xE0 2\xA0000 caract\xE8res.`],
  poured_on: ["The pour date can't be in the future.", "La date de coul\xE9e ne peut pas \xEAtre dans le futur."],
  cure_days: ["Cure time is 28 to 60 days.", "La cure dure de 28 \xE0 60 jours."],
  drop_at_local_format: ["Enter a date and time like 2026-11-07T10:00.", "Entrez une date et une heure comme 2026-11-07T10:00."],
  drop_at_local_past: ["Choose a time in the future.", "Choisissez un moment dans le futur."],
  drop_at_local_before_cure: ["The drop can't be before the cure date, {date}.", "La vente ne peut pas pr\xE9c\xE9der la date de cure, le {date}."],
  drop_at_local_gap: ["That time doesn't exist in Toronto: clocks spring forward.", "Cette heure n'existe pas \xE0 Toronto\xA0: on avance l'heure."],
  packing_cutoff_local: ["Enter a time like 14:00.", "Entrez une heure comme 14\xA0h\xA000."],
  month: ["Enter a month like 2026-10.", "Entrez un mois comme 2026-10."],
  holds: ["Choose at least one held bar.", "Choisissez au moins un pain r\xE9serv\xE9."],
  batch: ["Choose a batch.", "Choisissez un lot."],
  purpose: ["Use checkout or sign_in.", "Utilisez checkout ou sign_in."],
  q: ["Enter an order number, subscription number or email.", "Entrez un num\xE9ro de commande, un num\xE9ro d'abonnement ou un courriel."],
  status: ["Choose queued, retrying, sent or failed.", "Choisissez queued, retrying, sent ou failed."],
  open_not_cured: ["This batch is still curing until {date}.", "Ce lot est en cure jusqu'au {date}."]
};
function fieldMessage(key, locale, params = {}) {
  const entry = FIELDS[key] ?? FIELDS.cant_set;
  let text = locale === "fr-CA" ? entry[1] : entry[0];
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}

// src-server/domain/batches.ts
var PUBLIC_STATES = ["scheduled", "live", "sold_out"];
function isPublicState(state) {
  return PUBLIC_STATES.includes(state);
}
function transitionError(state, action, locale) {
  const result = batchTransitionMessage(state, action, locale);
  return new ApiError(409, result.code, result.message);
}
async function getBatch(client, code) {
  const res = await client.query("SELECT * FROM batches WHERE code = $1", [code]);
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, poured_on: dateToString(row.poured_on) };
}
async function logLoaf(client, locale, input) {
  if (!DROP_SCENTS.some((scent) => scent.slug === input.scent)) {
    throw new ApiError(422, "invalid", null, { scent: fieldMessage("scent", locale) });
  }
  const today = torontoDate(/* @__PURE__ */ new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.pouredOn) || input.pouredOn > today) {
    throw new ApiError(422, "invalid", null, { poured_on: fieldMessage("poured_on", locale) });
  }
  if (!Number.isInteger(input.cureDays) || input.cureDays < 28 || input.cureDays > 60) {
    throw new ApiError(422, "invalid", null, { cure_days: fieldMessage("cure_days", locale) });
  }
  const counter = await client.query("UPDATE counters SET value = value + 1 WHERE name = 'batch' RETURNING value");
  const code = `B-${String(counter.rows[0].value).padStart(4, "0")}`;
  await client.query(
    `INSERT INTO batches (code, scent, state, poured_on, cure_days, bars_cut, drop_at)
     VALUES ($1, $2, 'poured', $3, $4, 0, NULL)`,
    [code, input.scent, input.pouredOn, input.cureDays]
  );
  return await getBatch(client, code);
}
async function cutBatch(client, locale, code, bars) {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "poured") {
    throw transitionError(batch.state, "cut", locale);
  }
  if (!Number.isInteger(bars) || bars < 1 || bars > 24) {
    throw new ApiError(422, "invalid", null, { bars: fieldMessage("bars_cut", locale) });
  }
  await client.query("UPDATE batches SET bars_cut = $2, state = 'curing' WHERE code = $1", [code, bars]);
  await addMovement(client, code, "cut", Array.from({ length: bars }, (_, i) => i + 1), null);
  return await getBatch(client, code);
}
async function scheduleBatch(client, locale, code, dropAtLocal) {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "curing" && batch.state !== "scheduled") {
    throw transitionError(batch.state, "schedule", locale);
  }
  const fields = await scheduleFields(locale, batch, dropAtLocal);
  await client.query("UPDATE batches SET state = 'scheduled', drop_at = $2 WHERE code = $1", [code, fields.instant]);
  return await getBatch(client, code);
}
async function scheduleFields(locale, batch, dropAtLocal) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dropAtLocal)) {
    throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_format", locale) });
  }
  const conversion = torontoLocalToInstant(dropAtLocal);
  if (conversion.gap || !conversion.instant) {
    throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_gap", locale) });
  }
  const instant = conversion.instant;
  if (instant.getTime() <= Date.now()) {
    throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_past", locale) });
  }
  const cureDate = addDays(dateToString(batch.poured_on), batch.cure_days);
  if (dateDiffDays(dropAtLocal.slice(0, 10), cureDate) < 0) {
    throw new ApiError(422, "invalid", null, {
      drop_at_local: fieldMessage("drop_at_local_before_cure", locale, { date: cureDate })
    });
  }
  return { instant };
}
async function openBatch(client, locale, code) {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "curing" && batch.state !== "scheduled") {
    throw transitionError(batch.state, "open", locale);
  }
  const cureDate = addDays(dateToString(batch.poured_on), batch.cure_days);
  const today = torontoDate(/* @__PURE__ */ new Date());
  if (dateDiffDays(today, cureDate) < 0) {
    throw new ApiError(422, "invalid", null, {
      drop_at_local: fieldMessage("open_not_cured", locale, { date: cureDate })
    });
  }
  await client.query("UPDATE batches SET state = 'live', drop_at = now() WHERE code = $1", [code]);
  return await getBatch(client, code);
}
async function withdrawBatch(client, locale, code) {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "poured" && batch.state !== "curing" && batch.state !== "scheduled" && batch.state !== "live") {
    throw transitionError(batch.state, "withdraw", locale);
  }
  await client.query("UPDATE batches SET state = 'withdrawn' WHERE code = $1", [code]);
  await client.query(
    `UPDATE holds SET status = 'released'
     WHERE batch_code = $1 AND status = 'active'`,
    [code]
  );
  return await getBatch(client, code);
}
async function activateDueBatches(pool) {
  await pool.query(
    "UPDATE batches SET state = 'live' WHERE state = 'scheduled' AND drop_at IS NOT NULL AND drop_at <= now()"
  );
}

// src-server/domain/holds.ts
var HOLD_LIMIT_PER_BATCH = 2;
async function createHold(pool, env, cartId, batchCode) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`batch:${batchCode}`]);
    const batch = await getBatch(client, batchCode);
    if (!batch || !isPublicState(batch.state)) {
      await client.query("ROLLBACK");
      throw new ApiError(404, "not_found");
    }
    if (batch.state === "scheduled") {
      await client.query("ROLLBACK");
      throw new ApiError(409, "not_live");
    }
    const now = /* @__PURE__ */ new Date();
    const stock = await batchStock(client, batchCode, now);
    if (stock.counts.available === 0) {
      await client.query("ROLLBACK");
      throw new ApiError(409, stock.counts.held > 0 ? "all_held" : "sold_out");
    }
    const cart = cartId ?? randomUUID();
    const activeForCart = await client.query(
      `SELECT count(*)::int AS n FROM holds
       WHERE cart_id = $1 AND batch_code = $2 AND status = 'active' AND expires_at > now()`,
      [cart, batchCode]
    );
    if (activeForCart.rows[0].n >= HOLD_LIMIT_PER_BATCH) {
      await client.query("ROLLBACK");
      throw new ApiError(409, "hold_limit");
    }
    const bar = stock.bars.find((candidate) => candidate.status === "available")?.number;
    if (bar === void 0) {
      await client.query("ROLLBACK");
      throw new ApiError(409, stock.counts.held > 0 ? "all_held" : "sold_out");
    }
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + env.holdTtlSeconds * 1e3);
    const res = await client.query(
      `INSERT INTO holds (id, cart_id, batch_code, bar, status, amount_cents, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'active', 1100, $5, $6) RETURNING *`,
      [id, cart, batchCode, bar, now, expiresAt]
    );
    await client.query("COMMIT");
    const hold = res.rows[0];
    client.release();
    return { hold, cartId: cart, batchState: batch.state };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw err;
  }
}
async function releaseHold(client, cartId, holdId) {
  const res = await client.query("SELECT * FROM holds WHERE id = $1", [holdId]);
  const hold = res.rows[0];
  if (!hold || hold.cart_id !== cartId) {
    throw new ApiError(404, "not_found");
  }
  if (hold.status !== "active" || hold.expires_at <= /* @__PURE__ */ new Date()) {
    throw new ApiError(409, "hold_not_active");
  }
  const updated = await client.query(
    `UPDATE holds SET status = 'released' WHERE id = $1 AND status = 'active' RETURNING *`,
    [holdId]
  );
  return updated.rows[0];
}
async function expireHolds(pool) {
  await pool.query(
    `UPDATE holds SET status = 'expired'
     WHERE status = 'active' AND expires_at <= now()`
  );
}
function holdView(hold) {
  return {
    id: hold.id,
    batch: hold.batch_code,
    bar: hold.bar,
    status: hold.status,
    created_at: hold.created_at.toISOString(),
    expires_at: hold.expires_at.toISOString(),
    amount: { cents: hold.amount_cents, currency: "CAD" }
  };
}

// src-server/background/background.ts
var Background = class {
  constructor(pool, kb, outbox) {
    this.pool = pool;
    this.kb = kb;
    this.outbox = outbox;
  }
  billingUp = true;
  catalogReady = false;
  stopped = false;
  start() {
    this.loop5s();
    this.loopCatalog();
  }
  stop() {
    this.stopped = true;
  }
  async loop5s() {
    while (!this.stopped) {
      const started = Date.now();
      try {
        this.billingUp = await this.kb.ping();
      } catch {
        this.billingUp = false;
      }
      try {
        await this.outbox.tick();
      } catch {
      }
      try {
        await expireHolds(this.pool);
      } catch {
      }
      try {
        const client = await this.pool.connect();
        try {
          await activateDueBatches(client);
        } finally {
          client.release();
        }
      } catch {
      }
      const elapsed = Date.now() - started;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 5e3 - elapsed)));
    }
  }
  async loopCatalog() {
    while (!this.stopped && !this.catalogReady) {
      try {
        const plans = await this.kb.basePlans();
        const wanted = [
          { planId: "trio-monthly", billingPeriod: "MONTHLY" },
          { planId: "trio-bimestrial", billingPeriod: "BIMESTRIAL" },
          { planId: "trio-quarterly", billingPeriod: "QUARTERLY" }
        ];
        for (const plan of wanted) {
          if (!plans.some((candidate) => candidate.plan === plan.planId)) {
            await this.kb.createSimplePlan({
              planId: plan.planId,
              productName: "trio",
              productCategory: "BASE",
              currency: "CAD",
              amount: 29.04,
              billingPeriod: plan.billingPeriod,
              trialLength: 0
            });
          }
        }
        this.catalogReady = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1e4));
      }
    }
  }
};

// src-server/routes/routes.ts
init_money();

// src-server/core/provinces.ts
init_money();
var GST = { code: "GST", rateHundredThousandths: RATES.GST, rateLabel: "5%" };
var QST = { code: "QST", rateHundredThousandths: RATES.QST, rateLabel: "9.975%" };
var HST13 = { code: "HST", rateHundredThousandths: RATES.HST13, rateLabel: "13%" };
var HST14 = { code: "HST", rateHundredThousandths: RATES.HST14, rateLabel: "14%" };
var HST15 = { code: "HST", rateHundredThousandths: RATES.HST15, rateLabel: "15%" };
var PROVINCES = [
  { code: "AB", en: "Alberta", fr: "Alberta", taxes: [GST] },
  { code: "BC", en: "British Columbia", fr: "Colombie-Britannique", taxes: [GST] },
  { code: "MB", en: "Manitoba", fr: "Manitoba", taxes: [GST] },
  { code: "NB", en: "New Brunswick", fr: "Nouveau-Brunswick", taxes: [HST15] },
  { code: "NL", en: "Newfoundland and Labrador", fr: "Terre-Neuve-et-Labrador", taxes: [HST15] },
  { code: "NS", en: "Nova Scotia", fr: "Nouvelle-\xC9cosse", taxes: [HST14] },
  { code: "NT", en: "Northwest Territories", fr: "Territoires du Nord-Ouest", taxes: [GST] },
  { code: "NU", en: "Nunavut", fr: "Nunavut", taxes: [GST] },
  { code: "ON", en: "Ontario", fr: "Ontario", taxes: [HST13] },
  { code: "PE", en: "Prince Edward Island", fr: "\xCEle-du-Prince-\xC9douard", taxes: [HST15] },
  { code: "QC", en: "Qu\xE9bec", fr: "Qu\xE9bec", taxes: [GST, QST] },
  { code: "SK", en: "Saskatchewan", fr: "Saskatchewan", taxes: [GST] },
  { code: "YT", en: "Yukon", fr: "Yukon", taxes: [GST] }
];
function findProvince(code) {
  return PROVINCES.find((p) => p.code === code);
}

// src-server/domain/stepup.ts
import "pg";

// src-server/domain/text.ts
var CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
function hasControlChars(value) {
  return CONTROL_CHAR_RE.test(value);
}
function hasDisallowedControlChars(value) {
  return /[\u0000-\u0009\u000B-\u001F\u007F]/.test(value);
}
function isValidEmail(value) {
  if (value.length < 3 || value.length > 254) return false;
  const at = value.indexOf("@");
  if (at === -1) return false;
  if (value.indexOf("@", at + 1) !== -1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes(".")) return false;
  if (/[,\s<>";]/.test(value)) return false;
  if (hasControlChars(value)) return false;
  return true;
}
function normalizeEmail(value) {
  return value.trim().toLowerCase();
}
function isValidCanadianPostalCode(value) {
  return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/.test(value.trim().toUpperCase());
}

// src-server/core/format.ts
function formatMoney(cents, locale) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const frac = abs % 100;
  if (locale === "fr-CA") {
    const grouped2 = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, "\xA0");
    const s2 = `${grouped2},${frac < 10 ? `0${frac}` : frac}\xA0$`;
    return negative ? `-${s2}` : s2;
  }
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const s = `$${grouped}.${frac < 10 ? `0${frac}` : frac}`;
  return negative ? `-${s}` : s;
}
var NBSP = "\xA0";
function formatRate(rateLabel, locale) {
  if (locale === "fr-CA") {
    return rateLabel.replace("%", `${NBSP}%`).replace(".", ",");
  }
  return rateLabel;
}
function formatTaxCode(code, locale) {
  if (locale === "fr-CA") {
    return code === "GST" ? "TPS" : code === "QST" ? "TVQ" : "TVH";
  }
  return code;
}

// src-server/core/emails.ts
var NBSP2 = "\xA0";
function taxLines(locale, taxes) {
  return taxes.map((tax) => {
    const code = formatTaxCode(tax.code, locale);
    const rate = formatRate(tax.rateLabel, locale);
    const amount = formatMoney(tax.amount.cents, locale);
    return locale === "fr-CA" ? `${code} (${rate})${NBSP2}:${NBSP2}${amount}` : `${code} (${rate}): ${amount}`;
  });
}
function stepupCodeEmail(code, expiresLocalMinute) {
  const clock = expiresLocalMinute.split("T")[1] ?? "00:00";
  const [h, m] = clock.split(":").map((part) => String(Number(part)));
  return {
    subjectEn: `Your Pain de Lune code: ${code}`,
    subjectFr: `Votre code Pain de Lune${NBSP2}:${NBSP2}${code}`,
    linesEn: [
      `Your one-time code is ${code}.`,
      `It works once and expires at ${h}:${m} Toronto time.`,
      `If you didn't ask for it, ignore this email.`
    ],
    linesFr: [
      `Votre code \xE0 usage unique est ${code}.`,
      `Il ne sert qu'une fois et expire \xE0 ${h}${NBSP2}h${NBSP2}${m}, heure de Toronto.`,
      `Si vous ne l'avez pas demand\xE9, ignorez ce courriel.`
    ]
  };
}
function orderConfirmationEmail(input) {
  const barLine = (bar, locale) => {
    const scent = locale === "fr-CA" ? bar.scentFr : bar.scentEn;
    const price = formatMoney(bar.price.cents, locale);
    return locale === "fr-CA" ? `Pain ${bar.bar} \xB7 ${bar.batch} \xB7 ${scent}${NBSP2}:${NBSP2}${price}` : `Bar ${bar.bar} \xB7 ${bar.batch} \xB7 ${scent}: ${price}`;
  };
  return {
    subjectEn: `Order ${input.orderNumber} confirmed`,
    subjectFr: `Commande ${input.orderNumber} confirm\xE9e`,
    linesEn: [
      `Order: ${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "en-CA")),
      `Subtotal: ${formatMoney(input.subtotal.cents, "en-CA")}`,
      `Shipping: ${formatMoney(input.shipping.cents, "en-CA")}`,
      ...taxLines("en-CA", input.taxes),
      `Total: ${formatMoney(input.total.cents, "en-CA")}`,
      `Ships on: ${input.shipOn}`
    ],
    linesFr: [
      `Commande${NBSP2}:${NBSP2}${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "fr-CA")),
      `Sous-total${NBSP2}:${NBSP2}${formatMoney(input.subtotal.cents, "fr-CA")}`,
      `Livraison${NBSP2}:${NBSP2}${formatMoney(input.shipping.cents, "fr-CA")}`,
      ...taxLines("fr-CA", input.taxes),
      `Total${NBSP2}:${NBSP2}${formatMoney(input.total.cents, "fr-CA")}`,
      `Exp\xE9dition le${NBSP2}:${NBSP2}${input.shipOn}`
    ]
  };
}
function subscriptionStartedEmail(input) {
  return {
    subjectEn: `Subscription ${input.number} started`,
    subjectFr: `Abonnement ${input.number} commenc\xE9`,
    linesEn: [
      `Subscription: ${input.number}`,
      `Trio: ${input.scentEn}`,
      `Cadence: ${cadenceLabel(input.cadence, "en-CA")}`,
      `Subtotal: ${formatMoney(input.subtotal.cents, "en-CA")}`,
      `Subscribe-and-save (12%): -${formatMoney(input.discount.cents, "en-CA")}`,
      ...taxLines("en-CA", input.taxes),
      `Total: ${formatMoney(input.total.cents, "en-CA")}`,
      `Charged today: ${formatMoney(input.chargedToday.cents, "en-CA")}`,
      `Next bill date: ${input.nextBillDate}`
    ],
    linesFr: [
      `Abonnement${NBSP2}:${NBSP2}${input.number}`,
      `Trio${NBSP2}:${NBSP2}${input.scentFr}`,
      `Fr\xE9quence${NBSP2}:${NBSP2}${cadenceLabel(input.cadence, "fr-CA")}`,
      `Sous-total${NBSP2}:${NBSP2}${formatMoney(input.subtotal.cents, "fr-CA")}`,
      `Abonnement-\xE9pargne (12${NBSP2}%)${NBSP2}:${NBSP2}-${formatMoney(input.discount.cents, "fr-CA")}`,
      ...taxLines("fr-CA", input.taxes),
      `Total${NBSP2}:${NBSP2}${formatMoney(input.total.cents, "fr-CA")}`,
      `Pr\xE9lev\xE9 aujourd'hui${NBSP2}:${NBSP2}${formatMoney(input.chargedToday.cents, "fr-CA")}`,
      `Prochaine date de facturation${NBSP2}:${NBSP2}${input.nextBillDate}`
    ]
  };
}
function refundEmail(input) {
  const barLine = (bar, locale) => {
    const scent = locale === "fr-CA" ? bar.scentFr : bar.scentEn;
    return locale === "fr-CA" ? `Pain ${bar.bar} \xB7 ${bar.batch} \xB7 ${scent}` : `Bar ${bar.bar} \xB7 ${bar.batch} \xB7 ${scent}`;
  };
  return {
    subjectEn: `Refund ${input.refundNumber} for order ${input.orderNumber}`,
    subjectFr: `Remboursement ${input.refundNumber} pour la commande ${input.orderNumber}`,
    linesEn: [
      `Refund: ${input.refundNumber}`,
      `Order: ${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "en-CA")),
      `Refunded: ${formatMoney(input.amount.cents, "en-CA")}`,
      `It reaches your original payment method within 5 to 10 business days.`
    ],
    linesFr: [
      `Remboursement${NBSP2}:${NBSP2}${input.refundNumber}`,
      `Commande${NBSP2}:${NBSP2}${input.orderNumber}`,
      ...input.bars.map((bar) => barLine(bar, "fr-CA")),
      `Rembours\xE9${NBSP2}:${NBSP2}${formatMoney(input.amount.cents, "fr-CA")}`,
      `Il appara\xEEtra sur votre moyen de paiement d'origine d'ici 5 \xE0 10 jours ouvrables.`
    ]
  };
}
function creditEmail(input) {
  return {
    subjectEn: `Credit ${input.creditNumber} added to your account`,
    subjectFr: `Cr\xE9dit ${input.creditNumber} ajout\xE9 \xE0 votre compte`,
    linesEn: [
      `Credit: ${input.creditNumber}`,
      `Amount: ${formatMoney(input.amount.cents, "en-CA")}`,
      `It applies automatically to your next invoice.`
    ],
    linesFr: [
      `Cr\xE9dit${NBSP2}:${NBSP2}${input.creditNumber}`,
      `Montant${NBSP2}:${NBSP2}${formatMoney(input.amount.cents, "fr-CA")}`,
      `Il s'applique automatiquement \xE0 votre prochaine facture.`
    ]
  };
}
function contactReplyEmail(input) {
  return {
    subjectEn: `We received your message ${input.reference}`,
    subjectFr: `Nous avons bien re\xE7u votre message ${input.reference}`,
    linesEn: [
      `Reference: ${input.reference}`,
      `Topic: ${topicLabel(input.topic, "en-CA")}`,
      `Thanks, ${input.name}. We reply within two business days.`
    ],
    linesFr: [
      `R\xE9f\xE9rence${NBSP2}:${NBSP2}${input.reference}`,
      `Sujet${NBSP2}:${NBSP2}${topicLabel(input.topic, "fr-CA")}`,
      `Merci, ${input.name}. Nous r\xE9pondons dans deux jours ouvrables.`
    ]
  };
}

// src-server/domain/stepup.ts
async function requestCode(pool, env, outbox, locale, email, purpose) {
  const normalized = normalizeEmail(email);
  const fields = {};
  if (!isValidEmail(normalized)) {
    fields.email = fieldMessage("email", locale);
  }
  if (purpose !== "checkout" && purpose !== "sign_in") {
    fields.purpose = fieldMessage("purpose", locale);
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const now = /* @__PURE__ */ new Date();
  const lock = await pool.query("SELECT until FROM stepup_locks WHERE email = $1", [normalized]);
  const lockedOut = lock.rows.length > 0 && lock.rows[0].until > now;
  const windowStart = new Date(now.getTime() - env.stepupRateWindowSeconds * 1e3);
  const counted = await pool.query(
    `SELECT at FROM stepup_requests
     WHERE email = $1 AND at > $2
     ORDER BY at ASC`,
    [normalized, windowStart]
  );
  if (counted.rows.length >= env.stepupRateLimit) {
    const oldest = counted.rows[0].at;
    const retryAfter = Math.max(
      1,
      Math.ceil((oldest.getTime() + env.stepupRateWindowSeconds * 1e3 - now.getTime()) / 1e3)
    );
    throw new ApiError(429, "rate_limited", message("rate_limited", locale), null, {
      "Retry-After": String(retryAfter)
    });
  }
  await pool.query("INSERT INTO stepup_requests (email, at) VALUES ($1, now())", [normalized]);
  const code = String(Math.floor(1e5 + Math.random() * 9e5));
  const counter = await pool.query("UPDATE counters SET value = value + 1 WHERE name = 'sc' RETURNING value");
  const scNumber = `SC-${String(counter.rows[0].value).padStart(6, "0")}`;
  const expiresAt = new Date(now.getTime() + env.stepupCodeTtlSeconds * 1e3);
  await pool.query(
    "INSERT INTO stepup_codes (sc_number, email, code, expires_at) VALUES ($1, $2, $3, $4)",
    [scNumber, normalized, code, expiresAt]
  );
  const content = stepupCodeEmail(code, torontoLocalMinute(expiresAt));
  if (!lockedOut) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await queueNotice(client, {
        key: `code.${scNumber}`,
        kind: "stepup_code",
        to: normalized,
        locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      client.release();
      throw err;
    }
    client.release();
    outbox.kick();
  }
  return { lockedOut };
}
async function verifyCode(pool, env, locale, email, code) {
  const normalized = normalizeEmail(email);
  const fields = {};
  if (!isValidEmail(normalized)) {
    fields.email = fieldMessage("email", locale);
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code) || hasControlChars(code)) {
    fields.code = fieldMessage("code", locale);
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const now = /* @__PURE__ */ new Date();
  const lock = await pool.query("SELECT until FROM stepup_locks WHERE email = $1", [normalized]);
  if (lock.rows.length > 0 && lock.rows[0].until > now) {
    throw new ApiError(429, "stepup_locked", message("stepup_locked", locale));
  }
  const res = await pool.query(
    `SELECT id, email FROM stepup_codes
     WHERE email = $1 AND code = $2 AND expires_at > $3 AND used_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [normalized, code, now]
  );
  if (res.rows.length === 0) {
    await recordFailedAttempt(pool, env, normalized, now);
    throw new ApiError(422, "invalid", null, { code: fieldMessage("code", locale) });
  }
  await pool.query("UPDATE stepup_codes SET used_at = now() WHERE email = $1", [normalized]);
  await pool.query("DELETE FROM stepup_locks WHERE email = $1", [normalized]);
  await pool.query("DELETE FROM stepup_attempts WHERE email = $1", [normalized]);
  const customerId = await ensureCustomer(pool, normalized, locale);
  return { customerId };
}
async function recordFailedAttempt(pool, env, email, now) {
  await pool.query("INSERT INTO stepup_attempts (email, at) VALUES ($1, $2)", [email, now]);
  const count = await pool.query("SELECT count(*)::int AS n FROM stepup_attempts WHERE email = $1", [email]);
  if (count.rows[0].n >= 5) {
    await pool.query(
      `INSERT INTO stepup_locks (email, until) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET until = $2`,
      [email, new Date(now.getTime() + env.stepupLockSeconds * 1e3)]
    );
    await pool.query("DELETE FROM stepup_attempts WHERE email = $1", [email]);
  }
}
async function ensureCustomer(pool, email, locale) {
  const res = await pool.query(
    `INSERT INTO customers (email, locale) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET locale = EXCLUDED.locale
     RETURNING id`,
    [email, locale]
  );
  return res.rows[0].id;
}

// src-server/domain/checkout.ts
import "pg";
init_money();
async function checkout(pool, kb, outbox, locale, cartId, customerId, customerEmail, input) {
  const fields = validateCheckout(locale, input);
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const client = await pool.connect();
  try {
    const holdIds = [...input.holds].sort();
    for (const holdId of holdIds) {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [`hold:${holdId}`]);
    }
    const released = { value: false };
    try {
      const holdRows = await loadHolds(client, input.holds, cartId);
      const now = /* @__PURE__ */ new Date();
      for (const hold of holdRows) {
        if (hold.expires_at <= now) {
          throw new ApiError(410, "hold_expired", message("hold_expired", locale));
        }
      }
      for (const hold of holdRows) {
        if (hold.status !== "active") {
          throw new ApiError(409, "hold_not_active");
        }
      }
      const batchScent = await loadBatchScents(client, holdRows);
      const counter = await client.query("SELECT value FROM counters WHERE name = 'order' FOR UPDATE");
      const orderNumber = `PDL-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
      await client.query("UPDATE counters SET value = value + 1 WHERE name = 'order'");
      await client.query("COMMIT");
      const province = findProvince(input.shipping.province);
      const price = dropPrice(holdRows.length, province.taxes);
      const killbill = await runKillBill(kb, customerEmail, input.shipping.name, locale, holdRows, batchScent, price, orderNumber);
      const placedAt = /* @__PURE__ */ new Date();
      const cutoff = await packingCutoff(client);
      const shipOn = computeShipOn(placedAt, cutoff);
      const taxesJson = price.taxes.map((tax) => ({ code: tax.code, rate: tax.rateLabel, amount_cents: tax.amount.cents }));
      await client.query("BEGIN");
      await client.query(
        "UPDATE customers SET killbill_account_id = $2 WHERE id = $1 AND (killbill_account_id IS NULL OR killbill_account_id <> $2)",
        [customerId, killbill.accountId]
      );
      const orderRes = await client.query(
        `INSERT INTO orders (number, customer_id, status, fulfilment, placed_at, ship_on, locale, email,
          name, line1, city, province, postal_code, subtotal_cents, shipping_cents, taxes, total_cents,
          refunded_cents, version, killbill_invoice_id, killbill_payment_id)
         VALUES ($1, $2, 'paid', 'to_pack', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, 0, 1, $16, $17)
         RETURNING id`,
        [
          orderNumber,
          customerId,
          placedAt,
          shipOn,
          locale,
          customerEmail,
          input.shipping.name,
          input.shipping.line1,
          input.shipping.city,
          input.shipping.province,
          input.shipping.postal_code,
          price.subtotal.cents,
          price.shipping.cents,
          JSON.stringify(taxesJson),
          price.total.cents,
          killbill.invoiceId,
          killbill.paymentId
        ]
      );
      const orderId = orderRes.rows[0].id;
      for (const [index, hold] of holdRows.entries()) {
        await client.query(
          `INSERT INTO order_lines (order_id, batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id)
           VALUES ($1, $2, $3, $4, $5, false, $6)`,
          [orderId, hold.batch_code, batchScent.get(hold.batch_code), hold.bar, BAR_PRICE_CENTS, killbill.itemIds[index] || null]
        );
      }
      for (const hold of holdRows) {
        await client.query("UPDATE holds SET status = 'converted' WHERE id = $1", [hold.id]);
      }
      const byBatch = /* @__PURE__ */ new Map();
      for (const hold of holdRows) {
        const list = byBatch.get(hold.batch_code) ?? [];
        list.push(hold.bar);
        byBatch.set(hold.batch_code, list);
      }
      for (const [batchCode, batchBars] of byBatch) {
        await addMovement(client, batchCode, "sale", batchBars, orderNumber);
        await refreshBatchState(client, batchCode, placedAt);
      }
      const content = orderConfirmationEmail({
        orderNumber,
        bars: holdRows.map((hold) => ({
          bar: hold.bar,
          batch: hold.batch_code,
          scentEn: scentName(batchScent.get(hold.batch_code), "en-CA"),
          scentFr: scentName(batchScent.get(hold.batch_code), "fr-CA"),
          price: money(hold.amount_cents)
        })),
        subtotal: price.subtotal,
        shipping: price.shipping,
        taxes: price.taxes,
        total: price.total,
        shipOn
      });
      await queueNotice(client, {
        key: `order.${orderNumber}`,
        kind: "order_confirmation",
        to: customerEmail,
        locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
      await client.query(
        `UPDATE orders SET kb_shipping_item_id = $2, kb_tax_items = $3::jsonb WHERE id = $1`,
        [orderId, killbill.shippingItemId, JSON.stringify(killbill.taxItems)]
      );
      await client.query("COMMIT");
      outbox.kick();
      const record = {
        number: orderNumber,
        status: "paid",
        fulfilment: "to_pack",
        placed_at: placedAt,
        ship_on: shipOn,
        locale,
        email: customerEmail,
        name: input.shipping.name,
        line1: input.shipping.line1,
        city: input.shipping.city,
        province: input.shipping.province,
        postal_code: input.shipping.postal_code,
        subtotal_cents: price.subtotal.cents,
        shipping_cents: price.shipping.cents,
        taxes: taxesJson,
        total_cents: price.total.cents,
        refunded_cents: 0,
        version: 1,
        lines: holdRows.map((hold, index) => ({
          batch_code: hold.batch_code,
          scent: batchScent.get(hold.batch_code),
          bar: hold.bar,
          unit_cents: BAR_PRICE_CENTS,
          refunded: false,
          kb_invoice_item_id: killbill.itemIds[index] || null
        }))
      };
      released.value = true;
      return { order: record };
    } finally {
      if (!released.value) {
        await client.query("ROLLBACK").catch(() => void 0);
      }
      for (const holdId of holdIds) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`hold:${holdId}`]).catch(() => void 0);
      }
    }
  } finally {
    client.release();
  }
}
function scentName(slug, locale) {
  const scent = DROP_SCENTS.find((candidate) => candidate.slug === slug);
  if (!scent) return slug;
  return locale === "fr-CA" ? scent.fr : scent.en;
}
async function loadHolds(client, holdIds, cartId) {
  const rows = [];
  for (const holdId of holdIds) {
    const res = await client.query("SELECT * FROM holds WHERE id = $1", [holdId]);
    const row = res.rows[0];
    if (!row || row.cart_id !== cartId) {
      throw new ApiError(404, "not_found");
    }
    rows.push(row);
  }
  return rows;
}
async function loadBatchScents(client, holdRows) {
  const map = /* @__PURE__ */ new Map();
  for (const hold of holdRows) {
    if (map.has(hold.batch_code)) continue;
    const res = await client.query("SELECT scent FROM batches WHERE code = $1", [hold.batch_code]);
    const scent = res.rows[0]?.scent;
    if (scent) map.set(hold.batch_code, scent);
  }
  return map;
}
function validateCheckout(locale, input) {
  const fields = {};
  if (!Array.isArray(input.holds) || input.holds.length === 0) {
    fields.holds = fieldMessage("holds", locale);
  }
  const shipping = input.shipping;
  if (!shipping || typeof shipping !== "object") {
    fields["shipping.name"] = fieldMessage("name", locale);
    fields["shipping.line1"] = fieldMessage("line1", locale);
    fields["shipping.city"] = fieldMessage("city", locale);
    fields["shipping.province"] = fieldMessage("province", locale);
    fields["shipping.postal_code"] = fieldMessage("postal_code", locale);
    return fields;
  }
  if (typeof shipping.name !== "string" || shipping.name.trim().length === 0 || hasControlChars(shipping.name)) {
    fields["shipping.name"] = fieldMessage("name", locale);
  }
  if (typeof shipping.line1 !== "string" || shipping.line1.trim().length === 0 || hasControlChars(shipping.line1)) {
    fields["shipping.line1"] = fieldMessage("line1", locale);
  }
  if (typeof shipping.city !== "string" || shipping.city.trim().length === 0 || hasControlChars(shipping.city)) {
    fields["shipping.city"] = fieldMessage("city", locale);
  }
  if (typeof shipping.province !== "string" || !findProvince(shipping.province)) {
    fields["shipping.province"] = fieldMessage("province", locale);
  }
  if (typeof shipping.postal_code !== "string" || !isValidCanadianPostalCode(shipping.postal_code)) {
    fields["shipping.postal_code"] = fieldMessage("postal_code", locale);
  }
  return fields;
}
async function packingCutoff(client) {
  const res = await client.query("SELECT value FROM settings WHERE key = 'packing_cutoff_local'");
  return res.rows[0]?.value ?? "14:00";
}
function computeShipOn(placedAt, cutoffLocal) {
  const parts = torontoParts(placedAt);
  const date = torontoDate(placedAt);
  const weekday = (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();
  const [cutoffH, cutoffM] = cutoffLocal.split(":").map(Number);
  const beforeCutoff = parts.hour * 60 + parts.minute < cutoffH * 60 + cutoffM;
  if (weekday >= 1 && weekday <= 5 && beforeCutoff) {
    return date;
  }
  let candidate = date;
  for (let i = 0; i < 7; i++) {
    candidate = addDays(candidate, 1);
    const candidateWeekday = (/* @__PURE__ */ new Date(`${candidate}T12:00:00Z`)).getUTCDay();
    if (candidateWeekday >= 1 && candidateWeekday <= 5) {
      return candidate;
    }
  }
  return candidate;
}
async function runKillBill(kb, email, name, locale, holdRows, batchScent, price, orderNumber) {
  try {
    let account = await kb.getAccountByKey(email);
    if (!account) {
      account = await kb.createAccount({
        externalKey: email,
        name,
        currency: "CAD",
        timeZone: "America/Toronto",
        locale: locale === "fr-CA" ? "fr_CA" : "en_CA"
      });
      await kb.tagAccountDraft(account.accountId);
    }
    const accountId = account.accountId;
    const chargeItems = holdRows.map((hold) => ({
      itemType: "EXTERNAL_CHARGE",
      description: `Bar ${hold.bar} \xB7 ${hold.batch_code} \xB7 ${scentName(batchScent.get(hold.batch_code) ?? "", "en-CA")}`,
      amount: centsToKb(hold.amount_cents),
      currency: "CAD"
    }));
    if (price.shipping.cents > 0) {
      chargeItems.push({
        itemType: "EXTERNAL_CHARGE",
        description: "Shipping",
        amount: centsToKb(price.shipping.cents),
        currency: "CAD"
      });
    }
    const created = await kb.createExternalCharges(accountId, chargeItems);
    const invoiceId = created[0].invoiceId;
    const itemIds = holdRows.map((hold) => {
      const item = created.find(
        (candidate) => candidate.description === `Bar ${hold.bar} \xB7 ${hold.batch_code} \xB7 ${scentName(batchScent.get(hold.batch_code) ?? "", "en-CA")}`
      );
      return item?.invoiceItemId ?? "";
    });
    const shippingItem = created.find((candidate) => candidate.description === "Shipping");
    const shippingItemId = shippingItem?.invoiceItemId ?? null;
    const taxItemInputs = price.taxes.map((tax) => ({
      itemType: "TAX",
      description: tax.code,
      amount: centsToKb(tax.amount.cents),
      currency: "CAD",
      invoiceId
    }));
    let taxItems = [];
    if (taxItemInputs.length > 0) {
      const createdTaxes = await kb.createTaxItems(account.accountId, taxItemInputs);
      taxItems = price.taxes.map((tax) => ({
        code: tax.code,
        itemId: createdTaxes.find((candidate) => candidate.description === tax.code)?.invoiceItemId ?? ""
      }));
    }
    await kb.commitInvoice(invoiceId);
    const invoice = await kb.getInvoice(invoiceId);
    for (const item of invoice.items ?? []) {
      if (item.itemType === "CBA_ADJ" && item.amount < 0) {
        await kb.deleteCbaItem(invoiceId, item.invoiceItemId, accountId);
      }
    }
    let paymentId = "";
    if (price.total.cents > 0) {
      const payment = await kb.payInvoice(invoiceId, {
        targetInvoiceId: invoiceId,
        accountId,
        purchasedAmount: centsToKb(price.total.cents),
        currency: "CAD",
        paymentExternalKey: orderNumber,
        transactions: [{
          transactionExternalKey: orderNumber,
          transactionType: "PURCHASE",
          amount: centsToKb(price.total.cents),
          currency: "CAD"
        }]
      }, "loafline");
      paymentId = payment.paymentId;
    }
    return { invoiceId, paymentId, itemIds, shippingItemId, taxItems, accountId };
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable_checkout", locale));
    }
    throw err;
  }
}

// src-server/domain/subscriptions.ts
import "pg";
init_money();
function validateShipping(locale, shipping) {
  const fields = {};
  const value = shipping;
  if (!value || typeof value !== "object") {
    fields["shipping.name"] = fieldMessage("name", locale);
    fields["shipping.line1"] = fieldMessage("line1", locale);
    fields["shipping.city"] = fieldMessage("city", locale);
    fields["shipping.province"] = fieldMessage("province", locale);
    fields["shipping.postal_code"] = fieldMessage("postal_code", locale);
    return fields;
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0 || hasControlChars(value.name)) {
    fields["shipping.name"] = fieldMessage("name", locale);
  }
  if (typeof value.line1 !== "string" || value.line1.trim().length === 0 || hasControlChars(value.line1)) {
    fields["shipping.line1"] = fieldMessage("line1", locale);
  }
  if (typeof value.city !== "string" || value.city.trim().length === 0 || hasControlChars(value.city)) {
    fields["shipping.city"] = fieldMessage("city", locale);
  }
  if (typeof value.province !== "string" || !findProvince(value.province)) {
    fields["shipping.province"] = fieldMessage("province", locale);
  }
  if (typeof value.postal_code !== "string" || !isValidCanadianPostalCode(value.postal_code)) {
    fields["shipping.postal_code"] = fieldMessage("postal_code", locale);
  }
  return fields;
}
function planNameFor(cadence) {
  return `trio-${cadence.toLowerCase()}`;
}
async function startSubscription(pool, kb, outbox, locale, customerId, email, input) {
  const fields = {};
  if (!TRIO_SCENTS.some((scent) => scent.slug === input.scent)) {
    fields.scent = fieldMessage("scent", locale);
  }
  const cadence = input.cadence;
  if (typeof cadence !== "string" || !CADENCE_MONTHS[cadence]) {
    fields.cadence = fieldMessage("cadence_missing", locale);
  }
  Object.assign(fields, validateShipping(locale, input.shipping));
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const chosenCadence = cadence;
  const client = await pool.connect();
  try {
    await lockCustomer(client, customerId);
    try {
      const existing = await client.query(
        `SELECT number FROM subscriptions WHERE customer_id = $1 AND state IN ('active', 'paused')`,
        [customerId]
      );
      if (existing.rows.length > 0) {
        throw new ApiError(409, "subscription_exists", message("subscription_exists", locale));
      }
      const counter = await client.query("SELECT value FROM counters WHERE name = 'subscription' FOR UPDATE");
      const number = `SUB-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
      await client.query("UPDATE counters SET value = value + 1 WHERE name = 'subscription'");
      const startedOn = torontoDate(/* @__PURE__ */ new Date());
      const province = findProvince(input.shipping.province);
      const price = trioPrice(province.taxes);
      const killbill = await runStartKillBill(kb, locale, email, input, number, chosenCadence, price);
      await client.query("BEGIN");
      await client.query(
        "UPDATE customers SET killbill_account_id = $2 WHERE id = $1 AND (killbill_account_id IS NULL OR killbill_account_id <> $2)",
        [customerId, killbill.accountId]
      );
      const res = await client.query(
        `INSERT INTO subscriptions (number, customer_id, state, scent, cadence, pending_cadence, anchor_date,
          started_on, next_bill_date, skipped_bill_date, paused_from, name, line1, city, province, postal_code,
          version, killbill_subscription_id)
         VALUES ($1, $2, 'active', $3, $4, NULL, $5, $5, $6, NULL, NULL, $7, $8, $9, $10, $11, 1, $12)
         RETURNING *`,
        [
          number,
          customerId,
          input.scent,
          chosenCadence,
          startedOn,
          addMonths(startedOn, CADENCE_MONTHS[chosenCadence]),
          input.shipping.name,
          input.shipping.line1,
          input.shipping.city,
          input.shipping.province,
          input.shipping.postal_code,
          killbill.subscriptionId
        ]
      );
      const record = toRecord(res.rows[0]);
      const content = subscriptionStartedEmail({
        number,
        scentEn: trioScentName(input.scent, "en-CA"),
        scentFr: trioScentName(input.scent, "fr-CA"),
        cadence: chosenCadence,
        subtotal: price.subtotal,
        discount: price.discount,
        taxes: price.taxes,
        total: price.total,
        chargedToday: money(killbill.chargedToday),
        nextBillDate: record.next_bill_date
      });
      await queueNotice(client, {
        key: `subscription.${number}`,
        kind: "subscription_started",
        to: email,
        locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
      await client.query("COMMIT");
      outbox.kick();
      return { subscription: record, chargedToday: killbill.chargedToday, creditApplied: killbill.creditApplied };
    } finally {
      await unlockCustomer(client, customerId);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw err;
  }
}
function trioScentName(slug, locale) {
  const scent = TRIO_SCENTS.find((candidate) => candidate.slug === slug);
  if (!scent) return slug;
  return locale === "fr-CA" ? scent.fr : scent.en;
}
async function lockCustomer(client, customerId) {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [`customer:${customerId}`]);
}
async function unlockCustomer(client, customerId) {
  await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`customer:${customerId}`]);
}
async function runStartKillBill(kb, locale, email, input, number, cadence, price) {
  try {
    let account = await kb.getAccountByKey(email);
    if (!account) {
      account = await kb.createAccount({
        externalKey: email,
        name: input.shipping.name,
        currency: "CAD",
        timeZone: "America/Toronto",
        locale: locale === "fr-CA" ? "fr_CA" : "en_CA"
      });
      await kb.tagAccountDraft(account.accountId);
    }
    await kb.createSubscription({
      accountId: account.accountId,
      externalKey: number,
      planName: planNameFor(cadence)
    });
    const subscription = await kb.getSubscriptionByKey(number);
    const invoice = await waitForSubscriptionInvoice(kb, account.accountId, subscription.subscriptionId);
    const taxItems = price.taxes.map((tax) => ({
      itemType: "TAX",
      description: tax.code,
      amount: centsToKb(tax.amount.cents),
      currency: "CAD",
      invoiceId: invoice.invoiceId
    }));
    if (taxItems.length > 0) {
      await kb.createTaxItems(account.accountId, taxItems);
    }
    await kb.commitInvoice(invoice.invoiceId);
    const committed = await kb.getInvoice(invoice.invoiceId);
    const balanceCents = Math.round(committed.balance * 100);
    const creditApplied = price.total.cents - balanceCents;
    if (balanceCents > 0) {
      await kb.payInvoice(invoice.invoiceId, {
        targetInvoiceId: invoice.invoiceId,
        accountId: account.accountId,
        purchasedAmount: centsToKb(balanceCents),
        currency: "CAD",
        paymentExternalKey: `${number}-${committed.invoiceDate ?? torontoDate(/* @__PURE__ */ new Date())}`,
        transactions: [{
          transactionExternalKey: `${number}-${committed.invoiceDate ?? torontoDate(/* @__PURE__ */ new Date())}`,
          transactionType: "PURCHASE",
          amount: centsToKb(balanceCents),
          currency: "CAD"
        }]
      }, "loafline");
    }
    return {
      subscriptionId: subscription.subscriptionId,
      chargedToday: balanceCents,
      creditApplied,
      accountId: account.accountId
    };
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable_subscription", locale));
    }
    throw err;
  }
}
async function waitForSubscriptionInvoice(kb, accountId, subscriptionId) {
  for (let i = 0; i < 40; i++) {
    const invoices = await kb.getInvoices(accountId);
    for (const summary of invoices) {
      const invoice = await kb.getInvoice(summary.invoiceId);
      if (invoice.items?.some((item) => item.subscriptionId === subscriptionId)) {
        return { invoiceId: invoice.invoiceId };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new KillBillError(0, "subscription invoice not generated", false);
}
function toRecord(row) {
  return {
    number: row.number,
    killbill_subscription_id: row.killbill_subscription_id ?? "",
    state: row.state,
    scent: row.scent,
    cadence: row.cadence,
    pending_cadence: row.pending_cadence ?? null,
    anchor_date: dateToString(row.anchor_date),
    started_on: dateToString(row.started_on),
    next_bill_date: row.next_bill_date ? dateToString(row.next_bill_date) : null,
    skipped_bill_date: row.skipped_bill_date ? dateToString(row.skipped_bill_date) : null,
    paused_from: row.paused_from ? dateToString(row.paused_from) : null,
    name: row.name,
    line1: row.line1,
    city: row.city,
    province: row.province,
    postal_code: row.postal_code,
    version: row.version
  };
}
async function loadSubscription(client, customerId, number) {
  const res = await client.query("SELECT * FROM subscriptions WHERE number = $1", [number]);
  const row = res.rows[0];
  if (!row || row.customer_id !== customerId) {
    throw new ApiError(404, "not_found");
  }
  return toRecord(row);
}
function lockInstant(date, lockHours) {
  return new Date(torontoMidnight(date).getTime() - lockHours * 36e5);
}
async function changeSubscription(pool, env, kb, locale, customerId, number, change) {
  const client = await pool.connect();
  try {
    await lockCustomer(client, customerId);
    try {
      await client.query("BEGIN");
      const record = await loadSubscription(client, customerId, number);
      const now = /* @__PURE__ */ new Date();
      await applyChange(client, kb, env, locale, record, change, now);
      await client.query("COMMIT");
      const after = await loadSubscription(client, customerId, number);
      return after;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      await unlockCustomer(client, customerId);
    }
  } finally {
    client.release();
  }
}
async function applyChange(client, kb, env, locale, record, change, now) {
  const lock = record.next_bill_date ? lockInstant(record.next_bill_date, env.subscriptionLockHours) : null;
  const locked = lock !== null && now >= lock;
  switch (change.kind) {
    case "skip": {
      if (record.state !== "active") {
        throw transitionError2(locale);
      }
      if (record.skipped_bill_date) {
        throw new ApiError(409, "already_skipped", message("already_skipped", locale));
      }
      if (locked) throw lockedError(record.next_bill_date, locale);
      const skipped = record.next_bill_date;
      const next = nextInSeries(record.anchor_date, skipped, CADENCE_MONTHS[record.cadence]);
      await addBlocking(kb, record, "TRIO_SKIP", true, skipped, locale);
      await addBlocking(kb, record, "TRIO_CLEAR", false, next, locale);
      await updateSubscription(client, record.number, {
        skipped_bill_date: skipped,
        next_bill_date: next
      });
      return;
    }
    case "unskip": {
      if (record.state !== "active") {
        throw transitionError2(locale);
      }
      if (!record.skipped_bill_date) {
        throw new ApiError(409, "not_skipped", message("not_skipped", locale));
      }
      const skippedLock = lockInstant(record.skipped_bill_date, env.subscriptionLockHours);
      if (now >= skippedLock) throw lockedError(record.skipped_bill_date, locale);
      await addBlocking(kb, record, "TRIO_CLEAR", false, record.skipped_bill_date, locale);
      await updateSubscription(client, record.number, {
        skipped_bill_date: null,
        next_bill_date: record.skipped_bill_date
      });
      return;
    }
    case "pause": {
      if (record.state !== "active" || record.skipped_bill_date) {
        throw transitionError2(locale);
      }
      if (locked) throw lockedError(record.next_bill_date, locale);
      await addBlocking(kb, record, "TRIO_PAUSE", true, record.next_bill_date, locale);
      await updateSubscription(client, record.number, {
        state: "paused",
        paused_from: record.next_bill_date,
        next_bill_date: null
      });
      return;
    }
    case "resume": {
      if (record.state !== "paused") {
        throw transitionError2(locale);
      }
      const pausedFrom = record.paused_from;
      const today = torontoDate(now);
      await addBlockingAt(kb, record, "TRIO_CLEAR", false, maxInstant(pausedFrom, now), locale);
      if (dateOnOrAfter(today, pausedFrom)) {
        await chargeResume(kb, record, today, locale);
        await updateSubscription(client, record.number, {
          state: "active",
          paused_from: null,
          anchor_date: today,
          next_bill_date: addMonths(today, CADENCE_MONTHS[record.cadence])
        });
      } else {
        await updateSubscription(client, record.number, {
          state: "active",
          paused_from: null,
          next_bill_date: pausedFrom
        });
      }
      return;
    }
    case "cancel": {
      if (record.state !== "active") {
        throw transitionError2(locale);
      }
      if (locked) throw lockedError(record.next_bill_date, locale);
      try {
        await kb.cancelSubscription(record.killbill_subscription_id, torontoMidnight(record.next_bill_date).toISOString());
      } catch (err) {
        throw kbUnavailable(err, locale);
      }
      await updateSubscription(client, record.number, {
        state: "cancelled",
        next_bill_date: null,
        skipped_bill_date: null
      });
      return;
    }
  }
}
function dateOnOrAfter(a, b) {
  return a >= b;
}
function maxInstant(date, now) {
  const midnight = torontoMidnight(date);
  return midnight > now ? midnight : now;
}
async function addBlocking(kb, record, stateName, blockBilling, date, locale) {
  const instant = torontoMidnight(date).toISOString();
  try {
    await kb.addSubscriptionBlockingState(
      record.killbill_subscription_id,
      {
        blockedId: record.killbill_subscription_id,
        stateName,
        service: "loafline",
        isBlockBilling: blockBilling,
        isBlockChange: false,
        isBlockEntitlement: false,
        effectiveDate: instant,
        type: "SUBSCRIPTION"
      },
      instant
    );
  } catch (err) {
    throw kbUnavailable(err, locale);
  }
}
async function addBlockingAt(kb, record, stateName, blockBilling, instant, locale) {
  try {
    await kb.addSubscriptionBlockingState(
      record.killbill_subscription_id,
      {
        blockedId: record.killbill_subscription_id,
        stateName,
        service: "loafline",
        isBlockBilling: blockBilling,
        isBlockChange: false,
        isBlockEntitlement: false,
        effectiveDate: instant.toISOString(),
        type: "SUBSCRIPTION"
      },
      instant.toISOString()
    );
  } catch (err) {
    throw kbUnavailable(err, locale);
  }
}
async function chargeResume(kb, record, today, locale) {
  try {
    const accountId = await accountForSubscription(kb, record);
    const province = findProvince(record.province);
    const price = trioPrice(province.taxes);
    const created = await kb.createExternalCharges(accountId, [{
      itemType: "EXTERNAL_CHARGE",
      description: "Trio",
      amount: centsToKb(price.preTax.cents),
      currency: "CAD"
    }]);
    const invoiceId = created[0].invoiceId;
    const taxItems = price.taxes.map((tax) => ({
      itemType: "TAX",
      description: tax.code,
      amount: centsToKb(tax.amount.cents),
      currency: "CAD",
      invoiceId
    }));
    if (taxItems.length > 0) {
      await kb.createTaxItems(accountId, taxItems);
    }
    await kb.commitInvoice(invoiceId);
    const invoice = await kb.getInvoice(invoiceId);
    const balanceCents = Math.round(invoice.balance * 100);
    if (balanceCents > 0) {
      await kb.payInvoice(invoiceId, {
        targetInvoiceId: invoiceId,
        accountId,
        purchasedAmount: centsToKb(balanceCents),
        currency: "CAD",
        paymentExternalKey: `${record.number}-${today}`,
        transactions: [{
          transactionExternalKey: `${record.number}-${today}`,
          transactionType: "PURCHASE",
          amount: centsToKb(balanceCents),
          currency: "CAD"
        }]
      }, "loafline");
    }
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable_subscription", locale));
    }
    throw err;
  }
}
async function accountForSubscription(kb, record) {
  const subscription = await kb.getSubscriptionByKey(record.number);
  return subscription.accountId;
}
async function updateSubscription(client, number, patch) {
  const keys = Object.keys(patch);
  const sets = keys.map((key, index) => `${toSnake(key)} = $${index + 2}`);
  await client.query(
    `UPDATE subscriptions SET ${sets.join(", ")}, version = version + 1 WHERE number = $1`,
    [number, ...keys.map((key) => patch[key])]
  );
}
function toSnake(key) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
function transitionError2(locale) {
  return new ApiError(409, "invalid_transition", message("invalid_transition", locale));
}
function lockedError(date, locale) {
  return new ApiError(409, "cycle_locked", message("cycle_locked", locale, { date }));
}
function kbUnavailable(err, locale) {
  if (err instanceof ApiError) return err;
  if (err instanceof KillBillError) {
    return new ApiError(503, "billing_unavailable", message("billing_unavailable_subscription", locale));
  }
  throw err;
}
async function patchSubscription(pool, env, kb, locale, customerId, number, patch) {
  const fields = {};
  if (patch.scent !== void 0 && !TRIO_SCENTS.some((scent) => scent.slug === patch.scent)) {
    fields.scent = fieldMessage("scent", locale);
  }
  if (patch.cadence !== void 0 && !CADENCE_MONTHS[patch.cadence]) {
    fields.cadence = fieldMessage("cadence_missing", locale);
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const client = await pool.connect();
  try {
    await lockCustomer(client, customerId);
    try {
      await client.query("BEGIN");
      const record = await loadSubscription(client, customerId, number);
      const now = /* @__PURE__ */ new Date();
      const lock = record.next_bill_date ? lockInstant(record.next_bill_date, env.subscriptionLockHours) : null;
      const locked = lock !== null && now >= lock;
      if (record.state !== "active") {
        throw transitionError2(locale);
      }
      if (locked) throw lockedError(record.next_bill_date, locale);
      const fields2 = {};
      if (patch.scent !== void 0 && !TRIO_SCENTS.some((scent) => scent.slug === patch.scent)) {
        fields2.scent = fieldMessage("scent", locale);
      }
      if (patch.cadence !== void 0 && !CADENCE_MONTHS[patch.cadence]) {
        fields2.cadence = fieldMessage("cadence_missing", locale);
      }
      if (Object.keys(fields2).length > 0) {
        throw new ApiError(422, "invalid", null, fields2);
      }
      if (patch.cadence !== void 0 && patch.cadence === record.cadence) {
        throw new ApiError(422, "invalid", null, { cadence: fieldMessage("cadence_same", locale) });
      }
      if (patch.cadence !== void 0) {
        try {
          if (record.pending_cadence) {
            await kb.undoChangePlan(record.killbill_subscription_id);
          }
          await kb.changePlan(record.killbill_subscription_id, planNameFor(patch.cadence), torontoMidnight(record.next_bill_date).toISOString());
        } catch (err) {
          throw kbUnavailable(err, locale);
        }
      }
      const patchFields = {};
      if (patch.scent !== void 0) patchFields.scent = patch.scent;
      if (patch.cadence !== void 0) patchFields.pending_cadence = patch.cadence;
      if (Object.keys(patchFields).length > 0) {
        await updateSubscription(client, record.number, patchFields);
      }
      await client.query("COMMIT");
      return await loadSubscription(client, customerId, number);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      await unlockCustomer(client, customerId);
    }
  } finally {
    client.release();
  }
}

// src-server/domain/refunds.ts
import "pg";
init_money();

// src-server/domain/audit.ts
init_money();
async function writeAudit(client, actor, action, target, reason, amountCents, killbillRef, outcome) {
  const res = await client.query(
    `INSERT INTO audit_entries (actor, role, action, target, reason, amount, killbill_ref, outcome)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
    [actor.email, actor.role, action, target, reason, JSON.stringify(money(amountCents)), killbillRef, outcome]
  );
  return res.rows[0].id;
}

// src-server/domain/refunds.ts
function orderFromRow(row, lines) {
  return {
    number: row.number,
    status: row.status,
    fulfilment: row.fulfilment,
    placed_at: row.placed_at,
    ship_on: dateToString(row.ship_on),
    locale: row.locale,
    email: row.email,
    name: row.name,
    line1: row.line1,
    city: row.city,
    province: row.province,
    postal_code: row.postal_code,
    subtotal_cents: row.subtotal_cents,
    shipping_cents: row.shipping_cents,
    taxes: row.taxes,
    total_cents: row.total_cents,
    refunded_cents: row.refunded_cents,
    version: row.version,
    lines
  };
}
async function loadOrderForStaff(client, number, lock) {
  const res = await client.query(
    lock ? "SELECT * FROM orders WHERE number = $1 FOR UPDATE" : "SELECT * FROM orders WHERE number = $1",
    [number]
  );
  const row = res.rows[0];
  if (!row) throw new ApiError(404, "not_found");
  const lines = await client.query(
    "SELECT batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id FROM order_lines WHERE order_id = $1 ORDER BY batch_code, bar",
    [row.id]
  );
  return { row, order: orderFromRow(row, lines.rows), id: row.id };
}
function allocateRefund(order, bars, issued) {
  const barCents = bars.length * BAR_PRICE_CENTS;
  const orderTaxes = taxLinesFromJson(order.taxes);
  const refundedBars = new Set(
    order.lines.filter((line) => line.refunded).map((line) => `${line.batch_code}:${line.bar}`)
  );
  for (const bar of bars) refundedBars.add(`${bar.batch}:${bar.bar}`);
  const final = order.lines.every((line) => refundedBars.has(`${line.batch_code}:${line.bar}`));
  let shippingCents = 0;
  const taxes = [];
  for (const tax of orderTaxes) {
    if (final) {
      const earlier = issued.reduce((sum, refund) => {
        const entry = refund.allocation.taxes.find((candidate) => candidate.code === tax.code);
        return sum + (entry?.amount_cents ?? 0);
      }, 0);
      taxes.push({ code: tax.code, rate: tax.rateLabel, amount_cents: tax.amount.cents - earlier });
    } else {
      taxes.push({ code: tax.code, rate: tax.rateLabel, amount_cents: applyRate(barCents, tax.rateHundredThousandths) });
    }
  }
  if (final) shippingCents = order.shipping_cents;
  const amountCents = barCents + shippingCents + taxes.reduce((sum, tax) => sum + tax.amount_cents, 0);
  return { barsCents: barCents, shippingCents, taxes, amountCents, final };
}
function refundFromRow(row, orderNumber) {
  return {
    number: row.number,
    order_number: orderNumber,
    status: row.status,
    bars: row.bars,
    restock: row.restock,
    amount_cents: row.amount_cents,
    allocation: row.allocation,
    reason: row.reason,
    killbill_ref: row.killbill_ref ?? null,
    created_at: row.created_at
  };
}
async function issuedRefunds(client, orderId) {
  const res = await client.query(
    "SELECT * FROM refunds WHERE order_id = $1 AND status = 'issued' ORDER BY id",
    [orderId]
  );
  const orderNumber = (await client.query("SELECT number FROM orders WHERE id = $1", [orderId])).rows[0].number;
  return res.rows.map((row) => refundFromRow(row, orderNumber));
}
function validateRefund(locale, order, input) {
  const fields = {};
  if (!Array.isArray(input.bars) || input.bars.length === 0) {
    fields.bars = fieldMessage("bars_refund", locale);
  } else {
    const inOrder = input.bars.filter(
      (bar) => order.lines.some((line) => line.batch_code === bar.batch && line.bar === bar.bar)
    );
    if (inOrder.length !== input.bars.length) {
      fields.bars = fieldMessage("bars_refund", locale);
    }
  }
  if (typeof input.restock !== "boolean") {
    fields.restock = fieldMessage("cant_set", locale);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500 || hasControlChars(input.reason)) {
    fields.reason = fieldMessage("reason", locale);
  }
  return fields;
}
async function issueRefund(pool, kb, outbox, locale, actor, orderNumber, ifMatchVersion, input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const loaded = await loadOrderForStaff(client, orderNumber, true);
    const order = loaded.order;
    if (ifMatchVersion === null) {
      throw new ApiError(428, "precondition_required");
    }
    if (order.version !== ifMatchVersion) {
      throw new ApiError(412, "stale_version", message("stale_version", locale));
    }
    const already = input.bars.filter(
      (bar) => order.lines.some((line) => line.batch_code === bar.batch && line.bar === bar.bar && line.refunded)
    );
    if (already.length > 0) {
      throw new ApiError(409, "already_refunded");
    }
    const fields = validateRefund(locale, order, input);
    if (Object.keys(fields).length > 0) {
      throw new ApiError(422, "invalid", null, fields);
    }
    if (input.restock) {
      for (const batch of new Set(input.bars.map((bar) => bar.batch))) {
        const state = await client.query("SELECT state FROM batches WHERE code = $1", [batch]);
        if (state.rows[0]?.state === "withdrawn") {
          throw new ApiError(422, "invalid", null, { restock: fieldMessage("restock", locale) });
        }
      }
    }
    const issued = await issuedRefunds(client, loaded.id);
    const allocation = allocateRefund(order, input.bars, issued);
    const counter = await client.query("SELECT value FROM counters WHERE name = 'refund' FOR UPDATE");
    const refundNumber = `RF-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
    await client.query("UPDATE counters SET value = value + 1 WHERE name = 'refund'");
    const insert = await client.query(
      `INSERT INTO refunds (number, order_id, status, bars, restock, amount_cents, allocation, reason)
       VALUES ($1, $2, 'requested', $3::jsonb, $4, 0, $5::jsonb, $6)
       RETURNING id, created_at`,
      [
        refundNumber,
        loaded.id,
        JSON.stringify(input.bars),
        input.restock,
        JSON.stringify({ bars_cents: 0, shipping_cents: 0, taxes: [] }),
        input.reason
      ]
    );
    const refundId = insert.rows[0].id;
    const createdAt = insert.rows[0].created_at;
    await client.query("UPDATE orders SET version = version + 1 WHERE number = $1", [orderNumber]);
    let outcome;
    let killbillRef = null;
    try {
      let paymentId = loaded.row.killbill_payment_id;
      if (!paymentId) {
        const invoiceId = loaded.row.killbill_invoice_id;
        const payments = await kb.getInvoicePayments(invoiceId);
        paymentId = payments.find((candidate) => candidate.paymentExternalKey === orderNumber)?.paymentId ?? null;
      }
      if (!paymentId) throw new KillBillError(404, "payment missing", false);
      const taxItems = loaded.row.kb_tax_items ?? [];
      const shippingItemId = loaded.row.kb_shipping_item_id;
      const adjustments = [];
      for (const bar of input.bars) {
        const line = order.lines.find((candidate) => candidate.batch_code === bar.batch && candidate.bar === bar.bar);
        if (line?.kb_invoice_item_id) {
          adjustments.push({ invoiceItemId: line.kb_invoice_item_id, amount: centsToKb(BAR_PRICE_CENTS) });
        }
      }
      if (allocation.final && shippingItemId && allocation.shippingCents > 0) {
        adjustments.push({ invoiceItemId: shippingItemId, amount: centsToKb(allocation.shippingCents) });
      }
      for (const tax of allocation.taxes) {
        const item = taxItems.find((candidate) => candidate.code === tax.code);
        if (item && tax.amount_cents > 0) {
          adjustments.push({ invoiceItemId: item.itemId, amount: centsToKb(tax.amount_cents) });
        }
      }
      await kb.refundInvoicePayment(paymentId, {
        paymentId,
        amount: centsToKb(allocation.amountCents),
        currency: "CAD",
        isAdjusted: true,
        adjustments,
        transactionExternalKey: refundNumber
      }, actor.email);
      const paymentAfter = await kb.getPayment(paymentId);
      const refundTx = paymentAfter.transactions.find((tx) => tx.transactionExternalKey === refundNumber);
      killbillRef = refundTx?.transactionId ?? null;
      outcome = "issued";
    } catch (err) {
      if (!(err instanceof KillBillError)) throw err;
      outcome = "failed";
    }
    if (outcome === "issued") {
      await client.query(
        "UPDATE refunds SET status = 'issued', amount_cents = $2, killbill_ref = $3, allocation = $4::jsonb WHERE id = $1",
        [
          refundId,
          allocation.amountCents,
          killbillRef,
          JSON.stringify({
            bars_cents: allocation.barsCents,
            shipping_cents: allocation.shippingCents,
            taxes: allocation.taxes
          })
        ]
      );
      for (const bar of input.bars) {
        await client.query(
          `UPDATE order_lines SET refunded = true
           WHERE order_id = $1 AND batch_code = $2 AND bar = $3`,
          [loaded.id, bar.batch, bar.bar]
        );
      }
      await client.query(
        "UPDATE orders SET refunded_cents = refunded_cents + $2, status = $3 WHERE number = $1",
        [orderNumber, allocation.amountCents, allocation.final ? "refunded" : "partially_refunded"]
      );
      if (input.restock) {
        const byBatch = /* @__PURE__ */ new Map();
        for (const bar of input.bars) {
          const list = byBatch.get(bar.batch) ?? [];
          list.push(bar.bar);
          byBatch.set(bar.batch, list);
        }
        for (const [batchCode, bars] of byBatch) {
          await client.query(
            "INSERT INTO stock_movements (batch_code, kind, bars, ref) VALUES ($1, 'restock', $2, $3)",
            [batchCode, bars, refundNumber]
          );
          await client.query(
            "UPDATE batches SET state = 'live' WHERE code = $1 AND state = 'sold_out'",
            [batchCode]
          );
        }
      }
      const content = refundEmail({
        refundNumber,
        orderNumber,
        bars: input.bars.map((bar) => {
          const slug = order.lines.find((line) => line.batch_code === bar.batch && line.bar === bar.bar)?.scent ?? "";
          const scent = DROP_SCENTS.find((candidate) => candidate.slug === slug);
          return {
            bar: bar.bar,
            batch: bar.batch,
            scentEn: scent ? scent.en : slug,
            scentFr: scent ? scent.fr : slug
          };
        }),
        amount: money(allocation.amountCents)
      });
      await queueNotice(client, {
        key: `refund.${refundNumber}`,
        kind: "refund",
        to: order.email,
        locale: order.locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
    } else {
      await client.query("UPDATE refunds SET status = 'failed', killbill_ref = NULL WHERE id = $1", [refundId]);
    }
    await writeAudit(
      client,
      actor,
      "refund",
      orderNumber,
      input.reason,
      outcome === "issued" ? allocation.amountCents : 0,
      killbillRef,
      outcome
    );
    await client.query("COMMIT");
    outbox.kick();
    if (outcome === "failed") {
      throw new ApiError(503, "billing_unavailable", refundFailedCopy(locale, refundNumber));
    }
    const after = await loadOrderForStaff(client, orderNumber, false);
    const refundRow = {
      number: refundNumber,
      order_number: orderNumber,
      status: outcome,
      bars: input.bars,
      restock: input.restock,
      amount_cents: outcome === "issued" ? allocation.amountCents : 0,
      allocation: outcome === "issued" ? { bars_cents: allocation.barsCents, shipping_cents: allocation.shippingCents, taxes: allocation.taxes } : { bars_cents: 0, shipping_cents: 0, taxes: [] },
      reason: input.reason,
      killbill_ref: killbillRef,
      created_at: createdAt
    };
    return { refund: refundRow, order: after.order };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw err;
  }
}
function refundFailedCopy(locale, refundNumber) {
  return locale === "fr-CA" ? `Kill Bill est injoignable. Le remboursement ${refundNumber} est consign\xE9 comme \xE9chou\xE9; rien n'a \xE9t\xE9 rembours\xE9.` : `Kill Bill is unreachable. Refund ${refundNumber} is recorded as failed; nothing was paid back.`;
}

// src-server/domain/credits.ts
import "pg";
init_money();
async function loadTargetForCredit(client, target) {
  const order = await client.query("SELECT * FROM orders WHERE number = $1 FOR UPDATE", [target]);
  if (order.rows[0]) {
    const lines = await client.query(
      "SELECT batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id FROM order_lines WHERE order_id = $1 ORDER BY batch_code, bar",
      [order.rows[0].id]
    );
    const record = orderFromRow(order.rows[0], lines.rows);
    const customer = await client.query("SELECT id, email, locale FROM customers WHERE id = $1", [order.rows[0].customer_id]);
    return { kind: "order", customerId: customer.rows[0].id, email: customer.rows[0].email, locale: customer.rows[0].locale, version: record.version };
  }
  const subscription = await client.query("SELECT * FROM subscriptions WHERE number = $1 FOR UPDATE", [target]);
  if (subscription.rows[0]) {
    const customer = await client.query("SELECT id, email, locale FROM customers WHERE id = $1", [subscription.rows[0].customer_id]);
    return {
      kind: "subscription",
      customerId: customer.rows[0].id,
      email: customer.rows[0].email,
      locale: customer.rows[0].locale,
      version: subscription.rows[0].version
    };
  }
  throw new ApiError(404, "not_found");
}
async function addCredit(pool, kb, outbox, locale, actor, ifMatchVersion, input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const targetInfo = await loadTargetForCredit(client, input.target);
    if (ifMatchVersion === null) {
      throw new ApiError(428, "precondition_required");
    }
    if (targetInfo.version !== ifMatchVersion) {
      throw new ApiError(412, "stale_version", message("stale_version", locale));
    }
    const fields = validateCredit(locale, input);
    if (Object.keys(fields).length > 0) {
      throw new ApiError(422, "invalid", null, fields);
    }
    const counter = await client.query("SELECT value FROM counters WHERE name = 'credit' FOR UPDATE");
    const creditNumber = `CR-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
    await client.query("UPDATE counters SET value = value + 1 WHERE name = 'credit'");
    const insert = await client.query(
      `INSERT INTO credits (number, target, customer_id, status, amount_cents, reason)
       VALUES ($1, $2, $3, 'requested', $4, $5) RETURNING id, created_at`,
      [creditNumber, input.target, targetInfo.customerId, input.amountCents, input.reason]
    );
    const creditId = insert.rows[0].id;
    const createdAt = insert.rows[0].created_at;
    if (targetInfo.kind === "order") {
      await client.query("UPDATE orders SET version = version + 1 WHERE number = $1", [input.target]);
    } else {
      await client.query("UPDATE subscriptions SET version = version + 1 WHERE number = $1", [input.target]);
    }
    let outcome;
    let killbillRef = null;
    try {
      const account = await kb.getAccountByKey(targetInfo.email);
      if (!account) throw new KillBillError(404, "account missing", false);
      const created = await kb.createCredit({
        accountId: account.accountId,
        amount: centsToKb(input.amountCents),
        currency: "CAD",
        description: `Goodwill ${creditNumber}`,
        itemType: "CREDIT_ADJ"
      }, actor.email);
      killbillRef = created[0]?.invoiceId ?? null;
      outcome = "issued";
    } catch (err) {
      if (!(err instanceof KillBillError)) throw err;
      outcome = "failed";
    }
    if (outcome === "issued") {
      await client.query("UPDATE credits SET status = 'issued', killbill_ref = $2 WHERE id = $1", [creditId, killbillRef]);
      const content = creditEmail({ creditNumber, amount: money(input.amountCents) });
      await queueNotice(client, {
        key: `credit.${creditNumber}`,
        kind: "credit",
        to: targetInfo.email,
        locale: targetInfo.locale,
        subjectEn: content.subjectEn,
        subjectFr: content.subjectFr,
        linesEn: content.linesEn,
        linesFr: content.linesFr
      });
    } else {
      await client.query("UPDATE credits SET status = 'failed' WHERE id = $1", [creditId]);
    }
    await writeAudit(
      client,
      actor,
      "credit",
      input.target,
      input.reason,
      input.amountCents,
      killbillRef,
      outcome
    );
    await client.query("COMMIT");
    outbox.kick();
    if (outcome === "failed") {
      throw new ApiError(503, "billing_unavailable", creditFailedCopy(locale, creditNumber));
    }
    const record = {
      number: creditNumber,
      target: input.target,
      status: outcome,
      amount_cents: input.amountCents,
      reason: input.reason,
      killbill_ref: killbillRef,
      created_at: createdAt
    };
    return record;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw err;
  }
}
function validateCredit(locale, input) {
  const fields = {};
  if (typeof input.amountCents !== "number" || !Number.isInteger(input.amountCents) || input.amountCents < 100 || input.amountCents > 2500) {
    fields.amount_cents = fieldMessage("amount_cents", locale);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500 || hasControlChars(input.reason)) {
    fields.reason = fieldMessage("reason", locale);
  }
  return fields;
}
function creditFailedCopy(locale, creditNumber) {
  return locale === "fr-CA" ? `Kill Bill est injoignable. Le cr\xE9dit ${creditNumber} est consign\xE9 comme \xE9chou\xE9; rien n'a \xE9t\xE9 ajout\xE9.` : `Kill Bill is unreachable. Credit ${creditNumber} is recorded as failed; nothing was added.`;
}

// src-server/domain/packing.ts
import "pg";
async function packingList(client) {
  const cutoffRes = await client.query("SELECT value FROM settings WHERE key = 'packing_cutoff_local'");
  const cutoffLocal = cutoffRes.rows[0]?.value ?? "14:00";
  const date = torontoDate(/* @__PURE__ */ new Date());
  const res = await client.query(
    `SELECT o.number, o.ship_on, o.name, o.line1, o.city, o.province, o.postal_code, o.fulfilment, o.version
     FROM orders o
     WHERE o.fulfilment = 'to_pack' AND o.status <> 'refunded' AND o.ship_on <= $1
     ORDER BY o.ship_on, o.number`,
    [date]
  );
  const orders = [];
  for (const row of res.rows) {
    const bars = await client.query(
      `SELECT batch_code, scent, bar FROM order_lines
       WHERE order_id = (SELECT id FROM orders WHERE number = $1) AND refunded = false
       ORDER BY batch_code, bar`,
      [row.number]
    );
    orders.push({
      number: row.number,
      ship_on: dateToString(row.ship_on),
      name: row.name,
      line1: row.line1,
      city: row.city,
      province: row.province,
      postal_code: row.postal_code,
      bars: bars.rows.map((bar) => ({ batch: bar.batch_code, scent: bar.scent, bar: bar.bar })),
      fulfilment: row.fulfilment,
      version: row.version
    });
  }
  return { date, cutoffLocal, orders };
}
function packingView(row) {
  return {
    number: row.number,
    ship_on: row.ship_on,
    name: row.name,
    address: { line1: row.line1, city: row.city, province: row.province, postal_code: row.postal_code },
    bars: row.bars,
    fulfilment: row.fulfilment,
    version: row.version
  };
}
async function shipOrder(pool, locale, orderNumber) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query("SELECT * FROM orders WHERE number = $1 FOR UPDATE", [orderNumber]);
    const row = res.rows[0];
    if (!row) {
      throw new ApiError(404, "not_found");
    }
    if (row.status === "refunded") {
      throw new ApiError(409, "order_refunded", message("order_refunded", locale, { order: orderNumber }));
    }
    if (row.fulfilment === "shipped") {
      throw new ApiError(409, "already_shipped", message("already_shipped", locale, { order: orderNumber }));
    }
    await client.query(
      "UPDATE orders SET fulfilment = 'shipped', version = version + 1 WHERE number = $1",
      [orderNumber]
    );
    await client.query("COMMIT");
    const bars = await client.query(
      `SELECT batch_code, scent, bar FROM order_lines
       WHERE order_id = (SELECT id FROM orders WHERE number = $1) AND refunded = false
       ORDER BY batch_code, bar`,
      [orderNumber]
    );
    return {
      number: row.number,
      ship_on: dateToString(row.ship_on),
      name: row.name,
      line1: row.line1,
      city: row.city,
      province: row.province,
      postal_code: row.postal_code,
      bars: bars.rows.map((bar) => ({ batch: bar.batch_code, scent: bar.scent, bar: bar.bar })),
      fulfilment: "shipped",
      version: row.version + 1
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw err;
  }
}

// src-server/domain/contact.ts
import "pg";
async function submitContact(pool, outbox, locale, input) {
  const fields = {};
  if (typeof input.name !== "string" || input.name.trim().length < 1 || input.name.length > 120 || hasControlChars(input.name)) {
    fields.name = fieldMessage("name", locale);
  }
  if (typeof input.email !== "string" || !isValidEmail(input.email)) {
    fields.email = fieldMessage("email", locale);
  }
  const topics = ["order", "subscription", "wholesale", "other"];
  if (typeof input.topic !== "string" || !topics.includes(input.topic)) {
    fields.topic = fieldMessage("topic", locale);
  }
  if (typeof input.message !== "string" || input.message.trim().length < 10 || input.message.length > 2e3 || hasDisallowedControlChars(input.message)) {
    fields.message = fieldMessage("message", locale);
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const email = normalizeEmail(input.email);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const counter = await client.query("SELECT value FROM counters WHERE name = 'contact' FOR UPDATE");
    const reference = `CT-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
    await client.query("UPDATE counters SET value = value + 1 WHERE name = 'contact'");
    await client.query(
      "INSERT INTO contacts (number, name, email, topic, message) VALUES ($1, $2, $3, $4, $5)",
      [reference, input.name, email, input.topic, input.message]
    );
    const content = contactReplyEmail({ reference, topic: input.topic, name: input.name });
    await queueNotice(client, {
      key: `contact.${reference}`,
      kind: "contact_reply",
      to: email,
      locale,
      subjectEn: content.subjectEn,
      subjectFr: content.subjectFr,
      linesEn: content.linesEn,
      linesFr: content.linesFr
    });
    await client.query("COMMIT");
    outbox.kick();
    return { reference };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw err;
  }
}

// src-server/domain/reconciliation.ts
import "pg";
init_money();
function monthIsValid(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}
async function reconciliation(pool, kb, locale, monthInput) {
  const month = monthInput ?? torontoMonth(/* @__PURE__ */ new Date());
  if (!monthIsValid(month)) {
    throw new ApiError(422, "invalid", null, { month: fieldMessage("month", locale) });
  }
  try {
    const lines = await buildLines(pool, kb, month);
    const totals = sumLines(lines);
    await saveSnapshot(pool, month, lines, totals);
    return { month, stale: false, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), lines, totals };
  } catch (err) {
    if (err instanceof KillBillError) {
      const snapshot = await lastSnapshot(pool, month);
      return {
        month,
        stale: true,
        checkedAt: snapshot ? snapshot.checked_at.toISOString() : null,
        lines: snapshot ? snapshot.lines : [],
        totals: snapshot ? { shopCents: snapshot.totals.shop.cents, killbillCents: snapshot.totals.killbill.cents } : { shopCents: 0, killbillCents: 0 }
      };
    }
    throw err;
  }
}
function sumLines(lines) {
  let shop = 0;
  let killbill = 0;
  for (const line of lines) {
    if (line.shopCents !== null) shop += line.shopCents;
    if (line.killbillCents !== null) killbill += line.killbillCents;
  }
  return { shopCents: shop, killbillCents: killbill };
}
function sortLines(lines) {
  return lines.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
async function buildLines(pool, kb, month) {
  const client = await pool.connect();
  try {
    const start = torontoMonthStart(month);
    const end = torontoMonthStart(nextMonth(month));
    const lines = [];
    const orders = await client.query(
      `SELECT o.number, o.total_cents, o.placed_at, c.killbill_account_id
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.placed_at >= $1 AND o.placed_at < $2`,
      [start, end]
    );
    const refundedByOrder = /* @__PURE__ */ new Map();
    const refundRows = await client.query(
      `SELECT r.number AS refund_number, o.number AS order_number, r.amount_cents
       FROM refunds r JOIN orders o ON o.id = r.order_id
       WHERE r.status = 'issued' AND r.created_at >= $1 AND r.created_at < $2`,
      [start, end]
    );
    for (const row of refundRows.rows) {
      refundedByOrder.set(row.order_number, (refundedByOrder.get(row.order_number) ?? 0) + row.amount_cents);
    }
    const acceptedKeys = await acceptedLineKeys(client, month);
    for (const order of orders.rows) {
      const refunded = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS total FROM refunds
         WHERE order_id = (SELECT id FROM orders WHERE number = $1) AND status = 'issued'`,
        [order.number]
      );
      const shop = order.total_cents - refunded.rows[0].total;
      const paymentNet = await killbillPaymentNet(kb, order.killbill_account_id, order.number);
      lines.push(makeLine(`order:${order.number}`, "order", shop, paymentNet, acceptedKeys));
    }
    const subscriptions = await client.query(
      `SELECT s.number, s.province, s.killbill_subscription_id, c.killbill_account_id
       FROM subscriptions s JOIN customers c ON c.id = s.customer_id`
    );
    for (const subscription of subscriptions.rows) {
      const invoices = await subscriptionInvoicesForMonth(
        kb,
        subscription.killbill_account_id,
        subscription.killbill_subscription_id,
        month
      );
      for (const invoice of invoices) {
        const amountBeforeCredit = invoice.items?.filter((item) => item.itemType !== "CBA_ADJ").reduce((sum, item) => sum + Math.round(item.amount * 100), 0) ?? 0;
        const shop = trioTotalForProvince(subscription.province);
        lines.push(makeLine(`subscription:${subscription.number}:${invoice.invoiceDate ?? ""}`, "subscription", shop, amountBeforeCredit, acceptedKeys));
      }
    }
    const credits = await client.query(
      `SELECT number, amount_cents, killbill_ref FROM credits
       WHERE status = 'issued' AND created_at >= $1 AND created_at < $2`,
      [start, end]
    );
    for (const credit of credits.rows) {
      const killbillCents = await killbillCreditAmount(kb, credit.killbill_ref);
      lines.push(makeLine(`credit:${credit.number}`, "credit", credit.amount_cents, killbillCents, acceptedKeys));
    }
    const customers = await client.query("SELECT email, killbill_account_id FROM customers WHERE killbill_account_id IS NOT NULL");
    const knownKeys = /* @__PURE__ */ new Set();
    for (const order of orders.rows) knownKeys.add(order.number);
    const subscriptionPayments = await client.query("SELECT number FROM subscriptions");
    const subscriptionKeys = /* @__PURE__ */ new Set();
    for (const subscription of subscriptionPayments.rows) {
      const startOn = String(subscription.number);
      subscriptionKeys.add(startOn);
    }
    for (const customer of customers.rows) {
      const payments = await kb.getAccountPayments(customer.killbill_account_id);
      for (const payment of payments) {
        const key = payment.paymentExternalKey ?? "";
        if (!key || knownKeys.has(key) || isSubscriptionPaymentKey(key, subscriptionKeys)) continue;
        const purchase = payment.transactions.find((tx) => tx.transactionType === "PURCHASE" && tx.status === "SUCCESS");
        if (!purchase?.effectiveDate) continue;
        const effective = new Date(purchase.effectiveDate);
        if (effective < start || effective >= end) continue;
        const net = Math.round((payment.purchasedAmount ?? 0) * 100) - Math.round((payment.refundedAmount ?? 0) * 100);
        const refunded = Math.round((payment.refundedAmount ?? 0) * 100);
        const status = refunded > 0 && net === 0 ? "refunded" : "kb_only";
        lines.push({
          key: `payment:${payment.paymentId}`,
          kind: "payment",
          shopCents: null,
          killbillCents: net,
          status
        });
      }
    }
    return sortLines(lines);
  } finally {
    client.release();
  }
}
function isSubscriptionPaymentKey(key, subscriptionNumbers) {
  const dash = key.lastIndexOf("-");
  if (dash === -1) return false;
  const prefix = key.slice(0, dash);
  return subscriptionNumbers.has(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(key.slice(dash + 1));
}
function makeLine(key, kind, shop, killbill, acceptedKeys) {
  const accepted = acceptedKeys.has(key);
  let status;
  if (kind === "payment") {
    status = "kb_only";
  } else if (killbill === null) {
    status = "shop_only";
  } else if (accepted) {
    status = shop === killbill ? "accepted" : "mismatch";
  } else {
    status = shop === killbill ? "match" : "mismatch";
  }
  return {
    key,
    kind,
    shopCents: accepted && kind !== "payment" ? killbill : shop,
    killbillCents: killbill,
    status
  };
}
function trioTotalForProvince(province) {
  const taxes = findProvince(province)?.taxes ?? [];
  return trioPrice(taxes).total.cents;
}
async function killbillPaymentNet(kb, accountId, orderNumber) {
  if (!accountId) return null;
  try {
    const payments = await kb.getAccountPayments(accountId);
    const payment = payments.find((candidate) => candidate.paymentExternalKey === orderNumber);
    if (!payment) return null;
    return Math.round((payment.purchasedAmount ?? 0) * 100) - Math.round((payment.refundedAmount ?? 0) * 100);
  } catch {
    return null;
  }
}
async function subscriptionInvoicesForMonth(kb, accountId, subscriptionId, month) {
  if (!accountId || !subscriptionId) return [];
  const summaries = await kb.getInvoices(accountId);
  const found = [];
  for (const summary of summaries) {
    const invoice = await kb.getInvoice(summary.invoiceId);
    if (invoice.status !== "COMMITTED") continue;
    if (!(invoice.items ?? []).some((item) => item.subscriptionId === subscriptionId)) continue;
    if ((invoice.invoiceDate ?? "").slice(0, 7) !== month) continue;
    found.push(invoice);
  }
  return found;
}
async function killbillCreditAmount(kb, invoiceId) {
  if (!invoiceId) return null;
  try {
    const invoice = await kb.getInvoice(invoiceId);
    const item = invoice.items?.find((candidate) => candidate.itemType === "CREDIT_ADJ");
    if (!item) return null;
    return Math.round(Math.abs(item.amount) * 100);
  } catch {
    return null;
  }
}
async function acceptedLineKeys(client, month) {
  const res = await client.query(
    "SELECT line_key FROM reconciliation_accepts WHERE month = $1",
    [month]
  );
  return new Set(res.rows.map((row) => row.line_key));
}
async function saveSnapshot(pool, month, lines, totals) {
  await pool.query(
    `INSERT INTO reconciliation_snapshots (month, lines, totals)
     VALUES ($1, $2::jsonb, $3::jsonb)`,
    [month, JSON.stringify(lines), JSON.stringify({ shop: money(totals.shopCents), killbill: money(totals.killbillCents) })]
  );
}
async function lastSnapshot(pool, month) {
  const res = await pool.query(
    "SELECT * FROM reconciliation_snapshots WHERE month = $1 ORDER BY created_at DESC LIMIT 1",
    [month]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    month: row.month,
    lines: row.lines,
    totals: row.totals,
    checked_at: row.checked_at
  };
}
async function acceptLine(pool, kb, locale, actor, month, key) {
  const lines = await buildOrSnapshot(pool, kb, locale, month);
  const line = lines.find((candidate) => candidate.key === key);
  if (!line) {
    throw new ApiError(404, "not_found");
  }
  if (line.status !== "mismatch") {
    throw new ApiError(409, "line_not_mismatched");
  }
  if (line.killbillCents === null || line.shopCents === null) {
    throw new ApiError(409, "line_not_mismatched");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO reconciliation_accepts (month, line_key, shop_cents, killbill_cents) VALUES ($1, $2, $3, $4)",
      [month, key, line.shopCents, line.killbillCents]
    );
    const difference = line.killbillCents - line.shopCents;
    const auditId = await writeAudit(
      client,
      actor,
      "reconciliation_accept",
      key,
      "Accepted Kill Bill figure",
      difference,
      null,
      "issued"
    );
    await client.query("COMMIT");
    return {
      line: { ...line, shopCents: line.killbillCents, status: "accepted" },
      auditId
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw err;
  }
}
async function buildOrSnapshot(pool, kb, locale, month) {
  if (!monthIsValid(month)) {
    throw new ApiError(422, "invalid", null, { month: fieldMessage("month", locale) });
  }
  try {
    return await buildLines(pool, kb, month);
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable", locale));
    }
    throw err;
  }
}
async function refundOrphan(pool, kb, locale, actor, month, key) {
  const lines = await buildOrSnapshot(pool, kb, locale, month);
  const line = lines.find((candidate) => candidate.key === key);
  if (!line) {
    throw new ApiError(404, "not_found");
  }
  if (line.kind !== "payment" || line.status !== "kb_only") {
    throw new ApiError(409, "line_not_orphan");
  }
  const paymentId = key.slice("payment:".length);
  try {
    const payment = await kb.getPayment(paymentId);
    const net = Math.round((payment.purchasedAmount ?? 0) * 100) - Math.round((payment.refundedAmount ?? 0) * 100);
    await kb.refundPayment(paymentId, {
      amount: centsToKb(net),
      currency: "CAD",
      transactionExternalKey: `orphan:${paymentId}`
    }, actor.email);
    const after = await kb.getPayment(paymentId);
    const refundTx = after.transactions.find((tx) => tx.transactionExternalKey === `orphan:${paymentId}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const auditId = await writeAudit(
        client,
        actor,
        "orphan_refund",
        paymentId,
        "Orphan payment",
        net,
        refundTx?.transactionId ?? null,
        "issued"
      );
      await client.query("COMMIT");
      return {
        line: { ...line, killbillCents: 0, status: "refunded" },
        refund: { amountCents: net, killbillRef: refundTx?.transactionId ?? "" },
        auditId
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => void 0);
      client.release();
      throw err;
    }
  } catch (err) {
    if (err instanceof KillBillError) {
      throw new ApiError(503, "billing_unavailable", message("billing_unavailable", locale));
    }
    throw err;
  }
}
function lineView(line) {
  return {
    key: line.key,
    kind: line.kind,
    shop: line.shopCents === null ? null : money(line.shopCents),
    killbill: line.killbillCents === null ? null : money(line.killbillCents),
    status: line.status
  };
}

// src-server/domain/views.ts
init_money();
function taxLineView(tax) {
  return { code: tax.code, rate: tax.rateLabel, amount: tax.amount };
}
function batchView(batch, stock) {
  return {
    code: batch.code,
    scent: batch.scent,
    state: batch.state,
    bars_cut: stock.counts.cut,
    available: stock.counts.available,
    held: stock.counts.held,
    sold: stock.counts.sold,
    bars: stock.bars.map((bar) => ({ number: bar.number, status: bar.status })),
    unit_price: money(1100),
    cure_date: addDays(dateString(batch.poured_on), batch.cure_days),
    drop_at: batch.drop_at ? batch.drop_at.toISOString() : null,
    drop_at_local: batch.drop_at ? torontoLocalMinute(batch.drop_at) : null
  };
}
function dateString(value) {
  return dateToString(value);
}
function orderView(record) {
  return {
    number: record.number,
    status: record.status,
    fulfilment: record.fulfilment,
    placed_at: record.placed_at.toISOString(),
    ship_on: record.ship_on,
    locale: record.locale,
    email: record.email,
    shipping: {
      name: record.name,
      line1: record.line1,
      city: record.city,
      province: record.province,
      postal_code: record.postal_code
    },
    lines: record.lines.map((line) => ({
      batch: line.batch_code,
      scent: line.scent,
      bar: line.bar,
      unit_price: money(line.unit_cents),
      refunded: line.refunded
    })),
    subtotal: money(record.subtotal_cents),
    shipping_fee: money(record.shipping_cents),
    taxes: taxLinesFromJson(record.taxes).map(taxLineView),
    total: money(record.total_cents),
    refunded: money(record.refunded_cents),
    version: record.version
  };
}
function subscriptionPriceView(subscription) {
  const taxes = subscriptionTaxes(subscription.province);
  const subtotal = money(3300);
  const discount = money(Math.floor((subtotal.cents * 12e3 + 5e4) / 1e5));
  const preTax = money(subtotal.cents - discount.cents);
  const taxLines2 = taxes.map((tax) => ({
    code: tax.code,
    rate: tax.rateLabel,
    amount: money(Math.floor((preTax.cents * tax.rateHundredThousandths + 5e4) / 1e5))
  }));
  return {
    subtotal,
    discount,
    pre_tax: preTax,
    taxes: taxLines2.map((line) => ({ code: line.code, rate: line.rate, amount: line.amount })),
    total: money(preTax.cents + taxLines2.reduce((sum, line) => sum + line.amount.cents, 0))
  };
}
function subscriptionTaxes(province) {
  return findProvince(province)?.taxes ?? [];
}
function subscriptionView(record, lockHours) {
  const locksAt = computeLocksAt(record, lockHours);
  return {
    number: record.number,
    state: record.state,
    scent: record.scent,
    cadence: record.cadence,
    pending_cadence: record.pending_cadence,
    started_on: record.started_on,
    next_bill_date: record.next_bill_date,
    skipped_bill_date: record.skipped_bill_date,
    paused_from: record.paused_from,
    locks_at: locksAt ? locksAt.toISOString() : null,
    locked: locksAt ? /* @__PURE__ */ new Date() >= locksAt : false,
    shipping: {
      name: record.name,
      line1: record.line1,
      city: record.city,
      province: record.province,
      postal_code: record.postal_code
    },
    price: subscriptionPriceView(record),
    version: record.version
  };
}
function computeLocksAt(record, lockHours) {
  const date = record.state === "active" ? record.next_bill_date : record.skipped_bill_date ?? record.next_bill_date;
  if (!date) return null;
  const midnight = torontoMidnight(date);
  return new Date(midnight.getTime() - lockHours * 36e5);
}
function refundView(record) {
  return {
    number: record.number,
    order: record.order_number,
    status: record.status,
    bars: record.bars,
    restock: record.restock,
    amount: money(record.amount_cents),
    allocation: {
      bars: money(record.allocation.bars_cents),
      shipping: money(record.allocation.shipping_cents),
      taxes: record.allocation.taxes.map((tax) => ({
        code: tax.code,
        rate: tax.rate,
        amount: money(tax.amount_cents)
      }))
    },
    reason: record.reason,
    killbill_ref: record.killbill_ref,
    created_at: record.created_at.toISOString()
  };
}
function auditView(row) {
  const amount = row.amount;
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    role: row.role,
    action: row.action,
    target: row.target,
    reason: row.reason,
    amount: money(amount.cents),
    killbill_ref: row.killbill_ref,
    outcome: row.outcome
  };
}

// src-server/routes/routes.ts
function route(method, pathTemplate, handler) {
  const paramNames = [];
  const patternSource = pathTemplate.replace(/\{(\w+)\}/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${patternSource}$`), paramNames, handler };
}
async function json(status, body, headers) {
  return { status, body, headers };
}
function stringValue(shape, path) {
  const value = shape.values[path];
  return typeof value === "string" ? value : void 0;
}
function fieldsFromShape(shape, declared) {
  const fields = {};
  for (const [path, kind] of Object.entries(shape.errors)) {
    if (kind === "cant_set") {
      fields[path] = fieldMessage("cant_set", "en-CA");
    } else if (declared[path]) {
      fields[path] = fieldMessage(declared[path], "en-CA");
    } else {
      fields[path] = fieldMessage("cant_set", "en-CA");
    }
  }
  return fields;
}
async function cartPayload(ctx, services, cartIdOverride, provinceInput) {
  const cartId = cartIdOverride ?? ctx.cookies["pdl_cart"];
  const province = provinceInput ?? "QC";
  const provinceInfo = findProvince(province);
  if (!provinceInfo) {
    throw new ApiError(422, "invalid", null, { province: fieldMessage("province", ctx.locale) });
  }
  const client = await services.pool.connect();
  try {
    const now = /* @__PURE__ */ new Date();
    const holds = cartId ? (await client.query(
      `SELECT * FROM holds WHERE cart_id = $1 AND status = 'active' AND expires_at > $2 ORDER BY created_at`,
      [cartId, now]
    )).rows : [];
    const batches = [];
    const priceBreakdown = holds.length === 0 ? { subtotal: money(0), shipping: money(0), taxes: [], total: money(0) } : (await Promise.resolve().then(() => (init_money(), money_exports))).dropPrice(holds.length, provinceInfo.taxes);
    for (const hold of holds) {
      if (batches.some((batch) => batch.code === hold.batch_code)) continue;
      const stock = await batchStock(client, hold.batch_code, now);
      batches.push({
        code: hold.batch_code,
        available: stock.counts.available,
        held: stock.counts.held,
        sold: stock.counts.sold
      });
    }
    return {
      server_now: now.toISOString(),
      holds: holds.map(holdView),
      batches,
      province,
      subtotal: priceBreakdown.subtotal,
      shipping_fee: priceBreakdown.shipping,
      taxes: priceBreakdown.taxes.map((tax) => ({ code: tax.code, rate: tax.rateLabel, amount: tax.amount })),
      total: priceBreakdown.total
    };
  } finally {
    client.release();
  }
}
async function loadPublicBatch(client, code) {
  const batch = await getBatch(client, code);
  if (!batch || !isPublicState(batch.state)) return null;
  const stock = await batchStock(client, code, /* @__PURE__ */ new Date());
  return { batch, stock };
}
function buildRoutes() {
  const routes = [];
  routes.push(route("GET", "/health", async () => json(200, { status: "ok" })));
  routes.push(route("GET", "/status", async (_ctx, services) => json(200, {
    billing: services.billingUp ? "up" : "down",
    mail: services.outbox.mailUp ? "up" : "down",
    checked_at: (/* @__PURE__ */ new Date()).toISOString()
  })));
  routes.push(route("GET", "/drop", async (_ctx, services) => {
    const client = await services.pool.connect();
    try {
      const now = /* @__PURE__ */ new Date();
      const res = await client.query(
        `SELECT * FROM batches WHERE state IN ('scheduled', 'live', 'sold_out') ORDER BY drop_at NULLS LAST, code`
      );
      const batches = [];
      for (const row of res.rows) {
        const stock = await batchStock(client, row.code, now);
        batches.push(batchView(row, stock));
      }
      return json(200, { server_now: now.toISOString(), batches });
    } finally {
      client.release();
    }
  }));
  routes.push(route("GET", "/batches/{code}", async (_ctx, services, params) => {
    const client = await services.pool.connect();
    try {
      const found = await loadPublicBatch(client, params.code);
      if (!found) throw new ApiError(404, "not_found");
      return json(200, batchView(found.batch, found.stock));
    } finally {
      client.release();
    }
  }));
  routes.push(route("POST", "/holds", async (ctx, services) => {
    const spec = { batch: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { batch: "batch" }));
    }
    const batchCode = stringValue(shape, "batch") ?? "";
    const result = await createHold(services.pool, services.env, ctx.cookies["pdl_cart"], batchCode);
    ctx.setCookies.push(cookieHeader("pdl_cart", result.cartId));
    return json(201, { hold: holdView(result.hold), cart: await cartPayload(ctx, services, result.cartId, null) });
  }));
  routes.push(route("DELETE", "/holds/{id}", async (ctx, services, params) => {
    const client = await services.pool.connect();
    try {
      const released = await releaseHold(client, ctx.cookies["pdl_cart"], params.id);
      return json(200, { hold: holdView(released) });
    } finally {
      client.release();
    }
  }));
  routes.push(route("GET", "/cart", async (ctx, services) => {
    const province = ctx.url.searchParams.get("province");
    return json(200, await cartPayload(ctx, services, null, province));
  }));
  routes.push(route("POST", "/auth/code", async (ctx, services) => {
    const spec = {
      email: { type: "string", required: true },
      purpose: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { email: "email", purpose: "purpose" }));
    }
    await requestCode(
      services.pool,
      services.env,
      services.outbox,
      ctx.locale,
      stringValue(shape, "email") ?? "",
      stringValue(shape, "purpose") ?? ""
    );
    return json(202, { status: "sent" });
  }));
  routes.push(route("POST", "/auth/verify", async (ctx, services) => {
    const spec = {
      email: { type: "string", required: true },
      code: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { email: "email", code: "code" }));
    }
    const result = await verifyCode(
      services.pool,
      services.env,
      ctx.locale,
      stringValue(shape, "email") ?? "",
      stringValue(shape, "code") ?? ""
    );
    const token = await createSession(ctx, "customer", result.customerId, null);
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_CUSTOMER, token, { maxAge: 43200 }));
    const email = (stringValue(shape, "email") ?? "").trim().toLowerCase();
    const localeRow = await services.pool.query("SELECT locale FROM customers WHERE id = $1", [result.customerId]);
    return json(200, { customer: { email, locale: localeRow.rows[0].locale } });
  }));
  routes.push(route("POST", "/auth/sign-out", async (ctx) => {
    await destroySession(ctx, SESSION_COOKIE_CUSTOMER, "customer");
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_CUSTOMER, "", { maxAge: 0 }));
    return { status: 204 };
  }));
  routes.push(route("POST", "/checkout", async (ctx, services) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const spec = {
      holds: { type: "array", required: true },
      shipping: {
        type: "object",
        required: true,
        fields: {
          name: { type: "string", required: true },
          line1: { type: "string", required: true },
          city: { type: "string", required: true },
          province: { type: "string", required: true },
          postal_code: { type: "string", required: true }
        }
      }
    };
    const shape = checkShape(ctx.body, spec);
    const holdIds = shape.values["holds"] ?? [];
    const shipping = {
      name: shape.values["shipping.name"],
      line1: shape.values["shipping.line1"],
      city: shape.values["shipping.city"],
      province: shape.values["shipping.province"],
      postal_code: shape.values["shipping.postal_code"]
    };
    const key = idempotencyKey(ctx);
    const scope = `checkout:${session.customer_id}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay);
      return {
        status: stored.status,
        body: JSON.parse(stored.body),
        headers: { "Idempotent-Replayed": "true" }
      };
    }
    if (Object.keys(shape.errors).length > 0) {
      const fields = fieldsFromShape(shape, {
        holds: "holds",
        "shipping.name": "name",
        "shipping.line1": "line1",
        "shipping.city": "city",
        "shipping.province": "province",
        "shipping.postal_code": "postal_code"
      });
      const apiError = new ApiError(422, "invalid", null, fields);
      const { body } = errorBody(apiError, ctx.locale);
      await finishIdempotency(ctx, scope, key, 422, body);
      throw apiError;
    }
    let result;
    try {
      result = await checkoutRoute(ctx, services, session.customer_id, holdIds, shipping);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status >= 200 && status < 300 || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    const bodyText = JSON.stringify(result.body);
    await finishIdempotency(ctx, scope, key, result.status, bodyText);
    return result;
  }));
  routes.push(route("POST", "/contact", async (ctx, services) => {
    const spec = {
      name: { type: "string", required: true },
      email: { type: "string", required: true },
      topic: { type: "string", required: true },
      message: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { name: "name", email: "email", topic: "topic", message: "message" }));
    }
    const result = await submitContact(services.pool, services.outbox, ctx.locale, {
      name: stringValue(shape, "name") ?? "",
      email: stringValue(shape, "email") ?? "",
      topic: stringValue(shape, "topic") ?? "",
      message: shape.values["message"]
    });
    return json(201, result);
  }));
  routes.push(route("GET", "/account", async (ctx, services) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const client = await services.pool.connect();
    try {
      const customer = await client.query("SELECT email, locale FROM customers WHERE id = $1", [session.customer_id]);
      const orders = await client.query(
        `SELECT number, placed_at, total_cents, status FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC`,
        [session.customer_id]
      );
      const subscriptions = await client.query(
        `SELECT number, state, scent, cadence, next_bill_date FROM subscriptions WHERE customer_id = $1 ORDER BY id DESC`,
        [session.customer_id]
      );
      return json(200, {
        customer: { email: customer.rows[0].email, locale: customer.rows[0].locale },
        orders: orders.rows.map((row) => ({
          number: row.number,
          placed_at: row.placed_at.toISOString(),
          total: money(row.total_cents),
          status: row.status
        })),
        subscriptions: subscriptions.rows.map((row) => ({
          number: row.number,
          state: row.state,
          scent: row.scent,
          cadence: row.cadence,
          next_bill_date: row.next_bill_date ? dateToString(row.next_bill_date) : null
        }))
      });
    } finally {
      client.release();
    }
  }));
  routes.push(route("GET", "/account/orders/{number}", async (ctx, services, params) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const client = await services.pool.connect();
    try {
      const res = await client.query(
        "SELECT * FROM orders WHERE number = $1 AND customer_id = $2",
        [params.number, session.customer_id]
      );
      if (!res.rows[0]) throw new ApiError(404, "not_found");
      const lines = await client.query(
        "SELECT batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id FROM order_lines WHERE order_id = $1 ORDER BY batch_code, bar",
        [res.rows[0].id]
      );
      return json(200, orderView(orderFromRow(res.rows[0], lines.rows)));
    } finally {
      client.release();
    }
  }));
  routes.push(route("POST", "/subscriptions", async (ctx, services) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const spec = {
      scent: { type: "string", required: true },
      cadence: { type: "string", required: true },
      shipping: {
        type: "object",
        required: true,
        fields: {
          name: { type: "string", required: true },
          line1: { type: "string", required: true },
          city: { type: "string", required: true },
          province: { type: "string", required: true },
          postal_code: { type: "string", required: true }
        }
      }
    };
    const shape = checkShape(ctx.body, spec);
    const key = idempotencyKey(ctx);
    const scope = `subscriptions:${session.customer_id}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay);
      return { status: stored.status, body: JSON.parse(stored.body), headers: { "Idempotent-Replayed": "true" } };
    }
    let result;
    try {
      const customer = await services.pool.query("SELECT email FROM customers WHERE id = $1", [session.customer_id]);
      const started = await startSubscription(
        services.pool,
        services.kb,
        services.outbox,
        ctx.locale,
        session.customer_id,
        customer.rows[0].email,
        {
          scent: stringValue(shape, "scent") ?? "",
          cadence: stringValue(shape, "cadence") ?? "",
          shipping: {
            name: shape.values["shipping.name"],
            line1: shape.values["shipping.line1"],
            city: shape.values["shipping.city"],
            province: shape.values["shipping.province"],
            postal_code: shape.values["shipping.postal_code"]
          }
        }
      );
      result = await json(201, {
        subscription: subscriptionView(started.subscription, services.env.subscriptionLockHours),
        charged_today: money(started.chargedToday),
        credit_applied: money(started.creditApplied)
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status >= 200 && status < 300 || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    const bodyText = JSON.stringify(result.body);
    await finishIdempotency(ctx, scope, key, result.status, bodyText);
    return result;
  }));
  routes.push(route("GET", "/account/subscriptions/{number}", async (ctx, services, params) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const client = await services.pool.connect();
    try {
      const record = await loadSubscription(client, session.customer_id, params.number);
      return json(200, subscriptionView(record, services.env.subscriptionLockHours));
    } finally {
      client.release();
    }
  }));
  const subscriptionActions = [
    { path: "/skip", kind: "skip" },
    { path: "/unskip", kind: "unskip" },
    { path: "/pause", kind: "pause" },
    { path: "/resume", kind: "resume" },
    { path: "/cancel", kind: "cancel" }
  ];
  for (const action of subscriptionActions) {
    routes.push(route("POST", `/account/subscriptions/{number}${action.path}`, async (ctx, services, params) => {
      const session = await loadCustomerSession(ctx);
      if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
      const spec = {};
      const shape = checkShape(ctx.body, spec);
      void shape;
      const record = await changeSubscription(
        services.pool,
        services.env,
        services.kb,
        ctx.locale,
        session.customer_id,
        params.number,
        { kind: action.kind }
      );
      return json(200, { subscription: subscriptionView(record, services.env.subscriptionLockHours) });
    }));
  }
  routes.push(route("PATCH", "/account/subscriptions/{number}", async (ctx, services, params) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const spec = {
      scent: { type: "string" },
      cadence: { type: "string" }
    };
    const shape = checkShape(ctx.body, spec);
    const patch = {};
    if (shape.values["scent"] !== void 0) patch.scent = shape.values["scent"];
    if (shape.values["cadence"] !== void 0) patch.cadence = shape.values["cadence"];
    const record = await patchSubscription(
      services.pool,
      services.env,
      services.kb,
      ctx.locale,
      session.customer_id,
      params.number,
      patch
    );
    return json(200, { subscription: subscriptionView(record, services.env.subscriptionLockHours) });
  }));
  const staffOnly = async (ctx, services, roles) => {
    const session = await loadStaffSession(ctx);
    if (!session?.staff_id) throw new ApiError(401, "unauthenticated");
    const res = await services.pool.query("SELECT id, email, name, role FROM staff WHERE id = $1", [session.staff_id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(401, "unauthenticated");
    if (!roles.includes(row.role)) throw new ApiError(403, "forbidden", message("forbidden", ctx.locale));
    return { row };
  };
  routes.push(route("POST", "/staff/sign-in", async (ctx, services) => {
    const spec = {
      email: { type: "string", required: true },
      password: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, {
        email: fieldMessage("email", ctx.locale),
        password: fieldMessage("cant_set", ctx.locale)
      });
    }
    const email = (stringValue(shape, "email") ?? "").toLowerCase();
    const password = stringValue(shape, "password") ?? "";
    const res = await services.pool.query("SELECT * FROM staff WHERE email = $1", [email]);
    const row = res.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new ApiError(401, "invalid_credentials", message("invalid_credentials", ctx.locale));
    }
    const token = await createSession(ctx, "staff", null, row.id);
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_STAFF, token, { maxAge: 43200 }));
    return json(200, { staff: { email: row.email, name: row.name, role: row.role } });
  }));
  routes.push(route("POST", "/staff/sign-out", async (ctx) => {
    await destroySession(ctx, SESSION_COOKIE_STAFF, "staff");
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_STAFF, "", { maxAge: 0 }));
    return { status: 204 };
  }));
  routes.push(route("GET", "/staff/me", async (ctx, services) => {
    const session = await loadStaffSession(ctx);
    if (!session?.staff_id) throw new ApiError(401, "unauthenticated");
    const res = await services.pool.query("SELECT email, name, role FROM staff WHERE id = $1", [session.staff_id]);
    if (!res.rows[0]) throw new ApiError(401, "unauthenticated");
    return json(200, { staff: res.rows[0] });
  }));
  routes.push(route("GET", "/staff/batches", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const client = await services.pool.connect();
    try {
      const now = /* @__PURE__ */ new Date();
      const res = await client.query("SELECT * FROM batches ORDER BY code");
      const batches = [];
      for (const row of res.rows) {
        const stock = await batchStock(client, row.code, now);
        const holds = await client.query(
          `SELECT bar, expires_at FROM holds WHERE batch_code = $1 AND status = 'active' AND expires_at > now() ORDER BY bar`,
          [row.code]
        );
        batches.push({
          ...batchView(row, stock),
          poured_on: dateToString(row.poured_on),
          cure_days: row.cure_days,
          holds: holds.rows.map((hold) => ({ bar: hold.bar, expires_at: hold.expires_at.toISOString() }))
        });
      }
      return json(200, { server_now: now.toISOString(), batches });
    } finally {
      client.release();
    }
  }));
  routes.push(route("POST", "/staff/batches", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const spec = {
      scent: { type: "string", required: true },
      poured_on: { type: "string", required: true },
      cure_days: { type: "number", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, {
        scent: fieldMessage("scent", ctx.locale),
        poured_on: fieldMessage("poured_on", ctx.locale),
        cure_days: fieldMessage("cure_days", ctx.locale)
      });
    }
    const client = await services.pool.connect();
    try {
      const batch = await logLoaf(client, ctx.locale, {
        scent: stringValue(shape, "scent") ?? "",
        pouredOn: stringValue(shape, "poured_on") ?? "",
        cureDays: shape.values["cure_days"]
      });
      const stock = await batchStock(client, batch.code, /* @__PURE__ */ new Date());
      return json(201, { batch: { ...batchView(batch, stock), poured_on: String(batch.poured_on).slice(0, 10), cure_days: batch.cure_days, holds: [] } });
    } finally {
      client.release();
    }
  }));
  const batchAction = async (ctx, services, code, action, body) => {
    await staffOnly(ctx, services, ["maker"]);
    const client = await services.pool.connect();
    try {
      let batch;
      if (action === "cut") {
        batch = await cutBatch(client, ctx.locale, code, body.bars ?? 0);
      } else if (action === "schedule") {
        batch = await scheduleBatch(client, ctx.locale, code, body.dropAtLocal ?? "");
      } else if (action === "open") {
        batch = await openBatch(client, ctx.locale, code);
      } else {
        batch = await withdrawBatch(client, ctx.locale, code);
      }
      const stock = await batchStock(client, code, /* @__PURE__ */ new Date());
      const holds = await client.query(
        `SELECT bar, expires_at FROM holds WHERE batch_code = $1 AND status = 'active' AND expires_at > now() ORDER BY bar`,
        [code]
      );
      return json(200, {
        batch: {
          ...batchView(batch, stock),
          poured_on: dateToString(batch.poured_on),
          cure_days: batch.cure_days,
          holds: holds.rows.map((hold) => ({ bar: hold.bar, expires_at: hold.expires_at.toISOString() }))
        }
      });
    } finally {
      client.release();
    }
  };
  routes.push(route("POST", "/staff/batches/{code}/cut", async (ctx, services, params) => {
    const spec = { bars: { type: "number", required: true } };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, { bars: fieldMessage("bars_cut", ctx.locale) });
    }
    return batchAction(ctx, services, params.code, "cut", { bars: shape.values["bars"] });
  }));
  routes.push(route("POST", "/staff/batches/{code}/schedule", async (ctx, services, params) => {
    const spec = { drop_at_local: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_format", ctx.locale) });
    }
    return batchAction(ctx, services, params.code, "schedule", { dropAtLocal: shape.values["drop_at_local"] });
  }));
  routes.push(route(
    "POST",
    "/staff/batches/{code}/open",
    async (ctx, services, params) => batchAction(ctx, services, params.code, "open", {})
  ));
  routes.push(route(
    "POST",
    "/staff/batches/{code}/withdraw",
    async (ctx, services, params) => batchAction(ctx, services, params.code, "withdraw", {})
  ));
  routes.push(route("GET", "/staff/batches/{code}/movements", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker"]);
    const client = await services.pool.connect();
    try {
      const res = await client.query(
        "SELECT at, kind, bars, ref FROM stock_movements WHERE batch_code = $1 ORDER BY id",
        [params.code]
      );
      const batch = await client.query("SELECT code FROM batches WHERE code = $1", [params.code]);
      if (!batch.rows[0]) throw new ApiError(404, "not_found");
      return json(200, {
        movements: res.rows.map((row) => ({
          at: row.at.toISOString(),
          kind: row.kind,
          bars: row.bars,
          ref: row.ref
        }))
      });
    } finally {
      client.release();
    }
  }));
  routes.push(route("GET", "/staff/settings", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const res = await services.pool.query("SELECT value FROM settings WHERE key = 'packing_cutoff_local'");
    return json(200, { packing_cutoff_local: res.rows[0]?.value ?? "14:00", time_zone: "America/Toronto" });
  }));
  routes.push(route("PUT", "/staff/settings", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const spec = { packing_cutoff_local: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    const value = shape.values["packing_cutoff_local"];
    if (Object.keys(shape.errors).length > 0 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? "")) {
      throw new ApiError(422, "invalid", null, { packing_cutoff_local: fieldMessage("packing_cutoff_local", ctx.locale) });
    }
    await services.pool.query("UPDATE settings SET value = $2 WHERE key = 'packing_cutoff_local'", ["", value]);
    return json(200, { packing_cutoff_local: value, time_zone: "America/Toronto" });
  }));
  routes.push(route("GET", "/staff/packing", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "packing"]);
    const client = await services.pool.connect();
    try {
      const list = await packingList(client);
      return json(200, {
        date: list.date,
        cutoff_local: list.cutoffLocal,
        orders: list.orders.map(packingView)
      });
    } finally {
      client.release();
    }
  }));
  routes.push(route("POST", "/staff/orders/{number}/ship", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "packing"]);
    const row = await shipOrder(services.pool, ctx.locale, params.number);
    return json(200, { order: packingView(row) });
  }));
  routes.push(route("GET", "/staff/search", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const q = ctx.url.searchParams.get("q") ?? "";
    if (q.trim().length === 0) {
      throw new ApiError(422, "invalid", null, { q: fieldMessage("q", ctx.locale) });
    }
    const client = await services.pool.connect();
    try {
      const orders = await client.query(
        `SELECT o.number, o.placed_at, o.total_cents, o.status, o.customer_id FROM orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE o.number = $1 OR c.email = $1
         ORDER BY o.placed_at DESC`,
        [q.trim().toLowerCase()]
      );
      const subscriptions = await client.query(
        `SELECT s.number, s.state, s.scent, s.cadence, s.next_bill_date FROM subscriptions s
         JOIN customers c ON c.id = s.customer_id
         WHERE s.number = $1 OR c.email = $1
         ORDER BY s.id DESC`,
        [q.trim().toLowerCase()]
      );
      return json(200, {
        orders: orders.rows.map((row) => ({
          number: row.number,
          placed_at: row.placed_at.toISOString(),
          total: money(row.total_cents),
          status: row.status
        })),
        subscriptions: subscriptions.rows.map((row) => ({
          number: row.number,
          state: row.state,
          scent: row.scent,
          cadence: row.cadence,
          next_bill_date: row.next_bill_date ? dateToString(row.next_bill_date) : null
        }))
      });
    } finally {
      client.release();
    }
  }));
  routes.push(route("GET", "/staff/orders/{number}", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const client = await services.pool.connect();
    try {
      const loaded = await loadOrderForStaff(client, params.number, false);
      const refunds = await client.query(
        `SELECT * FROM refunds WHERE order_id = $1 ORDER BY id`,
        [loaded.id]
      );
      const credits = await client.query(
        `SELECT * FROM credits WHERE target = $1 ORDER BY id`,
        [params.number]
      );
      return json(200, {
        ...orderView(loaded.order),
        refunds: refunds.rows.map((row) => refundViewFromRecord(refundFromRow(row, params.number))),
        credits: credits.rows.map((row) => ({
          number: row.number,
          target: row.target,
          status: row.status,
          amount: money(row.amount_cents),
          reason: row.reason,
          killbill_ref: row.killbill_ref,
          created_at: row.created_at.toISOString()
        }))
      }, { ETag: `"${loaded.order.version}"` });
    } finally {
      client.release();
    }
  }));
  routes.push(route("GET", "/staff/subscriptions/{number}", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const client = await services.pool.connect();
    try {
      const res = await client.query("SELECT * FROM subscriptions WHERE number = $1", [params.number]);
      if (!res.rows[0]) throw new ApiError(404, "not_found");
      const customer = await client.query("SELECT email FROM customers WHERE id = $1", [res.rows[0].customer_id]);
      const credits = await client.query(
        "SELECT * FROM credits WHERE target = $1 AND customer_id = $2 ORDER BY id",
        [params.number, res.rows[0].customer_id]
      );
      return json(200, {
        ...subscriptionView(toRecord(res.rows[0]), services.env.subscriptionLockHours),
        email: customer.rows[0].email,
        credits: credits.rows.map((row) => ({
          number: row.number,
          target: row.target,
          status: row.status,
          amount: money(row.amount_cents),
          reason: row.reason,
          killbill_ref: row.killbill_ref,
          created_at: row.created_at.toISOString()
        }))
      }, { ETag: `"${res.rows[0].version}"` });
    } finally {
      client.release();
    }
  }));
  routes.push(route("POST", "/staff/orders/{number}/refunds", async (ctx, services, params) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec = {
      bars: { type: "array", required: true, items: { batch: { type: "string", required: true }, bar: { type: "number", required: true } } },
      restock: { type: "boolean", required: true },
      reason: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    const key = idempotencyKey(ctx);
    const scope = `refunds:${staff.row.email}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay);
      return { status: stored.status, body: JSON.parse(stored.body), headers: { "Idempotent-Replayed": "true" } };
    }
    let result;
    try {
      const ifMatch = readIfMatch(ctx);
      const outcome = await issueRefund(
        services.pool,
        services.kb,
        services.outbox,
        ctx.locale,
        { email: staff.row.email, role: staff.row.role },
        params.number,
        ifMatch,
        {
          bars: shape.values["bars"] ?? [],
          restock: shape.values["restock"] === true,
          reason: shape.values["reason"]
        }
      );
      result = await json(201, {
        refund: refundViewFromRecord(outcome.refund),
        order: orderView(outcome.order)
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status >= 200 && status < 300 || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    await finishIdempotency(ctx, scope, key, result.status, JSON.stringify(result.body));
    return result;
  }));
  routes.push(route("POST", "/staff/credits", async (ctx, services) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec = {
      target: { type: "string", required: true },
      amount_cents: { type: "number", required: true },
      reason: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    const key = idempotencyKey(ctx);
    const scope = `credits:${staff.row.email}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay);
      return { status: stored.status, body: JSON.parse(stored.body), headers: { "Idempotent-Replayed": "true" } };
    }
    let result;
    try {
      const ifMatch = readIfMatch(ctx);
      const credit = await addCredit(
        services.pool,
        services.kb,
        services.outbox,
        ctx.locale,
        { email: staff.row.email, role: staff.row.role },
        ifMatch,
        {
          target: stringValue(shape, "target") ?? "",
          amountCents: shape.values["amount_cents"],
          reason: shape.values["reason"]
        }
      );
      result = await json(201, {
        number: credit.number,
        target: credit.target,
        status: credit.status,
        amount: money(credit.amount_cents),
        reason: credit.reason,
        killbill_ref: credit.killbill_ref,
        created_at: credit.created_at.toISOString()
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status >= 200 && status < 300 || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    await finishIdempotency(ctx, scope, key, result.status, JSON.stringify(result.body));
    return result;
  }));
  routes.push(route("GET", "/staff/audit", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const res = await services.pool.query("SELECT * FROM audit_entries ORDER BY id DESC");
    return json(200, { entries: res.rows.map(auditView) });
  }));
  const auditImmutable = async (ctx) => {
    throw new ApiError(405, "audit_immutable", message("audit_immutable", ctx.locale));
  };
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    routes.push(route(method, "/staff/audit", auditImmutable));
    routes.push(route(method, "/staff/audit/{id}", auditImmutable));
  }
  routes.push(route("GET", "/staff/reconciliation", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const month = ctx.url.searchParams.get("month") ?? void 0;
    const result = await reconciliation(services.pool, services.kb, ctx.locale, month);
    return json(200, {
      month: result.month,
      stale: result.stale,
      checked_at: result.checkedAt,
      lines: result.lines.map(lineView),
      totals: { shop: money(result.totals.shopCents), killbill: money(result.totals.killbillCents) }
    });
  }));
  routes.push(route("POST", "/staff/reconciliation/accept", async (ctx, services) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec = { month: { type: "string", required: true }, key: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    const result = await acceptLine(
      services.pool,
      services.kb,
      ctx.locale,
      { email: staff.row.email, role: staff.row.role },
      stringValue(shape, "month") ?? "",
      stringValue(shape, "key") ?? ""
    );
    return json(200, {
      line: lineView(result.line),
      audit: auditView({
        id: result.auditId,
        at: /* @__PURE__ */ new Date(),
        actor: staff.row.email,
        role: staff.row.role,
        action: "reconciliation_accept",
        target: "",
        reason: "",
        amount: money(0),
        killbill_ref: null,
        outcome: "issued"
      })
    });
  }));
  routes.push(route("POST", "/staff/reconciliation/refund-orphan", async (ctx, services) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec = { month: { type: "string", required: true }, key: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    const result = await refundOrphan(
      services.pool,
      services.kb,
      ctx.locale,
      { email: staff.row.email, role: staff.row.role },
      stringValue(shape, "month") ?? "",
      stringValue(shape, "key") ?? ""
    );
    return json(200, {
      line: lineView(result.line),
      refund: { amount: money(result.refund.amountCents), killbill_ref: result.refund.killbillRef },
      audit: auditView({
        id: result.auditId,
        at: /* @__PURE__ */ new Date(),
        actor: staff.row.email,
        role: staff.row.role,
        action: "orphan_refund",
        target: "",
        reason: "",
        amount: money(0),
        killbill_ref: null,
        outcome: "issued"
      })
    });
  }));
  routes.push(route("GET", "/staff/notices", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const status = ctx.url.searchParams.get("status");
    if (status !== null && !["queued", "retrying", "sent", "failed"].includes(status)) {
      throw new ApiError(422, "invalid", null, { status: fieldMessage("status", ctx.locale) });
    }
    const res = status ? await services.pool.query("SELECT * FROM notices WHERE status = $1 ORDER BY id DESC", [status]) : await services.pool.query("SELECT * FROM notices ORDER BY id DESC");
    return json(200, {
      notices: res.rows.map((row) => ({
        number: row.number,
        key: row.key,
        kind: row.kind,
        to: row.to_email,
        locale: row.locale,
        subject: row.subject,
        status: row.status,
        enqueued_at: row.enqueued_at.toISOString(),
        attempts: row.attempts
      }))
    });
  }));
  routes.push(route("POST", "/staff/notices/{number}/resend", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const result = await services.outbox.resend(params.number);
    if (!result) {
      throw new ApiError(409, "notice_not_failed", message("notice_not_failed", ctx.locale, { notice: params.number }));
    }
    return json(200, {
      notice: {
        number: result.number,
        key: result.key,
        kind: "",
        to: result.to_email,
        locale: result.locale,
        subject: result.subject,
        status: "queued",
        enqueued_at: result.enqueued_at.toISOString(),
        attempts: []
      }
    });
  }));
  return routes;
}
async function checkoutRoute(ctx, services, customerId, holdIds, shipping) {
  const customer = await services.pool.query("SELECT email FROM customers WHERE id = $1", [customerId]);
  const result = await checkout(
    services.pool,
    services.kb,
    services.outbox,
    ctx.locale,
    ctx.cookies["pdl_cart"],
    customerId,
    customer.rows[0].email,
    {
      holds: holdIds,
      shipping: {
        name: shipping.name ?? "",
        line1: shipping.line1 ?? "",
        city: shipping.city ?? "",
        province: shipping.province ?? "",
        postal_code: shipping.postal_code ?? ""
      }
    }
  );
  return json(201, { order: orderView(result.order) });
}
function refundViewFromRecord(record) {
  return refundView(record);
}
function readIfMatch(ctx) {
  const header = ctx.req.headers.get("if-match");
  if (header === null) return null;
  const value = header.replace(/^"(.*)"$/, "$1");
  const version = Number(value);
  return Number.isInteger(version) ? version : -1;
}

// src-server/routes/router.ts
var ApiRouter = class {
  constructor(services) {
    this.services = services;
  }
  routes = buildRoutes();
  async handle(req, url) {
    const cookies = readCookies(req.headers.get("cookie"));
    const locale = resolveLocale(cookies, req.headers.get("accept-language"));
    const ctx = {
      req,
      url,
      method: req.method.toUpperCase(),
      env: this.services.env,
      pool: this.services.pool,
      locale,
      cookies,
      body: void 0,
      setCookies: [],
      responseHeaders: {}
    };
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    try {
      checkOrigin(req);
      ctx.body = await readJsonBody(req);
      const path = url.pathname;
      if (!path.startsWith("/api/") && path !== "/api") {
        throw new ApiError(404, "not_found");
      }
      const apiPath = path.slice("/api".length) || "/";
      const method = ctx.method;
      let pathMatched = false;
      for (const routeItem of this.routes) {
        const match = routeItem.pattern.exec(apiPath);
        if (!match) continue;
        pathMatched = true;
        if (routeItem.method !== method && !(routeItem.method === "GET" && method === "HEAD")) continue;
        const params = {};
        routeItem.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1]);
        });
        const result = await routeItem.handler(ctx, this.services, params);
        for (const [key, value] of Object.entries(result.headers ?? {})) {
          headers[key] = value;
        }
        for (const cookie of ctx.setCookies) {
          headers["Set-Cookie"] = headers["Set-Cookie"] ? `${headers["Set-Cookie"]}, ${cookie}` : cookie;
        }
        if (result.status === 204) {
          return { status: 204, body: null, headers };
        }
        return { status: result.status, body: JSON.stringify(result.body ?? null), headers };
      }
      if (pathMatched) {
        throw new ApiError(405, "method_not_allowed");
      }
      throw new ApiError(404, "not_found");
    } catch (err) {
      if (!(err instanceof ApiError)) {
        console.error("api error:", err);
      }
      const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
      const { status, body } = errorBody(apiError, locale);
      for (const [key, value] of Object.entries(apiError.headers)) {
        headers[key] = value;
      }
      for (const cookie of ctx.setCookies) {
        headers["Set-Cookie"] = headers["Set-Cookie"] ? `${headers["Set-Cookie"]}, ${cookie}` : cookie;
      }
      return { status, body, headers };
    }
  }
};

// src-server/main.ts
var DIST_DIR = join(fileURLToPath(new URL(import.meta.url)), "..", "..", "dist");
var KNOWN_SCREENS = /^\/($|checkout|checkout\/placed\/[^/]+|subscribe|account|account\/orders\/[^/]+|account\/subscriptions\/[^/]+|contact|studio|studio\/[a-z]+)$/;
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".svg": "image/svg+xml"
};
async function main() {
  const env = readEnv();
  const pool = createPool(env.databaseUrl);
  for (; ; ) {
    try {
      await applySchema(pool);
      break;
    } catch (err) {
      console.error("database not ready:", err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 2e3));
    }
  }
  const kb = new KillBillClient(env);
  const outbox = new Outbox(env, pool);
  const background = new Background(pool, kb, outbox);
  background.start();
  const services = { env, pool, kb, outbox, billingUp: true };
  const router = new ApiRouter(services);
  const refreshBilling = () => {
    services.billingUp = background.billingUp;
  };
  const server = createServer(async (req, res) => {
    try {
      refreshBilling();
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: req.method === "GET" || req.method === "HEAD" ? void 0 : req,
          // @ts-expect-error Node 22 accepts duplex for streaming request bodies.
          duplex: "half"
        });
        const result = await router.handle(request, url);
        res.writeHead(result.status, result.headers);
        res.end(result.body ?? void 0);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method not allowed");
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { code: "internal_error", message: "Something went wrong." } }));
      } else {
        res.end();
      }
    }
  });
  server.listen(env.publicPort, "0.0.0.0", () => {
    console.log(`Loafline listening on 0.0.0.0:${env.publicPort}`);
  });
}
async function serveStatic(pathname, res) {
  if (pathname.includes("..")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  let assetPath = pathname;
  let status = 200;
  const known = KNOWN_SCREENS.test(pathname);
  if (pathname === "/" || known) {
    assetPath = "/index.html";
  } else if (extname(pathname) === "") {
    assetPath = "/index.html";
    status = 404;
  }
  const file = join(DIST_DIR, assetPath);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const content = await readFile(file);
    res.writeHead(status, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=300"
    });
    res.end(content);
  } catch {
    try {
      const html = await readFile(join(DIST_DIR, "index.html"));
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      res.end(html);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }
}
main().catch((err) => {
  console.error("server failed to start:", err);
  process.exit(1);
});
