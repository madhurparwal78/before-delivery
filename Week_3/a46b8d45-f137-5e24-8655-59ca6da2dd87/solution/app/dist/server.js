// src/server/config.ts
var env = process.env;
function text(name, fallback = "") {
  const value = env[name];
  return value === void 0 || value === "" ? fallback : value;
}
function whole(name, fallback) {
  const value = env[name];
  if (value === void 0 || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
function optionalWhole(name) {
  const value = env[name];
  if (value === void 0 || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
function frozenClock() {
  const value = env["DESK_CLOCK_FROZEN_AT"];
  if (value === void 0 || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
var port = whole("APP_PUBLIC_PORT", 4173);
var config = {
  port,
  appPublicUrl: text("APP_PUBLIC_URL", `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true").toLowerCase() === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY")
  },
  killBill: {
    url: text("KILLBILL_URL").replace(/\/+$/, ""),
    username: text("KILLBILL_USERNAME"),
    password: text("KILLBILL_PASSWORD"),
    apiKey: text("KILLBILL_API_KEY"),
    apiSecret: text("KILLBILL_API_SECRET")
  },
  mail: {
    smtpHost: text("SMTP_HOST"),
    smtpPort: whole("SMTP_PORT", 1025),
    mailpitUrl: text("MAILPIT_URL").replace(/\/+$/, ""),
    from: text("MAIL_FROM", "Holmgarth Aftercare <desk@holmgarth.example>")
  },
  carrierUrl: text("WIREMOCK_URL").replace(/\/+$/, ""),
  desk: {
    standardMonths: whole("AFTERCARE_STANDARD_MONTHS", 24),
    clubMonths: whole("AFTERCARE_CLUB_MONTHS", 36),
    termSecondsOverride: optionalWhole("AFTERCARE_TERM_SECONDS_OVERRIDE"),
    confirmLinkTtlSeconds: whole("CONFIRM_LINK_TTL_SECONDS", 1800),
    dispatchCutoffLocal: text("DISPATCH_CUTOFF_LOCAL", "14:00"),
    referenceLockSeconds: whole("REFERENCE_LOCK_SECONDS", 900),
    partsRatePerMinute: whole("PARTS_RATE_LIMIT_PER_MINUTE", 60),
    operatorSessionSeconds: whole("OPERATOR_SESSION_SECONDS", 43200),
    clockFrozenAt: frozenClock()
  }
};

// src/server/db.ts
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

// src/shared/format.ts
var EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var PL_MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "wrze\u015Bnia", "pa\u017Adziernika", "listopada", "grudnia"];
var NBSP = "\xA0";
var londonClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});
function londonParts(at) {
  const parts = {};
  for (const part of londonClock.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts["year"] ?? 0,
    month: parts["month"] ?? 0,
    day: parts["day"] ?? 0,
    hour: parts["hour"] ?? 0,
    minute: parts["minute"] ?? 0,
    second: parts["second"] ?? 0
  };
}
var pad = (n, width = 2) => String(n).padStart(width, "0");
function londonDateOf(at) {
  const p = londonParts(at);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}
function timeText(at) {
  const p = londonParts(at);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
function dateText(ymd, lang) {
  const [y, m, d] = ymd.split("-").map(Number);
  const months = lang === "pl-PL" ? PL_MONTHS : EN_MONTHS;
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}
function instantDateText(iso2, lang) {
  return dateText(londonDateOf(new Date(iso2)), lang);
}
function instantTimeText(iso2) {
  return timeText(new Date(iso2));
}
function groupThousands(whole2, separator) {
  let out = "";
  for (let i = whole2.length; i > 0; i -= 3) {
    out = whole2.slice(Math.max(0, i - 3), i) + (out ? separator + out : "");
  }
  return out;
}
function money(minor, lang) {
  const pounds = Math.trunc(minor / 100);
  const pence = pad(Math.abs(minor % 100));
  const whole2 = String(pounds);
  if (lang === "en-GB") return `\xA3${groupThousands(whole2, ",")}.${pence}`;
  const grouped = whole2.length >= 5 ? groupThousands(whole2, NBSP) : whole2;
  return `${grouped},${pence}${NBSP}\xA3`;
}

// src/shared/copy.ts
var pick = (pair, lang) => lang === "pl-PL" ? pair[1] : pair[0];
var STATE_NAMES = {
  started: ["Started", "Rozpocz\u0119te"],
  confirmed: ["Confirmed", "Potwierdzone"],
  identified: ["Identified", "Zidentyfikowane"],
  quoted: ["Quoted", "Wycenione"],
  declined: ["Declined", "Odrzucone"],
  dispatched: ["Dispatched", "Wys\u0142ane"],
  closed: ["Closed", "Zamkni\u0119te"],
  erased: ["Erased", "Usuni\u0119te"]
};
var stateName = (state, lang) => pick(STATE_NAMES[state], lang);
var OWNER_REFUSALS = {
  link_lapsed: ["This confirmation link has lapsed. Start your claim again to get a new one.", "Ten link potwierdzaj\u0105cy wygas\u0142. Rozpocznij zg\u0142oszenie ponownie, aby otrzyma\u0107 nowy."],
  link_used: ["This confirmation link has already been used.", "Ten link potwierdzaj\u0105cy zosta\u0142 ju\u017C u\u017Cyty."],
  link_unknown: ["We couldn't find that confirmation link.", "Nie znale\u017Ali\u015Bmy tego linku potwierdzaj\u0105cego."],
  claim_unknown: ["We couldn't find that claim.", "Nie znale\u017Ali\u015Bmy tego zg\u0142oszenia."],
  not_a_photo: ["The file <file> isn't a JPEG, PNG or WebP photo.", "Plik <file> nie jest zdj\u0119ciem JPEG, PNG ani WebP."],
  too_large: ["The file <file> is larger than 8 MB.", "Plik <file> jest wi\u0119kszy ni\u017C 8 MB."],
  photo_count: ["Add between 1 and 4 photos.", "Dodaj od 1 do 4 zdj\u0119\u0107."],
  request_too_large: ["Those photos are too large to send together.", "Te zdj\u0119cia s\u0105 razem za du\u017Ce do wys\u0142ania."],
  carrier_unavailable: ["The carrier isn't answering right now. Try the estimate again later.", "Przewo\u017Anik nie odpowiada w tej chwili. Spr\xF3buj ponownie p\xF3\u017Aniej."],
  carrier_timeout: ["The carrier is taking too long to answer. Try the estimate again in a minute.", "Przewo\u017Anik zbyt d\u0142ugo nie odpowiada. Spr\xF3buj ponownie za minut\u0119."],
  carrier_malformed: ["The carrier sent an answer we can't read. Try the estimate again later.", "Przewo\u017Anik przes\u0142a\u0142 odpowied\u017A, kt\xF3rej nie mo\u017Cemy odczyta\u0107. Spr\xF3buj ponownie p\xF3\u017Aniej."],
  storage_unavailable: ["We can't store photos right now, so nothing was saved. Please try again in a few minutes.", "Nie mo\u017Cemy teraz zapisa\u0107 zdj\u0119\u0107, wi\u0119c nic nie zosta\u0142o zapisane. Spr\xF3buj ponownie za kilka minut."],
  mail_unavailable: ["We can't send email right now, so nothing was saved. Please try again in a few minutes.", "Nie mo\u017Cemy teraz wys\u0142a\u0107 e-maila, wi\u0119c nic nie zosta\u0142o zapisane. Spr\xF3buj ponownie za kilka minut."],
  database_unavailable: ["We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes.", "Nie mo\u017Cemy teraz po\u0142\u0105czy\u0107 si\u0119 z rejestrem zg\u0142osze\u0144, wi\u0119c nic nie zosta\u0142o zapisane. Spr\xF3buj ponownie za kilka minut."],
  part_withdrawn: ["Part <number> is no longer available to claim.", "Cz\u0119\u015B\u0107 <number> nie jest ju\u017C dost\u0119pna do zg\u0142oszenia."],
  not_found: ["We couldn't find a claim with that reference and email.", "Nie znale\u017Ali\u015Bmy zg\u0142oszenia o tym numerze i adresie e-mail."],
  reference_locked: ["This reference is locked after too many wrong tries. Try again later.", "Ten numer zg\u0142oszenia jest zablokowany po zbyt wielu b\u0142\u0119dnych pr\xF3bach. Spr\xF3buj ponownie p\xF3\u017Aniej."],
  wrong_state: ["This claim hasn't been confirmed yet. Use the link in the email we sent.", "To zg\u0142oszenie nie zosta\u0142o jeszcze potwierdzone. U\u017Cyj linku z wys\u0142anego e-maila."],
  claim_closed: ["This claim is closed, so its link no longer works.", "To zg\u0142oszenie jest zamkni\u0119te, wi\u0119c link ju\u017C nie dzia\u0142a."],
  link_withdrawn: ["This link has been withdrawn. Ask Holmgarth Aftercare for a new one.", "Ten link zosta\u0142 wycofany. Popro\u015B Holmgarth Aftercare o nowy."],
  share_unknown: ["We couldn't find that link.", "Nie znale\u017Ali\u015Bmy tego linku."],
  rate_limited: ["Too many requests. Please wait a moment.", "Zbyt wiele zapyta\u0144. Poczekaj chwil\u0119."]
};
var OPS_REFUSALS = {
  bad_credentials: "That email and password don't match.",
  wrong_state: "This claim is <state>, so that can't be done now.",
  not_paid: "Record the owner's payment before dispatch.",
  already_paid: "This claim is already paid.",
  part_withdrawn: "Part <number> has been withdrawn.",
  idempotency_conflict: "That request was already used for a different action.",
  billing_unavailable: "Billing isn't answering. Nothing was charged or changed.",
  carrier_unavailable: "The carrier isn't answering. No quote was made.",
  carrier_timeout: "The carrier took too long to answer. No quote was made.",
  carrier_malformed: "The carrier's answer couldn't be read. No quote was made.",
  storage_unavailable: "File storage isn't answering. Nothing was changed.",
  mail_unavailable: "Email isn't answering. Nothing was erased.",
  database_unavailable: "The claim records aren't answering. Nothing was changed.",
  must_be_future: "Choose a date after today.",
  edition_date_taken: "An edition already starts on that date.",
  edition_code_taken: "That edition code is already used.",
  file_too_large: "The file is larger than 2,000,000 bytes.",
  not_found: "No claim with that reference."
};
function fill(template, values) {
  return template.replace(/<(\w+)>/g, (whole2, key) => key in values ? String(values[key]) : whole2);
}
var FIELDS_MESSAGE = "Some fields need attention.";
var PART_NOT_FOUND_MESSAGE = "Choose the broken or missing part.";
var lifetimeLine = (confirmBy, lang) => {
  const time = instantTimeText(confirmBy);
  const date = instantDateText(confirmBy, lang);
  return lang === "pl-PL" ? `Link dzia\u0142a do ${time} dnia ${date} (czas brytyjski).` : `This link works until ${time} on ${date} (UK time).`;
};
var partLine = (booklet, name, lang) => lang === "pl-PL" ? `Cz\u0119\u015B\u0107 ${booklet}: ${name}` : `Part ${booklet}: ${name}`;
var partNumberLine = (partNumber, lang) => lang === "pl-PL" ? `Numer cz\u0119\u015Bci ${partNumber}` : `Part number ${partNumber}`;
var partAmountLine = (minor, lang) => lang === "pl-PL" ? `Cz\u0119\u015B\u0107 ${money(minor, lang)}` : `Part ${money(minor, lang)}`;
var carriageLine = (band, minor, lang) => lang === "pl-PL" ? `Przesy\u0142ka, strefa ${band} ${money(minor, lang)}` : `Carriage, band ${band} ${money(minor, lang)}`;
var totalLine = (minor, lang) => lang === "pl-PL" ? `Razem ${money(minor, lang)}` : `Total ${money(minor, lang)}`;
var paidLine = (minor, lang) => lang === "pl-PL" ? `Zap\u0142acono ${money(minor, lang)}` : `Paid ${money(minor, lang)}`;
var sameDayLine = (ymd, lang) => lang === "pl-PL" ? `Wysy\u0142ka tego samego dnia roboczego: cz\u0119\u015B\u0107 wyjdzie z warsztatu ${dateText(ymd, lang)}` : `Same-working-day dispatch: leaves the workshop on ${dateText(ymd, lang)}`;
var laterLine = (ymd, lang) => lang === "pl-PL" ? `Cz\u0119\u015B\u0107 wyjdzie z warsztatu najp\xF3\u017Aniej ${dateText(ymd, lang)}` : `Leaves the workshop by ${dateText(ymd, lang)}`;
var promiseLine = (promise, lang) => promise.kind === "same_day" ? sameDayLine(promise.date, lang) : laterLine(promise.date, lang);

// src/server/errors.ts
var STATUS = {
  rate_limited: 429,
  read_only: 405,
  method_not_allowed: 405,
  request_too_large: 413,
  payload_too_large: 413,
  file_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  bad_credentials: 401,
  not_found: 404,
  claim_unknown: 404,
  link_unknown: 404,
  share_unknown: 404,
  link_lapsed: 410,
  claim_closed: 410,
  link_withdrawn: 410,
  reference_locked: 423,
  wrong_state: 409,
  already_paid: 409,
  not_paid: 409,
  part_withdrawn: 409,
  link_used: 409,
  idempotency_conflict: 409,
  edition_date_taken: 409,
  edition_code_taken: 409,
  validation_failed: 422,
  carrier_malformed: 502,
  database_unavailable: 503,
  storage_unavailable: 503,
  mail_unavailable: 503,
  billing_unavailable: 503,
  carrier_unavailable: 503,
  carrier_timeout: 504,
  internal_error: 500
};
var ApiError = class extends Error {
  code;
  detail;
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
  get status() {
    return STATUS[this.code];
  }
};
var fail = (errorCode, detail = {}) => {
  throw new ApiError(errorCode, detail);
};
var failFields = (fields) => fail("validation_failed", { fields });
var unknownClaim = (code = "not_found") => fail(code);
var unknownPartOrModel = () => fail("not_found", { message: PART_NOT_FOUND_MESSAGE });
var SENTENCES = {
  read_only: "This address can only be read.",
  method_not_allowed: "That method is not allowed here.",
  payload_too_large: "That request is too large.",
  unsupported_media_type: "That content type is not supported.",
  cross_origin: "That request came from another origin.",
  unauthenticated: "Sign in first.",
  validation_failed: FIELDS_MESSAGE,
  internal_error: "Something went wrong on our side."
};
function messageFor(error, ops) {
  if (error.detail.message !== void 0) return error.detail.message;
  const numberValue = error.detail.number ?? 0;
  if (ops && error.code in OPS_REFUSALS) {
    const template = OPS_REFUSALS[error.code];
    return fill(template, { state: stateName(error.detail.state ?? "started", "en-GB"), number: numberValue });
  }
  if (error.code in OWNER_REFUSALS) {
    return fill(OWNER_REFUSALS[error.code][0], { number: numberValue });
  }
  return SENTENCES[error.code] ?? "That request could not be completed.";
}
function errorBody(error, ops) {
  const body = { error: { code: error.code, message: messageFor(error, ops) } };
  if (error.detail.fields) body.error.fields = error.detail.fields;
  if (error.detail.state) body.error.state = error.detail.state;
  return body;
}

// src/server/db.ts
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1082, (value) => value);
var pool = new pg.Pool({
  connectionString: config.databaseUrl || void 0,
  max: 20,
  connectionTimeoutMillis: 3e3,
  idleTimeoutMillis: 3e4
});
pool.on("error", () => void 0);
function isConnectionFailure(error) {
  if (!(error instanceof Error)) return false;
  const code = error.code;
  if (typeof code !== "string") return /connection|timeout|terminated/i.test(error.message);
  return code.startsWith("08") || code.startsWith("57") || /^E[A-Z]+$/.test(code);
}
function asDatabaseError(error) {
  return error instanceof ApiError || !isConnectionFailure(error) ? error : new ApiError("database_unavailable");
}
async function rows(db, sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (error) {
    throw asDatabaseError(error);
  }
}
async function one(db, sql, params = []) {
  return (await rows(db, sql, params))[0] ?? null;
}
async function transaction(work) {
  await ensureSchema();
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw asDatabaseError(error);
  }
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw asDatabaseError(error);
  } finally {
    client.release();
  }
}
async function database() {
  await ensureSchema();
  return pool;
}
var SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  slug text PRIMARY KEY, name text NOT NULL, axis text, retired_names text[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS parts (
  model_slug text NOT NULL REFERENCES models(slug), booklet_number int NOT NULL, part_number text NOT NULL,
  name text NOT NULL, price_minor int NOT NULL, weight_g int NOT NULL, longest_side_mm int NOT NULL,
  status text NOT NULL, bin_count int NOT NULL DEFAULT 0, PRIMARY KEY (model_slug, booklet_number));
CREATE TABLE IF NOT EXISTS editions (
  code text PRIMARY KEY, title text NOT NULL, starts_on date NOT NULL UNIQUE, standard_months int NOT NULL,
  club_months int NOT NULL, owner_contribution_percent int NOT NULL);
CREATE TABLE IF NOT EXISTS club_roster (email text PRIMARY KEY, joined_on date NOT NULL);
CREATE TABLE IF NOT EXISTS bank_holidays (day date PRIMARY KEY);
CREATE TABLE IF NOT EXISTS operator_account (email text PRIMARY KEY, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS decided_counts (
  id int PRIMARY KEY CHECK (id = 1), decided int NOT NULL, inside int NOT NULL, outside int NOT NULL);
CREATE TABLE IF NOT EXISTS claims (
  reference text PRIMARY KEY, state text NOT NULL, language text, name text, email text, postcode text,
  purchase_date date, model_slug text, booklet_number int, quantity int, description text,
  started_at timestamptz, confirm_by timestamptz, confirm_token text UNIQUE, confirmed_at timestamptz,
  ruling_inside boolean, ruling_edition text, ruling_cover_ends_at timestamptz, ruling_cover_ends_on date,
  ruling_term_months int, ruling_decided_at timestamptz,
  paid_minor int, paid_at timestamptz, decline_reason text, decline_charged_minor int, decline_refunded_minor int,
  dispatched_at timestamptz, closed_at timestamptz, erased_at timestamptz, billing_account text);
CREATE INDEX IF NOT EXISTS claims_email_idx ON claims (lower(email));
CREATE TABLE IF NOT EXISTS claim_history (
  claim_reference text NOT NULL REFERENCES claims(reference), seq int NOT NULL, state text NOT NULL,
  at timestamptz NOT NULL, PRIMARY KEY (claim_reference, seq));
CREATE TABLE IF NOT EXISTS claim_photos (
  claim_reference text NOT NULL REFERENCES claims(reference), idx int NOT NULL, content_type text NOT NULL,
  bytes int NOT NULL, PRIMARY KEY (claim_reference, idx));
CREATE TABLE IF NOT EXISTS quote_revisions (
  claim_reference text NOT NULL REFERENCES claims(reference), revision int NOT NULL, status text NOT NULL,
  source text NOT NULL, quantity int NOT NULL, part_line_minor int NOT NULL, carriage_minor int NOT NULL,
  total_minor int NOT NULL, band text NOT NULL, carriage_valid_until timestamptz NOT NULL,
  promise_kind text NOT NULL, promise_date date NOT NULL, quoted_at timestamptz NOT NULL,
  billing_invoice text NOT NULL, bin_returned boolean NOT NULL DEFAULT false,
  PRIMARY KEY (claim_reference, revision));
CREATE TABLE IF NOT EXISTS share_tokens (
  token text PRIMARY KEY, claim_reference text NOT NULL REFERENCES claims(reference), state text NOT NULL,
  created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS share_tokens_claim_idx ON share_tokens (claim_reference);
CREATE TABLE IF NOT EXISTS idempotency_records (
  claim_reference text NOT NULL REFERENCES claims(reference), key text NOT NULL, action text NOT NULL,
  fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (claim_reference, key));
CREATE TABLE IF NOT EXISTS reference_attempts (
  reference text PRIMARY KEY REFERENCES claims(reference), wrong_count int NOT NULL, locked_until timestamptz);
CREATE TABLE IF NOT EXISTS rate_hits (caller text NOT NULL, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_idx ON rate_hits (caller, at);
CREATE TABLE IF NOT EXISTS operator_sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS notice_queue (
  id bigserial PRIMARY KEY, claim_reference text NOT NULL REFERENCES claims(reference), recipient text NOT NULL,
  subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL);
`;
var SEED_MODELS = [
  {
    slug: "aldra-wardrobe",
    name: "Aldra Wardrobe",
    axis: "y",
    retired: ["Aldra Robe", "Aldra 2-Door", "Holm Classic"],
    parts: [
      { booklet: 1, number: "40218831", name: "Side panel", price: 4800, weight: 14200, side: 1990, bin: 0 },
      { booklet: 2, number: "40218848", name: "Top panel", price: 3600, weight: 6800, side: 980, bin: 0 },
      { booklet: 3, number: "102944", name: "Shelf", price: 1450, weight: 2100, side: 940, bin: 3 },
      { booklet: 4, number: "118320", name: "Hanging rail", price: 950, weight: 600, side: 900, bin: 6 },
      { booklet: 5, number: "100823", name: "Cam lock", price: 45, weight: 12, side: 15, bin: 400 },
      { booklet: 6, number: "100824", name: "Cam bolt", price: 35, weight: 9, side: 34, bin: 400 }
    ]
  },
  {
    slug: "bramwell-sofa-frame",
    name: "Bramwell Sofa Frame",
    axis: "x",
    retired: ["Bramwell 3-Seater", "Holm Classic"],
    parts: [
      { booklet: 1, number: "50331207", name: "Back rail", price: 2250, weight: 3100, side: 1820, bin: 0 },
      { booklet: 2, number: "503319", name: "Seat slat", price: 690, weight: 700, side: 760, bin: 12 },
      { booklet: 3, number: "112903", name: "Front leg", price: 1125, weight: 450, side: 140, bin: 8 },
      { booklet: 4, number: "112911", name: "Corner block", price: 365, weight: 120, side: 90, bin: 30 },
      { booklet: 5, number: "100190", name: "Bolt M8 \xD7 80", price: 85, weight: 40, side: 80, bin: 200 }
    ]
  },
  {
    slug: "kestle-shelving-unit",
    name: "Kestle Shelving Unit",
    axis: "iso",
    retired: ["Kestle Tall Shelf", "Kestle 5-Tier"],
    parts: [
      { booklet: 1, number: "60770016", name: "Upright", price: 2900, weight: 3900, side: 1810, bin: 0 },
      { booklet: 2, number: "607701", name: "Shelf board", price: 1675, weight: 2600, side: 790, bin: 4 },
      { booklet: 3, number: "101345", name: "Shelf pin", price: 15, weight: 3, side: 16, bin: 1e3 },
      { booklet: 4, number: "120456", name: "Wall bracket", price: 255, weight: 60, side: 70, bin: 25 },
      { booklet: 5, number: "607744", name: "Back brace", price: 740, weight: 800, side: 760, bin: 2, status: "withdrawn" }
    ]
  },
  {
    slug: "fenwick-bed-frame",
    name: "Fenwick Bed Frame",
    axis: null,
    retired: ["Fenwick Double"],
    parts: [
      { booklet: 1, number: "70110025", name: "Headboard", price: 5400, weight: 9800, side: 1420, bin: 0 },
      { booklet: 2, number: "701102", name: "Side rail", price: 1990, weight: 3300, side: 1960, bin: 2 },
      { booklet: 3, number: "701109", name: "Slat", price: 320, weight: 400, side: 1380, bin: 40 },
      { booklet: 4, number: "120870", name: "Centre leg", price: 410, weight: 300, side: 250, bin: 10 }
    ]
  }
];
var BANK_HOLIDAYS = [
  "2026-01-01",
  "2026-04-03",
  "2026-04-06",
  "2026-05-04",
  "2026-05-25",
  "2026-08-31",
  "2026-12-25",
  "2026-12-28",
  "2027-01-01",
  "2027-03-26",
  "2027-03-29",
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  "2027-12-27",
  "2027-12-28"
];
var OPERATOR_EMAIL = "operator@holmgarth.example";
var OPERATOR_PASSWORD = "fan-out-2026-desk";
function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
async function seed(client) {
  const existing = await client.query("SELECT count(*)::int AS n FROM models");
  if (existing.rows[0].n > 0) return;
  for (const model of SEED_MODELS) {
    await client.query("INSERT INTO models (slug, name, axis, retired_names) VALUES ($1, $2, $3, $4)", [model.slug, model.name, model.axis, model.retired]);
    for (const part of model.parts) {
      await client.query(
        "INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g, longest_side_mm, status, bin_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [model.slug, part.booklet, part.number, part.name, part.price, part.weight, part.side, part.status ?? "active", part.bin]
      );
    }
  }
  const { standardMonths, clubMonths } = config.desk;
  await client.query("INSERT INTO editions VALUES ('AC-2025', 'Aftercare 2025', '2025-01-01', $1, $2, 0), ('AC-2026', 'Aftercare 2026', '2026-07-15', $1, $2, 25)", [standardMonths, clubMonths]);
  await client.query("INSERT INTO club_roster VALUES ('ines.kowalczyk@example.org', '2023-04-02'), ('tom.ashby@example.net', '2025-09-10')");
  for (const day of BANK_HOLIDAYS) await client.query("INSERT INTO bank_holidays VALUES ($1)", [day]);
  await client.query("INSERT INTO operator_account VALUES ($1, $2)", [OPERATOR_EMAIL, hashPassword(OPERATOR_PASSWORD)]);
  await client.query("INSERT INTO decided_counts VALUES (1, 0, 0, 0) ON CONFLICT DO NOTHING");
}
var schemaReady = false;
var schemaInFlight = null;
async function applySchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727001)");
    await client.query(SCHEMA);
    await seed(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
}
async function ensureSchema() {
  if (schemaReady) return;
  schemaInFlight ??= applySchema().then(() => {
    schemaReady = true;
  }).finally(() => {
    schemaInFlight = null;
  });
  try {
    await schemaInFlight;
  } catch (error) {
    throw asDatabaseError(error);
  }
}

// src/server/http.ts
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

// src/server/context.ts
var headerText = (value) => Array.isArray(value) ? value[0] : value;
var json = (status, body, headers) => ({ status, json: body, headers });

// src/server/parse.ts
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var asText = (value) => typeof value === "string" ? value : void 0;
function integerIn(value, low, high) {
  if (value === void 0 || value === null || typeof value === "string" && value.trim() === "") return "required";
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= low && parsed <= high ? parsed : "invalid";
}
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function poundsToMinor(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  const fixed = value.toFixed(2);
  return Number(fixed.replace(".", ""));
}
var minorToPounds = (minor) => Number((minor / 100).toFixed(2));

// src/server/clock.ts
var now = () => config.desk.clockFrozenAt ?? /* @__PURE__ */ new Date();
var today = () => londonDateOf(now());
var iso = (at) => at.toISOString().replace(/\.\d{3}Z$/, "Z");
var MINUTE = 6e4;
function londonOffsetMinutes(utcMs) {
  const p = londonParts(new Date(utcMs));
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((localAsUtc - Math.floor(utcMs / 1e3) * 1e3) / MINUTE);
}
function londonLocalInstant(ymd, hour, minute) {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  for (const offset of [60, 0]) {
    const utc = naive - offset * MINUTE;
    if (londonOffsetMinutes(utc) === offset) return new Date(utc);
  }
  let probe = naive - 60 * MINUTE;
  while (londonOffsetMinutes(probe) !== 60) probe += MINUTE;
  return new Date(probe);
}
var londonStartOfDay = (ymd) => londonLocalInstant(ymd, 0, 0);
var daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
var toYmd = (year, month, day) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
function addCalendarMonths(ymd, months) {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  if (d <= daysInMonth(year, month)) return toYmd(year, month, d);
  return month === 12 ? toYmd(year + 1, 1, 1) : toYmd(year, month + 1, 1);
}
function addDays(ymd, days) {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return toYmd(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}
function isWeekday(ymd) {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}
function isValidCalendarDate(text2) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text2);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

// src/server/ratelimit.ts
var WINDOW_MS = 6e4;
async function refuseAfterRate(caller) {
  const limit = config.desk.partsRatePerMinute;
  const at = now();
  return transaction(async (db) => {
    await rows(db, "SELECT pg_advisory_xact_lock(hashtext($1))", [caller]);
    await rows(db, "DELETE FROM rate_hits WHERE caller = $1 AND at <= $2", [caller, new Date(at.getTime() - WINDOW_MS)]);
    const window = await one(db, "SELECT count(*)::int AS n, min(at) AS oldest FROM rate_hits WHERE caller = $1", [caller]);
    if (limit === 0) return 60;
    if ((window?.n ?? 0) >= limit) {
      const oldest = window?.oldest ?? at;
      return Math.max(1, Math.ceil((oldest.getTime() + WINDOW_MS - at.getTime()) / 1e3));
    }
    await rows(db, "INSERT INTO rate_hits (caller, at) VALUES ($1, $2)", [caller, at]);
    return null;
  });
}

// src/server/session.ts
import { createHash, randomBytes as randomBytes2, scryptSync as scryptSync2, timingSafeEqual } from "node:crypto";
var SESSION_COOKIE = "desk_session";
var digest = (token) => createHash("sha256").update(token).digest("hex");
function sessionToken(ctx) {
  const cookie = headerText(ctx.headers["cookie"]);
  if (!cookie) return void 0;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return void 0;
}
async function hasLiveSession(db, token) {
  const found = await one(db, "SELECT 1 AS ok FROM operator_sessions WHERE token_hash = $1 AND expires_at > $2", [digest(token), now()]);
  return found !== null;
}
function passwordMatches(password, stored) {
  const [salt = "", hash = ""] = stored.split(":");
  const candidate = scryptSync2(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}
async function openSession(db, email, password) {
  const account = await one(db, "SELECT password_hash FROM operator_account WHERE lower(email) = lower($1)", [email]);
  if (!account || !passwordMatches(password, account.password_hash)) return fail("bad_credentials");
  const token = randomBytes2(32).toString("base64url");
  const at = now();
  await rows(db, "DELETE FROM operator_sessions WHERE expires_at <= $1", [at]);
  await rows(db, "INSERT INTO operator_sessions (token_hash, expires_at) VALUES ($1, $2)", [digest(token), new Date(at.getTime() + config.desk.operatorSessionSeconds * 1e3)]);
  return token;
}
async function closeSession(db, token) {
  await rows(db, "DELETE FROM operator_sessions WHERE token_hash = $1", [digest(token)]);
}
function sessionCookie(token) {
  const maxAge = config.desk.operatorSessionSeconds;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${maxAge > 0 ? `; Max-Age=${maxAge}` : ""}`;
}
var clearedSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

// src/server/rules.ts
import { randomInt } from "node:crypto";

// src/shared/state-machine.ts
var ANY_LIVE = ["started", "confirmed", "identified", "quoted", "declined", "dispatched", "closed"];
var TRANSITIONS = {
  confirm: { from: ["started"], to: "confirmed" },
  identify: { from: ["confirmed"], to: "identified" },
  quote: { from: ["identified", "quoted"], to: "quoted" },
  payment: { from: ["quoted"], to: null },
  decline: { from: ["quoted"], to: "declined" },
  dispatch: { from: ["quoted"], to: "dispatched" },
  close: { from: ["declined", "dispatched"], to: "closed" },
  share_link: { from: ["confirmed", "identified", "quoted", "declined", "dispatched"], to: null },
  erase: { from: ANY_LIVE, to: "erased" }
};
function refusalOf(action, state, paid) {
  if (!TRANSITIONS[action].from.includes(state)) return "wrong_state";
  if ((action === "quote" || action === "payment") && paid) return "already_paid";
  if (action === "dispatch" && !paid) return "not_paid";
  return null;
}
var nextState = (action, state) => TRANSITIONS[action].to ?? state;

// src/server/rules.ts
var BOOKLET_RANGE = [1, 99];
var QUANTITY_RANGE = [1, 20];
var REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
var REFERENCE_PATTERN = new RegExp(`^HG-[${REFERENCE_ALPHABET}]{6}$`);
function normaliseReference(text2) {
  if (typeof text2 !== "string") return null;
  const upper = text2.toUpperCase();
  return REFERENCE_PATTERN.test(upper) ? upper : null;
}
function newReference() {
  let tail = "";
  for (let i = 0; i < 6; i++) tail += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `HG-${tail}`;
}
function applyAction(action, current, paid = false) {
  const refusal = refusalOf(action, current, paid);
  if (refusal === "wrong_state") return fail("wrong_state", { state: current });
  if (refusal) return fail(refusal);
  return nextState(action, current);
}
function linkState(state, confirmBy, at) {
  if (state !== "started") return "used";
  return isBefore(at, confirmBy) ? "live" : "lapsed";
}
function decidingEdition(editions2, confirmedAt) {
  const day = londonDateOf(confirmedAt);
  const inForce = editions2.filter((edition2) => edition2.starts_on <= day).sort((a, b) => a.starts_on < b.starts_on ? 1 : -1);
  const edition = inForce[0];
  if (!edition) throw new Error("no aftercare edition is in force");
  return edition;
}
function makeRuling(input) {
  const { edition, confirmedAt } = input;
  if (input.termSecondsOverride !== null) {
    const coverEndsAt2 = new Date(input.startedAt.getTime() + input.termSecondsOverride * 1e3);
    return {
      inside: isBefore(confirmedAt, coverEndsAt2),
      edition: edition.code,
      coverEndsAt: coverEndsAt2,
      coverEndsOn: londonDateOf(coverEndsAt2),
      termMonths: null
    };
  }
  const termMonths = input.clubMember ? edition.club_months : edition.standard_months;
  const coverEndsOn = addCalendarMonths(input.purchaseDate, termMonths);
  const coverEndsAt = londonStartOfDay(coverEndsOn);
  return { inside: isBefore(confirmedAt, coverEndsAt), edition: edition.code, coverEndsAt, coverEndsOn, termMonths };
}
var isBefore = (instant, closing) => instant.getTime() < closing.getTime();
function partLineMinor(unitPriceMinor, quantity, percent) {
  return Math.floor((unitPriceMinor * quantity * percent + 50) / 100);
}
var isWorkingDay = (ymd, holidays) => isWeekday(ymd) && !holidays.has(ymd);
function workingDaysAfter(ymd, count, holidays) {
  let day = ymd;
  for (let counted = 0; counted < count; ) {
    day = addDays(day, 1);
    if (isWorkingDay(day, holidays)) counted += 1;
  }
  return day;
}
function dispatchPromise(input) {
  const day = londonDateOf(input.quotedAt);
  const [hour = 0, minute = 0] = input.cutoffLocal.split(":").map(Number);
  const cutoff = londonLocalInstant(day, hour, minute);
  if (input.source === "bin" && isWorkingDay(day, input.holidays) && isBefore(input.quotedAt, cutoff)) {
    return { kind: "same_day", date: day };
  }
  return { kind: "later", date: workingDaysAfter(day, input.source === "bin" ? 1 : 3, input.holidays) };
}
var PHOTO_CAP_BYTES = 8e6;
var SIGNATURES = [
  { type: "image/jpeg", matches: (b) => b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255 },
  {
    type: "image/png",
    matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  },
  {
    type: "image/webp",
    matches: (b) => b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"
  }
];
function judgePhoto(bytes) {
  const found = SIGNATURES.find((signature) => signature.matches(bytes));
  if (!found) return { ok: false, code: "not_a_photo" };
  if (bytes.length > PHOTO_CAP_BYTES) return { ok: false, code: "too_large" };
  return { ok: true, contentType: found.type };
}
var UK_POSTCODE = /^([A-Z]{1,2})(\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
function postcodeArea(postcode) {
  const match = UK_POSTCODE.exec(postcode.trim());
  return match?.[1] ? match[1].toUpperCase() : null;
}
function idempotencyKeyProblem(key) {
  if (key === void 0 || key === "") return "required";
  if (key.length > 64 || !/^[!-~]+$/.test(key)) return "invalid";
  return null;
}

// src/server/carrier.ts
var CARRIER_WAIT_MS = 4e3;
function readAnswer(raw) {
  const body = parseJson(raw);
  if (!isObject(body)) return fail("carrier_malformed");
  const { band, charge_minor: charge, currency, valid_until: validUntil } = body;
  if (typeof band !== "string" || !/^[A-Z0-9]{1,4}$/.test(band)) return fail("carrier_malformed");
  if (typeof charge !== "number" || !Number.isInteger(charge) || charge < 0) return fail("carrier_malformed");
  if (currency !== "GBP") return fail("carrier_malformed");
  if (typeof validUntil !== "string") return fail("carrier_malformed");
  const until = new Date(validUntil);
  if (Number.isNaN(until.getTime()) || !isBefore(now(), until)) return fail("carrier_malformed");
  return { band, charge_minor: charge, currency: "GBP", valid_until: iso(until) };
}
async function carriageQuote(request) {
  const query = new URLSearchParams({ weight_g: String(request.weightG), longest_side_mm: String(request.longestSideMm), postcode_area: request.postcodeArea });
  let status;
  let raw;
  try {
    const response = await fetch(`${config.carrierUrl}/v1/carriage/quote?${query.toString()}`, { signal: AbortSignal.timeout(CARRIER_WAIT_MS) });
    status = response.status;
    raw = await response.text();
  } catch (error) {
    return fail(error instanceof Error && error.name === "TimeoutError" ? "carrier_timeout" : "carrier_unavailable");
  }
  if (status !== 200) return fail("carrier_unavailable");
  return readAnswer(raw);
}

// src/server/claims.ts
import { randomBytes as randomBytes3 } from "node:crypto";
var liveOf = (row) => row;
var isoOrNull = (at) => at ? iso(at) : null;
var newToken = () => randomBytes3(32).toString("base64url");
async function findClaim(db, reference, who, options = {}) {
  const normal = normaliseReference(reference);
  if (!normal) return unknownClaim(options.unknown);
  const row = await one(db, `SELECT * FROM claims WHERE reference = $1${options.lock ? " FOR UPDATE" : ""}`, [normal]);
  if (!row || who === "owner" && row.state === "erased") return unknownClaim(options.unknown);
  return row;
}
function requireSameReference(body, claim, unknown = "not_found") {
  if (!isObject(body) || !("reference" in body)) return;
  if (normaliseReference(body["reference"]) !== claim.reference) unknownClaim(unknown);
}
async function isClubMember(db, email, purchaseDate) {
  const found = await one(db, "SELECT EXISTS (SELECT 1 FROM club_roster WHERE lower(email) = lower($1) AND joined_on < $2) AS member", [email, purchaseDate]);
  return found?.member ?? false;
}
async function recordState(db, claim, state, at) {
  await rows(db, "UPDATE claims SET state = $2 WHERE reference = $1", [claim.reference, state]);
  await addHistory(db, claim.reference, state, at);
}
async function addHistory(db, reference, state, at) {
  await rows(
    db,
    "INSERT INTO claim_history (claim_reference, seq, state, at) VALUES ($1, COALESCE((SELECT max(seq) + 1 FROM claim_history WHERE claim_reference = $1), 1), $2, $3)",
    [reference, state, at]
  );
}
var partOf = (db, modelSlug, booklet) => one(db, "SELECT * FROM parts WHERE model_slug = $1 AND booklet_number = $2", [modelSlug, booklet]);
async function holidaySet(db) {
  const found = await rows(db, "SELECT day FROM bank_holidays");
  return new Set(found.map((row) => row.day));
}
async function issueShareToken(db, reference, at) {
  const token = newToken();
  await rows(db, "INSERT INTO share_tokens (token, claim_reference, state, created_at) VALUES ($1, $2, 'active', $3)", [token, reference, at]);
  return token;
}
async function activeShareToken(db, reference) {
  const found = await one(db, "SELECT token FROM share_tokens WHERE claim_reference = $1 AND state = 'active' ORDER BY created_at DESC LIMIT 1", [reference]);
  return found?.token ?? null;
}
async function withdrawShareTokens(db, reference) {
  await rows(db, "UPDATE share_tokens SET state = 'withdrawn' WHERE claim_reference = $1 AND state = 'active'", [reference]);
}
var quoteView = (row) => ({
  revision: row.revision,
  status: row.status,
  source: row.source,
  part_line_minor: row.part_line_minor,
  carriage_minor: row.carriage_minor,
  total_minor: row.total_minor,
  band: row.band,
  carriage_valid_until: iso(row.carriage_valid_until),
  promise: { kind: row.promise_kind, date: row.promise_date },
  quoted_at: iso(row.quoted_at)
});
async function quotesOf(db, reference) {
  return rows(db, "SELECT * FROM quote_revisions WHERE claim_reference = $1 ORDER BY revision DESC", [reference]);
}
async function currentQuote(db, reference) {
  return (await quotesOf(db, reference)).find((quote2) => quote2.status === "current");
}
var billingAccountOf = (claim) => claim.billing_account;
async function opsView(db, row) {
  if (row.state === "erased") {
    const erased = { reference: row.reference, state: "erased", erased_at: iso(row.erased_at) };
    return erased;
  }
  const claim = liveOf(row);
  const [model, part, photos, quotes, token, pending, club] = await Promise.all([
    one(db, "SELECT slug, name FROM models WHERE slug = $1", [claim.model_slug]),
    partOf(db, claim.model_slug, claim.booklet_number),
    rows(db, "SELECT idx, content_type, bytes FROM claim_photos WHERE claim_reference = $1 ORDER BY idx", [claim.reference]),
    quotesOf(db, claim.reference),
    one(db, "SELECT token, state FROM share_tokens WHERE claim_reference = $1 ORDER BY (state = 'active') DESC, created_at DESC LIMIT 1", [claim.reference]),
    one(db, "SELECT count(*)::int AS n FROM notice_queue WHERE claim_reference = $1", [claim.reference]),
    isClubMember(db, claim.email, claim.purchase_date)
  ]);
  const catalogued = { model, part };
  const partView = {
    booklet_number: catalogued.part.booklet_number,
    part_number: catalogued.part.part_number,
    name: catalogued.part.name,
    status: catalogued.part.status,
    bin_count: catalogued.part.bin_count
  };
  const shareLink = token ? { url: `/s/${token.token}`, state: claim.state === "closed" ? "ended" : token.state } : null;
  const view = {
    reference: claim.reference,
    state: claim.state,
    language: claim.language,
    owner: { name: claim.name, email: claim.email, postcode: claim.postcode },
    purchase_date: claim.purchase_date,
    club_member: club,
    model: catalogued.model,
    part: partView,
    quantity: claim.quantity,
    description: claim.description,
    photos: photos.map((photo) => ({ index: photo.idx, content_type: photo.content_type, bytes: photo.bytes })),
    started_at: iso(claim.started_at),
    confirm_by: iso(claim.confirm_by),
    confirmed_at: isoOrNull(claim.confirmed_at),
    ruling: rulingOf(claim),
    quotes: quotes.map(quoteView),
    payment: claim.paid_minor === null ? null : { paid_minor: claim.paid_minor, paid_at: iso(claim.paid_at) },
    decline: declineOf(claim),
    dispatched_at: isoOrNull(claim.dispatched_at),
    closed_at: isoOrNull(claim.closed_at),
    share_link: shareLink,
    notices_pending: pending?.n ?? 0
  };
  return view;
}
function rulingOf(claim) {
  if (claim.ruling_inside === null) return null;
  return {
    inside: claim.ruling_inside,
    edition: claim.ruling_edition,
    cover_ends_at: iso(claim.ruling_cover_ends_at),
    cover_ends_on: claim.ruling_cover_ends_on,
    term_months: claim.ruling_term_months,
    decided_at: iso(claim.ruling_decided_at)
  };
}
function declineOf(claim) {
  if (claim.decline_reason === null) return null;
  return { reason: claim.decline_reason, charged_minor: claim.decline_charged_minor, refunded_minor: claim.decline_refunded_minor };
}
async function shareView(db, row) {
  const claim = liveOf(row);
  const [model, part, quotes, history] = await Promise.all([
    one(db, "SELECT name FROM models WHERE slug = $1", [claim.model_slug]),
    partOf(db, claim.model_slug, claim.booklet_number),
    quotesOf(db, claim.reference),
    rows(db, "SELECT state, at FROM claim_history WHERE claim_reference = $1 ORDER BY seq", [claim.reference])
  ]);
  const current = quotes.find((quote2) => quote2.status === "current");
  const ruling = rulingOf(claim);
  const catalogued = part;
  return {
    reference: claim.reference,
    state: claim.state,
    language: claim.language,
    model: { name: model.name },
    part: { booklet_number: catalogued.booklet_number, part_number: catalogued.part_number, name: catalogued.name },
    quantity: claim.quantity,
    purchase_date: claim.purchase_date,
    ruling: ruling && { inside: ruling.inside, edition: ruling.edition, cover_ends_at: ruling.cover_ends_at, cover_ends_on: ruling.cover_ends_on },
    quote: current ? {
      revision: current.revision,
      part_line_minor: current.part_line_minor,
      carriage_minor: current.carriage_minor,
      total_minor: current.total_minor,
      band: current.band,
      promise: { kind: current.promise_kind, date: current.promise_date }
    } : null,
    paid_minor: claim.paid_minor,
    decline: declineOf(claim),
    dispatched_at: isoOrNull(claim.dispatched_at),
    history: history.map((entry) => ({ state: entry.state, at: iso(entry.at) }))
  };
}

// src/server/catalogue.ts
async function listModels(db) {
  const found = await rows(
    db,
    'SELECT m.slug, m.name, m.axis, m.retired_names, (SELECT count(*)::int FROM parts p WHERE p.model_slug = m.slug) AS part_count FROM models m ORDER BY m.slug COLLATE "C"'
  );
  return found.map((model) => ({ slug: model.slug, name: model.name, axis: model.axis, diagram: model.axis !== null, part_count: model.part_count }));
}
async function modelDetail(db, slug) {
  const model = await one(db, "SELECT slug, name, axis, retired_names FROM models WHERE slug = $1", [slug]);
  if (!model) return null;
  const parts = await rows(
    db,
    "SELECT booklet_number, part_number, name, longest_side_mm, status FROM parts WHERE model_slug = $1 ORDER BY booklet_number",
    [slug]
  );
  return { slug: model.slug, name: model.name, axis: model.axis, diagram: model.axis !== null, parts };
}
var SUPPLIER_CODE = /[\s/-]+[a-z]{2,4}\d{2,4}$/i;
var normaliseName = (name) => name.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
var supplierName = (name) => normaliseName(name.replace(SUPPLIER_CODE, ""));
function matchModel(models2, supplierModelName) {
  const wanted = supplierName(supplierModelName);
  const hits = models2.filter((model) => [model.name, ...model.retired_names].some((name) => normaliseName(name) === wanted));
  if (hits.length === 1 && hits[0]) return { kind: "matched", slug: hits[0].slug };
  return { kind: hits.length === 0 ? "unknown_model" : "ambiguous_model" };
}
var IMPORT_HEADER = "model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status";
function csvFields(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      fields.push(current);
      current = "";
    } else current += c;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}
var WHOLE = /^\d+$/;
function checkRow(fields, models2) {
  const [modelName = "", booklet = "", partNumber = "", name = "", price = "", weight = "", side = "", status = ""] = fields;
  if (fields.length < 8 || [modelName, booklet, partNumber, name, price, weight, side, status].some((field) => field === "")) return { ok: false, reason: "missing_field" };
  const match = matchModel(models2, modelName);
  if (match.kind !== "matched") return { ok: false, reason: match.kind };
  const bookletNumber = WHOLE.test(booklet) ? integerIn(booklet, ...BOOKLET_RANGE) : "invalid";
  if (typeof bookletNumber !== "number") return { ok: false, reason: "bad_booklet_number" };
  if (!/^(\d{6}|\d{8})$/.test(partNumber)) return { ok: false, reason: "bad_part_number" };
  const priceMatch = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price);
  const priceMinor = priceMatch ? Number(priceMatch[1]) * 100 + Number((priceMatch[2] ?? "").padEnd(2, "0")) : 0;
  if (priceMinor < 1) return { ok: false, reason: "bad_price" };
  if (!WHOLE.test(weight) || Number(weight) < 1) return { ok: false, reason: "bad_weight" };
  if (!WHOLE.test(side) || Number(side) < 1) return { ok: false, reason: "bad_size" };
  if (status !== "active" && status !== "withdrawn") return { ok: false, reason: "bad_status" };
  return { ok: true, row: { slug: match.slug, booklet: bookletNumber, partNumber, name, priceMinor, weightG: Number(weight), sideMm: Number(side), status } };
}
async function importSupplierFile(db, csv) {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0] !== IMPORT_HEADER) return null;
  const models2 = await rows(db, "SELECT slug, name, axis, retired_names FROM models");
  const report = { created: 0, updated: 0, unchanged: 0, unmatched: [] };
  const seen = /* @__PURE__ */ new Set();
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const checked = checkRow(csvFields(line), models2);
    const identity = checked.ok ? `${checked.row.slug}#${checked.row.booklet}` : "";
    if (!checked.ok || seen.has(identity)) {
      report.unmatched.push({ line: index + 1, reason: checked.ok ? "duplicate_row" : checked.reason });
      continue;
    }
    seen.add(identity);
    const { row } = checked;
    const existing = await one(
      db,
      "SELECT part_number, name, price_minor, weight_g, longest_side_mm, status FROM parts WHERE model_slug = $1 AND booklet_number = $2 FOR UPDATE",
      [row.slug, row.booklet]
    );
    if (!existing) {
      await rows(db, "INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g, longest_side_mm, status, bin_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)", [
        row.slug,
        row.booklet,
        row.partNumber,
        row.name,
        row.priceMinor,
        row.weightG,
        row.sideMm,
        row.status
      ]);
      report.created += 1;
    } else if (existing.part_number !== row.partNumber || existing.name !== row.name || existing.price_minor !== row.priceMinor || existing.weight_g !== row.weightG || existing.longest_side_mm !== row.sideMm || existing.status !== row.status) {
      await rows(db, "UPDATE parts SET part_number = $3, name = $4, price_minor = $5, weight_g = $6, longest_side_mm = $7, status = $8 WHERE model_slug = $1 AND booklet_number = $2", [
        row.slug,
        row.booklet,
        row.partNumber,
        row.name,
        row.priceMinor,
        row.weightG,
        row.sideMm,
        row.status
      ]);
      report.updated += 1;
    } else report.unchanged += 1;
  }
  return report;
}
function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.model, row.booklet_number, row.part_number])).toString("base64url");
}
function decodeCursor(text2) {
  try {
    const value = JSON.parse(Buffer.from(text2, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 3 && typeof value[0] === "string" && Number.isInteger(value[1]) && typeof value[2] === "string") {
      return [value[0], value[1], value[2]];
    }
  } catch {
    return null;
  }
  return null;
}
async function listParts(db, model, limit, after) {
  const found = await rows(
    db,
    `SELECT model_slug AS model, booklet_number, part_number, name, price_minor, status FROM parts
     WHERE ($1::text IS NULL OR model_slug = $1)
       AND ($2::text IS NULL OR (model_slug COLLATE "C", booklet_number, part_number COLLATE "C") > ($2::text COLLATE "C", $3::int, $4::text COLLATE "C"))
     ORDER BY model_slug COLLATE "C", booklet_number, part_number COLLATE "C" LIMIT $5`,
    [model, after?.[0] ?? null, after?.[1] ?? null, after?.[2] ?? null, limit + 1]
  );
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  return { parts: page, next: found.length > limit && last ? encodeCursor(last) : null };
}
function listEditions(db) {
  return rows(db, "SELECT code, title, starts_on, standard_months, club_months, owner_contribution_percent FROM editions ORDER BY starts_on");
}
function readEdition(body) {
  const input = isObject(body) ? body : {};
  const fields = {};
  const text2 = (name) => typeof input[name] === "string" ? input[name] : "";
  const code = text2("code");
  if (code === "") fields["code"] = "required";
  else if (!/^[A-Z0-9-]{3,20}$/.test(code)) fields["code"] = "invalid";
  const title = text2("title");
  if (title.trim() === "") fields["title"] = "required";
  else if ([...title].length > 80) fields["title"] = "too_long";
  const startsOn = text2("starts_on");
  if (startsOn === "") fields["starts_on"] = "required";
  else if (!isValidCalendarDate(startsOn)) fields["starts_on"] = "invalid";
  else if (startsOn <= today()) fields["starts_on"] = "must_be_future";
  const standard = integerIn(input["standard_months"], 1, 120);
  const club = integerIn(input["club_months"], 1, 120);
  const percent = integerIn(input["owner_contribution_percent"], 0, 100);
  if (typeof standard === "string") fields["standard_months"] = standard;
  if (typeof club === "string") fields["club_months"] = club;
  if (typeof percent === "string") fields["owner_contribution_percent"] = percent;
  if (Object.keys(fields).length > 0) return failFields(fields);
  return { code, title: title.trim(), starts_on: startsOn, standard_months: standard, club_months: club, owner_contribution_percent: percent };
}

// src/server/mailer.ts
import net from "node:net";
var CONNECT_TIMEOUT_MS = 3e3;
var COMMAND_TIMEOUT_MS = 5e3;
var addressOf = (header) => {
  const match = /<([^>]+)>/.exec(header);
  return (match?.[1] ?? header).trim();
};
var needsEncoding = (text2) => /[^\x20-\x7e]/.test(text2);
function encodeHeader(text2) {
  if (!needsEncoding(text2)) return text2;
  const chars = [...text2];
  const words = [];
  for (let i = 0; i < chars.length; i += 20) {
    words.push(`=?UTF-8?B?${Buffer.from(chars.slice(i, i + 20).join(""), "utf8").toString("base64")}?=`);
  }
  return words.join("\r\n ");
}
function wrapBase64(data) {
  return (data.match(/.{1,76}/g) ?? []).join("\r\n");
}
function composeMessage(to, subject, body) {
  return [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@holmgarth.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(body, "utf8").toString("base64")),
    ""
  ].join("\r\n");
}
function sendMail(to, subject, body) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.mail.smtpHost, port: config.mail.smtpPort });
    const refuse = () => {
      socket.destroy();
      reject(new Error("smtp"));
    };
    socket.setTimeout(COMMAND_TIMEOUT_MS, refuse);
    const connectTimer = setTimeout(refuse, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => clearTimeout(connectTimer));
    socket.on("error", () => {
      clearTimeout(connectTimer);
      refuse();
    });
    const steps = [
      { send: null, expect: "220" },
      { send: "EHLO fittings-desk", expect: "250" },
      { send: `MAIL FROM:<${addressOf(config.mail.from)}>`, expect: "250" },
      { send: `RCPT TO:<${addressOf(to)}>`, expect: "250" },
      { send: "DATA", expect: "354" },
      { send: `${composeMessage(to, subject, body).replace(/^\./gm, "..")}\r
.`, expect: "250" },
      { send: "QUIT", expect: "221" }
    ];
    let step = 0;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      const lines = buffer.split("\r\n");
      const last = lines[lines.length - 2];
      if (!buffer.endsWith("\r\n") || last === void 0 || /^\d{3}-/.test(last)) return;
      const code = last.slice(0, 3);
      buffer = "";
      const current = steps[step];
      if (!current || code !== current.expect) return refuse();
      step += 1;
      const next = steps[step];
      if (!next) {
        socket.end();
        resolve();
        return;
      }
      if (next.send !== null) socket.write(`${next.send}\r
`);
    });
  }).catch(() => fail("mail_unavailable"));
}
async function mailpit(path, init = {}) {
  try {
    const response = await fetch(`${config.mail.mailpitUrl}${path}`, { ...init, signal: AbortSignal.timeout(1e4) });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => void 0);
      return fail("mail_unavailable");
    }
    return response;
  } catch {
    return fail("mail_unavailable");
  }
}
async function messagesTo(address) {
  const wanted = address.toLowerCase();
  const ids = [];
  const query = encodeURIComponent(`to:"${address}"`);
  const response = await mailpit(`/api/v1/search?query=${query}&limit=500`);
  const payload = parseJson(await response.text());
  const messages = isObject(payload) && Array.isArray(payload["messages"]) ? payload["messages"] : [];
  for (const message of messages) {
    if (!isObject(message) || !Array.isArray(message["To"])) continue;
    const id = asText(message["ID"]);
    const recipients = message["To"].map((entry) => isObject(entry) ? (asText(entry["Address"]) ?? "").toLowerCase() : "");
    if (id && recipients.includes(wanted)) ids.push(id);
  }
  return ids;
}
async function deleteMessages(ids) {
  if (ids.length === 0) return;
  const response = await mailpit("/api/v1/messages", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: ids })
  });
  await response.arrayBuffer();
}

// src/server/notices.ts
var linkTo = (path) => `${config.appPublicUrl}${path}`;
var polish = (lang) => lang === "pl-PL";
function confirmationNotice(reference, lang, token, confirmBy) {
  return polish(lang) ? {
    subject: `Potwierd\u017A zg\u0142oszenie Holmgarth ${reference}`,
    body: `Otw\xF3rz ten link, aby potwierdzi\u0107 zg\u0142oszenie ${reference}:
${linkTo(`/confirm/${token}`)}

${lifetimeLine(iso(confirmBy), lang)}
`
  } : {
    subject: `Confirm your Holmgarth claim ${reference}`,
    body: `Open this link to confirm claim ${reference}:
${linkTo(`/confirm/${token}`)}

${lifetimeLine(iso(confirmBy), lang)}
`
  };
}
function quotedNotice(reference, lang, quote2, shareToken) {
  const figures = [partAmountLine(quote2.part_line_minor, lang), carriageLine(quote2.band, quote2.carriage_minor, lang), totalLine(quote2.total_minor, lang)].join("\n");
  const promise = promiseLine({ kind: quote2.promise_kind, date: quote2.promise_date }, lang);
  const link = linkTo(`/s/${shareToken}`);
  return polish(lang) ? { subject: `Wycena zg\u0142oszenia ${reference}: ${money(quote2.total_minor, lang)}`, body: `${figures}

${promise}

\u015Aled\u017A zg\u0142oszenie: ${link}
` } : { subject: `Quote for claim ${reference}: ${money(quote2.total_minor, lang)}`, body: `${figures}

${promise}

Follow your claim: ${link}
` };
}
function declinedNotice(reference, lang, refundedMinor, shareToken) {
  const link = linkTo(`/s/${shareToken}`);
  if (polish(lang)) {
    const outcome2 = refundedMinor > 0 ? `zwrot ${money(refundedMinor, lang)}` : "bez op\u0142at";
    return { subject: `Zg\u0142oszenie ${reference} odrzucone \u2014 ${outcome2}`, body: `Zg\u0142oszenie ${reference} zosta\u0142o odrzucone (${outcome2}).

\u015Aled\u017A zg\u0142oszenie: ${link}
` };
  }
  const outcome = refundedMinor > 0 ? `${money(refundedMinor, lang)} refunded` : "nothing charged";
  return { subject: `Claim ${reference} declined \u2014 ${outcome}`, body: `Claim ${reference} was declined (${outcome}).

Follow your claim: ${link}
` };
}
function dispatchedNotice(reference, lang, paidMinor, shareToken) {
  const link = linkTo(`/s/${shareToken}`);
  return polish(lang) ? { subject: `Cz\u0119\u015B\u0107 w drodze \u2014 zg\u0142oszenie ${reference}`, body: `Twoja cz\u0119\u015B\u0107 jest w drodze.
${paidLine(paidMinor, lang)}

\u015Aled\u017A zg\u0142oszenie: ${link}
` } : { subject: `Part on its way for claim ${reference}`, body: `Your part is on its way.
${paidLine(paidMinor, lang)}

Follow your claim: ${link}
` };
}
function closedNotice(reference, lang) {
  return polish(lang) ? { subject: `Zg\u0142oszenie ${reference} zosta\u0142o zamkni\u0119te`, body: `Zg\u0142oszenie ${reference} zosta\u0142o zamkni\u0119te.
` } : { subject: `Claim ${reference} is closed`, body: `Claim ${reference} is closed.
` };
}
function newLinkNotice(reference, lang, shareToken) {
  const link = linkTo(`/s/${shareToken}`);
  return polish(lang) ? { subject: `Nowy link do zg\u0142oszenia ${reference}`, body: `Oto nowy link do Twojego zg\u0142oszenia:
${link}
` } : { subject: `New link for claim ${reference}`, body: `Here is the new link to your claim:
${link}
` };
}
async function enqueueNotice(db, claim, notice) {
  await rows(db, "INSERT INTO notice_queue (claim_reference, recipient, subject, body, created_at) VALUES ($1, $2, $3, $4, $5)", [
    claim.reference,
    claim.email,
    notice.subject,
    notice.body,
    now()
  ]);
}
async function drainNotices() {
  for (; ; ) {
    const sent = await transaction(async (db) => {
      const next = await one(db, "SELECT id, recipient, subject, body FROM notice_queue ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!next) return false;
      await sendMail(next.recipient, next.subject, next.body);
      await rows(db, "DELETE FROM notice_queue WHERE id = $1", [next.id]);
      return true;
    });
    if (!sent) return;
  }
}
function startNoticeWorker() {
  setInterval(() => void drainNotices().catch(() => void 0), 1e4).unref();
}
async function deliverClaimNotices(db, reference) {
  const queued = await rows(db, "SELECT id, recipient, subject, body FROM notice_queue WHERE claim_reference = $1 ORDER BY id FOR UPDATE SKIP LOCKED", [reference]);
  for (const notice of queued) {
    try {
      await sendMail(notice.recipient, notice.subject, notice.body);
    } catch {
      return;
    }
    await rows(db, "DELETE FROM notice_queue WHERE id = $1", [notice.id]);
  }
}

// src/server/storage.ts
import { createHash as createHash2, createHmac } from "node:crypto";
var TIMEOUT_MS = 3e4;
var sha256 = (data) => createHash2("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
var encode = (text2) => encodeURIComponent(text2).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function target(key, query) {
  const base = new URL(config.s3.endpoint);
  const bucketPath = config.s3.forcePathStyle ? `/${config.s3.bucket}` : "";
  if (!config.s3.forcePathStyle) base.hostname = `${config.s3.bucket}.${base.hostname}`;
  const path = `${bucketPath}${key ? `/${key.split("/").map(encode).join("/")}` : "/"}`;
  const canonicalPath = path === "" ? "/" : path;
  const url = new URL(base.origin + canonicalPath);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return { url, canonicalPath };
}
async function signedRequest(method, key, query, body, contentType) {
  const { url, canonicalPath } = target(key, query);
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalQuery = [...url.searchParams.entries()].map(([k, v]) => [encode(k), encode(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical2 = [method, canonicalPath, canonicalQuery, names.map((n) => `${n}:${headers[n]}
`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical2)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(body) : void 0,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    return fail("storage_unavailable");
  }
}
async function expect(response, ...accepted) {
  if (!accepted.includes(response.status)) {
    await response.arrayBuffer().catch(() => void 0);
    return fail("storage_unavailable");
  }
  return response;
}
async function putObject(key, body, contentType) {
  const response = await expect(await signedRequest("PUT", key, {}, body, contentType), 200);
  await response.arrayBuffer();
}
async function getObject(key) {
  const response = await expect(await signedRequest("GET", key, {}, Buffer.alloc(0)), 200, 404);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}
async function deleteObject(key) {
  const response = await expect(await signedRequest("DELETE", key, {}, Buffer.alloc(0)), 204, 200, 404);
  await response.arrayBuffer();
}
async function listObjects(prefix) {
  const found = [];
  let token;
  do {
    const query = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const response = await expect(await signedRequest("GET", "", query, Buffer.alloc(0)), 200);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) found.push(unescapeXml(match[1] ?? ""));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] : void 0;
  } while (token);
  return found;
}
var unescapeXml = (text2) => text2.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
var photoKey = (reference, index) => `claims/${reference}/photos/${index}`;
var dispatchNoteKey = (reference) => `claims/${reference}/dispatch-note.html`;
var claimPrefix = (reference) => `claims/${reference}/`;
async function deleteClaimObjects(reference) {
  for (const key of await listObjects(claimPrefix(reference))) await deleteObject(key);
}

// src/server/routes-owner.ts
async function models() {
  return json(200, { models: await listModels(await database()) });
}
async function modelBySlug(ctx) {
  const detail = await modelDetail(await database(), ctx.params["slug"] ?? "");
  return detail ? json(200, detail) : unknownPartOrModel();
}
var PARTS_DEFAULT = 20;
var PARTS_MAX = 50;
async function partsList(ctx) {
  const fields = {};
  const rawLimit = ctx.query.get("limit");
  let limit = PARTS_DEFAULT;
  if (rawLimit !== null) {
    if (/^\d+$/.test(rawLimit) && Number(rawLimit) >= 1) limit = Math.min(Number(rawLimit), PARTS_MAX);
    else fields["limit"] = "invalid";
  }
  const rawCursor = ctx.query.get("cursor");
  const after = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && after === null) fields["cursor"] = "invalid";
  if (Object.keys(fields).length > 0) return failFields(fields);
  const page = await listParts(await database(), ctx.query.get("model"), limit, after);
  return json(200, { parts: page.parts, next_cursor: page.next });
}
async function carriageEstimate(ctx) {
  const db = await database();
  const model = ctx.query.get("model") ?? "";
  const partText = ctx.query.get("part");
  const booklet = integerIn(partText, ...BOOKLET_RANGE);
  let part = null;
  if (model !== "" && typeof booklet === "number") {
    part = await partOf(db, model, booklet);
    if (!part) return unknownPartOrModel();
    if (part.status === "withdrawn") return fail("part_withdrawn", { number: booklet });
  }
  const fields = {};
  if (model === "") fields["model"] = "required";
  if (typeof booklet === "string") fields["part"] = booklet;
  const quantity = integerIn(ctx.query.get("quantity"), ...QUANTITY_RANGE);
  if (typeof quantity === "string") fields["quantity"] = quantity;
  const postcode = ctx.query.get("postcode") ?? "";
  const area = postcodeArea(postcode);
  if (postcode === "") fields["postcode"] = "required";
  else if (area === null) fields["postcode"] = "invalid";
  if (Object.keys(fields).length > 0 || !part || typeof quantity !== "number" || area === null) return failFields(fields);
  const estimate = await carriageQuote({ weightG: part.weight_g * quantity, longestSideMm: part.longest_side_mm, postcodeArea: area });
  return json(200, estimate);
}
function parseMultipart(body, contentType) {
  const result = { fields: {}, files: [] };
  const boundaryText = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryText?.[1] ?? boundaryText?.[2];
  if (!boundary) return result;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length;
    if (body.subarray(headerStart, headerStart + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, headerStart);
    if (next === -1) break;
    const part = body.subarray(headerStart + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const headers = part.subarray(0, split).toString("utf8");
      const data = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      if (name === "photos" && filename !== void 0) result.files.push({ filename, data });
      else if (name !== void 0 && filename === void 0) result.fields[name] = data.toString("utf8");
    }
    start = next;
  }
  return result;
}
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateStart(form, hasPart) {
  const f = form.fields;
  const fields = {};
  const name = (f["name"] ?? "").trim();
  if (name === "") fields["name"] = "required";
  else if ([...name].length > 120) fields["name"] = "too_long";
  const email = (f["email"] ?? "").trim();
  if (email === "") fields["email"] = "required";
  else if (!EMAIL.test(email) || email.length > 254) fields["email"] = "invalid";
  const postcode = (f["postcode"] ?? "").trim();
  if (postcode === "") fields["postcode"] = "required";
  else if (postcodeArea(postcode) === null) fields["postcode"] = "invalid";
  const model = f["model"] ?? "";
  if (model === "") fields["model"] = "required";
  const booklet = integerIn(f["booklet_number"], ...BOOKLET_RANGE);
  if (typeof booklet === "string") fields["booklet_number"] = booklet;
  const quantity = integerIn(f["quantity"], ...QUANTITY_RANGE);
  if (typeof quantity === "string") fields["quantity"] = quantity;
  const purchaseDate = (f["purchase_date"] ?? "").trim();
  if (purchaseDate === "") fields["purchase_date"] = "required";
  else if (!isValidCalendarDate(purchaseDate)) fields["purchase_date"] = "invalid";
  else if (purchaseDate > today()) fields["purchase_date"] = "in_future";
  const description = f["description"] ?? "";
  if ([...description].length > 1e3) fields["description"] = "too_long";
  const language = f["language"];
  if (language !== "en-GB" && language !== "pl-PL") fields["language"] = "invalid";
  const photos = [];
  if (form.files.length < 1 || form.files.length > 4) fields["photos"] = "count";
  form.files.forEach((file, index) => {
    const verdict = judgePhoto(file.data);
    if (verdict.ok) photos.push({ data: file.data, contentType: verdict.contentType });
    else fields[`photos.${index + 1}`] = verdict.code;
  });
  if (Object.keys(fields).length > 0 || !hasPart || typeof booklet !== "number" || typeof quantity !== "number") return failFields(fields);
  return { name, email, postcode, model, booklet, quantity, purchaseDate, description, language, photos };
}
async function startClaim(ctx) {
  const form = parseMultipart(ctx.body, ctx.contentType);
  const db = await database();
  const model = form.fields["model"] ?? "";
  const booklet = integerIn(form.fields["booklet_number"], ...BOOKLET_RANGE);
  let hasPart = false;
  if (model !== "" && typeof booklet === "number") {
    const part = await partOf(db, model, booklet);
    if (!part) return unknownPartOrModel();
    if (part.status === "withdrawn") return fail("part_withdrawn", { number: booklet });
    hasPart = true;
  }
  const start = validateStart(form, hasPart);
  const startedAt = now();
  const confirmBy = new Date(startedAt.getTime() + config.desk.confirmLinkTtlSeconds * 1e3);
  const token = newToken();
  const reference = await transaction(async (tx) => {
    let created = "";
    for (; ; ) {
      created = newReference();
      const inserted = await rows(
        tx,
        `INSERT INTO claims (reference, state, language, name, email, postcode, purchase_date, model_slug, booklet_number, quantity, description, started_at, confirm_by, confirm_token)
         VALUES ($1, 'started', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (reference) DO NOTHING RETURNING reference`,
        [created, start.language, start.name, start.email, start.postcode, start.purchaseDate, start.model, start.booklet, start.quantity, start.description, startedAt, confirmBy, token]
      );
      if (inserted.length > 0) break;
    }
    await rows(tx, "INSERT INTO claim_history (claim_reference, seq, state, at) VALUES ($1, 1, 'started', $2)", [created, startedAt]);
    try {
      let index = 0;
      for (const photo of start.photos) {
        index += 1;
        await putObject(photoKey(created, index), photo.data, photo.contentType);
        await rows(tx, "INSERT INTO claim_photos (claim_reference, idx, content_type, bytes) VALUES ($1, $2, $3, $4)", [created, index, photo.contentType, photo.data.length]);
      }
      const notice = confirmationNotice(created, start.language, token, confirmBy);
      await sendMail(start.email, notice.subject, notice.body);
    } catch (error) {
      await deleteClaimObjects(created).catch(() => void 0);
      throw error;
    }
    return created;
  });
  return json(201, { reference, state: "started", confirm_by: iso(confirmBy) });
}
async function confirmationStatus(ctx) {
  const claim = await findClaim(await database(), ctx.params["reference"], "owner", { unknown: "claim_unknown" });
  const confirmBy = claim.confirm_by;
  return json(200, { reference: claim.reference, link_state: linkState(claim.state, confirmBy, now()), confirm_by: iso(confirmBy) });
}
async function confirmClaim(ctx) {
  const body = isObject(ctx.json) ? ctx.json : {};
  const token = typeof body["token"] === "string" ? body["token"] : "";
  const confirmed = await transaction(async (db) => {
    const claim = token === "" ? null : await one(db, "SELECT * FROM claims WHERE confirm_token = $1 FOR UPDATE", [token]);
    if (!claim) return "reference" in body || token !== "" ? fail("link_unknown") : failFields({ token: "required" });
    requireSameReference(body, claim, "link_unknown");
    const at = now();
    const link = linkState(claim.state, claim.confirm_by, at);
    if (link === "used") return fail("link_used");
    if (link === "lapsed") return fail("link_lapsed");
    const next = applyAction("confirm", claim.state);
    await rows(db, "UPDATE claims SET confirmed_at = $2 WHERE reference = $1", [claim.reference, at]);
    await recordState(db, claim, next, at);
    return { reference: claim.reference, share: await issueShareToken(db, claim.reference, at) };
  });
  return json(200, { reference: confirmed.reference, state: "confirmed", share_url: `/s/${confirmed.share}` });
}
var LOCK_AFTER = 5;
async function lookupClaim(ctx) {
  const body = isObject(ctx.json) ? ctx.json : {};
  const referenceText = typeof body["reference"] === "string" ? body["reference"] : "";
  const emailText = typeof body["email"] === "string" ? body["email"] : "";
  if (referenceText === "") return failFields({ reference: "required", ...emailText === "" ? { email: "required" } : {} });
  const outcome = await transaction(async (db) => {
    const claim = await findClaim(db, referenceText, "owner", { lock: true });
    const at = now();
    const attempt = await one(db, "SELECT wrong_count, locked_until FROM reference_attempts WHERE reference = $1", [claim.reference]);
    if (attempt?.locked_until && attempt.locked_until.getTime() > at.getTime()) {
      return fail("reference_locked", { retryAfter: Math.max(1, Math.ceil((attempt.locked_until.getTime() - at.getTime()) / 1e3)) });
    }
    if (emailText === "") return failFields({ email: "required" });
    if (claim.email.toLowerCase() !== emailText.toLowerCase()) {
      const wrong = (attempt?.wrong_count ?? 0) + 1;
      const locks = wrong >= LOCK_AFTER;
      await rows(
        db,
        `INSERT INTO reference_attempts (reference, wrong_count, locked_until) VALUES ($1, $2, $3)
         ON CONFLICT (reference) DO UPDATE SET wrong_count = $2, locked_until = $3`,
        [claim.reference, locks ? 0 : wrong, locks ? new Date(at.getTime() + config.desk.referenceLockSeconds * 1e3) : null]
      );
      return null;
    }
    await rows(db, "DELETE FROM reference_attempts WHERE reference = $1", [claim.reference]);
    return claim;
  });
  if (!outcome) return fail("not_found");
  if (outcome.state === "started") return fail("wrong_state", { state: "started" });
  if (outcome.state === "closed") return fail("claim_closed");
  const token = await activeShareToken(await database(), outcome.reference);
  return token ? json(200, { share_url: `/s/${token}` }) : fail("link_withdrawn");
}
async function shareClaim(ctx) {
  const db = await database();
  const found = await one(db, "SELECT state, claim_reference FROM share_tokens WHERE token = $1", [ctx.params["token"] ?? ""]);
  if (!found) return fail("share_unknown");
  if (found.state === "withdrawn") return fail("link_withdrawn");
  const claim = await findClaim(db, found.claim_reference, "owner", { unknown: "share_unknown" });
  if (claim.state === "closed") return fail("claim_closed");
  return json(200, await shareView(db, claim));
}
var ownerRoutes = [
  { method: "GET", template: "/api/models", body: "none", auth: "public", handler: models },
  { method: "GET", template: "/api/models/:slug", body: "none", auth: "public", handler: modelBySlug },
  { method: "GET", template: "/api/parts", body: "none", auth: "public", limited: true, handler: partsList },
  { method: "GET", template: "/api/carriage-estimate", body: "none", auth: "public", handler: carriageEstimate },
  { method: "POST", template: "/api/claims", body: "multipart", auth: "public", handler: startClaim },
  { method: "GET", template: "/api/claims/:reference/confirmation", body: "none", auth: "public", handler: confirmationStatus },
  { method: "POST", template: "/api/claims/confirm", body: "json", auth: "public", handler: confirmClaim },
  { method: "POST", template: "/api/claims/lookup", body: "json", auth: "public", handler: lookupClaim },
  { method: "*", template: "/api/share/:token", body: "none", auth: "public", handler: shareClaim }
];

// src/server/routes-ops.ts
import { createHash as createHash3 } from "node:crypto";

// src/server/billing.ts
var TIMEOUT_MS2 = 15e3;
async function call(method, path, body) {
  const headers = {
    authorization: `Basic ${Buffer.from(`${config.killBill.username}:${config.killBill.password}`).toString("base64")}`,
    "x-killbill-apikey": config.killBill.apiKey,
    "x-killbill-apisecret": config.killBill.apiSecret,
    "x-killbill-createdby": "fittings-desk",
    accept: "application/json"
  };
  if (body !== void 0) headers["content-type"] = "application/json";
  try {
    const response = await fetch(`${config.killBill.url}/1.0/kb${path}`, {
      method,
      headers,
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS2)
    });
    const text2 = await response.text();
    return { status: response.status, body: text2 === "" ? void 0 : parseJson(text2) };
  } catch {
    return fail("billing_unavailable");
  }
}
function succeeded(answer2) {
  return answer2.status >= 200 && answer2.status < 300 ? answer2 : fail("billing_unavailable");
}
var objectOf = (value) => isObject(value) ? value : fail("billing_unavailable");
var listOf = (value) => Array.isArray(value) ? value : [];
function readInvoice(value) {
  const invoice = objectOf(value);
  const amountMinor = poundsToMinor(invoice["amount"]);
  const balanceMinor = poundsToMinor(invoice["balance"]);
  const invoiceId = asText(invoice["invoiceId"]);
  if (amountMinor === void 0 || balanceMinor === void 0 || invoiceId === void 0) return fail("billing_unavailable");
  return {
    invoiceId,
    amountMinor,
    balanceMinor,
    items: listOf(invoice["items"]).map((item) => {
      const entry = objectOf(item);
      return { description: asText(entry["description"]) ?? "", amountMinor: poundsToMinor(entry["amount"]) ?? fail("billing_unavailable") };
    })
  };
}
function readPayments(value) {
  return listOf(value).map((payment2) => {
    const entry = objectOf(payment2);
    return {
      paymentId: asText(entry["paymentId"]) ?? fail("billing_unavailable"),
      transactions: listOf(entry["transactions"]).map((transaction2) => {
        const tx = objectOf(transaction2);
        return {
          type: asText(tx["transactionType"]) ?? "",
          status: asText(tx["status"]) ?? "",
          amountMinor: poundsToMinor(tx["amount"]) ?? fail("billing_unavailable")
        };
      })
    };
  });
}
var accountLookup = (reference) => `/accounts?externalKey=${encodeURIComponent(reference)}`;
async function ensureAccount(reference) {
  const found = await call("GET", accountLookup(reference));
  if (found.status === 200) return asText(objectOf(found.body)["accountId"]) ?? fail("billing_unavailable");
  if (found.status !== 404) return fail("billing_unavailable");
  succeeded(await call("POST", "/accounts", { name: reference, externalKey: reference, currency: "GBP" }));
  const created = succeeded(await call("GET", accountLookup(reference)));
  return asText(objectOf(created.body)["accountId"]) ?? fail("billing_unavailable");
}
async function readInvoiceById(invoiceId) {
  return readInvoice(succeeded(await call("GET", `/invoices/${invoiceId}?withItems=true`)).body);
}
async function createInvoice(accountId, charges) {
  const item = (description, minor) => ({ accountId, description, amount: minorToPounds(minor), currency: "GBP" });
  const created = succeeded(await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, [item(charges.partDescription, charges.partMinor), item(charges.carriageDescription, charges.carriageMinor)]));
  const invoiceId = asText(objectOf(listOf(created.body)[0])["invoiceId"]) ?? fail("billing_unavailable");
  return readInvoiceById(invoiceId);
}
async function voidInvoice(invoiceId) {
  succeeded(await call("PUT", `/invoices/${invoiceId}/voidInvoice`));
}
async function accountPayments(accountId) {
  return readPayments(succeeded(await call("GET", `/accounts/${accountId}/payments`)).body);
}
async function accountBalance(accountId) {
  const account = objectOf(succeeded(await call("GET", `/accounts/${accountId}?accountWithBalance=true`)).body);
  return poundsToMinor(account["accountBalance"]) ?? fail("billing_unavailable");
}
function successfulTransaction(payments, type) {
  for (const payment2 of payments) {
    const transaction2 = payment2.transactions.find((tx) => tx.type === type && tx.status === "SUCCESS");
    if (transaction2) return { paymentId: payment2.paymentId, transaction: transaction2 };
  }
  return fail("billing_unavailable");
}
async function recordExternalPayment(accountId, invoiceId, balanceMinor) {
  succeeded(await call("POST", `/invoices/${invoiceId}/payments?externalPayment=true`, { accountId, purchasedAmount: minorToPounds(balanceMinor) }));
  return successfulTransaction(await accountPayments(accountId), "PURCHASE").transaction.amountMinor;
}
async function refundWholePayment(accountId, paymentId, amountMinor) {
  succeeded(await call("POST", `/payments/${paymentId}/refunds`, { amount: minorToPounds(amountMinor) }));
  return successfulTransaction(await accountPayments(accountId), "REFUND").transaction.amountMinor;
}

// src/server/dispatch-note.ts
var escapeHtml = (text2) => text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function renderDispatchNote(note) {
  const lines = [
    `Claim ${note.reference}`,
    partLine(note.bookletNumber, note.partName, "en-GB"),
    partNumberLine(note.partNumber, "en-GB"),
    partAmountLine(note.partLineMinor, "en-GB"),
    carriageLine(note.carriageBand, note.carriageMinor, "en-GB"),
    totalLine(note.totalMinor, "en-GB"),
    paidLine(note.paidMinor, "en-GB"),
    `Quantity ${note.quantity}`
  ];
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Dispatch note ${escapeHtml(note.reference)}</title>
<style>body{font-family:"IBM Plex Sans",system-ui,sans-serif;color:#101a33;background:#f5eedd;max-width:36rem;margin:2rem auto;padding:0 1rem}h1{font-family:"Space Grotesk",system-ui,sans-serif}p{margin:.4rem 0;border-bottom:1px solid #b9ae9a;padding-bottom:.4rem}</style>
</head>
<body>
<h1>Dispatch note</h1>
${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
</body>
</html>
`;
  return Buffer.from(html, "utf8");
}

// src/server/routes-ops.ts
async function signIn(ctx) {
  const body = isObject(ctx.json) ? ctx.json : {};
  const email = asText(body["email"]) ?? "";
  const password = asText(body["password"]) ?? "";
  const fields = {};
  if (email === "") fields["email"] = "required";
  if (password === "") fields["password"] = "required";
  if (Object.keys(fields).length > 0) return failFields(fields);
  const token = await openSession(await database(), email, password);
  return { status: 204, headers: { "set-cookie": sessionCookie(token) } };
}
async function signOut(ctx) {
  const token = sessionToken(ctx);
  if (token) await closeSession(await database(), token);
  return { status: 204, headers: { "set-cookie": clearedSessionCookie() } };
}
async function listClaims(ctx) {
  const found = await rows(
    await database(),
    `SELECT reference, state, model_slug AS model, confirmed_at FROM claims WHERE ($1::text IS NULL OR state = $1)
     ORDER BY confirmed_at DESC NULLS LAST, started_at DESC NULLS LAST, reference`,
    [ctx.query.get("state")]
  );
  return json(200, { claims: found.map((row) => ({ ...row, confirmed_at: row.confirmed_at ? iso(row.confirmed_at) : null })) });
}
async function viewClaim(ctx) {
  const db = await database();
  return json(200, await opsView(db, await findClaim(db, ctx.params["reference"], "operator")));
}
async function claimPhoto(ctx) {
  const db = await database();
  const claim = await findClaim(db, ctx.params["reference"], "operator");
  const index = /^\d+$/.test(ctx.params["index"] ?? "") ? Number(ctx.params["index"]) : 0;
  const photo = await one(db, "SELECT content_type FROM claim_photos WHERE claim_reference = $1 AND idx = $2", [claim.reference, index]);
  if (!photo) return unknownClaim();
  const stored = await getObject(photoKey(claim.reference, index));
  if (!stored) return unknownClaim();
  return { status: 200, raw: stored.body, contentType: photo.content_type, headers: { "x-content-type-options": "nosniff" } };
}
async function dispatchNote(ctx) {
  const claim = await findClaim(await database(), ctx.params["reference"], "operator");
  const stored = await getObject(dispatchNoteKey(claim.reference));
  if (!stored) return unknownClaim();
  return { status: 200, raw: stored.body, contentType: "text/html; charset=utf-8" };
}
async function stats() {
  const counts = await one(await database(), "SELECT decided, inside, outside FROM decided_counts WHERE id = 1");
  return json(200, { decided_claims: counts?.decided ?? 0, decided_inside: counts?.inside ?? 0, decided_outside: counts?.outside ?? 0 });
}
var bodyOf = (ctx) => isObject(ctx.json) ? ctx.json : {};
async function onClaim(ctx, work) {
  return transaction(async (db) => {
    const claim = await findClaim(db, ctx.params["reference"], "operator", { lock: true });
    requireSameReference(ctx.json, claim);
    return work(db, claim, now());
  });
}
async function answer(db, reference) {
  await deliverClaimNotices(db, reference);
  return json(200, await opsView(db, await findClaim(db, reference, "operator")));
}
var canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value).filter((key) => key !== "reference").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};
async function startKeyed(db, ctx, claim, action) {
  const key = headerText(ctx.headers["idempotency-key"]);
  const fingerprint = createHash3("sha256").update(`${action}
${canonical(ctx.json)}`).digest("hex");
  if (idempotencyKeyProblem(key) === null) {
    const stored = await one(
      db,
      "SELECT action, fingerprint, response FROM idempotency_records WHERE claim_reference = $1 AND key = $2",
      [claim.reference, key]
    );
    if (stored) {
      if (stored.action !== action || stored.fingerprint !== fingerprint) return fail("idempotency_conflict");
      return { key, fingerprint, replay: json(200, stored.response) };
    }
  }
  return { key, fingerprint, replay: null };
}
var keyFields = (keyed) => {
  const problem = idempotencyKeyProblem(keyed.key);
  return problem ? { idempotency_key: problem } : {};
};
async function finishKeyed(db, claim, keyed, action, reply, at) {
  await rows(db, "INSERT INTO idempotency_records (claim_reference, key, action, fingerprint, response, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    claim.reference,
    keyed.key,
    action,
    keyed.fingerprint,
    JSON.stringify(reply.json),
    at
  ]);
  return reply;
}
async function identify(ctx) {
  return onClaim(ctx, async (db, claim, at) => {
    const body = bodyOf(ctx);
    const modelSlug = asText(body["model"]) ?? "";
    const booklet = integerIn(body["booklet_number"], ...BOOKLET_RANGE);
    const quantity = integerIn(body["quantity"], ...QUANTITY_RANGE);
    const part = modelSlug !== "" && typeof booklet === "number" ? await partOf(db, modelSlug, booklet) ?? unknownPartOrModel() : null;
    const next = applyAction("identify", claim.state);
    if (part?.status === "withdrawn") return fail("part_withdrawn", { number: part.booklet_number });
    const fields = {};
    if (modelSlug === "") fields["model"] = "required";
    if (typeof booklet === "string") fields["booklet_number"] = booklet;
    if (typeof quantity === "string") fields["quantity"] = quantity;
    if (Object.keys(fields).length > 0 || !part || typeof quantity !== "number") return failFields(fields);
    const owner = liveOf(claim);
    const confirmedAt = claim.confirmed_at;
    const ruling = makeRuling({
      purchaseDate: owner.purchase_date,
      startedAt: owner.started_at,
      confirmedAt,
      clubMember: await isClubMember(db, owner.email, owner.purchase_date),
      edition: decidingEdition(await listEditions(db), confirmedAt),
      termSecondsOverride: config.desk.termSecondsOverride
    });
    await rows(
      db,
      `UPDATE claims SET model_slug = $2, booklet_number = $3, quantity = $4, ruling_inside = $5, ruling_edition = $6,
         ruling_cover_ends_at = $7, ruling_cover_ends_on = $8, ruling_term_months = $9, ruling_decided_at = $10 WHERE reference = $1`,
      [claim.reference, modelSlug, part.booklet_number, quantity, ruling.inside, ruling.edition, ruling.coverEndsAt, ruling.coverEndsOn, ruling.termMonths, at]
    );
    await recordState(db, claim, next, at);
    await rows(db, "UPDATE decided_counts SET decided = decided + 1, inside = inside + $1, outside = outside + $2 WHERE id = 1", [ruling.inside ? 1 : 0, ruling.inside ? 0 : 1]);
    return answer(db, claim.reference);
  });
}
var lockPart = (db, claim) => one(db, "SELECT * FROM parts WHERE model_slug = $1 AND booklet_number = $2 FOR UPDATE", [claim.model_slug, claim.booklet_number]);
function figuresFromInvoice(invoice) {
  const part = invoice.items.find((item) => item.description.startsWith("Part "));
  const carriage = invoice.items.find((item) => item.description.startsWith("Carriage band "));
  if (!part || !carriage) return fail("billing_unavailable");
  return { partLineMinor: part.amountMinor, carriageMinor: carriage.amountMinor, totalMinor: invoice.amountMinor };
}
async function returnToBin(db, claim, revision) {
  if (revision.source !== "bin" || revision.bin_returned) return;
  await rows(db, "UPDATE parts SET bin_count = bin_count + $3 WHERE model_slug = $1 AND booklet_number = $2", [claim.model_slug, claim.booklet_number, revision.quantity]);
  await rows(db, "UPDATE quote_revisions SET bin_returned = true WHERE claim_reference = $1 AND revision = $2", [claim.reference, revision.revision]);
}
async function quote(ctx) {
  return onClaim(ctx, async (db, row, at) => {
    const keyed = await startKeyed(db, ctx, row, "quote");
    if (keyed.replay) return keyed.replay;
    const next = applyAction("quote", row.state, row.paid_minor !== null);
    const claim = liveOf(row);
    const part = await lockPart(db, claim);
    if (part.status === "withdrawn") return fail("part_withdrawn", { number: part.booklet_number });
    if (Object.keys(keyFields(keyed)).length > 0) return failFields(keyFields(keyed));
    const estimate = await carriageQuote({
      weightG: part.weight_g * claim.quantity,
      longestSideMm: part.longest_side_mm,
      postcodeArea: postcodeArea(claim.postcode)
    });
    const accountId = claim.billing_account ?? await ensureAccount(claim.reference);
    const previous = (await quotesOf(db, claim.reference)).find((revision2) => revision2.status === "current");
    const binAfterReturn = part.bin_count + (previous && previous.source === "bin" && !previous.bin_returned ? previous.quantity : 0);
    const source = binAfterReturn >= claim.quantity ? "bin" : "supplier";
    const edition = await one(db, "SELECT owner_contribution_percent FROM editions WHERE code = $1", [claim.ruling_edition]);
    const percent = claim.ruling_inside ? edition.owner_contribution_percent : 100;
    const invoice = await createInvoice(accountId, {
      partDescription: `Part ${part.part_number} \xD7 ${claim.quantity}`,
      partMinor: partLineMinor(part.price_minor, claim.quantity, percent),
      carriageDescription: `Carriage band ${estimate.band}`,
      carriageMinor: estimate.charge_minor
    });
    const billed = figuresFromInvoice(invoice);
    if (previous) {
      try {
        await voidInvoice(previous.billing_invoice);
      } catch (error) {
        await voidInvoice(invoice.invoiceId).catch(() => void 0);
        throw error;
      }
      await rows(db, "UPDATE quote_revisions SET status = 'void' WHERE claim_reference = $1 AND revision = $2", [claim.reference, previous.revision]);
      await returnToBin(db, claim, previous);
    }
    if (source === "bin") await rows(db, "UPDATE parts SET bin_count = bin_count - $3 WHERE model_slug = $1 AND booklet_number = $2", [claim.model_slug, claim.booklet_number, claim.quantity]);
    const promise = dispatchPromise({ quotedAt: at, source, cutoffLocal: config.desk.dispatchCutoffLocal, holidays: await holidaySet(db) });
    const revision = (previous?.revision ?? 0) + 1;
    await rows(
      db,
      `INSERT INTO quote_revisions (claim_reference, revision, status, source, quantity, part_line_minor, carriage_minor, total_minor, band,
         carriage_valid_until, promise_kind, promise_date, quoted_at, billing_invoice) VALUES ($1,$2,'current',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [claim.reference, revision, source, claim.quantity, billed.partLineMinor, billed.carriageMinor, billed.totalMinor, estimate.band, estimate.valid_until, promise.kind, promise.date, at, invoice.invoiceId]
    );
    await rows(db, "UPDATE claims SET billing_account = $2 WHERE reference = $1", [claim.reference, accountId]);
    if (next !== claim.state) await recordState(db, claim, next, at);
    const token = await activeShareToken(db, claim.reference) ?? "";
    await enqueueNotice(db, claim, quotedNotice(claim.reference, claim.language, await currentQuote(db, claim.reference), token));
    return finishKeyed(db, claim, keyed, "quote", await answer(db, claim.reference), at);
  });
}
async function payment(ctx) {
  return onClaim(ctx, async (db, claim, at) => {
    const keyed = await startKeyed(db, ctx, claim, "payment");
    if (keyed.replay) return keyed.replay;
    applyAction("payment", claim.state, claim.paid_minor !== null);
    if (Object.keys(keyFields(keyed)).length > 0) return failFields(keyFields(keyed));
    const current = await currentQuote(db, claim.reference);
    const invoice = await readInvoiceById(current.billing_invoice);
    const paid = await recordExternalPayment(billingAccountOf(claim), current.billing_invoice, invoice.balanceMinor);
    await rows(db, "UPDATE claims SET paid_minor = $2, paid_at = $3 WHERE reference = $1", [claim.reference, paid, at]);
    return finishKeyed(db, claim, keyed, "payment", await answer(db, claim.reference), at);
  });
}
var REASONS = ["owner_declined", "cannot_send"];
async function decline(ctx) {
  return onClaim(ctx, async (db, row, at) => {
    const keyed = await startKeyed(db, ctx, row, "decline");
    if (keyed.replay) return keyed.replay;
    const next = applyAction("decline", row.state);
    const fields = keyFields(keyed);
    const reason = bodyOf(ctx)["reason"];
    if (reason === void 0 || reason === "") fields["reason"] = "required";
    else if (!REASONS.includes(reason)) fields["reason"] = "invalid";
    if (Object.keys(fields).length > 0) return failFields(fields);
    const claim = liveOf(row);
    const current = await currentQuote(db, claim.reference);
    const accountId = billingAccountOf(claim);
    let refunded = 0;
    if (claim.paid_minor !== null) {
      const purchase = successfulTransaction(await accountPayments(accountId), "PURCHASE");
      refunded = await refundWholePayment(accountId, purchase.paymentId, purchase.transaction.amountMinor);
    } else {
      await voidInvoice(current.billing_invoice);
    }
    const charged = await accountBalance(accountId);
    await lockPart(db, claim);
    await returnToBin(db, claim, current);
    await rows(db, "UPDATE claims SET decline_reason = $2, decline_charged_minor = $3, decline_refunded_minor = $4 WHERE reference = $1", [claim.reference, reason, charged, refunded]);
    await recordState(db, claim, next, at);
    const token = await activeShareToken(db, claim.reference) ?? "";
    await enqueueNotice(db, claim, declinedNotice(claim.reference, claim.language, refunded, token));
    return finishKeyed(db, claim, keyed, "decline", await answer(db, claim.reference), at);
  });
}
async function dispatch(ctx) {
  return onClaim(ctx, async (db, row, at) => {
    const keyed = await startKeyed(db, ctx, row, "dispatch");
    if (keyed.replay) return keyed.replay;
    const next = applyAction("dispatch", row.state, row.paid_minor !== null);
    if (Object.keys(keyFields(keyed)).length > 0) return failFields(keyFields(keyed));
    const claim = liveOf(row);
    const current = await currentQuote(db, claim.reference);
    const billed = figuresFromInvoice(await readInvoiceById(current.billing_invoice));
    const paid = successfulTransaction(await accountPayments(billingAccountOf(claim)), "PURCHASE").transaction.amountMinor;
    const part = await partOf(db, claim.model_slug, claim.booklet_number);
    const note = renderDispatchNote({
      reference: claim.reference,
      bookletNumber: part.booklet_number,
      partName: part.name,
      partNumber: part.part_number,
      quantity: current.quantity,
      partLineMinor: billed.partLineMinor,
      carriageBand: current.band,
      carriageMinor: billed.carriageMinor,
      totalMinor: billed.totalMinor,
      paidMinor: paid
    });
    await putObject(dispatchNoteKey(claim.reference), note, "text/html; charset=utf-8");
    try {
      await rows(db, "UPDATE claims SET dispatched_at = $2 WHERE reference = $1", [claim.reference, at]);
      await recordState(db, claim, next, at);
      const token = await activeShareToken(db, claim.reference) ?? "";
      await enqueueNotice(db, claim, dispatchedNotice(claim.reference, claim.language, paid, token));
      return await finishKeyed(db, claim, keyed, "dispatch", await answer(db, claim.reference), at);
    } catch (error) {
      await deleteObject(dispatchNoteKey(claim.reference)).catch(() => void 0);
      throw error;
    }
  });
}
async function closeClaim(ctx) {
  return onClaim(ctx, async (db, row, at) => {
    const next = applyAction("close", row.state);
    const claim = liveOf(row);
    await rows(db, "UPDATE claims SET closed_at = $2 WHERE reference = $1", [claim.reference, at]);
    await recordState(db, claim, next, at);
    await enqueueNotice(db, claim, closedNotice(claim.reference, claim.language));
    return answer(db, claim.reference);
  });
}
async function withdrawLink(ctx) {
  return onClaim(ctx, async (db, claim) => {
    applyAction("share_link", claim.state);
    await withdrawShareTokens(db, claim.reference);
    return { status: 204 };
  });
}
async function newLink(ctx) {
  return onClaim(ctx, async (db, row, at) => {
    applyAction("share_link", row.state);
    const claim = liveOf(row);
    await withdrawShareTokens(db, claim.reference);
    const token = await issueShareToken(db, claim.reference, at);
    await enqueueNotice(db, claim, newLinkNotice(claim.reference, claim.language, token));
    return { ...await answer(db, claim.reference), status: 201 };
  });
}
var CLAIM_CHILD_TABLES = ["claim_history", "claim_photos", "quote_revisions", "share_tokens", "idempotency_records", "notice_queue"];
async function erase(ctx) {
  return onClaim(ctx, async (db, row, at) => {
    applyAction("erase", row.state);
    const typed = bodyOf(ctx)["confirm_reference"];
    if (typed === void 0 || typed === "") return failFields({ confirm_reference: "required" });
    if (typed !== row.reference) return failFields({ confirm_reference: "mismatch" });
    const { email } = liveOf(row);
    const owned = await rows(db, "SELECT reference FROM claims WHERE lower(email) = lower($1) AND state <> 'erased' ORDER BY reference FOR UPDATE", [email]);
    const references = owned.map((claim) => claim.reference);
    const objects = (await Promise.all(references.map((reference) => listObjects(`claims/${reference}/`)))).flat();
    const messages = await messagesTo(email);
    for (const table of CLAIM_CHILD_TABLES) await rows(db, `DELETE FROM ${table} WHERE claim_reference = ANY($1)`, [references]);
    await rows(db, "DELETE FROM reference_attempts WHERE reference = ANY($1)", [references]);
    await rows(
      db,
      `UPDATE claims SET state = 'erased', erased_at = $2, language = NULL, name = NULL, email = NULL, postcode = NULL, purchase_date = NULL,
         model_slug = NULL, booklet_number = NULL, quantity = NULL, description = NULL, started_at = NULL, confirm_by = NULL, confirm_token = NULL,
         confirmed_at = NULL, ruling_inside = NULL, ruling_edition = NULL, ruling_cover_ends_at = NULL, ruling_cover_ends_on = NULL,
         ruling_term_months = NULL, ruling_decided_at = NULL, paid_minor = NULL, paid_at = NULL, decline_reason = NULL,
         decline_charged_minor = NULL, decline_refunded_minor = NULL, dispatched_at = NULL, closed_at = NULL, billing_account = NULL
       WHERE reference = ANY($1)`,
      [references, at]
    );
    await rows(db, "DELETE FROM club_roster WHERE lower(email) = lower($1)", [email]);
    for (const key of objects) await deleteObject(key);
    await deleteMessages(messages);
    return json(200, { erased: references });
  });
}
async function editions() {
  return json(200, { editions: await listEditions(await database()) });
}
async function saveEdition(ctx) {
  const edition = readEdition(ctx.json);
  return transaction(async (db) => {
    const clash = await one(db, "SELECT code FROM editions WHERE code = $1 OR starts_on = $2", [edition.code, edition.starts_on]);
    if (clash?.code === edition.code) return fail("edition_code_taken");
    if (clash) return fail("edition_date_taken");
    await rows(db, "INSERT INTO editions (code, title, starts_on, standard_months, club_months, owner_contribution_percent) VALUES ($1,$2,$3,$4,$5,$6)", [
      edition.code,
      edition.title,
      edition.starts_on,
      edition.standard_months,
      edition.club_months,
      edition.owner_contribution_percent
    ]);
    return json(201, edition);
  });
}
async function importFile(ctx) {
  const report = await transaction((db) => importSupplierFile(db, ctx.body.toString("utf8")));
  return report ? json(200, report) : failFields({ file: "bad_header" });
}
var opsRoutes = [
  { method: "POST", template: "/api/ops/session", body: "json", auth: "sign-in", handler: signIn },
  { method: "DELETE", template: "/api/ops/session", body: "none", auth: "operator", handler: signOut },
  { method: "GET", template: "/api/ops/claims", body: "none", auth: "operator", handler: listClaims },
  { method: "GET", template: "/api/ops/stats", body: "none", auth: "operator", handler: stats },
  { method: "GET", template: "/api/ops/editions", body: "none", auth: "operator", handler: editions },
  { method: "POST", template: "/api/ops/editions", body: "json", auth: "operator", handler: saveEdition },
  { method: "POST", template: "/api/ops/imports", body: "csv", auth: "operator", handler: importFile },
  { method: "GET", template: "/api/ops/claims/:reference", body: "none", auth: "operator", handler: viewClaim },
  { method: "GET", template: "/api/ops/claims/:reference/photos/:index", body: "none", auth: "operator", handler: claimPhoto },
  { method: "GET", template: "/api/ops/claims/:reference/dispatch-note", body: "none", auth: "operator", handler: dispatchNote },
  { method: "POST", template: "/api/ops/claims/:reference/identify", body: "json", auth: "operator", handler: identify },
  { method: "POST", template: "/api/ops/claims/:reference/quote", body: "json", auth: "operator", handler: quote },
  { method: "POST", template: "/api/ops/claims/:reference/payment", body: "json", auth: "operator", handler: payment },
  { method: "POST", template: "/api/ops/claims/:reference/decline", body: "json", auth: "operator", handler: decline },
  { method: "POST", template: "/api/ops/claims/:reference/dispatch", body: "json", auth: "operator", handler: dispatch },
  { method: "POST", template: "/api/ops/claims/:reference/close", body: "json", auth: "operator", handler: closeClaim },
  { method: "DELETE", template: "/api/ops/claims/:reference/share-link", body: "none", auth: "operator", handler: withdrawLink },
  { method: "POST", template: "/api/ops/claims/:reference/share-link", body: "json", auth: "operator", handler: newLink },
  { method: "POST", template: "/api/ops/claims/:reference/erase", body: "json", auth: "operator", handler: erase }
];

// src/server/http.ts
var ROUTES = [...ownerRoutes, ...opsRoutes];
var BODY_CAPS = {
  json: { bytes: 64e3, code: "payload_too_large" },
  multipart: { bytes: 33e6, code: "request_too_large" },
  csv: { bytes: 2e6, code: "file_too_large" }
};
var BODY_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH"]);
var CHANGING_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function compile(template) {
  return new RegExp(`^${template.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
}
var COMPILED = ROUTES.map((route) => ({ route, pattern: compile(route.template) }));
function matchRoute(method, path) {
  let pathKnown = false;
  for (const { route, pattern } of COMPILED) {
    const found = pattern.exec(path);
    if (!found) continue;
    pathKnown = true;
    if (route.method !== method && route.method !== "*") continue;
    const params = {};
    for (const [name, value] of Object.entries(found.groups ?? {})) {
      try {
        params[name] = decodeURIComponent(value);
      } catch {
        params[name] = value;
      }
    }
    return { match: { route, params }, pathKnown };
  }
  return { match: null, pathKnown };
}
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= cap) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > cap ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
var isJsonType = (type) => /^application\/json\s*(;|$)/i.test(type);
async function loadBody(req, kind, method) {
  const contentType = headerText(req.headers["content-type"]) ?? "";
  if (kind === "none" || !BODY_METHODS.has(method)) return { body: Buffer.alloc(0), contentType };
  const cap = BODY_CAPS[kind];
  const length = Number(headerText(req.headers["content-length"]) ?? "0");
  const hasBody = length > 0 || req.headers["transfer-encoding"] !== void 0;
  if (length > cap.bytes) {
    req.resume();
    throw new ApiError(cap.code);
  }
  const wrongType = kind === "json" && hasBody && !isJsonType(contentType) || kind === "multipart" && !/^multipart\/form-data\s*;/i.test(contentType) || kind === "csv" && !/^text\/csv\s*(;|$)/i.test(contentType);
  if (wrongType) {
    req.resume();
    throw new ApiError("unsupported_media_type");
  }
  const body = await readBody(req, cap.bytes);
  if (body === null) throw new ApiError(cap.code);
  return { body, contentType };
}
function send(res, reply) {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...reply.headers };
  let payload;
  if (reply.raw) {
    payload = reply.raw;
    headers["content-type"] = reply.contentType ?? "application/octet-stream";
  } else if (reply.json !== void 0) {
    payload = Buffer.from(JSON.stringify(reply.json));
    headers["content-type"] = "application/json; charset=utf-8";
  }
  if (payload) headers["content-length"] = String(payload.length);
  res.writeHead(reply.status, headers);
  res.end(payload);
}
function errorReply(error, ops) {
  const known = asDatabaseError(error);
  const apiError = known instanceof ApiError ? known : new ApiError("internal_error");
  if (!(known instanceof ApiError)) process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  const headers = {};
  if (apiError.detail.retryAfter !== void 0) headers["retry-after"] = String(apiError.detail.retryAfter);
  return { status: apiError.status, json: errorBody(apiError, ops), headers };
}
function refuseForeignOrigin(req) {
  const origin = headerText(req.headers["origin"]);
  if (origin === void 0) return;
  let host = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== headerText(req.headers["host"])) throw new ApiError("cross_origin");
}
async function api(req, res, url) {
  const method = req.method ?? "GET";
  const path = url.pathname;
  const ops = path.startsWith("/api/ops/");
  try {
    if (method === "GET" && path === "/api/health") return send(res, { status: 200, json: { status: "ok" } });
    const { match, pathKnown } = matchRoute(method, path);
    if (!match) throw new ApiError(pathKnown ? "method_not_allowed" : "not_found");
    const { route, params } = match;
    const remote = req.socket.remoteAddress ?? "unknown";
    if (route.limited) {
      const retryAfter = await refuseAfterRate(remote).catch((error) => {
        const known = asDatabaseError(error);
        if (known instanceof ApiError && known.code === "database_unavailable") return null;
        throw error;
      });
      if (retryAfter !== null) throw new ApiError("rate_limited", { retryAfter });
    }
    if (route.method === "*" && method !== "GET") throw new ApiError("read_only");
    const { body, contentType } = await loadBody(req, route.body, method);
    if (CHANGING_METHODS.has(method)) refuseForeignOrigin(req);
    const ctx = {
      method,
      path,
      query: url.searchParams,
      headers: req.headers,
      remote,
      params,
      body,
      json: route.body === "json" ? parseJson(body.toString("utf8")) ?? {} : void 0,
      contentType
    };
    if (route.auth === "operator") {
      const token = sessionToken(ctx);
      if (!token) throw new ApiError("unauthenticated");
      if (!await hasLiveSession(await database(), token)) throw new ApiError("unauthenticated");
    } else {
      await ensureSchema();
    }
    send(res, await route.handler(ctx));
  } catch (error) {
    send(res, errorReply(error, ops));
  }
}
var PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));
var PAGES = [
  /^\/$/,
  /^\/claim\/new$/,
  /^\/claim\/[^/]+\/sent$/,
  /^\/confirm\/[^/]+$/,
  /^\/s\/[^/]+$/,
  /^\/find$/,
  /^\/ops\/sign-in$/,
  /^\/ops\/claims$/,
  /^\/ops\/claims\/[^/]+(\/(quote(\/[^/]+)?|declined|dispatched))?$/,
  /^\/ops\/imports$/,
  /^\/ops\/editions$/
];
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml"
};
var PAGE_HEADERS = {
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff"
};
function sendFile(res, file, status = 200, cache = "no-cache") {
  const body = readFileSync(file);
  res.writeHead(status, { ...PAGE_HEADERS, "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": String(body.length), "cache-control": cache });
  res.end(body);
}
function pages(req, res, url) {
  const notFound = () => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end("Not found");
  };
  if (req.method !== "GET" && req.method !== "HEAD") return notFound();
  const path = url.pathname;
  const isAsset = path.startsWith("/assets/") || path.startsWith("/fonts/");
  if (isAsset) {
    const file = normalize(join(PUBLIC_DIR, path));
    if (!file.startsWith(PUBLIC_DIR + sep) || !existsSync(file) || !statSync(file).isFile()) return notFound();
    return sendFile(res, file, 200, path.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache");
  }
  const index = join(PUBLIC_DIR, "index.html");
  if (PAGES.some((page) => page.test(path))) return sendFile(res, index);
  const lastSegment = path.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return notFound();
  sendFile(res, index, 404);
}
function startServer(port2) {
  const server2 = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      void api(req, res, url);
      return;
    }
    try {
      pages(req, res, url);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  server2.keepAliveTimeout = 5e3;
  server2.listen(port2, "0.0.0.0");
  return server2;
}

// src/server/main.ts
process.on("uncaughtException", (error) => process.stderr.write(`uncaught: ${error.stack ?? error.message}
`));
process.on("unhandledRejection", (reason) => process.stderr.write(`unhandled: ${String(reason)}
`));
var server = startServer(config.port);
process.stdout.write(`Fittings Desk listening on 0.0.0.0:${config.port}
`);
function applySchemaWhenPossible() {
  ensureSchema().catch(() => setTimeout(applySchemaWhenPossible, 3e3).unref());
}
applySchemaWhenPossible();
startNoticeWorker();
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
