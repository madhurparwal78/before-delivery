// server/config.ts
var env = process.env;
var text = (name, fallback = "") => env[name] ?? fallback;
var positive = (name, fallback) => {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
var optionalPositive = (name) => {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
var namespace = text("PRESS_NAMESPACE");
var port = positive("APP_PUBLIC_PORT", 4173);
var clockStart = text("PRESS_CLOCK_START");
var config = {
  port,
  publicUrl: text("APP_PUBLIC_URL").replace(/\/$/, ""),
  databaseUrl: text("DATABASE_URL"),
  killbill: {
    url: text("KILLBILL_URL").replace(/\/$/, ""),
    username: text("KILLBILL_USERNAME"),
    password: text("KILLBILL_PASSWORD"),
    apiKey: text("KILLBILL_API_KEY"),
    apiSecret: text("KILLBILL_API_SECRET")
  },
  wiremockUrl: text("WIREMOCK_URL").replace(/\/$/, ""),
  keycloak: {
    url: text("KEYCLOAK_URL").replace(/\/$/, ""),
    realm: text("KEYCLOAK_REALM"),
    issuer: text("AUTH_ISSUER_URL").replace(/\/$/, ""),
    clientId: text("AUTH_CLIENT_ID"),
    clientSecret: text("AUTH_CLIENT_SECRET")
  },
  valkeyUrl: text("VALKEY_URL"),
  amqpUrl: text("AMQP_URL"),
  meili: { url: text("MEILISEARCH_URL").replace(/\/$/, ""), apiKey: text("MEILISEARCH_API_KEY") },
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY")
  },
  gotenbergUrl: text("GOTENBERG_URL").replace(/\/$/, ""),
  smtp: { host: text("SMTP_HOST"), port: Number(text("SMTP_PORT")), from: text("MAIL_FROM") },
  svix: { url: text("SVIX_URL").replace(/\/$/, ""), apiKey: text("SVIX_API_KEY") },
  ntfy: { url: text("NTFY_URL").replace(/\/$/, ""), username: text("NTFY_USERNAME"), password: text("NTFY_PASSWORD") },
  holdSeconds: positive("HOLD_SECONDS", 600),
  authSeconds: positive("AUTH_SECONDS", 604800),
  challengeSeconds: positive("CHALLENGE_SECONDS", 300),
  transferSeconds: optionalPositive("TRANSFER_SECONDS"),
  lookupWindowSeconds: positive("LOOKUP_WINDOW_SECONDS", 900),
  lowStockThresholds: text("LOW_STOCK_THRESHOLDS", "24,5").split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0),
  clockStart: clockStart ? Date.parse(clockStart) : null,
  gatewayCallbackSecret: text("GATEWAY_CALLBACK_SECRET", "sbx_gateway_callback_secret_01"),
  charityWebhookSecret: text("CHARITY_WEBHOOK_SECRET", "whsec_U3ZvdmxzdGlrQ2hhcml0eVNhbmRib3hLZXkwMTIz"),
  charityWebhookUrl: text("CHARITY_WEBHOOK_URL"),
  staffSeeds: [
    { username: "maker", password: "Maker-Press-2026!", role: "maker" },
    { username: "packer", password: "Packer-Press-2026!", role: "packer" },
    { username: "treasurer", password: "Treasurer-Press-2026!", role: "treasurer" }
  ]
};
var named = (name) => namespace ? `${namespace}-${name}` : name;

// server/broker.ts
import amqp from "amqplib";
var BrokerUnreachable = class extends Error {
  constructor() {
    super("broker unreachable");
  }
};
var names = {
  exchange: named("press.events"),
  main: named("press.fulfilment"),
  retry: named("press.fulfilment.retry"),
  dead: named("press.fulfilment.dead")
};
var connection = null;
var channel = null;
var connecting = null;
var isConnected = () => channel !== null;
var open = async () => {
  const fresh = await amqp.connect(config.amqpUrl, { timeout: 3e3 });
  const made = await fresh.createConfirmChannel();
  fresh.on("error", () => void 0);
  made.on("error", () => void 0);
  made.on("close", () => {
    channel = null;
  });
  fresh.on("close", () => {
    connection = null;
    channel = null;
  });
  await made.assertExchange(names.exchange, "direct", { durable: true });
  for (const queue of [names.main, names.retry, names.dead]) await made.assertQueue(queue, { durable: true });
  await made.bindQueue(names.main, names.exchange, "order.paid");
  await made.bindQueue(names.main, names.exchange, "box.packed");
  await made.bindQueue(names.retry, names.exchange, "retry");
  await made.bindQueue(names.dead, names.exchange, "dead");
  connection = fresh;
  channel = made;
  return made;
};
var getChannel = async () => {
  if (channel) return channel;
  connecting ??= open().finally(() => {
    connecting = null;
  });
  try {
    return await connecting;
  } catch {
    throw new BrokerUnreachable();
  }
};
var publish = async (routingKey, message, headers2 = {}) => {
  const active = await getChannel();
  active.publish(names.exchange, routingKey, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: "application/json",
    headers: headers2
  });
  await active.waitForConfirms();
};
var closeBroker = async () => {
  await connection?.close().catch(() => void 0);
};

// server/db.ts
import pg from "pg";

// shared/domain.ts
var EDITION = 240;
var PLATES = ["Stove", "Goose", "Tree", "Star", "Grandmother"];
var plateOf = (number) => PLATES[(number - 1) % PLATES.length];
var CHAPTERS = ["alley", "stove", "goose", "tree", "star", "grandmother", "shelf"];
var ROLES = ["maker", "packer", "treasurer"];
var MAX_GIFT_MESSAGE = 280;
var ORDER_LOOKUP_TRIES = 5;
var CLOSES_AT = "2027-02-01T00:00:00+01:00";
var CHARITY_NAME = "Varmestuen Nord";
var EDITION_PRICE = { priceOre: 149500, netOre: 119600, vatOre: 29900, courierOre: 8900, totalOre: 158400 };
var SEED_RATE_BASIS_POINTS = 3150;

// shared/tale.ts
var TALE = [
  { passageId: "p01", chapter: "alley", text: "It was terribly cold and nearly dark on the last evening of the old year, and the snow was falling fast. In the cold and the darkness, a poor little girl, with bare head and naked feet, roamed through the streets. It is true she had on a pair of slippers when she left home, but they were not of much use. They were very large, so large, indeed, that they had belonged to her mother, and the poor little creature had lost them in running across the street to avoid two carriages that were rolling along at a terrible rate. One of the slippers she could not find, and a boy seized upon the other and ran away with it, saying that he could use it as a cradle, when he had children of his own. So the little girl went on with her little naked feet, which were quite red and blue with the cold. In an old apron she carried a number of matches, and had a bundle of them in her hands. No one had bought anything of her the whole day, nor had any one given her even a penny. Shivering with cold and hunger, she crept along; poor little child, she looked the picture of misery. The snowflakes fell on her long, fair hair, which hung in curls on her shoulders, but she regarded them not." },
  { passageId: "p02", chapter: "alley", text: "Lights were shining from every window, and there was a savory smell of roast goose, for it was New-year's eve\u2014yes, she remembered that. In a corner, between two houses, one of which projected beyond the other, she sank down and huddled herself together. She had drawn her little feet under her, but she could not keep off the cold; and she dared not go home, for she had sold no matches, and could not take home even a penny of money. Her father would certainly beat her; besides, it was almost as cold at home as here, for they had only the roof to cover them, through which the wind howled, although the largest holes had been stopped up with straw and rags. Her little hands were almost frozen with the cold. Ah! perhaps a burning match might be some good, if she could draw it from the bundle and strike it against the wall, just to warm her fingers." },
  { passageId: "p03", chapter: "stove", text: 'She drew one out\u2014"scratch!" how it sputtered as it burnt! It gave a warm, bright light, like a little candle, as she held her hand over it. It was really a wonderful light. It seemed to the little girl that she was sitting by a large iron stove, with polished brass feet and a brass ornament. How the fire burned! and seemed so beautifully warm that the child stretched out her feet as if to warm them, when, lo! the flame of the match went out, the stove vanished, and she had only the remains of the half-burnt match in her hand.' },
  { passageId: "p04", chapter: "goose", text: "She rubbed another match on the wall. It burst into a flame, and where its light fell upon the wall it became as transparent as a veil, and she could see into the room. The table was covered with a snowy white table-cloth, on which stood a splendid dinner service, and a steaming roast goose, stuffed with apples and dried plums. And what was still more wonderful, the goose jumped down from the dish and waddled across the floor, with a knife and fork in its breast, to the little girl. Then the match went out, and there remained nothing but the thick, damp, cold wall before her." },
  { passageId: "p05", chapter: "tree", text: "She lighted another match, and then she found herself sitting under a beautiful Christmas-tree. It was larger and more beautifully decorated than the one which she had seen through the glass door at the rich merchant's. Thousands of tapers were burning upon the green branches, and colored pictures, like those she had seen in the show-windows, looked down upon it all. The little one stretched out her hand towards them, and the match went out." },
  { passageId: "p06", chapter: "star", text: 'The Christmas lights rose higher and higher, till they looked to her like the stars in the sky. Then she saw a star fall, leaving behind it a bright streak of fire. "Some one is dying," thought the little girl, for her old grandmother, the only one who had ever loved her, and who was now dead, had told her that when a star falls, a soul was going up to God.' },
  { passageId: "p07", chapter: "grandmother", text: 'She again rubbed a match on the wall, and the light shone round her; in the brightness stood her old grandmother, clear and shining, yet mild and loving in her appearance. "Grandmother," cried the little one, "O take me with you; I know you will go away when the match burns out; you will vanish like the warm stove, the roast goose, and the large, glorious Christmas-tree." And she made haste to light the whole bundle of matches, for she wished to keep her grandmother there. And the matches glowed with a light that was brighter than the noon-day, and her grandmother had never appeared so large or so beautiful. She took the little girl in her arms, and they both flew upwards in brightness and joy far above the earth, where there was neither cold nor hunger nor pain, for they were with God.' },
  { passageId: "p08", chapter: "shelf", text: `In the dawn of morning there lay the poor little one, with pale cheeks and smiling mouth, leaning against the wall; she had been frozen to death on the last evening of the year; and the New-year's sun rose and shone upon a little corpse! The child still sat, in the stiffness of death, holding the matches in her hand, one bundle of which was burnt. "She tried to warm herself," said some. No one imagined what beautiful things she had seen, nor into what glory she had entered with her grandmother, on New-year's day.` }
];

// server/db.ts
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));
var pool = new pg.Pool({ connectionString: config.databaseUrl, max: 48, connectionTimeoutMillis: 5e3 });
pool.on("error", () => void 0);
var isUniqueViolation = (error) => error.code === "23505";
var withTx = async (work) => {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result2 = await work(tx);
    await tx.query("COMMIT");
    return result2;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
};
var withLock = async (key, work) => {
  const session = await pool.connect();
  try {
    await session.query("SELECT pg_advisory_lock($1)", [key]);
    return await work();
  } finally {
    await session.query("SELECT pg_advisory_unlock($1)", [key]);
    session.release();
  }
};
var SCHEMA = `
CREATE TABLE IF NOT EXISTS boxes (
  number int PRIMARY KEY, plate text NOT NULL, state text NOT NULL DEFAULT 'available');
CREATE TABLE IF NOT EXISTS orders (
  reference text PRIMARY KEY,
  box_number int NOT NULL REFERENCES boxes(number),
  hold_token text NOT NULL,
  order_token text NOT NULL,
  method text,
  buyer_name text, buyer_email text, street text, postcode text, city text,
  gift_name text, gift_email text, gift_message text,
  payment_state text NOT NULL DEFAULT 'started',
  box_state text,
  live boolean NOT NULL DEFAULT false,
  rate_basis_points int,
  payment_id text, transfer_id text, transfer_iban text, transfer_reference text,
  challenge_id text, challenge_expires_at timestamptz,
  kb_account_id text, kb_invoice_id text, kb_payment_id text,
  deadline_at timestamptz,
  authorised_at timestamptz,
  auth_expires_at timestamptz,
  capture_requested boolean NOT NULL DEFAULT false,
  capture_confirmed boolean NOT NULL DEFAULT false,
  capture_attempts int NOT NULL DEFAULT 0,
  settle_confirmed boolean NOT NULL DEFAULT false,
  void_pending boolean NOT NULL DEFAULT false,
  kb_closed boolean NOT NULL DEFAULT true,
  last_sequence int NOT NULL DEFAULT 0,
  certificate_state text NOT NULL DEFAULT 'none',
  tracking_code text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (box_number, hold_token));
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_live_claim ON orders (box_number) WHERE live;
CREATE INDEX IF NOT EXISTS orders_email ON orders (lower(buyer_email));
CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL,
  done boolean NOT NULL DEFAULT false, status int, body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS payment_events (
  event_id text PRIMARY KEY, reference text NOT NULL, sequence int NOT NULL, type text NOT NULL,
  status text NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS refunds (
  refund_id text PRIMARY KEY, reference text NOT NULL, idempotency_key text,
  fingerprint text, amount_ore int NOT NULL, net_ore int NOT NULL, vat_ore int NOT NULL,
  charity_ore int NOT NULL, maker_ore int NOT NULL, state text NOT NULL DEFAULT 'pending',
  gateway_refund_id text, gateway_confirmed boolean NOT NULL DEFAULT false,
  kb_done boolean NOT NULL DEFAULT false, rate_basis_points int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_key ON refunds (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS split_lines (
  id bigserial PRIMARY KEY, reference text NOT NULL, box_number int NOT NULL, kind text NOT NULL,
  gross_ore int NOT NULL, net_ore int NOT NULL, vat_ore int NOT NULL, charity_ore int NOT NULL,
  maker_ore int NOT NULL, rate_basis_points int NOT NULL, posted_at timestamptz NOT NULL,
  refund_id text);
CREATE INDEX IF NOT EXISTS split_lines_reference ON split_lines (reference);
CREATE TABLE IF NOT EXISTS rate_changes (
  id serial PRIMARY KEY, basis_points int NOT NULL, effective_from timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS statements (
  id text PRIMARY KEY, month text NOT NULL, revision int NOT NULL,
  charity_total_ore int NOT NULL, maker_total_ore int NOT NULL, vat_total_ore int NOT NULL,
  lines jsonb NOT NULL, token text NOT NULL, issued_at timestamptz NOT NULL,
  UNIQUE (month, revision));
CREATE TABLE IF NOT EXISTS events (
  event_id text PRIMARY KEY, type text NOT NULL, reference text NOT NULL, box_number int NOT NULL,
  occurred_at timestamptz NOT NULL, published boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'pending',
  last_error text, failed_at timestamptz, dismissal_note text);
CREATE INDEX IF NOT EXISTS events_unpublished ON events (occurred_at) WHERE NOT published;
CREATE TABLE IF NOT EXISTS event_effects (
  event_id text NOT NULL, effect text NOT NULL, PRIMARY KEY (event_id, effect));
CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY, kind text NOT NULL, key text NOT NULL UNIQUE, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(), last_error text);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (run_at) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS passages (
  passage_id text PRIMARY KEY, chapter text NOT NULL, position int NOT NULL, text text NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, username text NOT NULL, roles text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS kb_accounts (email text PRIMARY KEY, account_id text NOT NULL);
CREATE TABLE IF NOT EXISTS stock_alerts (threshold int PRIMARY KEY, armed boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS plate_art (
  plate text PRIMARY KEY, object_key text NOT NULL, content_type text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
`;
var migrate = async () => {
  await withTx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(72011)");
    await tx.query(SCHEMA);
    for (let number = 1; number <= EDITION; number += 1)
      await tx.query("INSERT INTO boxes (number, plate) VALUES ($1, $2) ON CONFLICT DO NOTHING", [number, plateOf(number)]);
    await tx.query(
      "INSERT INTO rate_changes (basis_points, effective_from) SELECT $1, to_timestamp(0) WHERE NOT EXISTS (SELECT 1 FROM rate_changes)",
      [SEED_RATE_BASIS_POINTS]
    );
    for (const [position, passage] of TALE.entries())
      await tx.query(
        "INSERT INTO passages (passage_id, chapter, position, text) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [passage.passageId, passage.chapter, position, passage.text]
      );
    for (const threshold of config.lowStockThresholds)
      await tx.query("INSERT INTO stock_alerts (threshold) VALUES ($1) ON CONFLICT DO NOTHING", [threshold]);
  });
};

// shared/copy.ts
var fixed = (status, message) => ({ status, message: () => message });
var ERRORS = {
  box_held: { status: 409, message: (n = 0) => `Someone else is holding box ${n}. Choose another number.` },
  box_taken: { status: 409, message: (n = 0) => `Box ${n} has already found a home. Choose another number.` },
  hold_not_yours: fixed(403, "This hold belongs to someone else."),
  hold_ended: { status: 410, message: (n = 0) => `Your match went out. Box ${n} is back on the shelf.` },
  edition_closed: fixed(409, "This edition closed on 1 February 2027."),
  sales_paused: fixed(503, "Sales are paused because the shelf cannot be reached. The tale is still here."),
  do_not_honor: fixed(402, "Your bank declined this card. Try another card; your match keeps burning."),
  insufficient_funds: fixed(402, "This card has too little in it. Try another card; your match keeps burning."),
  expired_card: fixed(402, "This card has expired. Try another card; your match keeps burning."),
  challenge_failed: fixed(402, "The bank could not confirm it was you. Try again; your match keeps burning."),
  challenge_cancelled: fixed(402, "You cancelled the bank's check. Try again; your match keeps burning."),
  challenge_expired: fixed(410, "The bank's check ran out of time. Try again; your match keeps burning."),
  authorised_too_late: fixed(410, "Your match went out before the bank replied. You have not been charged."),
  lookup_refused: fixed(404, "We could not find an order with that reference and email."),
  lookup_limited: fixed(429, "Too many tries. Please wait before trying again."),
  certificate_pending: fixed(409, "Your certificate is being prepared."),
  certificate_cancelled: fixed(410, "This certificate was cancelled when the box was refunded."),
  capture_refused: { status: 402, message: (n = 0) => `The card could not be captured for box ${n}. Try packing again.` },
  art_wrong_type: fixed(415, "Plate art must be a PNG or JPEG file."),
  art_too_large: fixed(413, "Plate art must be 5,000,000 bytes or smaller."),
  art_too_many_pixels: fixed(422, "Plate art must be 6,000 pixels or fewer on each side."),
  refund_exceeds_remainder: fixed(422, "That is more than remains on this box."),
  refund_invalid: fixed(422, "Enter an amount above zero."),
  rate_must_be_future: fixed(422, "A new rate must start in the future."),
  rate_invalid: fixed(422, "Enter a rate from 0 to 100 percent."),
  month_invalid: fixed(422, "Enter a month that has started, as YYYY-MM."),
  dismissal_note_required: fixed(422, "Add a note of up to 280 characters."),
  endpoint_invalid: fixed(422, "Enter a full http or https address."),
  validation_failed: fixed(422, "Please check the highlighted fields."),
  illegal_transition: fixed(409, "That cannot be done in this box's current state."),
  authorisation_expired: fixed(409, "This authorisation lapsed. You have not been charged."),
  not_captured: fixed(409, "This order has not been charged yet."),
  idempotency_conflict: fixed(409, "That request key was already used for something else."),
  sign_in_required: fixed(401, "Please sign in."),
  forbidden: fixed(403, "Your role cannot do this."),
  not_found: fixed(404, "We could not find that."),
  origin_refused: fixed(403, "This request came from another site."),
  body_too_large: fixed(413, "That request is too large."),
  unsupported_media_type: fixed(415, "That request type is not accepted."),
  bad_signature: fixed(401, "Signature refused."),
  gateway_unreachable: fixed(503, "The bank's line is down. Your match keeps burning; try again in a moment."),
  ledger_unreachable: fixed(503, "We can't record payments right now. Your match keeps burning; try again in a moment."),
  search_unreachable: fixed(503, "Search is resting. The tale and the shelf still work."),
  queue_unreachable: fixed(503, "The dead-letter list cannot be read right now. Nothing is lost."),
  pdf_unreachable: fixed(503, "The PDF service is down. No statement was issued; try again shortly."),
  storage_unreachable: fixed(503, "Plate storage is down. Nothing was saved; try again shortly."),
  deliveries_unreachable: fixed(503, "Delivery state cannot be read right now. Events are kept and will be sent."),
  identity_unreachable: fixed(503, "Sign-in is unavailable right now. Try again shortly."),
  internal_error: fixed(500, "Something went wrong on our side.")
};
var OUTAGE_COPY = {
  pack: {
    gateway_unreachable: "The gateway is down. Nothing was captured.",
    ledger_unreachable: "The ledger is down. Nothing was captured."
  },
  refund: {
    gateway_unreachable: "The gateway is down. No refund was started.",
    ledger_unreachable: "The ledger is down. No refund was started."
  },
  download: "Downloads are unavailable right now. Try again shortly."
};
var FIELD_ERRORS = {
  "buyer.name": "Enter your name.",
  "buyer.email": "Enter a valid email address.",
  "address.street": "Enter a street address.",
  "address.postcode": "Enter a four-digit postcode.",
  "address.city": "Enter a city.",
  "gift.recipientName": "Enter the recipient's name.",
  "gift.recipientEmail": "Enter the recipient's email address.",
  "gift.message": "Keep the gift message to 280 characters.",
  "card.number": "Enter the 16-digit card number.",
  "card.expiry": "Enter the expiry as MM/YY.",
  "card.cvc": "Enter the three-digit security code."
};
var ALERT_COPY = {
  captureFailed: (number, amount) => ({ title: "Capture failed", message: `Box ${number}: capture of ${amount} failed.` }),
  authorisationExpired: (number, amount) => ({
    title: "Authorisation expired",
    message: `Box ${number}: authorisation of ${amount} expired and was voided.`
  }),
  deadLettered: (eventId, number) => ({
    title: "Event dead-lettered",
    message: `Event ${eventId} for box ${number} reached the dead-letter list.`
  }),
  lowStock: (remaining) => ({ title: "Low stock", message: `${remaining} boxes remain.` })
};
var MAIL_SUBJECTS = {
  authorisation: (number, reference) => `Box ${number} is reserved: card authorised (${reference})`,
  transfer: (number, reference) => `Bank transfer instructions for box ${number} (${reference})`,
  receipt: (number, reference) => `Your receipt for box ${number} (${reference})`,
  lapse: (number, reference) => `Your transfer deadline passed: box ${number} (${reference})`,
  refund: (number, reference) => `Refund for box ${number} (${reference})`,
  gift: "A numbered box is on its way to you"
};
var PAYMENT_COPY = {
  started: "Asking your bank...",
  challenge: "Your bank wants to check it is you.",
  authorised: "Your card is authorised. You have not been charged yet.",
  captured: "Your card has been charged.",
  partially_refunded: "Part of your payment has been refunded.",
  refunded: "Your payment has been refunded.",
  voided: "This authorisation was cancelled. You have not been charged.",
  capture_failed: "We could not charge your card. The press will be in touch.",
  authorisation_expired: ERRORS.authorisation_expired.message(),
  pending: "Waiting for your bank transfer.",
  settled: "Your transfer has arrived.",
  lapsed: (n) => `Your transfer deadline passed. Box ${n} is back on the shelf.`,
  declined: ERRORS.do_not_honor.message()
};
var WAITING_HEADER = "x-press-waiting";

// shared/money.ts
var roundHalfUp = (numerator, denominator) => Math.floor((2 * numerator + denominator) / (2 * denominator));
var BASIS_POINTS = 1e4;
var charityShare = (netOre, rateBasisPoints) => roundHalfUp(netOre * rateBasisPoints, BASIS_POINTS);
var netOfGross = (grossOre) => roundHalfUp(grossOre * 4, 5);
var splitSale = (netOre, vatOre, rateBasisPoints) => {
  const charityOre = charityShare(netOre, rateBasisPoints);
  return { netOre, vatOre, charityOre, makerOre: netOre - charityOre };
};
var gatewayFee = (method, totalOre) => method === "card" ? roundHalfUp(totalOre * 125, BASIS_POINTS) + 100 : 400;
var GROUP = /\B(?=(\d{3})+(?!\d))/g;
var formatKroner = (ore) => {
  const sign = ore < 0 ? "-" : "";
  const absolute = Math.abs(ore);
  const whole = String(Math.floor(absolute / 100)).replace(GROUP, ",");
  return `${sign}${whole}.${String(absolute % 100).padStart(2, "0")}`;
};
var formatDkk = (ore) => ore < 0 ? `-DKK ${formatKroner(-ore)}` : `DKK ${formatKroner(ore)}`;
var toDecimalKroner = (ore) => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)}.${String(Math.abs(ore) % 100).padStart(2, "0")}`;
var fromDecimalKroner = (value) => {
  if (value === null || value === void 0) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2})0*)?$/.exec(String(value));
  if (!match) return null;
  const ore = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -ore : ore;
};
var splitRefund = (amountOre, remaining, rateBasisPoints) => {
  if (amountOre === remaining.grossOre) {
    return { netOre: remaining.netOre, vatOre: remaining.vatOre, charityOre: remaining.charityOre, makerOre: remaining.makerOre };
  }
  let netOre = Math.min(netOfGross(amountOre), remaining.netOre);
  let vatOre = amountOre - netOre;
  if (vatOre > remaining.vatOre) {
    vatOre = remaining.vatOre;
    netOre = amountOre - vatOre;
  }
  let charityOre = Math.min(charityShare(netOre, rateBasisPoints), remaining.charityOre);
  let makerOre = netOre - charityOre;
  if (makerOre > remaining.makerOre) {
    makerOre = remaining.makerOre;
    charityOre = netOre - makerOre;
  }
  return { netOre, vatOre, charityOre, makerOre };
};

// server/jobs.ts
var handlers = /* @__PURE__ */ new Map();
var registerJob = (kind, handler) => {
  handlers.set(kind, handler);
};
var enqueue = async (q, kind, key, payload) => {
  await q.query("INSERT INTO jobs (kind, key, payload) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING", [kind, key, payload]);
};
var BACKOFF_SECONDS = 15;
var runOne = async (job) => {
  try {
    const handler = handlers.get(job.kind);
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    await handler(job.payload);
    await pool.query("UPDATE jobs SET status = 'done' WHERE id = $1", [job.id]);
  } catch (error) {
    const delay = Math.min(2 ** job.attempts, BACKOFF_SECONDS);
    await pool.query(
      "UPDATE jobs SET status = 'pending', attempts = attempts + 1, run_at = now() + make_interval(secs => $2), last_error = $3 WHERE id = $1",
      [job.id, delay, error instanceof Error ? error.name : "failed"]
    );
  }
};
var draining = false;
var drain = async () => {
  if (draining) return;
  draining = true;
  try {
    const claimed = await pool.query(
      `UPDATE jobs SET status = 'running', run_at = now() + interval '60 seconds'
       WHERE id IN (SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
       RETURNING id, kind, payload, attempts`
    );
    await Promise.all(claimed.rows.map(runOne));
    await pool.query("UPDATE jobs SET status = 'pending' WHERE status = 'running' AND run_at <= now()");
  } catch {
    return;
  } finally {
    draining = false;
  }
};
var startJobs = () => {
  setInterval(() => void drain(), 400).unref();
};
var hasPending = async (kind) => {
  const row = await pool.query("SELECT 1 FROM jobs WHERE kind = $1 AND status <> 'done' LIMIT 1", [kind]);
  return row.rowCount === 1;
};

// server/alerts.ts
var alertCaptureFailed = (q, key, number, totalOre) => enqueue(q, "alert", key, ALERT_COPY.captureFailed(number, formatDkk(totalOre)));
var alertAuthorisationExpired = (q, key, number, totalOre) => enqueue(q, "alert", key, ALERT_COPY.authorisationExpired(number, formatDkk(totalOre)));
var alertDeadLettered = (q, eventId, number) => enqueue(q, "alert", `dead-${eventId}-${Date.now()}`, ALERT_COPY.deadLettered(eventId, number));
var alertLowStock = (q, key, remaining) => enqueue(q, "alert", key, ALERT_COPY.lowStock(remaining));

// server/boxes.ts
import { randomUUID } from "node:crypto";

// server/http.ts
import multipart from "@fastify/multipart";
import Fastify from "fastify";
var ApiError = class extends Error {
  constructor(code, options = {}) {
    super(code);
    this.code = code;
    this.options = options;
  }
  code;
  options;
};
function fail(code, options = {}) {
  throw new ApiError(code, options);
}
var errorBody = (code, options = {}) => ({
  error: { code, message: options.message ?? ERRORS[code].message(options.number), ...options.fields ? { fields: options.fields } : {} },
  ...options.extra ?? {}
});
var sendError = (reply, error) => reply.code(ERRORS[error.code].status).headers(error.options.headers ?? {}).send(errorBody(error.code, error.options));
var statusOf = (code) => ERRORS[code].status;
var JSON_LIMIT = 64e3;
var ART_MULTIPART_LIMIT = 51e5;
var isForeignOrigin = (request2) => {
  const origin = request2.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== request2.headers.host;
  } catch {
    return true;
  }
};
var MUTATING = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
var buildApp = async () => {
  const app = Fastify({
    bodyLimit: JSON_LIMIT,
    routerOptions: { ignoreTrailingSlash: true },
    frameworkErrors: (_error, _request, reply) => sendError(reply, new ApiError("not_found"))
  });
  app.decorateRequest("rawBody", null);
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: JSON_LIMIT }, (request2, body, done2) => {
    const raw = body;
    request2.rawBody = raw;
    if (raw.length === 0) return done2(null, void 0);
    try {
      done2(null, JSON.parse(raw.toString("utf8")));
    } catch {
      done2(new ApiError("validation_failed"));
    }
  });
  await app.register(multipart, { limits: { fileSize: ART_MULTIPART_LIMIT, files: 1, fields: 4 } });
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
  });
  app.addHook("preHandler", async (request2) => {
    if (MUTATING.has(request2.method) && !request2.url.startsWith("/api/gateway/callbacks") && isForeignOrigin(request2))
      fail("origin_refused");
  });
  app.setErrorHandler((error, request2, reply) => {
    if (error instanceof ApiError) return sendError(reply, error);
    if (error.code === "FST_REQ_FILE_TOO_LARGE") return sendError(reply, new ApiError("art_too_large"));
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return sendError(reply, new ApiError(request2.url.startsWith("/api/staff/plates/") ? "art_too_large" : "body_too_large"));
    if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return sendError(reply, new ApiError("unsupported_media_type"));
    if (error.code === "FST_ERR_NOT_FOUND") return sendError(reply, new ApiError("not_found"));
    if (error.code === "FST_INVALID_MULTIPART_CONTENT_TYPE") return sendError(reply, new ApiError("unsupported_media_type"));
    if (error.statusCode && error.statusCode < 500) return sendError(reply, new ApiError("validation_failed"));
    request2.log.error(error);
    return sendError(reply, new ApiError("internal_error"));
  });
  app.setNotFoundHandler((_request, reply) => sendError(reply, new ApiError("not_found")));
  return app;
};

// server/transitions.ts
var BOX_MOVES = {
  available: ["awaiting_transfer", "claimed"],
  awaiting_transfer: ["claimed", "available"],
  claimed: ["packed", "available", "returned"],
  packed: ["shipped", "returned"],
  shipped: ["returned"],
  returned: ["available"]
};
var PAYMENT_MOVES = {
  started: ["challenge", "authorised", "declined", "pending"],
  challenge: ["authorised", "declined"],
  declined: ["started"],
  authorised: ["captured", "voided", "capture_failed", "authorisation_expired"],
  capture_failed: ["captured", "authorisation_expired"],
  captured: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
  voided: [],
  authorisation_expired: [],
  pending: ["settled", "lapsed"],
  settled: ["partially_refunded", "refunded"],
  lapsed: []
};
var canMoveBox = (from, to) => BOX_MOVES[from].includes(to);
var canMovePayment = (from, to) => PAYMENT_MOVES[from].includes(to);
var isPaidState = (state) => state === "captured" || state === "settled" || state === "partially_refunded";
var isRefundableState = (state) => isPaidState(state) || state === "refunded";
var awaitsAuthorisation = (state) => state === "started" || state === "challenge";
var holdsAuthorisation = (state) => state === "authorised" || state === "capture_failed";
var canRetryAttempt = (state) => state === "challenge" || state === "declined";

// server/boxes.ts
var availableCount = async (q) => (await q.query("SELECT count(*)::int AS available FROM boxes WHERE state = 'available'")).rows[0].available;
var evaluateStock = async (tx) => {
  const thresholds = await tx.query("SELECT threshold, armed FROM stock_alerts ORDER BY threshold FOR UPDATE");
  const remaining = await availableCount(tx);
  for (const row of thresholds.rows) {
    if (remaining <= row.threshold && row.armed) {
      await tx.query("UPDATE stock_alerts SET armed = false WHERE threshold = $1", [row.threshold]);
      await alertLowStock(tx, `low-stock-${row.threshold}-${randomUUID()}`, remaining);
    } else if (remaining > row.threshold && !row.armed) {
      await tx.query("UPDATE stock_alerts SET armed = true WHERE threshold = $1", [row.threshold]);
    }
  }
};
var moveBox = async (tx, number, to, reference = null) => {
  const row = await tx.query("SELECT state FROM boxes WHERE number = $1 FOR UPDATE", [number]);
  const from = row.rows[0]?.state;
  if (!from || !canMoveBox(from, to)) return fail("illegal_transition");
  await tx.query("UPDATE boxes SET state = $2 WHERE number = $1", [number, to]);
  if (from === "available" && reference) await tx.query("UPDATE orders SET live = true, box_state = $2 WHERE reference = $1", [reference, to]);
  else if (to === "available") await tx.query("UPDATE orders SET live = false, box_state = 'available' WHERE box_number = $1 AND live", [number]);
  else await tx.query("UPDATE orders SET box_state = $2 WHERE box_number = $1 AND live", [number, to]);
  if (from === "available" || to === "available") await evaluateStock(tx);
  await enqueue(tx, "search", `search-${number}-${randomUUID()}`, { numbers: [number] });
  return from;
};
var putBackOnShelf = async (tx, number) => {
  const row = await tx.query("SELECT state FROM boxes WHERE number = $1 FOR UPDATE", [number]);
  if (row.rows[0]?.state !== "returned") fail("illegal_transition");
  await moveBox(tx, number, "available");
};

// server/clock.ts
var bootedAt = Date.now();
var startedAt = config.clockStart !== null && Number.isFinite(config.clockStart) ? config.clockStart : bootedAt;
var businessNow = () => new Date(startedAt + (Date.now() - bootedAt));
var ZONE = "Europe/Copenhagen";
var formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});
var copenhagenTime = (instant) => {
  const parts = {};
  for (const part of formatter.formatToParts(instant)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0
  };
};
var offsetMinutes = (instant) => {
  const local2 = copenhagenTime(instant);
  const asUtc = Date.UTC(local2.year, local2.month - 1, local2.day, local2.hour, local2.minute, local2.second);
  return (asUtc - Math.floor(instant.getTime() / 1e3) * 1e3) / 6e4;
};
var two = (value) => String(value).padStart(2, "0");
var formatCopenhagen = (instant) => {
  const local2 = copenhagenTime(instant);
  const offset = offsetMinutes(instant);
  const sign = offset < 0 ? "-" : "+";
  const magnitude = Math.abs(offset);
  return `${local2.year}-${two(local2.month)}-${two(local2.day)}T${two(local2.hour)}:${two(local2.minute)}:${two(local2.second)}${sign}${two(Math.floor(magnitude / 60))}:${two(magnitude % 60)}`;
};
var copenhagenMonth = (instant) => {
  const local2 = copenhagenTime(instant);
  return `${local2.year}-${two(local2.month)}`;
};
var copenhagenInstant = (local2) => {
  const guess = Date.UTC(local2.year, local2.month - 1, local2.day, local2.hour, local2.minute, local2.second);
  return new Date(guess - offsetMinutes(new Date(guess - 2 * 3600 * 1e3)) * 6e4);
};

// server/art.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// server/s3.ts
import { createHash, createHmac } from "node:crypto";
var StorageUnreachable = class extends Error {
  constructor() {
    super("storage unreachable");
  }
};
var sha256 = (data) => createHash("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
var encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
var request = async (method, key, body, contentType) => {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
  const url = new URL(endpoint);
  const path = `/${bucket}${key ? `/${key.split("/").map(encode).join("/")}` : ""}`;
  const now = /* @__PURE__ */ new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payload = sha256(body ?? "");
  const signedHeaders = { host: url.host, "x-amz-content-sha256": payload, "x-amz-date": amzDate };
  if (contentType) signedHeaders["content-type"] = contentType;
  const names2 = Object.keys(signedHeaders).sort();
  const canonical2 = [
    method,
    path,
    "",
    names2.map((name) => `${name}:${signedHeaders[name]}
`).join(""),
    names2.join(";"),
    payload
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256
${amzDate}
${scope}
${sha256(canonical2)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const headers2 = {
    ...signedHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names2.join(";")}, Signature=${signature}`
  };
  try {
    return await fetch(`${endpoint}${path}`, { method, headers: headers2, body: body ? Buffer.from(body) : void 0, signal: AbortSignal.timeout(2e4) });
  } catch {
    throw new StorageUnreachable();
  }
};
var checked = (response) => {
  if (response.status >= 500) throw new StorageUnreachable();
  return response;
};
var ensureBucket = async () => {
  const head = checked(await request("HEAD", ""));
  if (head.status === 404) checked(await request("PUT", ""));
};
var putObject = async (key, body, contentType) => {
  const response = checked(await request("PUT", key, body, contentType));
  if (!response.ok) throw new StorageUnreachable();
};
var getObject = async (key) => {
  const response = checked(await request("GET", key));
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
};
var hasObject = async (key) => checked(await request("HEAD", key)).ok;

// server/art.ts
var MAX_BYTES = 5e6;
var MAX_SIDE = 6e3;
var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
var SOF = /* @__PURE__ */ new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
var jpegSize = (bytes) => {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 255) return null;
    const marker = bytes[at + 1] ?? 0;
    if (SOF.has(marker)) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
};
var inspect = (bytes) => {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { contentType: "image/png", extension: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    const size = jpegSize(bytes);
    return size ? { contentType: "image/jpeg", extension: "jpg", ...size } : null;
  }
  return null;
};
var plateKey = (plate) => {
  const lower = plate.toLowerCase();
  return PLATES.some((name) => name.toLowerCase() === lower) ? lower : fail("not_found");
};
var saveArt = async (plate, bytes) => {
  const key = plateKey(plate);
  if (bytes.length > MAX_BYTES) return fail("art_too_large");
  const facts = inspect(bytes);
  if (!facts) return fail("art_wrong_type");
  if (facts.width > MAX_SIDE || facts.height > MAX_SIDE) return fail("art_too_many_pixels");
  const objectKey = `plates/${key}/${randomUUID2()}.${facts.extension}`;
  try {
    await putObject(objectKey, bytes, facts.contentType);
  } catch (error) {
    if (error instanceof StorageUnreachable) return fail("storage_unreachable");
    throw error;
  }
  await pool.query(
    `INSERT INTO plate_art (plate, object_key, content_type) VALUES ($1, $2, $3)
     ON CONFLICT (plate) DO UPDATE SET object_key = excluded.object_key, content_type = excluded.content_type, updated_at = now()`,
    [key, objectKey, facts.contentType]
  );
  return { plate: key, artUrl: artUrl(key), bytes: bytes.length, width: facts.width, height: facts.height };
};
var artUrl = (plate) => `/api/plates/${plate.toLowerCase()}/art`;
var hasArt = async (plate) => (await pool.query("SELECT 1 FROM plate_art WHERE plate = $1", [plate.toLowerCase()])).rowCount === 1;
var latestArt = async (plate) => {
  const row = (await pool.query("SELECT object_key, content_type FROM plate_art WHERE plate = $1", [plate.toLowerCase()])).rows[0];
  const bytes = row ? await getObject(row.object_key) : null;
  return row && bytes ? { contentType: row.content_type, bytes } : null;
};
var readArt = async (plate) => {
  try {
    return await latestArt(plateKey(plate)) ?? fail("not_found");
  } catch (error) {
    if (error instanceof StorageUnreachable) return fail("storage_unreachable", { message: OUTAGE_COPY.download });
    throw error;
  }
};

// server/documents.ts
var escape = (text3) => text3.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var SHEET_CSS = `
  @page { size: A4; margin: 18mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #0a101c; background: #eaf0f8; margin: 0; }
  .sheet { border: 1px solid #6b7588; padding: 14mm; min-height: 240mm; }
  h1 { font-size: 30pt; font-weight: 400; margin: 0 0 4mm; }
  h2 { font-size: 18pt; font-weight: 400; margin: 0 0 8mm; color: #4a5568; }
  p { font-size: 13pt; margin: 3mm 0; white-space: nowrap; }
  img.art { display: block; max-width: 90mm; max-height: 90mm; margin: 8mm 0; border: 1px solid #6b7588; }
  .rule { border-top: 1px solid #6b7588; margin: 8mm 0; }
`;
var PLATE_DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="120" viewBox="0 0 260 120">
  <rect x="1" y="1" width="258" height="118" fill="none" stroke="#6b7588"/>
  <rect x="60" y="56" width="140" height="10" fill="#0a101c"/><circle cx="204" cy="61" r="9" fill="#0a101c"/></svg>`;
var certificateHtml = (data) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${SHEET_CSS}</style></head>
<body><div class="sheet">
<h1>Svovlstik Press</h1><h2>The Last Bundle</h2>
<p>Box ${data.number} of ${EDITION}</p>
<p>Plate: ${escape(data.plate)}</p>
<p>Order ${escape(data.reference)}</p>
<div class="rule"></div>
${data.art ? `<img class="art" alt="" src="data:${data.art.contentType};base64,${data.art.bytes.toString("base64")}">` : PLATE_DRAWING}
<p>Charity share of this box: ${formatDkk(data.charityOre)}</p>
</div></body></html>`;
var lineText = (line) => `Box ${line.boxNumber} ${line.reference} ${line.kind} gross ${formatDkk(line.grossOre)} net ${formatDkk(line.netOre)} VAT ${formatDkk(line.vatOre)} charity ${formatDkk(line.charityOre)} maker ${formatDkk(line.makerOre)}`;
var statementHtml = (data) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #0a101c; margin: 0; }
  h1 { font-size: 24pt; font-weight: 400; margin: 0 0 2mm; }
  h2 { font-size: 13pt; font-weight: 400; margin: 0 0 6mm; color: #4a5568; }
  p { font-size: 9pt; margin: 1.6mm 0; white-space: nowrap; }
  p.total { font-size: 11pt; margin-top: 6mm; }
</style></head><body>
<h1>Charity statement ${escape(data.month)}</h1>
<h2>Revision ${data.revision}</h2>
<p>${escape(data.charityName)}</p>
${data.lines.map((line) => `<p>${escape(lineText(line))}</p>`).join("\n")}
<p class="total">Total charity share: ${formatDkk(data.charityTotalOre)}</p>
<p class="total">Total maker share: ${formatDkk(data.makerTotalOre)}</p>
<p class="total">Total VAT: ${formatDkk(data.vatTotalOre)}</p>
</body></html>`;

// server/pdf.ts
var PdfUnreachable = class extends Error {
  constructor() {
    super("pdf unreachable");
  }
};
var renderPdf = async (html) => {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("preferCssPageSize", "true");
  form.append("printBackground", "true");
  let response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(6e4)
    });
  } catch {
    throw new PdfUnreachable();
  }
  if (!response.ok) throw new PdfUnreachable();
  return Buffer.from(await response.arrayBuffer());
};

// server/orders.ts
var loadOrder = async (q, reference, lock = false) => {
  const found = await q.query(`SELECT * FROM orders WHERE reference = $1${lock ? " FOR UPDATE" : ""}`, [reference]);
  return found.rows[0] ?? null;
};
var requireOrder = async (q, reference, lock = false) => await loadOrder(q, reference, lock) ?? fail("not_found");
var rateAt = async (q, instant) => {
  const found = await q.query(
    "SELECT basis_points FROM rate_changes WHERE effective_from <= $1 ORDER BY effective_from DESC, id DESC LIMIT 1",
    [instant]
  );
  return found.rows[0].basis_points;
};
var saleParts = (rateBasisPoints) => splitSale(EDITION_PRICE.netOre, EDITION_PRICE.vatOre, rateBasisPoints);
var orderRate = async (q, order) => order.rate_basis_points ?? await rateAt(q, businessNow());
var recipientOf = (order) => ({
  name: order.gift_name ?? order.buyer_name ?? "",
  email: order.gift_email ?? order.buyer_email ?? ""
});
var setPaymentState = async (tx, order, to) => {
  if (!canMovePayment(order.payment_state, to)) fail("illegal_transition");
  await tx.query("UPDATE orders SET payment_state = $2 WHERE reference = $1", [order.reference, to]);
  order.payment_state = to;
};
var transferView = (order) => order.method === "bank" && order.transfer_iban && order.deadline_at ? {
  iban: order.transfer_iban,
  paymentReference: order.transfer_reference ?? order.reference,
  amountOre: EDITION_PRICE.totalOre,
  deadlineAt: formatCopenhagen(order.deadline_at)
} : null;
var orderView = async (q, order) => ({
  reference: order.reference,
  number: order.box_number,
  plate: plateOf(order.box_number),
  method: order.method,
  paymentState: order.payment_state,
  boxState: order.box_state ?? "held",
  totalOre: EDITION_PRICE.totalOre,
  charityOre: saleParts(await orderRate(q, order)).charityOre,
  transfer: transferView(order),
  certificate: { state: order.certificate_state }
});

// server/certificates.ts
var certificateKey = (reference) => `certificates/${reference}.pdf`;
var issueCertificate = async (reference) => {
  const order = await requireOrder(pool, reference);
  if (order.certificate_state === "cancelled") return;
  const key = certificateKey(reference);
  if (!await hasObject(key)) {
    const plate = plateOf(order.box_number);
    const html = certificateHtml({
      number: order.box_number,
      plate,
      reference,
      charityOre: saleParts(await orderRate(pool, order)).charityOre,
      art: await latestArt(plate)
    });
    await putObject(key, await renderPdf(html), "application/pdf");
  }
  await pool.query("UPDATE orders SET certificate_state = 'issued' WHERE reference = $1 AND certificate_state <> 'cancelled'", [reference]);
};
var orderPaidPayload = async (reference, eventId) => {
  const order = await requireOrder(pool, reference);
  const sale = (await pool.query("SELECT * FROM split_lines WHERE reference = $1 AND kind = 'sale' ORDER BY id LIMIT 1", [reference])).rows[0];
  return {
    eventId,
    reference,
    boxNumber: order.box_number,
    plate: plateOf(order.box_number),
    grossOre: sale.gross_ore,
    netOre: sale.net_ore,
    vatOre: sale.vat_ore,
    charityOre: sale.charity_ore,
    makerOre: sale.maker_ore,
    rateBasisPoints: sale.rate_basis_points,
    paidAt: sale.posted_at.toISOString()
  };
};
var downloadCertificate = async (order) => {
  if (order.certificate_state === "cancelled") return fail("certificate_cancelled");
  if (order.certificate_state === "none") return fail("not_found");
  if (order.certificate_state === "pending") return fail("certificate_pending");
  return await getObject(certificateKey(order.reference)) ?? fail("certificate_pending");
};

// server/gateway.ts
var GatewayUnreachable = class extends Error {
  constructor() {
    super("gateway unreachable");
  }
};
var post = async (path, body, idempotencyKey) => {
  let response;
  try {
    response = await fetch(`${config.wiremockUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw new GatewayUnreachable();
  }
  if (response.status >= 500) throw new GatewayUnreachable();
  const text3 = await response.text();
  return { status: response.status, body: text3 ? JSON.parse(text3) : {} };
};
var authorise = (reference, amountOre, card, key) => post("/v1/authorisations", { reference, amountOre, currency: "DKK", card }, key);
var answerChallenge = (challengeId, code, key) => post(`/v1/challenges/${encodeURIComponent(challengeId)}`, { code }, key);
var capture = (paymentId, amountOre, key) => post(`/v1/payments/${encodeURIComponent(paymentId)}/capture`, { amountOre }, key);
var voidPayment = (paymentId, key) => post(`/v1/payments/${encodeURIComponent(paymentId)}/void`, {}, key);
var refundPayment = (paymentId, amountOre, key) => post(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, { amountOre }, key);
var reserveTransfer = (reference, amountOre, key) => post("/v1/transfers", { reference, amountOre, currency: "DKK" }, key);
var refundTransfer = (transferId, amountOre, key) => post(`/v1/transfers/${encodeURIComponent(transferId)}/refund`, { amountOre }, key);
var returnTransfer = (transferId, amountOre, key) => post(`/v1/transfers/${encodeURIComponent(transferId)}/return`, { amountOre }, key);
var bookCourier = (booking, key) => post("/v1/courier/bookings", booking, key);

// server/ids.ts
import { randomBytes, randomInt, randomUUID as randomUUID3 } from "node:crypto";
var REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var newReference = () => {
  let suffix = "";
  for (let index = 0; index < 6; index += 1) suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `LB-${suffix}`;
};
var newToken = () => randomBytes(24).toString("base64url");
var newEventId = (prefix) => `${prefix}_${randomUUID3().replaceAll("-", "")}`;

// server/mail.ts
import { connect } from "node:net";
var MailUnreachable = class extends Error {
  constructor() {
    super("mail unreachable");
  }
};
var SAFE_HEADER = /^[^\r\n\0\u0085\u2028\u2029]*$/;
var envelopeAddress = (from) => {
  const open3 = from.indexOf("<");
  return open3 >= 0 ? from.slice(open3 + 1, from.indexOf(">")) : from.trim();
};
var dialogue = (steps) => new Promise((resolve, reject) => {
  const socket = connect({ host: config.smtp.host, port: config.smtp.port });
  const abandon = () => {
    socket.destroy();
    reject(new MailUnreachable());
  };
  socket.setTimeout(15e3, abandon);
  socket.on("error", abandon);
  let buffer = "";
  let step = 0;
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const last = buffer.split("\r\n").filter((line) => line.length > 0).at(-1) ?? "";
    if (!buffer.endsWith("\r\n") || !/^\d{3} /.test(last)) return;
    buffer = "";
    if (Number(last.slice(0, 3)) !== steps[step]?.expect) return abandon();
    step += 1;
    const next = steps[step];
    if (!next) {
      socket.end();
      resolve();
      return;
    }
    socket.write(next.send ?? "");
  });
});
var sendMail = async (mail) => {
  if (![mail.to, mail.subject, config.smtp.from].every((value) => SAFE_HEADER.test(value))) throw new MailUnreachable();
  const body = Buffer.from(mail.text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  const message = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body
  ].join("\r\n");
  await dialogue([
    { send: null, expect: 220 },
    { send: "EHLO svovlstik.press\r\n", expect: 250 },
    { send: `MAIL FROM:<${envelopeAddress(config.smtp.from)}>\r
`, expect: 250 },
    { send: `RCPT TO:<${mail.to}>\r
`, expect: 250 },
    { send: "DATA\r\n", expect: 354 },
    { send: `${message}\r
.\r
`, expect: 250 },
    { send: "QUIT\r\n", expect: 221 }
  ]);
};

// server/notices.ts
var orderLink = (order) => `${config.publicUrl}/order/${order.reference}?token=${order.order_token}`;
var buyerMail = (order, subject, lines) => ({
  to: order.buyer_email ?? "",
  subject,
  text: [`Dear ${order.buyer_name ?? ""},`, "", ...lines, "", `Your order: ${orderLink(order)}`, "", "Svovlstik Press"].join("\n")
});
var buildMail = async (template, order, refundOre = 0) => {
  const box = `Box ${order.box_number} of ${EDITION}, plate ${plateOf(order.box_number)}`;
  switch (template) {
    case "authorisation":
      return buyerMail(order, MAIL_SUBJECTS.authorisation(order.box_number, order.reference), [
        `${box} is reserved for you.`,
        `Your card is authorised for ${formatDkk(EDITION_PRICE.totalOre)}. You have not been charged yet; the card is charged when the press packs your box.`
      ]);
    case "transfer":
      return buyerMail(order, MAIL_SUBJECTS.transfer(order.box_number, order.reference), [
        `${box} is reserved while you pay by bank transfer.`,
        `Account: ${order.transfer_iban ?? ""}`,
        `Payment reference: ${order.transfer_reference ?? order.reference}`,
        `Amount: ${formatDkk(EDITION_PRICE.totalOre)}`,
        `Pay by: ${order.deadline_at ? formatCopenhagen(order.deadline_at) : ""}`
      ]);
    case "receipt": {
      const parts = saleParts(await orderRate(pool, order));
      return buyerMail(order, MAIL_SUBJECTS.receipt(order.box_number, order.reference), [
        `${box}.`,
        `Total: ${formatDkk(EDITION_PRICE.totalOre)}`,
        `VAT: ${formatDkk(parts.vatOre)}`,
        `Courier: ${formatDkk(EDITION_PRICE.courierOre)}`,
        `Charity share: ${formatDkk(parts.charityOre)}`
      ]);
    }
    case "lapse":
      return buyerMail(order, MAIL_SUBJECTS.lapse(order.box_number, order.reference), [
        `The bank transfer for ${box} did not arrive in time, so the box is back on the shelf.`
      ]);
    case "refund":
      return buyerMail(order, MAIL_SUBJECTS.refund(order.box_number, order.reference), [
        `We have returned ${formatDkk(refundOre)} for ${box}.`
      ]);
    case "gift": {
      const recipient = recipientOf(order);
      return {
        to: recipient.email,
        subject: MAIL_SUBJECTS.gift,
        text: [
          `Dear ${recipient.name},`,
          "",
          `${order.buyer_name ?? "Someone"} has sent you box ${order.box_number} of ${EDITION}, plate ${plateOf(order.box_number)}, from Svovlstik Press.`,
          "",
          order.gift_message ?? "",
          "",
          "Svovlstik Press"
        ].join("\n")
      };
    }
  }
};

// server/svix.ts
var SvixUnreachable = class extends Error {
  constructor() {
    super("svix unreachable");
  }
};
var APP_UID = () => named("svovlstik-charity");
var call = async (method, path, body) => {
  let response;
  try {
    response = await fetch(`${config.svix.url}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${config.svix.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(15e3)
    });
  } catch {
    throw new SvixUnreachable();
  }
  if (response.status >= 500) throw new SvixUnreachable();
  const text3 = await response.text();
  return { status: response.status, body: text3 ? JSON.parse(text3) : null };
};
var ensureOk = (reply) => {
  if (reply.status >= 400) throw new SvixUnreachable();
};
var ensureApplication = async () => {
  const existing = await call("GET", `/app/${APP_UID()}/`);
  if (existing.status === 404) ensureOk(await call("POST", "/app/", { name: APP_UID(), uid: APP_UID() }));
  else ensureOk(existing);
};
var storedEndpoint = async () => {
  const row = await pool.query("SELECT value FROM settings WHERE key = 'charity_endpoint'");
  return row.rows[0]?.value ?? config.charityWebhookUrl;
};
var saveEndpoint = async (url) => {
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('charity_endpoint', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [url]
  );
};
var syncEndpoint = async () => {
  await ensureApplication();
  const url = await storedEndpoint();
  if (!url) return;
  const listed = await call("GET", `/app/${APP_UID()}/endpoint/`);
  ensureOk(listed);
  const endpoints = listed.body.data;
  const definition = { url, secret: config.charityWebhookSecret, version: 1, description: "Charity partner" };
  const [first, ...rest] = endpoints;
  for (const extra of rest) ensureOk(await call("DELETE", `/app/${APP_UID()}/endpoint/${extra.id}/`));
  if (!first) ensureOk(await call("POST", `/app/${APP_UID()}/endpoint/`, definition));
  else if (first.url !== url) ensureOk(await call("PUT", `/app/${APP_UID()}/endpoint/${first.id}/`, definition));
};
var sendMessage = async (eventId, eventType, payload) => {
  await syncEndpoint();
  const reply = await call("POST", `/app/${APP_UID()}/msg/`, { eventId, eventType, payload });
  if (reply.status !== 409) ensureOk(reply);
};
var SUCCESS = 0;
var FINAL_ATTEMPT = 8;
var listDeliveries = async () => {
  const [messages, endpoints] = await Promise.all([
    call("GET", `/app/${APP_UID()}/msg/?limit=100`),
    call("GET", `/app/${APP_UID()}/endpoint/`)
  ]);
  ensureOk(messages);
  ensureOk(endpoints);
  const sent = await Promise.all(
    endpoints.body.data.map((endpoint) => call("GET", `/app/${APP_UID()}/attempt/endpoint/${endpoint.id}/?limit=250`))
  );
  sent.forEach(ensureOk);
  const attempts = sent.flatMap((reply) => reply.body.data);
  return messages.body.data.map((message) => {
    const made = attempts.filter((attempt2) => attempt2.msgId === message.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const latest = made[0];
    const status = latest?.status === SUCCESS ? "delivered" : made.length >= FINAL_ATTEMPT ? "failed" : "retrying";
    return {
      eventId: message.eventId ?? message.id,
      eventType: message.eventType,
      status,
      attempts: made.length,
      lastStatusCode: latest?.responseStatusCode ?? null
    };
  });
};

// server/events.ts
var writeEvent = async (tx, type, reference, boxNumber2) => {
  await tx.query(
    "INSERT INTO events (event_id, type, reference, box_number, occurred_at) VALUES ($1, $2, $3, $4, $5)",
    [newEventId("evt"), type, reference, boxNumber2, businessNow()]
  );
};
var messageOf = (event) => ({
  eventId: event.event_id,
  type: event.type,
  reference: event.reference,
  boxNumber: event.box_number,
  occurredAt: event.occurred_at.toISOString()
});
var RETRY_DELAYS_MS = [5e3, 2e4];
var MAX_DELIVERIES = 3;
var EffectFailed = class extends Error {
};
var done = async (eventId, effect) => (await pool.query("SELECT 1 FROM event_effects WHERE event_id = $1 AND effect = $2", [eventId, effect])).rowCount === 1;
var mark = async (eventId, effect) => {
  await pool.query("INSERT INTO event_effects (event_id, effect) VALUES ($1, $2) ON CONFLICT DO NOTHING", [eventId, effect]);
};
var sendTemplate = async (event, template) => {
  const order = await requireOrder(pool, event.reference);
  await sendMail(await buildMail(template, order));
};
var effects = {
  "order.paid": [
    { name: "certificate", run: (event) => issueCertificate(event.reference) },
    { name: "receipt", run: (event) => sendTemplate(event, "receipt") },
    {
      name: "gift",
      run: async (event) => {
        const order = await requireOrder(pool, event.reference);
        if (order.gift_email) await sendMail(await buildMail("gift", order));
      }
    },
    {
      name: "webhook",
      run: async (event) => sendMessage(event.event_id, "order.paid", await orderPaidPayload(event.reference, event.event_id))
    }
  ],
  "box.packed": [
    {
      name: "courier",
      run: async (event) => {
        const order = await requireOrder(pool, event.reference);
        const recipient = recipientOf(order);
        const reply = await bookCourier({
          reference: order.reference,
          boxNumber: order.box_number,
          recipientName: recipient.name,
          address: { street: order.street ?? "", postcode: order.postcode ?? "", city: order.city ?? "" }
        }, `courier-${event.event_id}`);
        if (reply.status !== 201) throw new Error("courier refused the booking");
        await withTx(async (tx) => {
          await tx.query("UPDATE orders SET tracking_code = $2 WHERE reference = $1", [order.reference, String(reply.body.trackingCode)]);
          const box = await tx.query("SELECT state FROM boxes WHERE number = $1 FOR UPDATE", [order.box_number]);
          if (box.rows[0].state === "packed") await moveBox(tx, order.box_number, "shipped");
        });
      }
    }
  ]
};
var runEffects = async (event) => {
  let first = null;
  for (const effect of effects[event.type]) {
    if (await done(event.event_id, effect.name)) continue;
    try {
      await effect.run(event);
      await mark(event.event_id, effect.name);
    } catch (error) {
      first ??= `${effect.name} failed: ${(error instanceof Error ? error.message : "error").replace(/\S+@\S+/g, "[address]").slice(0, 120)}`;
    }
  }
  if (first) throw new EffectFailed(first);
};
var deliver = async (body) => {
  const found = await pool.query("SELECT * FROM events WHERE event_id = $1", [body.eventId]);
  const event = found.rows[0];
  if (!event || event.state !== "pending") return;
  try {
    await runEffects(event);
    await pool.query("UPDATE events SET state = 'done', attempts = attempts + 1 WHERE event_id = $1", [event.event_id]);
  } catch (error) {
    const attempts = event.attempts + 1;
    const reason = error instanceof Error ? error.message : "delivery failed";
    if (attempts < MAX_DELIVERIES) {
      await pool.query("UPDATE events SET attempts = $2, last_error = $3 WHERE event_id = $1", [event.event_id, attempts, reason]);
      await publish("retry", body, { "x-due": Date.now() + (RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[1]) });
      return;
    }
    await withTx(async (tx) => {
      await tx.query("UPDATE events SET state = 'dead', attempts = $2, last_error = $3, failed_at = now() WHERE event_id = $1", [event.event_id, attempts, reason]);
      await alertDeadLettered(tx, event.event_id, event.box_number);
    });
    await publish("dead", body);
  }
};
var publishing = false;
var publishPending = async () => {
  if (publishing || !isConnected()) return;
  publishing = true;
  try {
    const pending = await pool.query("SELECT * FROM events WHERE NOT published ORDER BY occurred_at, event_id LIMIT 50");
    for (const event of pending.rows) {
      await publish(event.type, messageOf(event));
      await pool.query("UPDATE events SET published = true WHERE event_id = $1", [event.event_id]);
    }
  } catch {
    return;
  } finally {
    publishing = false;
  }
};
var hasUnpublishedEvents = async () => (await pool.query("SELECT 1 FROM events WHERE NOT published LIMIT 1")).rowCount === 1;
var consumingOn = null;
var consume = async () => {
  try {
    const channel2 = await getChannel();
    if (consumingOn === channel2) return;
    consumingOn = channel2;
    await channel2.prefetch(10);
    await channel2.consume(names.main, (message) => {
      if (!message) return;
      void deliver(JSON.parse(message.content.toString("utf8"))).then(() => channel2.ack(message), () => channel2.nack(message, false, true)).catch(() => void 0);
    });
    await channel2.consume(names.retry, (message) => {
      if (!message) return;
      const body = JSON.parse(message.content.toString("utf8"));
      const due = Number(message.properties.headers?.["x-due"] ?? 0);
      setTimeout(() => {
        void publish(body.type, body).then(() => channel2.ack(message), () => channel2.nack(message, false, true)).catch(() => void 0);
      }, Math.max(0, due - Date.now()));
    });
  } catch {
    consumingOn = null;
  }
};
var startFulfilment = () => {
  setInterval(() => void consume().then(publishPending), 500).unref();
};
var listDeadLetters = async () => {
  if (!isConnected()) await getChannel();
  const rows = await pool.query("SELECT * FROM events WHERE state = 'dead' ORDER BY failed_at, event_id");
  return rows.rows.map((event) => ({
    eventId: event.event_id,
    type: event.type,
    reference: event.reference,
    boxNumber: event.box_number,
    failedAt: (event.failed_at ?? event.occurred_at).toISOString(),
    lastError: event.last_error ?? ""
  }));
};
var takeFromDeadQueue = async (eventId) => {
  const channel2 = await getChannel();
  const others = [];
  let found = false;
  for (; ; ) {
    const message = await channel2.get(names.dead, { noAck: false });
    if (!message) break;
    if (JSON.parse(message.content.toString("utf8")).eventId === eventId) {
      channel2.ack(message);
      found = true;
      break;
    }
    others.push(message);
  }
  for (const message of others) channel2.nack(message, false, true);
  return found;
};
var deadEvent = async (eventId) => {
  const found = await pool.query("SELECT * FROM events WHERE event_id = $1 AND state = 'dead'", [eventId]);
  return found.rows[0] ?? null;
};
var retryDeadLetter = async (eventId) => {
  const event = await deadEvent(eventId);
  if (!event) return false;
  await pool.query("UPDATE events SET state = 'pending', attempts = 0 WHERE event_id = $1", [eventId]);
  try {
    await publish(event.type, messageOf(event));
  } catch (error) {
    await pool.query("UPDATE events SET state = 'dead', attempts = $2 WHERE event_id = $1", [eventId, event.attempts]);
    throw error;
  }
  await takeFromDeadQueue(eventId);
  return true;
};
var dismissDeadLetter = async (eventId, note) => {
  const event = await deadEvent(eventId);
  if (!event) return false;
  await takeFromDeadQueue(eventId);
  await pool.query("UPDATE events SET state = 'dismissed', dismissal_note = $2 WHERE event_id = $1", [eventId, note]);
  return true;
};

// server/identity.ts
import { createPublicKey, verify } from "node:crypto";
var IdentityUnreachable = class extends Error {
  constructor() {
    super("identity unreachable");
  }
};
var REALM = () => `${config.keycloak.url}/realms/${config.keycloak.realm}`;
var ADMIN = () => `${config.keycloak.url}/admin/realms/${config.keycloak.realm}`;
var send = async (url, init) => {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(1e4) });
    if (response.status >= 500) throw new IdentityUnreachable();
    return response;
  } catch {
    throw new IdentityUnreachable();
  }
};
var tokenRequest = async (form) => {
  const response = await send(`${REALM()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.keycloak.clientId, client_secret: config.keycloak.clientSecret, ...form })
  });
  return response.ok ? await response.json() : null;
};
var authorizationUrl = (redirectUri, state) => `${config.keycloak.issuer}/protocol/openid-connect/auth?${new URLSearchParams({
  client_id: config.keycloak.clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "openid",
  state
})}`;
var exchangeCode = async (code, redirectUri) => {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  return typeof tokens?.access_token === "string" ? tokens.access_token : null;
};
var assertReachable = async () => {
  await send(`${REALM()}/.well-known/openid-configuration`, { method: "GET" });
};
var keys = /* @__PURE__ */ new Map();
var refreshKeys = async () => {
  const response = await send(`${REALM()}/protocol/openid-connect/certs`, { method: "GET" });
  const body = await response.json();
  keys = new Map(body.keys.map((key) => [key.kid, key]));
};
var decodePart = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
var verifyAccessToken = async (token) => {
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) return null;
  try {
    const header2 = decodePart(head);
    const claims = decodePart(body);
    if (header2.alg !== "RS256" || typeof header2.kid !== "string") return null;
    if (!keys.has(header2.kid)) await refreshKeys();
    const jwk = keys.get(header2.kid);
    if (!jwk) return null;
    const valid = verify("RSA-SHA256", Buffer.from(`${head}.${body}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url"));
    const expires = typeof claims.exp === "number" ? claims.exp : 0;
    if (!valid || claims.iss !== config.keycloak.issuer || expires * 1e3 < Date.now()) return null;
    return { username: String(claims.preferred_username ?? ""), roles: rolesOf(claims) };
  } catch {
    return null;
  }
};
var rolesOf = (claims) => {
  const access = claims.realm_access;
  return ROLES.filter((role) => access?.roles?.includes(role));
};
var serviceToken = async () => {
  const tokens = await tokenRequest({ grant_type: "client_credentials" });
  if (typeof tokens?.access_token !== "string") throw new IdentityUnreachable();
  return tokens.access_token;
};
var provision = async () => {
  const authorization = { authorization: `Bearer ${await serviceToken()}`, "content-type": "application/json" };
  const json = async (path, init = {}) => send(`${ADMIN()}${path}`, { ...init, headers: { ...authorization, ...init.headers ?? {} } });
  for (const role of ROLES) {
    const existing = await json(`/roles/${role}`);
    if (existing.status === 404) await json("/roles", { method: "POST", body: JSON.stringify({ name: role }) });
  }
  for (const staff of config.staffSeeds) {
    const found = await (await json(`/users?username=${staff.username}&exact=true`)).json();
    let id = found[0]?.id;
    if (!id) {
      const created = await json("/users", {
        method: "POST",
        body: JSON.stringify({
          username: staff.username,
          enabled: true,
          emailVerified: true,
          firstName: staff.username,
          lastName: "Press",
          email: `${staff.username}@svovlstik.example`,
          credentials: [{ type: "password", value: staff.password, temporary: false }]
        })
      });
      id = created.headers.get("location")?.split("/").at(-1);
    }
    if (!id) throw new IdentityUnreachable();
    const role = await (await json(`/roles/${staff.role}`)).json();
    await json(`/users/${id}/role-mappings/realm`, { method: "POST", body: JSON.stringify([role]) });
  }
};

// server/auth.ts
import { randomBytes as randomBytes2 } from "node:crypto";
var SESSION_COOKIE = "press_session";
var STATE_COOKIE = "press_oidc";
var cookieOf = (request2, name) => {
  const header2 = request2.headers.cookie ?? "";
  for (const part of header2.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
};
var authenticate = async (request2) => {
  const bearer = /^Bearer (.+)$/.exec(request2.headers.authorization ?? "")?.[1];
  if (bearer) return verifyAccessToken(bearer).catch(() => null);
  const session = cookieOf(request2, SESSION_COOKIE);
  if (!session) return null;
  const found = await pool.query("SELECT username, roles FROM sessions WHERE id = $1 AND created_at > now() - interval '8 hours'", [session]);
  const row = found.rows[0];
  return row ? { username: row.username, roles: row.roles } : null;
};
var requireStaff = async (request2, role) => {
  const principal = await authenticate(request2);
  if (!principal) return fail("sign_in_required");
  if (role === "any" ? principal.roles.length === 0 : !principal.roles.includes(role)) return fail("forbidden");
  return principal;
};
var requireSignedIn = async (request2) => await authenticate(request2) ?? fail("sign_in_required");
var originOf = (request2) => `${request2.protocol}://${request2.headers.host}`;
var cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
var startLogin = async (request2, reply) => {
  try {
    await assertReachable();
  } catch (error) {
    if (error instanceof IdentityUnreachable) return fail("identity_unreachable");
    throw error;
  }
  const state = randomBytes2(16).toString("hex");
  reply.header("set-cookie", cookie(STATE_COOKIE, state, 600));
  reply.redirect(authorizationUrl(`${originOf(request2)}/auth/callback`, state), 302);
};
var finishLogin = async (request2, reply) => {
  const query = request2.query;
  if (!query.code || !query.state || query.state !== cookieOf(request2, STATE_COOKIE)) return fail("sign_in_required");
  let token;
  try {
    token = await exchangeCode(query.code, `${originOf(request2)}/auth/callback`);
  } catch (error) {
    if (error instanceof IdentityUnreachable) return fail("identity_unreachable");
    throw error;
  }
  const principal = token ? await verifyAccessToken(token) : null;
  if (!principal) return fail("sign_in_required");
  const id = randomBytes2(24).toString("base64url");
  await pool.query("INSERT INTO sessions (id, username, roles) VALUES ($1, $2, $3)", [id, principal.username, principal.roles]);
  reply.header("set-cookie", [cookie(SESSION_COOKIE, id, 28800), cookie(STATE_COOKIE, "", 0)]);
  reply.redirect("/staff", 302);
};
var logout = async (request2, reply) => {
  const session = cookieOf(request2, SESSION_COOKIE);
  if (session) await pool.query("DELETE FROM sessions WHERE id = $1", [session]);
  reply.header("set-cookie", cookie(SESSION_COOKIE, "", 0)).code(204).send();
};

// server/routes-auth.ts
var registerAuthRoutes = (app) => {
  app.get("/auth/login", startLogin);
  app.get("/auth/callback", finishLogin);
  app.post("/auth/logout", logout);
};

// server/routes-public.ts
import { readFile } from "node:fs/promises";

// server/killbill.ts
var LedgerUnreachable = class extends Error {
  constructor() {
    super("ledger unreachable");
  }
};
var BASE = `${config.killbill.url}/1.0/kb`;
var headers = () => ({
  authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
  "x-killbill-apikey": config.killbill.apiKey,
  "x-killbill-apisecret": config.killbill.apiSecret,
  "x-killbill-createdby": "svovlstik-press",
  "content-type": "application/json",
  accept: "application/json"
});
var call2 = async (method, path, body) => {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: headers(),
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(2e4)
    });
  } catch {
    throw new LedgerUnreachable();
  }
  if (response.status >= 500) throw new LedgerUnreachable();
  const text3 = await response.text();
  return { status: response.status, body: text3 ? JSON.parse(text3) : null, location: response.headers.get("location") };
};
var must = (reply) => {
  if (reply.status >= 400) throw new LedgerUnreachable();
  return reply;
};
var ensureAccount = async (email, name) => {
  const key = email.toLowerCase();
  const known = await pool.query("SELECT account_id FROM kb_accounts WHERE email = $1", [key]);
  if (known.rows[0]) return known.rows[0].account_id;
  let found = await call2("GET", `/accounts?externalKey=${encodeURIComponent(key)}`);
  if (found.status === 404) {
    const created = await call2("POST", "/accounts", { name, email: key, externalKey: key, currency: "DKK" });
    if (created.status !== 409) must(created);
    found = must(await call2("GET", `/accounts?externalKey=${encodeURIComponent(key)}`));
    const accountId2 = found.body.accountId;
    must(await call2("POST", `/accounts/${accountId2}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__" }));
  }
  const accountId = must(found).body.accountId;
  await pool.query("INSERT INTO kb_accounts (email, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [key, accountId]);
  return accountId;
};
var createInvoice = async (accountId, shares) => {
  const items = Object.entries(shares).map(([description, ore]) => ({
    accountId,
    amount: toDecimalKroner(ore),
    currency: "DKK",
    description
  }));
  const created = must(await call2("POST", `/invoices/charges/${accountId}?autoCommit=true`, items));
  return created.body[0]?.invoiceId ?? "";
};
var loadPayment = async (reference) => {
  const found = await call2("GET", `/payments?externalKey=${encodeURIComponent(reference)}`);
  return found.status === 404 ? null : must(found).body;
};
var transactions = async (reference) => {
  const payment = await loadPayment(reference);
  return (payment?.transactions ?? []).map((item) => ({ type: item.transactionType, amountOre: fromDecimalKroner(item.amount) }));
};
var recordPayment = async (accountId, reference, type, amountOre, transactionKey) => {
  const payment = await loadPayment(reference);
  if (payment?.transactions.some((item) => item.transactionExternalKey === transactionKey)) return payment.paymentId;
  const amount = { amount: toDecimalKroner(amountOre), currency: "DKK", transactionExternalKey: transactionKey };
  if (type === "AUTHORIZE" || type === "PURCHASE") {
    must(await call2("POST", `/accounts/${accountId}/payments`, {
      transactionType: type,
      paymentExternalKey: reference,
      ...amount
    }));
    const created = await loadPayment(reference);
    return created?.paymentId ?? "";
  }
  const paymentId = payment?.paymentId ?? "";
  if (type === "CAPTURE") must(await call2("POST", `/payments/${paymentId}`, amount));
  else if (type === "REFUND") must(await call2("POST", `/payments/${paymentId}/refunds`, amount));
  else must(await call2("DELETE", `/payments/${paymentId}`, { transactionExternalKey: transactionKey }));
  return paymentId;
};
var loadItems = async (accountId) => {
  const invoices = must(await call2("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`));
  return invoices.body.flatMap((invoice) => invoice.items);
};
var invoiceView = async (accountId, invoiceId) => {
  const items = (await loadItems(accountId)).filter((item) => item.invoiceId === invoiceId);
  const originals = items.filter((item) => item.itemType === "EXTERNAL_CHARGE");
  return {
    invoiceId,
    items: originals.map((original) => ({
      description: original.description,
      amountOre: items.filter((item) => item.invoiceItemId === original.invoiceItemId || item.linkedInvoiceItemId === original.invoiceItemId).reduce((sum2, item) => sum2 + (fromDecimalKroner(item.amount) ?? 0), 0)
    }))
  };
};
var adjustShares = async (accountId, invoiceId, reductions, adjustmentKey) => {
  const items = (await loadItems(accountId)).filter((item) => item.invoiceId === invoiceId);
  for (const [description, ore] of Object.entries(reductions)) {
    if (ore <= 0) continue;
    const original = items.find((item) => item.itemType === "EXTERNAL_CHARGE" && item.description === description);
    if (!original) continue;
    const marker = `${adjustmentKey}:${description}`;
    if (items.some((item) => item.linkedInvoiceItemId === original.invoiceItemId && item.description === marker)) continue;
    must(await call2("POST", `/invoices/${invoiceId}`, {
      accountId,
      invoiceId,
      invoiceItemId: original.invoiceItemId,
      amount: toDecimalKroner(ore),
      currency: "DKK",
      description: marker
    }));
  }
};
var assertReachable2 = async () => {
  await call2("GET", "/accounts?externalKey=reachability-probe");
};

// server/ledger.ts
var sharesOf = async (order) => {
  const parts = saleParts(await orderRate(pool, order));
  return {
    "maker share": parts.makerOre,
    "charity share": parts.charityOre,
    VAT: parts.vatOre,
    courier: EDITION_PRICE.courierOre
  };
};
var accountOf = async (order) => order.kb_account_id ?? ensureAccount(order.buyer_email ?? "", order.buyer_name ?? "");
var ensureInvoice = async (order) => {
  if (order.kb_invoice_id) return order.kb_invoice_id;
  const accountId = await accountOf(order);
  const invoiceId = await createInvoice(accountId, await sharesOf(order));
  await pool.query("UPDATE orders SET kb_invoice_id = $2, kb_account_id = $3 WHERE reference = $1", [order.reference, invoiceId, accountId]);
  order.kb_invoice_id = invoiceId;
  return invoiceId;
};
var rememberPayment = async (order, paymentId) => {
  await pool.query("UPDATE orders SET kb_payment_id = $2 WHERE reference = $1", [order.reference, paymentId]);
  order.kb_payment_id = paymentId;
};
var recordAuthorisation = async (order) => {
  await ensureInvoice(order);
  await rememberPayment(order, await recordPayment(await accountOf(order), order.reference, "AUTHORIZE", EDITION_PRICE.totalOre, `${order.reference}-authorize`));
  await pool.query("UPDATE orders SET kb_closed = false WHERE reference = $1", [order.reference]);
};
var recordCapture = async (order) => {
  await recordPayment(await accountOf(order), order.reference, "CAPTURE", EDITION_PRICE.totalOre, `${order.reference}-capture`);
};
var recordSettlement = async (order) => {
  await ensureInvoice(order);
  await rememberPayment(order, await recordPayment(await accountOf(order), order.reference, "PURCHASE", EDITION_PRICE.totalOre, `${order.reference}-purchase`));
};
var recordRefund = async (order, refund) => {
  const account = await accountOf(order);
  await recordPayment(account, order.reference, "REFUND", refund.amount_ore, refund.refund_id);
  await adjustShares(account, await ensureInvoice(order), {
    "maker share": refund.maker_ore,
    "charity share": refund.charity_ore,
    VAT: refund.vat_ore
  }, refund.refund_id);
};
var recordClosure = async (order) => {
  if (order.kb_payment_id) await recordPayment(await accountOf(order), order.reference, "VOID", 0, `${order.reference}-void`);
  if (order.kb_invoice_id) {
    await adjustShares(await accountOf(order), order.kb_invoice_id, await sharesOf(order), `${order.reference}-close`);
  }
  await pool.query("UPDATE orders SET kb_closed = true WHERE reference = $1", [order.reference]);
};

// server/locks.ts
var tails = /* @__PURE__ */ new Map();
var serial = (key, work) => {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => void 0);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
};

// server/refunds.ts
import { randomUUID as randomUUID4 } from "node:crypto";
var refundsOf = async (q, reference) => (await q.query("SELECT * FROM refunds WHERE reference = $1 ORDER BY created_at, refund_id", [reference])).rows;
var remainders = async (q, order) => {
  const sale = saleParts(await orderRate(q, order));
  const taken = (await refundsOf(q, order.reference)).reduce(
    (sum2, refund) => ({
      grossOre: sum2.grossOre + refund.amount_ore,
      netOre: sum2.netOre + refund.net_ore,
      vatOre: sum2.vatOre + refund.vat_ore,
      charityOre: sum2.charityOre + refund.charity_ore,
      makerOre: sum2.makerOre + refund.maker_ore
    }),
    { grossOre: 0, netOre: 0, vatOre: 0, charityOre: 0, makerOre: 0 }
  );
  return {
    grossOre: EDITION_PRICE.priceOre - taken.grossOre,
    netOre: sale.netOre - taken.netOre,
    vatOre: sale.vatOre - taken.vatOre,
    charityOre: sale.charityOre - taken.charityOre,
    makerOre: sale.makerOre - taken.makerOre
  };
};
var checkRefundAmount = async (q, order, amountOre) => {
  if (!Number.isInteger(amountOre) || amountOre <= 0) return fail("refund_invalid");
  const left = await remainders(q, order);
  if (amountOre > left.grossOre) return fail("refund_exceeds_remainder");
  return splitRefund(amountOre, left, await orderRate(q, order));
};
var reserveRefund = async (reference, amountOre, key, gatewayRefundId) => withTx(async (tx) => {
  const order = await requireOrder(tx, reference, true);
  const parts = await checkRefundAmount(tx, order, amountOre);
  const refundId = gatewayRefundId ?? `ref_${randomUUID4()}`;
  const inserted = await tx.query(
    `INSERT INTO refunds (refund_id, reference, idempotency_key, amount_ore, net_ore, vat_ore, charity_ore, maker_ore,
         gateway_refund_id, rate_basis_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [refundId, reference, key, amountOre, parts.netOre, parts.vatOre, parts.charityOre, parts.makerOre, gatewayRefundId, await orderRate(tx, order)]
  );
  return inserted.rows[0];
});
var dropRefund = async (refundId) => {
  await pool.query("DELETE FROM refunds WHERE refund_id = $1 AND state = 'pending'", [refundId]);
};
var settle = async (tx, order, refund) => {
  const settledBefore = (await tx.query("SELECT coalesce(sum(amount_ore), 0)::int AS gross FROM refunds WHERE reference = $1 AND state = 'settled'", [order.reference])).rows[0].gross;
  const finalRefund = settledBefore + refund.amount_ore === EDITION_PRICE.priceOre;
  const now = businessNow();
  await tx.query("UPDATE refunds SET state = 'settled', kb_done = true, settled_at = $2 WHERE refund_id = $1", [refund.refund_id, now]);
  await tx.query(
    `INSERT INTO split_lines (reference, box_number, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_basis_points, posted_at, refund_id)
     VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [order.reference, order.box_number, -refund.amount_ore, -refund.net_ore, -refund.vat_ore, -refund.charity_ore, -refund.maker_ore, refund.rate_basis_points, now, refund.refund_id]
  );
  await setPaymentState(tx, order, finalRefund ? "refunded" : "partially_refunded");
  if (finalRefund) {
    await moveBox(tx, order.box_number, "returned");
    await tx.query("UPDATE orders SET certificate_state = 'cancelled' WHERE reference = $1", [order.reference]);
  }
  await enqueue(tx, "mail", `refund-mail-${refund.refund_id}`, { template: "refund", reference: order.reference, refundOre: refund.amount_ore });
  await enqueue(tx, "webhook", `refund-hook-${refund.refund_id}`, { refundId: refund.refund_id });
};
var finishRefund = (refundId) => serial(`refund:${refundId}`, async () => {
  const found = await pool.query("SELECT * FROM refunds WHERE refund_id = $1", [refundId]);
  const refund = found.rows[0];
  if (!refund || refund.state === "settled" || !refund.gateway_confirmed) return refund?.state === "settled";
  const order = await requireOrder(pool, refund.reference);
  await recordRefund(order, refund);
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, refund.reference, true);
    const current = await tx.query("SELECT state FROM refunds WHERE refund_id = $1 FOR UPDATE", [refundId]);
    if (current.rows[0].state === "pending") await settle(tx, locked, refund);
  });
  return true;
});
var confirmRefund = async (refundId) => {
  await pool.query("UPDATE refunds SET gateway_confirmed = true WHERE refund_id = $1", [refundId]);
  return finishRefund(refundId);
};
var refundForGatewayEvent = async (reference, gatewayRefundId, amountOre) => {
  const known = gatewayRefundId ? (await pool.query("SELECT refund_id FROM refunds WHERE gateway_refund_id = $1 OR refund_id = $1", [gatewayRefundId])).rows[0] : null;
  if (known) return known.refund_id;
  return (await reserveRefund(reference, amountOre, null, gatewayRefundId).catch(() => null))?.refund_id ?? null;
};
var applyWaitingRefunds = async (reference) => {
  const waiting = await pool.query("SELECT event_id, payload FROM payment_events WHERE reference = $1 AND status = 'waiting' ORDER BY sequence", [reference]);
  for (const row of waiting.rows) {
    const refundId = await refundForGatewayEvent(reference, row.payload.refundId, row.payload.amountOre);
    await pool.query("UPDATE payment_events SET status = 'applied' WHERE event_id = $1", [row.event_id]);
    if (refundId) await confirmRefund(refundId);
  }
};
var refundBody = (refund) => ({
  refundId: refund.refund_id,
  reference: refund.reference,
  state: refund.state,
  amountOre: refund.amount_ore,
  netOre: refund.net_ore,
  vatOre: refund.vat_ore,
  charityOre: refund.charity_ore,
  makerOre: refund.maker_ore
});
var startStaffRefund = async (reference, amountOre, key) => {
  const order = await requireOrder(pool, reference);
  if (!isRefundableState(order.payment_state)) return fail("not_captured");
  await checkRefundAmount(pool, order, amountOre);
  try {
    await assertReachable2();
  } catch (error) {
    if (error instanceof LedgerUnreachable) return fail("ledger_unreachable", { message: OUTAGE_COPY.refund.ledger_unreachable });
    throw error;
  }
  const refund = await reserveRefund(reference, amountOre, key, null);
  try {
    const reply = order.method === "bank" ? await refundTransfer(order.transfer_id ?? "", amountOre, key) : await refundPayment(order.payment_id ?? "", amountOre, key);
    if (typeof reply.body.refundId === "string") {
      await pool.query("UPDATE refunds SET gateway_refund_id = $2 WHERE refund_id = $1", [refund.refund_id, reply.body.refundId]);
    }
    if (reply.body.confirmation !== "callback") await confirmRefund(refund.refund_id).catch(() => false);
  } catch (error) {
    await dropRefund(refund.refund_id);
    if (error instanceof GatewayUnreachable) return fail("gateway_unreachable", { message: OUTAGE_COPY.refund.gateway_unreachable });
    throw error;
  }
  const settled = (await pool.query("SELECT * FROM refunds WHERE refund_id = $1", [refund.refund_id])).rows[0];
  return { status: 202, body: refundBody(settled) };
};

// server/valkey.ts
import { Redis } from "ioredis";
var client = new Redis(config.valkeyUrl || "redis://127.0.0.1:9/0", {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  connectTimeout: 2e3,
  retryStrategy: () => 500
});
client.on("error", () => void 0);
var up = false;
client.on("ready", () => {
  up = true;
});
client.on("close", () => {
  up = false;
});
client.on("end", () => {
  up = false;
});
var ValkeyUnreachable = class extends Error {
  constructor() {
    super("valkey unreachable");
  }
};
var isUp = () => up;
var connectValkey = () => {
  void client.connect().catch(() => void 0);
};
var guarded = async (work) => {
  if (!up) throw new ValkeyUnreachable();
  try {
    return await work();
  } catch {
    throw new ValkeyUnreachable();
  }
};
var holdKey = (number) => named(`hold:${number}`);
var grantHold = (number, token, holdMs) => guarded(async () => await client.set(holdKey(number), token, "PX", holdMs, "NX") === "OK");
var holdState = (number) => guarded(async () => {
  const answers = await client.pipeline().get(holdKey(number)).pttl(holdKey(number)).exec();
  const owner = answers?.[0]?.[1];
  const remainingMs = answers?.[1]?.[1];
  return { owner: typeof owner === "string" ? owner : null, remainingMs: typeof remainingMs === "number" && remainingMs > 0 ? remainingMs : 0 };
});
var releaseHold = (number, token) => guarded(async () => {
  const deleted = await client.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    holdKey(number),
    token
  );
  return deleted === 1;
});
var heldNumbers = (count) => guarded(async () => {
  const keys2 = Array.from({ length: count }, (_, index) => holdKey(index + 1));
  const owners = await client.mget(...keys2);
  const held = /* @__PURE__ */ new Set();
  owners.forEach((owner, index) => {
    if (owner !== null) held.add(index + 1);
  });
  return held;
});
var lookupKey = (clientId) => named(`lookup:${clientId}`);
var countRefusal = (clientId, windowSeconds) => guarded(async () => {
  const key = lookupKey(clientId);
  const count = await client.incr(key);
  if (count === 1) await client.expire(key, windowSeconds);
  const ttl = await client.ttl(key);
  return { count, ttl: ttl > 0 ? ttl : windowSeconds };
});
var refusalState = (clientId) => guarded(async () => {
  const key = lookupKey(clientId);
  const [count, ttl] = await Promise.all([client.get(key), client.ttl(key)]);
  return { count: Number(count ?? 0), ttl: ttl > 0 ? ttl : 0 };
});

// server/shelf.ts
var CLOSE_MS = Date.parse(CLOSES_AT);
var listeners = /* @__PURE__ */ new Set();
var states = Array.from({ length: EDITION }, () => "available");
var paused = !isUp();
var open2 = businessNow().getTime() < CLOSE_MS;
var ticking = false;
var salesOpen = () => open2;
var subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
var emit = (event) => {
  for (const listener of listeners) listener(event);
};
var salesEvent = () => ({ name: "sales", data: { salesPaused: paused, salesOpen: open2 } });
var readShelf = async () => {
  const rows = await pool.query("SELECT number, state FROM boxes ORDER BY number");
  let held = /* @__PURE__ */ new Set();
  let unreachable = false;
  try {
    held = await heldNumbers(EDITION);
  } catch {
    unreachable = true;
  }
  const states2 = rows.rows.map((row) => row.state !== "available" ? "taken" : held.has(row.number) ? "held" : "available");
  return { states: states2, salesPaused: unreachable };
};
var tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const { states: next, salesPaused: nowPaused } = await readShelf();
    const nowOpen = businessNow().getTime() < CLOSE_MS;
    next.forEach((state, index) => {
      if (states[index] !== state) emit({ name: "box", data: { number: index + 1, state } });
    });
    states = next;
    if (nowPaused !== paused || nowOpen !== open2) {
      paused = nowPaused;
      open2 = nowOpen;
      emit(salesEvent());
    }
  } catch {
    return;
  } finally {
    ticking = false;
  }
};
var nudge = () => {
  void tick();
};
var startShelf = () => {
  void tick();
  setInterval(() => void tick(), 400).unref();
};

// server/payments.ts
var orderKey = (reference) => `order:${reference}`;
var holdIsLive = async (order) => {
  try {
    return (await holdState(order.box_number)).owner === order.hold_token;
  } catch {
    return false;
  }
};
var lostTheBox = (error) => isUniqueViolation(error) || error instanceof ApiError && error.code === "illegal_transition";
var postSaleLine = async (tx, order) => {
  const rate = await orderRate(tx, order);
  const parts = saleParts(rate);
  await tx.query(
    `INSERT INTO split_lines (reference, box_number, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_basis_points, posted_at)
     VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7, $8, $9)`,
    [order.reference, order.box_number, EDITION_PRICE.priceOre, parts.netOre, parts.vatOre, parts.charityOre, parts.makerOre, rate, businessNow()]
  );
};
var markPaid = async (tx, order) => {
  await postSaleLine(tx, order);
  await tx.query("UPDATE orders SET paid_at = $2, certificate_state = 'pending' WHERE reference = $1", [order.reference, businessNow()]);
  await writeEvent(tx, "order.paid", order.reference, order.box_number);
};
var claimAuthorised = (reference) => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (order.payment_state === "authorised") return "claimed";
  if (!awaitsAuthorisation(order.payment_state)) return "too_late";
  if (await holdIsLive(order)) {
    try {
      await withTx(async (tx) => {
        const locked = await requireOrder(tx, reference, true);
        const now = businessNow();
        await moveBox(tx, locked.box_number, "claimed", reference);
        await setPaymentState(tx, locked, "authorised");
        await tx.query(
          "UPDATE orders SET rate_basis_points = $2, authorised_at = $3, auth_expires_at = $4, kb_closed = false WHERE reference = $1",
          [reference, await rateAt(tx, now), now, new Date(Date.now() + config.authSeconds * 1e3)]
        );
        await enqueue(tx, "mail", `authorisation-${reference}`, { template: "authorisation", reference });
      });
    } catch (error) {
      if (!lostTheBox(error)) throw error;
      await markForVoid(reference);
      return "too_late";
    }
    await releaseHold(order.box_number, order.hold_token).catch(() => false);
    nudge();
    await recordAuthorisation(await requireOrder(pool, reference)).catch(() => void 0);
    return "claimed";
  }
  await markForVoid(reference);
  return "too_late";
});
var markForVoid = async (reference) => {
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (awaitsAuthorisation(locked.payment_state)) await setPaymentState(tx, locked, "authorised");
    await tx.query("UPDATE orders SET void_pending = true WHERE reference = $1", [reference]);
  });
  await voidAtGateway(reference);
};
var voidAtGateway = async (reference) => {
  const order = await requireOrder(pool, reference);
  if (!order.void_pending || order.payment_state !== "authorised" || !order.payment_id) return;
  try {
    await voidPayment(order.payment_id, `void-${reference}`);
  } catch (error) {
    if (error instanceof GatewayUnreachable) return;
    throw error;
  }
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    await setPaymentState(tx, locked, "voided");
    await tx.query("UPDATE orders SET void_pending = false, kb_closed = true WHERE reference = $1", [reference]);
  });
};
var attemptVoid = (reference) => serial(orderKey(reference), () => voidAtGateway(reference));
var expireAuthorisation = (reference) => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (!holdsAuthorisation(order.payment_state) || !order.payment_id) return;
  try {
    await voidPayment(order.payment_id, `expire-${reference}`);
  } catch (error) {
    if (error instanceof GatewayUnreachable) return;
    throw error;
  }
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    await setPaymentState(tx, locked, "authorisation_expired");
    await moveBox(tx, locked.box_number, "available");
    await tx.query("UPDATE orders SET kb_closed = false WHERE reference = $1", [reference]);
    await alertAuthorisationExpired(tx, `expired-${reference}`, locked.box_number, EDITION_PRICE.totalOre);
  });
  await recordClosure(await requireOrder(pool, reference)).catch(() => void 0);
});
var closeLedger = (reference) => serial(orderKey(reference), async () => {
  await recordClosure(await requireOrder(pool, reference));
});
var resumeAuthorisationRecord = (reference) => serial(orderKey(reference), async () => {
  await recordAuthorisation(await requireOrder(pool, reference));
});
var finishCapture = (reference) => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (order.payment_state === "captured") return true;
  if (!order.capture_confirmed || !holdsAuthorisation(order.payment_state)) return false;
  await recordCapture(order);
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (!holdsAuthorisation(locked.payment_state)) return;
    await setPaymentState(tx, locked, "captured");
    await moveBox(tx, locked.box_number, "packed");
    await markPaid(tx, locked);
    await writeEvent(tx, "box.packed", reference, locked.box_number);
  });
  await applyWaitingRefunds(reference);
  return true;
});
var finishSettlement = (reference) => serial(orderKey(reference), async () => {
  const order = await requireOrder(pool, reference);
  if (order.payment_state === "settled") return true;
  if (!order.settle_confirmed || order.payment_state !== "pending") return false;
  await recordSettlement(order);
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (locked.payment_state !== "pending") return;
    await setPaymentState(tx, locked, "settled");
    await moveBox(tx, locked.box_number, "claimed");
    await markPaid(tx, locked);
  });
  await applyWaitingRefunds(reference);
  return true;
});
var lapseTransfer = (reference) => serial(orderKey(reference), async () => {
  await withTx(async (tx) => {
    const locked = await requireOrder(tx, reference, true);
    if (locked.payment_state !== "pending") return;
    await setPaymentState(tx, locked, "lapsed");
    await moveBox(tx, locked.box_number, "available");
    await enqueue(tx, "mail", `lapse-${reference}`, { template: "lapse", reference });
  });
});
var markPackedBankOrder = async (tx, order) => {
  await moveBox(tx, order.box_number, "packed");
  await writeEvent(tx, "box.packed", order.reference, order.box_number);
};

// server/callbacks.ts
var TYPES = ["payment.authorised", "payment.declined", "payment.captured", "payment.capture_failed", "payment.voided", "payment.refunded", "transfer.received"];
var text2 = (value) => typeof value === "string" ? value : null;
var parseCallback = (raw) => {
  const body = raw && typeof raw === "object" ? raw : {};
  const { eventId, reference, sequence, amountOre } = body;
  if (typeof eventId !== "string" || typeof reference !== "string" || !TYPES.some((type) => type === body.type) || typeof sequence !== "number" || !Number.isInteger(sequence) || typeof amountOre !== "number" || !Number.isInteger(amountOre)) {
    return fail("validation_failed");
  }
  return {
    eventId,
    reference,
    sequence,
    amountOre,
    type: body.type,
    paymentId: text2(body.paymentId),
    transferId: text2(body.transferId),
    refundId: text2(body.refundId),
    declineCode: text2(body.declineCode)
  };
};
var record = async (event, status) => {
  await pool.query("UPDATE payment_events SET status = $2 WHERE event_id = $1", [event.eventId, status]);
};
var onTransfer = async (order, event) => {
  if (order.method !== "bank" || !order.transfer_id) return "ignored";
  if (order.payment_state === "pending" && order.deadline_at && order.deadline_at.getTime() <= businessNow().getTime()) {
    await lapseTransfer(order.reference);
  }
  const current = await requireOrder(pool, order.reference);
  if (current.payment_state === "lapsed") {
    await refundTransfer(order.transfer_id, event.amountOre, `late-${event.eventId}`);
    await enqueue(pool, "mail", `refund-mail-late-${event.eventId}`, { template: "refund", reference: order.reference, refundOre: event.amountOre });
    return "applied";
  }
  if (current.payment_state !== "pending") return "ignored";
  if (event.amountOre !== EDITION_PRICE.totalOre) {
    await returnTransfer(order.transfer_id, event.amountOre, `return-${event.eventId}`);
    await enqueue(pool, "mail", `refund-mail-wrong-${event.eventId}`, { template: "refund", reference: order.reference, refundOre: event.amountOre });
    return "applied";
  }
  await pool.query("UPDATE orders SET settle_confirmed = true WHERE reference = $1", [order.reference]);
  await finishSettlement(order.reference).catch(() => false);
  return "applied";
};
var onRefund = async (order, event) => {
  if (holdsAuthorisation(order.payment_state)) return "waiting";
  if (order.payment_state !== "captured" && order.payment_state !== "partially_refunded" && order.payment_state !== "settled") return "ignored";
  const refundId = await refundForGatewayEvent(order.reference, event.refundId, event.amountOre);
  if (!refundId) return "ignored";
  await confirmRefund(refundId).catch(() => false);
  return "applied";
};
var apply = async (order, event) => {
  switch (event.type) {
    case "payment.authorised": {
      if (!awaitsAuthorisation(order.payment_state)) return "ignored";
      if (event.paymentId && !order.payment_id) await pool.query("UPDATE orders SET payment_id = $2 WHERE reference = $1", [order.reference, event.paymentId]);
      await claimAuthorised(order.reference);
      return "applied";
    }
    case "payment.declined": {
      if (!awaitsAuthorisation(order.payment_state)) return "ignored";
      await setPaymentState(pool, order, "declined");
      return "applied";
    }
    case "payment.captured": {
      if (!holdsAuthorisation(order.payment_state)) return "ignored";
      await pool.query("UPDATE orders SET capture_confirmed = true WHERE reference = $1", [order.reference]);
      await finishCapture(order.reference).catch(() => false);
      return "applied";
    }
    case "payment.capture_failed": {
      if (order.payment_state !== "authorised") return "ignored";
      await withTx(async (tx) => {
        await setPaymentState(tx, order, "capture_failed");
        await tx.query("UPDATE orders SET capture_requested = false WHERE reference = $1", [order.reference]);
        await alertCaptureFailed(tx, `capfail-${event.eventId}`, order.box_number, EDITION_PRICE.totalOre);
      });
      return "applied";
    }
    case "payment.voided": {
      if (order.payment_state !== "authorised") return "ignored";
      await withTx(async (tx) => {
        await setPaymentState(tx, order, "voided");
        await moveBox(tx, order.box_number, "available");
        await tx.query("UPDATE orders SET kb_closed = false WHERE reference = $1", [order.reference]);
      });
      return "applied";
    }
    case "payment.refunded":
      return onRefund(order, event);
    case "transfer.received":
      return onTransfer(order, event);
  }
};
var handleCallback = async (event) => {
  const order = await loadOrder(pool, event.reference);
  if (!order) return fail("not_found");
  const inserted = await pool.query(
    "INSERT INTO payment_events (event_id, reference, sequence, type, status, payload) VALUES ($1, $2, $3, $4, 'received', $5) ON CONFLICT DO NOTHING",
    [event.eventId, event.reference, event.sequence, event.type, event]
  );
  if (inserted.rowCount === 0) return "duplicate";
  const fresh = await requireOrder(pool, event.reference);
  if (event.sequence < fresh.last_sequence) {
    await record(event, "ignored");
    return "ignored";
  }
  let outcome;
  try {
    outcome = await apply(fresh, event);
  } catch (error) {
    await pool.query("DELETE FROM payment_events WHERE event_id = $1", [event.eventId]);
    throw error;
  }
  await record(event, outcome);
  if (outcome === "applied") await pool.query("UPDATE orders SET last_sequence = GREATEST(last_sequence, $2) WHERE reference = $1", [event.reference, event.sequence]);
  return outcome;
};

// server/deadline.ts
var BANKING_DAYS = 3;
var HOLIDAYS = /* @__PURE__ */ new Set(["12-24", "12-25", "12-26", "12-31", "01-01"]);
var isBankingDay = (date) => {
  const weekday = date.getUTCDay();
  const key = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(key);
};
var transferDeadline = (orderedAt = businessNow()) => {
  if (config.transferSeconds !== null) return new Date(orderedAt.getTime() + config.transferSeconds * 1e3);
  const ordered = copenhagenTime(orderedAt);
  const day = new Date(Date.UTC(ordered.year, ordered.month - 1, ordered.day));
  let counted = 0;
  while (counted < BANKING_DAYS) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (isBankingDay(day)) counted += 1;
  }
  const lastSecond = copenhagenInstant({
    year: day.getUTCFullYear(),
    month: day.getUTCMonth() + 1,
    day: day.getUTCDate(),
    hour: 23,
    minute: 59,
    second: 59
  });
  return new Date(lastSecond.getTime() + 999);
};

// server/holds.ts
var HOLD_MS = config.holdSeconds * 1e3;
var isBoxNumber = (value) => Number.isInteger(value) && value >= 1 && value <= EDITION;
var guard = async (work) => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ValkeyUnreachable) return fail("sales_paused");
    throw error;
  }
};
var grantBody = (number, token, remainingMs) => ({
  number,
  plate: plateOf(number),
  holdToken: token,
  holdMs: HOLD_MS,
  remainingMs
});
var reach = (number, ownToken) => guard(async () => {
  if (!isBoxNumber(number)) return fail("validation_failed");
  if (ownToken) {
    const own = await holdState(number);
    if (own.owner === ownToken) return { status: 200, body: grantBody(number, ownToken, own.remainingMs) };
  }
  if (!salesOpen()) return fail("edition_closed");
  const box = await pool.query("SELECT state FROM boxes WHERE number = $1", [number]);
  if (box.rows[0].state !== "available") return fail("box_taken", { number });
  const token = newToken();
  if (!await grantHold(number, token, HOLD_MS)) return fail("box_held", { number });
  nudge();
  return { status: 201, body: grantBody(number, token, (await holdState(number)).remainingMs) };
});
var ownedHold = (number, token) => guard(async () => {
  const hold = await holdState(number);
  if (hold.owner === null) return fail("hold_ended", { number });
  if (hold.owner !== token) return fail("hold_not_yours");
  return hold.remainingMs;
});
var holdStatus = async (number, token) => ({
  number,
  state: "held",
  holdMs: HOLD_MS,
  remainingMs: await ownedHold(number, token)
});
var putBack = async (number, token) => {
  await ownedHold(number, token);
  await guard(() => releaseHold(number, token ?? ""));
  nudge();
};
var remainingOrNull = async (number) => {
  try {
    return (await holdState(number)).remainingMs || null;
  } catch {
    return null;
  }
};

// server/idempotency.ts
import { createHash as createHash2 } from "node:crypto";
var canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};
var fingerprint = (method, path, body) => createHash2("sha256").update(`${method}
${path}
${canonical(body)}`).digest("hex");
var WAIT_MS = 3e4;
var POLL_MS = 100;
var begin = async (scope, key, print) => {
  const deadline = Date.now() + WAIT_MS;
  for (; ; ) {
    const inserted = await pool.query(
      "INSERT INTO idempotency (scope, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key",
      [scope, key, print]
    );
    if (inserted.rowCount === 1) return null;
    const stored = await pool.query("SELECT fingerprint, done, status, body FROM idempotency WHERE scope = $1 AND key = $2", [scope, key]);
    const row = stored.rows[0];
    if (row) {
      if (row.fingerprint !== print) return fail("idempotency_conflict");
      if (row.done) return { status: row.status, body: row.body };
    }
    if (Date.now() > deadline) return fail("idempotency_conflict");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
};
var finish = async (scope, key, status, body) => {
  await pool.query("UPDATE idempotency SET done = true, status = $3, body = $4 WHERE scope = $1 AND key = $2", [scope, key, status, body]);
};
var forget = async (scope, key) => {
  await pool.query("DELETE FROM idempotency WHERE scope = $1 AND key = $2 AND NOT done", [scope, key]);
};

// server/checkout.ts
var asRecord = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var asText = (value) => typeof value === "string" ? value : "";
var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
var HEADER_UNSAFE = /[\r\n\0\u0085\u2028\u2029]/;
var validate = (raw) => {
  const errors = {};
  const flag = (field, bad) => {
    if (bad) errors[field] = FIELD_ERRORS[field];
  };
  const buyer = asRecord(raw.buyer);
  const address = asRecord(raw.address);
  const method = raw.method === "bank" ? "bank" : raw.method === "card" ? "card" : null;
  if (method === null || typeof raw.number !== "number") fail("validation_failed");
  const name = asText(buyer.name).trim();
  const email = asText(buyer.email).trim();
  flag("buyer.name", name === "" || HEADER_UNSAFE.test(name));
  flag("buyer.email", !EMAIL.test(email) || HEADER_UNSAFE.test(email));
  flag("address.street", asText(address.street).trim() === "");
  flag("address.postcode", !/^\d{4}$/.test(asText(address.postcode).trim()));
  flag("address.city", asText(address.city).trim() === "");
  const giftRaw = raw.gift === null || raw.gift === void 0 ? null : asRecord(raw.gift);
  if (giftRaw) {
    flag("gift.recipientName", asText(giftRaw.recipientName).trim() === "" || HEADER_UNSAFE.test(asText(giftRaw.recipientName)));
    flag("gift.recipientEmail", !EMAIL.test(asText(giftRaw.recipientEmail).trim()));
    flag("gift.message", asText(giftRaw.message).length > MAX_GIFT_MESSAGE);
  }
  const cardRaw = asRecord(raw.card);
  const cardNumber = asText(cardRaw.number).replace(/\s+/g, "");
  if (method === "card") {
    flag("card.number", !/^\d{16}$/.test(cardNumber));
    flag("card.expiry", !/^(0[1-9]|1[0-2])\/\d{2}$/.test(asText(cardRaw.expiry)));
    flag("card.cvc", !/^\d{3}$/.test(asText(cardRaw.cvc)));
  }
  if (Object.keys(errors).length > 0) fail("validation_failed", { fields: errors });
  return {
    number: raw.number,
    method,
    buyer: { name, email },
    address: { street: asText(address.street).trim(), postcode: asText(address.postcode).trim(), city: asText(address.city).trim() },
    gift: giftRaw ? { recipientName: asText(giftRaw.recipientName).trim(), recipientEmail: asText(giftRaw.recipientEmail).trim(), message: asText(giftRaw.message) } : null,
    card: method === "card" ? { number: cardNumber, expiry: asText(cardRaw.expiry), cvc: asText(cardRaw.cvc) } : null
  };
};
var view = async (order, extra = {}) => ({
  reference: order.reference,
  orderToken: order.order_token,
  paymentState: order.payment_state,
  boxState: order.box_state ?? "held",
  holdRemainingMs: order.box_state ? null : await remainingOrNull(order.box_number),
  ...extra
});
var declined = async (order, code) => ({
  status: statusOf(code),
  body: errorBody(code, { extra: await view(order) })
});
var DECLINES = /* @__PURE__ */ new Set(["do_not_honor", "insufficient_funds", "expired_card", "challenge_failed"]);
var declineCodeOf = (reply) => DECLINES.has(String(reply.body.declineCode)) ? reply.body.declineCode : "do_not_honor";
var findOrder = async (number, token) => (await pool.query("SELECT * FROM orders WHERE box_number = $1 AND hold_token = $2", [number, token])).rows[0] ?? null;
var recordAttempt = async (details, token, accountId) => {
  await pool.query(
    "INSERT INTO orders (reference, box_number, hold_token, order_token) VALUES ($1, $2, $3, $4) ON CONFLICT (box_number, hold_token) DO NOTHING",
    [newReference(), details.number, token, newToken()]
  );
  await pool.query(
    `UPDATE orders SET method = $3, buyer_name = $4, buyer_email = $5, street = $6, postcode = $7, city = $8,
       gift_name = $9, gift_email = $10, gift_message = $11, kb_account_id = $12 WHERE box_number = $1 AND hold_token = $2`,
    [
      details.number,
      token,
      details.method,
      details.buyer.name,
      details.buyer.email,
      details.address.street,
      details.address.postcode,
      details.address.city,
      details.gift?.recipientName ?? null,
      details.gift?.recipientEmail ?? null,
      details.gift?.message ?? null,
      accountId
    ]
  );
  return await findOrder(details.number, token);
};
var canStartAttempt = (order) => !order || canRetryAttempt(order.payment_state) || order.payment_state === "started" && !order.payment_id;
var beginAttempt = async (order) => {
  if (order.payment_state === "challenge") await setPaymentState(pool, order, "declined");
  if (order.payment_state === "declined") await setPaymentState(pool, order, "started");
};
var challengeWindowMs = async (order) => Math.min(config.challengeSeconds * 1e3, await remainingOrNull(order.box_number) ?? 0);
var afterAuthorised = async (order) => {
  const claim = await claimAuthorised(order.reference);
  const fresh = await requireOrder(pool, order.reference);
  if (claim === "too_late") return { status: statusOf("authorised_too_late"), body: errorBody("authorised_too_late", { extra: await view(fresh) }) };
  return { status: 201, body: await view(fresh) };
};
var payByCard = async (order, card, key) => {
  const reply = await authorise(order.reference, EDITION_PRICE.totalOre, card, key);
  const paymentId = String(reply.body.paymentId ?? "");
  if (reply.status === 402 || reply.body.status === "declined") {
    await setPaymentState(pool, order, "declined");
    return declined(await requireOrder(pool, order.reference), declineCodeOf(reply));
  }
  await pool.query("UPDATE orders SET payment_id = $2 WHERE reference = $1", [order.reference, paymentId]);
  if (reply.body.status === "challenge") {
    const window = await challengeWindowMs(order);
    await pool.query("UPDATE orders SET challenge_id = $2, challenge_expires_at = $3 WHERE reference = $1", [
      order.reference,
      String(reply.body.challengeId),
      new Date(Date.now() + window)
    ]);
    await setPaymentState(pool, order, "challenge");
    return { status: 202, body: await view(await requireOrder(pool, order.reference), { challenge: { id: String(reply.body.challengeId), expiresInMs: window } }) };
  }
  if (reply.body.confirmation === "callback") return { status: 202, body: await view(await requireOrder(pool, order.reference)) };
  return afterAuthorised(order);
};
var payByTransfer = async (order, key) => {
  const reply = await reserveTransfer(order.reference, EDITION_PRICE.totalOre, key);
  const now = businessNow();
  try {
    await withTx(async (tx) => {
      const locked = await requireOrder(tx, order.reference, true);
      await moveBox(tx, locked.box_number, "awaiting_transfer", order.reference);
      await setPaymentState(tx, locked, "pending");
      await tx.query(
        `UPDATE orders SET transfer_id = $2, transfer_iban = $3, transfer_reference = $4, rate_basis_points = $5, authorised_at = $6, deadline_at = $7
         WHERE reference = $1`,
        [order.reference, String(reply.body.transferId), String(reply.body.iban), String(reply.body.paymentReference), await rateAt(tx, now), now, transferDeadline(now)]
      );
      await enqueue(tx, "mail", `transfer-${order.reference}`, { template: "transfer", reference: order.reference });
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "illegal_transition" || isUniqueViolation(error)) return fail("box_taken", { number: order.box_number });
    throw error;
  }
  await releaseHold(order.box_number, order.hold_token).catch(() => false);
  nudge();
  const fresh = await requireOrder(pool, order.reference);
  return { status: 201, body: await view(fresh, { transfer: transferView(fresh) }) };
};
var attempt = async (details, token, key) => {
  let accountId;
  try {
    accountId = await ensureAccount(details.buyer.email, details.buyer.name);
  } catch (error) {
    if (error instanceof LedgerUnreachable) return fail("ledger_unreachable");
    throw error;
  }
  const existing = await findOrder(details.number, token);
  if (existing && !canStartAttempt(existing)) {
    return { status: existing.payment_state === "started" ? 202 : 201, body: await view(existing, { transfer: transferView(existing) }) };
  }
  const order = await recordAttempt(details, token, accountId);
  await beginAttempt(order);
  try {
    return details.card ? await payByCard(order, details.card, key) : await payByTransfer(order, key);
  } catch (error) {
    if (error instanceof GatewayUnreachable) return fail("gateway_unreachable");
    throw error;
  }
};
var withoutCardSecrets = (body) => {
  const card = asRecord(body.card);
  return { ...body, card: body.card === void 0 ? void 0 : { last4: asText(card.number).replace(/\s+/g, "").slice(-4), expiry: card.expiry } };
};
var checkout = async (token, key, rawBody) => {
  const body = asRecord(rawBody);
  const scope = key ? { key, print: fingerprint("POST", "/api/checkout", withoutCardSecrets(body)) } : null;
  if (scope) {
    const replay = await begin("checkout", scope.key, scope.print);
    if (replay) return replay;
  }
  try {
    if (typeof body.number !== "number") return fail("validation_failed");
    await ownedHold(body.number, token);
    if (!scope) return fail("validation_failed");
    const details = validate(body);
    const result2 = await withLock(details.number, () => attempt(details, token ?? "", scope.key));
    await finish("checkout", scope.key, result2.status, result2.body);
    return result2;
  } catch (error) {
    if (scope) await forget("checkout", scope.key);
    throw error;
  }
};
var answer = async (reference, token, input) => {
  const order = await loadOrder(pool, reference);
  if (!order) return fail("not_found");
  if (order.hold_token !== token) return fail("hold_not_yours");
  await ownedHold(order.box_number, token);
  if (order.payment_state !== "challenge" || !order.challenge_id) return fail("illegal_transition");
  const hasCode = typeof input.code === "string" && input.code !== "";
  if (input.cancel !== true && !hasCode) return fail("validation_failed");
  if (input.cancel === true) {
    await setPaymentState(pool, order, "declined");
    return declined(await requireOrder(pool, reference), "challenge_cancelled");
  }
  if (order.challenge_expires_at && order.challenge_expires_at.getTime() <= Date.now()) {
    await setPaymentState(pool, order, "declined");
    return fail("challenge_expired");
  }
  try {
    const reply = await answerChallenge(order.challenge_id, input.code, `challenge-${reference}-${newToken()}`);
    if (reply.status === 200 && reply.body.status === "authorised") return await afterAuthorised(order);
    await setPaymentState(pool, order, "declined");
    return declined(await requireOrder(pool, reference), "challenge_failed");
  } catch (error) {
    if (error instanceof GatewayUnreachable) return fail("gateway_unreachable");
    throw error;
  }
};

// server/lookup.ts
var local = /* @__PURE__ */ new Map();
var localState = (client2) => {
  const entry = local.get(client2);
  if (!entry || entry.resetsAt <= Date.now()) {
    local.delete(client2);
    return { count: 0, ttl: 0 };
  }
  return { count: entry.count, ttl: Math.ceil((entry.resetsAt - Date.now()) / 1e3) };
};
var readState = async (client2) => {
  try {
    return await refusalState(client2);
  } catch (error) {
    if (error instanceof ValkeyUnreachable) return localState(client2);
    throw error;
  }
};
var countRefused = async (client2) => {
  try {
    await countRefusal(client2, config.lookupWindowSeconds);
  } catch (error) {
    if (!(error instanceof ValkeyUnreachable)) throw error;
    const current = localState(client2);
    local.set(client2, { count: current.count + 1, resetsAt: Date.now() + (current.ttl || config.lookupWindowSeconds) * 1e3 });
  }
};
var lookupOrder = async (client2, reference, email) => {
  const state = await readState(client2);
  if (state.count >= ORDER_LOOKUP_TRIES) return fail("lookup_limited", { headers: { "retry-after": String(Math.max(1, state.ttl)) } });
  const found = typeof reference === "string" && typeof email === "string" ? await pool.query("SELECT reference, order_token FROM orders WHERE reference = $1 AND lower(buyer_email) = lower($2)", [reference, email]) : null;
  if (!found?.rows[0]) {
    await countRefused(client2);
    return fail("lookup_refused");
  }
  return { reference: found.rows[0].reference, orderToken: found.rows[0].order_token };
};

// server/search.ts
var SearchUnreachable = class extends Error {
  constructor() {
    super("search unreachable");
  }
};
var PUBLIC = () => named("press_public");
var STAFF = () => named("press_staff");
var call3 = async (method, path, body) => {
  let response;
  try {
    response = await fetch(`${config.meili.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.meili.apiKey}`, "content-type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw new SearchUnreachable();
  }
  if (response.status >= 500) throw new SearchUnreachable();
  const text3 = await response.text();
  return { status: response.status, body: text3 ? JSON.parse(text3) : null };
};
var accepted = (reply) => {
  if (reply.status >= 400) throw new SearchUnreachable();
};
var ensureIndex = async (uid, searchable) => {
  accepted(await call3("POST", "/indexes", { uid, primaryKey: "id" }));
  accepted(await call3("PUT", `/indexes/${uid}/settings/searchable-attributes`, searchable));
};
var prepareIndexes = async () => {
  await ensureIndex(PUBLIC(), ["text", "number", "plate"]);
  await ensureIndex(STAFF(), ["number", "plate", "recipientName"]);
  accepted(await call3("POST", `/indexes/${PUBLIC()}/documents`, TALE.map((passage) => ({
    id: passage.passageId,
    kind: "passage",
    passageId: passage.passageId,
    chapter: passage.chapter,
    text: passage.text
  }))));
};
var upsertPublicBoxes = async (numbers) => {
  if (numbers.length === 0) return;
  accepted(await call3("POST", `/indexes/${PUBLIC()}/documents`, numbers.map((number) => ({
    id: `box-${number}`,
    kind: "box",
    number,
    plate: plateOf(number)
  }))));
};
var removePublicBoxes = async (numbers) => {
  if (numbers.length === 0) return;
  accepted(await call3("POST", `/indexes/${PUBLIC()}/documents/delete-batch`, numbers.map((number) => `box-${number}`)));
};
var upsertStaffBoxes = async (documents) => {
  if (documents.length === 0) return;
  accepted(await call3("POST", `/indexes/${STAFF()}/documents`, documents));
};
var searchPublic = async (query) => {
  const reply = await call3("POST", `/indexes/${PUBLIC()}/search`, {
    q: query,
    limit: 20,
    attributesToCrop: ["text"],
    cropLength: 28,
    attributesToHighlight: ["text"],
    highlightPreTag: "",
    highlightPostTag: ""
  });
  accepted(reply);
  const hits = reply.body.hits;
  return hits.map((hit) => ({
    kind: hit.kind,
    id: hit.id,
    number: hit.number,
    plate: hit.plate,
    passageId: hit.passageId,
    chapter: hit.chapter,
    excerpt: hit._formatted?.text
  }));
};
var searchStaff = async (query) => {
  const reply = await call3("POST", `/indexes/${STAFF()}/search`, { q: query, limit: 50 });
  accepted(reply);
  return reply.body.hits;
};

// server/searching.ts
var staffDocuments = async (numbers) => {
  const boxes = (await pool.query("SELECT number, state FROM boxes WHERE $1::int[] IS NULL OR number = ANY($1) ORDER BY number", [numbers])).rows;
  const orders = (await pool.query("SELECT * FROM orders WHERE live")).rows;
  return boxes.map((box) => {
    const order = orders.find((candidate) => candidate.box_number === box.number);
    return {
      id: `box-${box.number}`,
      number: box.number,
      plate: plateOf(box.number),
      state: box.state,
      recipientName: order ? recipientOf(order).name : null,
      reference: order?.reference ?? null
    };
  });
};
var syncBoxes = async (numbers) => {
  const documents = await staffDocuments(numbers);
  await upsertStaffBoxes(documents);
  await upsertPublicBoxes(documents.filter((box) => box.state === "available").map((box) => box.number));
  await removePublicBoxes(documents.filter((box) => box.state !== "available").map((box) => box.number));
};
registerJob("search", async (payload) => {
  await syncBoxes(payload.numbers);
});
var publicSearch = async (query) => {
  const [hits, shelf] = await Promise.all([searchPublic(query), readShelf()]);
  return hits.flatMap((hit) => {
    if (hit.kind === "passage") return [{ kind: "passage", passageId: hit.passageId, chapter: hit.chapter, excerpt: hit.excerpt ?? "" }];
    const state = shelf.states[(hit.number ?? 0) - 1] ?? "taken";
    return state === "taken" ? [] : [{ kind: "box", number: hit.number, plate: hit.plate, state }];
  });
};
var staffHit = (document) => ({
  number: document.number,
  plate: document.plate,
  state: document.state,
  recipientName: document.recipientName,
  reference: document.reference
});
var staffSearch = async (query) => {
  if (query === "") return { hits: [], degraded: false };
  try {
    return { hits: (await searchStaff(query)).map(staffHit), degraded: false };
  } catch (error) {
    if (!(error instanceof SearchUnreachable)) throw error;
    const needle = query.toLowerCase();
    const documents = (await staffDocuments(null)).filter((document) => String(document.number) === needle || document.plate.toLowerCase() === needle || (document.recipientName ?? "").toLowerCase().includes(needle));
    return { hits: documents.slice(0, 50).map(staffHit), degraded: true };
  }
};

// server/signatures.ts
import { createHmac as createHmac2, timingSafeEqual } from "node:crypto";
var TOLERANCE_SECONDS = 300;
var verifyCallback = (raw, header2) => {
  if (!header2) return false;
  const fields = new Map(header2.split(",").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [name ?? "", rest.join("=")];
  }));
  const stamp = Number(fields.get("t"));
  const given = fields.get("v1") ?? "";
  if (!Number.isInteger(stamp) || !/^[0-9a-f]{64}$/.test(given)) return false;
  if (Math.abs(Date.now() / 1e3 - stamp) > TOLERANCE_SECONDS) return false;
  const expected = createHmac2("sha256", config.gatewayCallbackSecret).update(`${stamp}.`).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
};

// server/statements.ts
import { randomUUID as randomUUID5 } from "node:crypto";
var statementKey = (month, revision) => `statements/${month}-r${revision}.pdf`;
var summary = (row) => ({
  id: row.id,
  month: row.month,
  revision: row.revision,
  charityTotalOre: row.charity_total_ore,
  makerTotalOre: row.maker_total_ore,
  vatTotalOre: row.vat_total_ore,
  pdfUrl: `/api/staff/statements/${row.id}/pdf`,
  issuedAt: row.issued_at.toISOString()
});
var listStatements = async () => (await pool.query("SELECT * FROM statements ORDER BY issued_at DESC, revision DESC")).rows.map(summary);
var DAY_MS = 24 * 3600 * 1e3;
var linesOf = async (month) => {
  const [year = 0, number = 0] = month.split("-").map(Number);
  const rows = await pool.query(
    "SELECT * FROM split_lines WHERE posted_at >= $1 AND posted_at < $2 ORDER BY posted_at, id",
    [new Date(Date.UTC(year, number - 1, 1) - DAY_MS), new Date(Date.UTC(year, number, 1) + DAY_MS)]
  );
  const inMonth = rows.rows.filter((row) => copenhagenMonth(row.posted_at) === month);
  return inMonth.map((row) => ({
    reference: String(row.reference),
    boxNumber: Number(row.box_number),
    kind: row.kind,
    grossOre: Number(row.gross_ore),
    netOre: Number(row.net_ore),
    vatOre: Number(row.vat_ore),
    charityOre: Number(row.charity_ore),
    makerOre: Number(row.maker_ore),
    rateBasisPoints: Number(row.rate_basis_points),
    postedAt: row.posted_at.toISOString()
  }));
};
var sum = (lines, pick) => lines.reduce((total, line) => total + pick(line), 0);
var issueStatement = async (month) => {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > copenhagenMonth(businessNow())) return fail("month_invalid");
  return serial(`statement:${month}`, () => issueFor(month));
};
var issueFor = async (month) => {
  const lines = await linesOf(month);
  const revision = (await pool.query("SELECT coalesce(max(revision), 0)::int AS latest FROM statements WHERE month = $1", [month])).rows[0].latest + 1;
  const totals = {
    charityTotalOre: sum(lines, (line) => line.charityOre),
    makerTotalOre: sum(lines, (line) => line.makerOre),
    vatTotalOre: sum(lines, (line) => line.vatOre)
  };
  try {
    const pdf = await renderPdf(statementHtml({ month, revision, charityName: CHARITY_NAME, lines, ...totals }));
    await putObject(statementKey(month, revision), pdf, "application/pdf");
  } catch (error) {
    if (error instanceof PdfUnreachable) return fail("pdf_unreachable");
    if (error instanceof StorageUnreachable) return fail("storage_unreachable");
    throw error;
  }
  const id = `st_${randomUUID5()}`;
  const issuedAt = businessNow();
  await withTx(async (tx) => {
    await tx.query(
      `INSERT INTO statements (id, month, revision, charity_total_ore, maker_total_ore, vat_total_ore, lines, token, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, month, revision, totals.charityTotalOre, totals.makerTotalOre, totals.vatTotalOre, JSON.stringify(lines), newToken(), issuedAt]
    );
    await enqueue(tx, "statement-hook", `statement-hook-${id}`, { statementId: id });
  });
  const row = (await pool.query("SELECT * FROM statements WHERE id = $1", [id])).rows[0];
  return { ...summary(row), lines };
};
var statementPayload = async (statementId) => {
  const row = (await pool.query("SELECT * FROM statements WHERE id = $1", [statementId])).rows[0];
  const count = (await pool.query("SELECT jsonb_array_length(lines)::int AS total FROM statements WHERE id = $1", [statementId])).rows[0].total;
  return {
    eventId: `evt_statement_${row.id}`,
    statementId: row.id,
    month: row.month,
    revision: row.revision,
    charityTotalOre: row.charity_total_ore,
    lineCount: count,
    downloadUrl: `${config.publicUrl}/api/statements/${row.id}/pdf?token=${row.token}`,
    issuedAt: row.issued_at.toISOString()
  };
};
var statementPdf = async (statementId, token) => {
  const found = await pool.query("SELECT month, revision, token FROM statements WHERE id = $1", [statementId]);
  const row = found.rows[0];
  if (!row || token !== null && token !== row.token) return fail("not_found");
  try {
    return await getObject(statementKey(row.month, row.revision)) ?? fail("not_found");
  } catch (error) {
    if (error instanceof StorageUnreachable) return fail("storage_unreachable", { message: OUTAGE_COPY.download });
    throw error;
  }
};

// server/routes-public.ts
var header = (request2, name) => {
  const value = request2.headers[name];
  return Array.isArray(value) ? value[0] : value;
};
var orderTokenOf = (request2) => header(request2, "x-order-token") ?? request2.query.token;
var accessibleOrder = async (request2) => {
  const { reference } = request2.params;
  const order = await loadOrder(pool, reference);
  const token = orderTokenOf(request2);
  if (!order || !token || token !== order.order_token) return fail("not_found");
  return order;
};
var boxNumber = (request2) => {
  const number = Number(request2.params.number);
  return isBoxNumber(number) ? number : fail("not_found");
};
var NARRATION = new URL("../../narration/", import.meta.url);
var sendFile = async (reply, request2, bytes, type) => {
  const range = /^bytes=(\d*)-(\d*)$/.exec(header(request2, "range") ?? "");
  reply.header("content-type", type).header("accept-ranges", "bytes");
  if (!range) return reply.send(bytes);
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  return reply.code(206).header("content-range", `bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start, end + 1));
};
var registerPublicRoutes = (app) => {
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/edition", async () => {
    const rate = await rateAt(pool, businessNow());
    return {
      edition: EDITION,
      ...EDITION_PRICE,
      charityName: CHARITY_NAME,
      rateBasisPoints: rate,
      charityOre: saleParts(rate).charityOre,
      closesAt: CLOSES_AT,
      salesOpen: salesOpen()
    };
  });
  app.get("/api/shelf", async () => {
    const shelf = await readShelf();
    return {
      salesPaused: shelf.salesPaused,
      remaining: await availableCount(pool),
      boxes: shelf.states.map((state, index) => ({ number: index + 1, plate: plateOf(index + 1), state }))
    };
  });
  app.get("/api/shelf/events", (request2, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-content-type-options": "nosniff"
    });
    const write = (name, data) => {
      reply.raw.write(`event: ${name}
data: ${JSON.stringify(data)}

`);
    };
    write("sales", salesEvent().data);
    const unsubscribe = subscribe((event) => write(event.name, event.data));
    const beat = setInterval(() => reply.raw.write(": keep-alive\n\n"), 15e3);
    request2.raw.on("close", () => {
      clearInterval(beat);
      unsubscribe();
    });
  });
  app.get("/api/boxes/:number", async (request2) => {
    const number = boxNumber(request2);
    const plate = plateOf(number);
    return {
      number,
      plate,
      state: (await readShelf()).states[number - 1],
      artUrl: await hasArt(plate) ? artUrl(plate) : null
    };
  });
  app.get("/api/plates/:plate/art", async (request2, reply) => {
    const art = await readArt(request2.params.plate);
    return reply.header("content-type", art.contentType).send(art.bytes);
  });
  app.get("/narration/:file", async (request2, reply) => {
    const name = /^([a-z]+)\.ogg$/.exec(request2.params.file)?.[1];
    if (!name || !CHAPTERS.includes(name)) return fail("not_found");
    return sendFile(reply, request2, await readFile(new URL(`${name}.ogg`, NARRATION)), "audio/ogg");
  });
  app.post("/api/holds", async (request2, reply) => {
    const result2 = await reach(request2.body?.number, header(request2, "x-hold-token"));
    return reply.code(result2.status).send(result2.body);
  });
  app.get("/api/holds/:number", async (request2) => holdStatus(boxNumber(request2), header(request2, "x-hold-token")));
  app.delete("/api/holds/:number", async (request2, reply) => {
    await putBack(boxNumber(request2), header(request2, "x-hold-token"));
    return reply.code(204).send();
  });
  app.post("/api/checkout", async (request2, reply) => {
    const result2 = await checkout(header(request2, "x-hold-token"), header(request2, "idempotency-key"), request2.body);
    return reply.code(result2.status).send(result2.body);
  });
  app.post("/api/checkout/:reference/challenge", async (request2, reply) => {
    const result2 = await answer(request2.params.reference, header(request2, "x-hold-token"), request2.body ?? {});
    return reply.code(result2.status).send(result2.body);
  });
  app.get("/api/orders/:reference", async (request2) => orderView(pool, await accessibleOrder(request2)));
  app.post("/api/orders/lookup", async (request2) => {
    const body = request2.body ?? {};
    return lookupOrder(request2.socket.remoteAddress ?? "unknown", body.reference, body.email);
  });
  app.get("/api/orders/:reference/certificate", async (request2, reply) => {
    const order = await accessibleOrder(request2);
    try {
      const bytes = await downloadCertificate(order);
      return reply.header("content-type", "application/pdf").send(bytes);
    } catch (error) {
      if (error instanceof StorageUnreachable) return fail("storage_unreachable", { message: OUTAGE_COPY.download });
      throw error;
    }
  });
  app.get("/api/search", async (request2) => {
    const { q } = request2.query;
    if (typeof q !== "string" || q.trim() === "") return { hits: [] };
    if (q.length > 100) return fail("validation_failed");
    try {
      return { hits: await publicSearch(q) };
    } catch (error) {
      if (error instanceof SearchUnreachable) return fail("search_unreachable");
      throw error;
    }
  });
  app.get("/api/statements/:id/pdf", async (request2, reply) => {
    const token = request2.query.token;
    if (!token) return fail("not_found");
    return reply.header("content-type", "application/pdf").send(await statementPdf(request2.params.id, token));
  });
  app.post("/api/gateway/callbacks", async (request2, reply) => {
    if (!request2.rawBody || !verifyCallback(request2.rawBody, header(request2, "x-gateway-signature"))) return fail("bad_signature");
    return reply.send({ status: await handleCallback(parseCallback(request2.body)) });
  });
};

// server/packing.ts
var result = (order, packing) => ({
  status: 202,
  body: { reference: order.reference, boxState: order.box_state ?? "claimed", paymentState: order.payment_state, packing }
});
var packBankOrder = async (order) => {
  await withTx(async (tx) => {
    await markPackedBankOrder(tx, await requireOrder(tx, order.reference, true));
  });
  return result(await requireOrder(pool, order.reference), "done");
};
var requestCapture = async (order) => {
  try {
    await assertReachable2();
  } catch (error) {
    if (error instanceof LedgerUnreachable) return fail("ledger_unreachable", { message: OUTAGE_COPY.pack.ledger_unreachable });
    throw error;
  }
  const attempts = order.capture_attempts + 1;
  await pool.query("UPDATE orders SET capture_requested = true, capture_attempts = $2 WHERE reference = $1", [order.reference, attempts]);
  try {
    const reply = await capture(order.payment_id ?? "", EDITION_PRICE.totalOre, `capture-${order.reference}-${attempts}`);
    if (reply.status === 402 || reply.body.status === "capture_failed") {
      await withTx(async (tx) => {
        const locked = await requireOrder(tx, order.reference, true);
        await setPaymentState(tx, locked, "capture_failed");
        await tx.query("UPDATE orders SET capture_requested = false WHERE reference = $1", [order.reference]);
        await alertCaptureFailed(tx, `capfail-${order.reference}-${attempts}`, order.box_number, EDITION_PRICE.totalOre);
      });
      const failed = await requireOrder(pool, order.reference);
      return fail("capture_refused", {
        number: order.box_number,
        extra: { reference: failed.reference, boxState: failed.box_state, paymentState: failed.payment_state }
      });
    }
    if (reply.body.confirmation === "callback") return result(await requireOrder(pool, order.reference), "pending");
    await pool.query("UPDATE orders SET capture_confirmed = true WHERE reference = $1", [order.reference]);
    const done2 = await finishCapture(order.reference).catch(() => false);
    const fresh = await requireOrder(pool, order.reference);
    return result(fresh, done2 ? "done" : "pending");
  } catch (error) {
    if (error instanceof GatewayUnreachable) {
      await pool.query("UPDATE orders SET capture_requested = false WHERE reference = $1", [order.reference]);
      return fail("gateway_unreachable", { message: OUTAGE_COPY.pack.gateway_unreachable });
    }
    throw error;
  }
};
var pack = (reference) => serial(`pack:${reference}`, async () => {
  const order = await requireOrder(pool, reference);
  const lapsed = order.payment_state === "authorisation_expired" || holdsAuthorisation(order.payment_state) && order.auth_expires_at !== null && order.auth_expires_at.getTime() <= Date.now();
  if (lapsed) return fail("authorisation_expired");
  if (order.box_state !== "claimed") return fail("illegal_transition");
  if (order.method === "bank") return packBankOrder(order);
  if (order.capture_requested && !order.capture_confirmed && order.payment_state === "authorised") return result(order, "pending");
  return requestCapture(order);
});

// server/views.ts
var packerOrders = async (boxState) => {
  const rows = await pool.query(
    `SELECT * FROM orders WHERE box_state IS NOT NULL AND ($1::text IS NULL OR box_state = $1) ORDER BY created_at DESC, reference`,
    [boxState]
  );
  return rows.rows.map((order) => ({
    reference: order.reference,
    number: order.box_number,
    plate: plateOf(order.box_number),
    recipientName: recipientOf(order).name,
    address: { street: order.street, postcode: order.postcode, city: order.city },
    boxState: order.box_state,
    paymentState: order.payment_state,
    trackingCode: order.tracking_code
  }));
};
var treasurerOrders = async () => {
  const rows = await pool.query("SELECT * FROM orders WHERE authorised_at IS NOT NULL ORDER BY created_at DESC, reference");
  return rows.rows.map((order) => ({
    reference: order.reference,
    number: order.box_number,
    paymentState: order.payment_state,
    boxState: order.box_state ?? "available",
    grossOre: EDITION_PRICE.priceOre,
    rateBasisPoints: order.rate_basis_points
  }));
};
var orderLedger = async (reference) => {
  const order = await requireOrder(pool, reference);
  const lines = (await pool.query("SELECT * FROM split_lines WHERE reference = $1 ORDER BY id", [reference])).rows;
  const totals = lines.reduce(
    (sum2, line) => ({
      grossOre: sum2.grossOre + line.gross_ore,
      netOre: sum2.netOre + line.net_ore,
      vatOre: sum2.vatOre + line.vat_ore,
      charityOre: sum2.charityOre + line.charity_ore,
      makerOre: sum2.makerOre + line.maker_ore
    }),
    { grossOre: 0, netOre: 0, vatOre: 0, charityOre: 0, makerOre: 0 }
  );
  const fee = order.paid_at && order.method ? gatewayFee(order.method, EDITION_PRICE.totalOre) : 0;
  let killbill = null;
  if (order.kb_invoice_id && order.kb_account_id) {
    try {
      const [invoice, kinds] = await Promise.all([invoiceView(order.kb_account_id, order.kb_invoice_id), transactions(reference)]);
      killbill = { invoiceId: invoice.invoiceId, items: invoice.items, transactions: kinds.map((item) => ({ type: item.type, amountOre: item.amountOre })) };
    } catch (error) {
      if (!(error instanceof LedgerUnreachable)) throw error;
    }
  }
  return {
    reference,
    rateBasisPoints: order.rate_basis_points,
    grossOre: EDITION_PRICE.priceOre,
    courierOre: EDITION_PRICE.courierOre,
    totalOre: EDITION_PRICE.totalOre,
    lines: lines.map((line) => ({
      kind: line.kind,
      grossOre: line.gross_ore,
      netOre: line.net_ore,
      vatOre: line.vat_ore,
      charityOre: line.charity_ore,
      makerOre: line.maker_ore,
      settledAt: line.posted_at.toISOString()
    })),
    totals,
    gatewayFeeOre: fee,
    makerAfterFeesOre: totals.makerOre - fee,
    refunds: (await refundsOf(pool, reference)).map((refund) => ({ refundId: refund.refund_id, state: refund.state, amountOre: refund.amount_ore })),
    killbill
  };
};
var ratesList = async () => (await pool.query("SELECT basis_points, effective_from FROM rate_changes ORDER BY effective_from, id")).rows.map((row) => ({ rateBasisPoints: row.basis_points, effectiveFrom: row.effective_from.toISOString() }));
var scheduleRate = async (basisPoints, effectiveFrom, now) => {
  if (typeof basisPoints !== "number" || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 1e4) return fail("rate_invalid");
  const instant = typeof effectiveFrom === "string" ? new Date(effectiveFrom) : null;
  if (!instant || Number.isNaN(instant.getTime())) return fail("validation_failed");
  if (instant.getTime() <= now.getTime()) return fail("rate_must_be_future");
  await pool.query("INSERT INTO rate_changes (basis_points, effective_from) VALUES ($1, $2)", [basisPoints, instant]);
  return { rateBasisPoints: basisPoints, effectiveFrom: instant.toISOString() };
};

// server/routes-staff.ts
var param = (request2, name) => request2.params[name] ?? "";
var MAX_NOTE = 280;
var registerStaffRoutes = (app) => {
  app.addHook("onSend", async (request2, reply, payload) => {
    if (!request2.url.startsWith("/api/staff/")) return payload;
    const waiting = [
      await hasUnpublishedEvents().catch(() => false) ? "queue" : "",
      await hasPending("alert").catch(() => false) ? "alerts" : ""
    ].filter(Boolean);
    if (waiting.length > 0) reply.header(WAITING_HEADER, waiting.join(","));
    return payload;
  });
  app.get("/api/staff/me", async (request2) => {
    const principal = await requireSignedIn(request2);
    return { username: principal.username, roles: principal.roles };
  });
  app.get("/api/staff/search", async (request2) => {
    await requireStaff(request2, "any");
    return staffSearch(String(request2.query.q ?? "").trim());
  });
  app.get("/api/staff/orders", async (request2) => {
    await requireStaff(request2, "packer");
    return { orders: await packerOrders(request2.query.boxState ?? null) };
  });
  app.post("/api/staff/orders/:reference/pack", async (request2, reply) => {
    await requireStaff(request2, "packer");
    const result2 = await pack(param(request2, "reference"));
    return reply.code(result2.status).send(result2.body);
  });
  app.post("/api/staff/boxes/:number/back-on-shelf", async (request2) => {
    await requireStaff(request2, "packer");
    const number = Number(param(request2, "number"));
    if (!isBoxNumber(number)) return fail("not_found");
    await withTx((tx) => putBackOnShelf(tx, number));
    nudge();
    return { number, state: "available" };
  });
  const deadLetters = async (work) => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BrokerUnreachable) return fail("queue_unreachable");
      throw error;
    }
  };
  app.get("/api/staff/dead-letters", async (request2) => {
    await requireStaff(request2, "packer");
    return { events: await deadLetters(listDeadLetters) };
  });
  app.post("/api/staff/dead-letters/:eventId/retry", async (request2, reply) => {
    await requireStaff(request2, "packer");
    const eventId = param(request2, "eventId");
    if (!await deadLetters(() => retryDeadLetter(eventId))) return fail("not_found");
    return reply.code(202).send({ eventId, status: "requeued" });
  });
  app.post("/api/staff/dead-letters/:eventId/dismiss", async (request2) => {
    await requireStaff(request2, "packer");
    const eventId = param(request2, "eventId");
    const note = typeof request2.body?.note === "string" ? request2.body.note.trim() : "";
    const found = await pool.query("SELECT 1 FROM events WHERE event_id = $1 AND state = 'dead'", [eventId]);
    if (found.rowCount === 0) return fail("not_found");
    if (note === "" || note.length > MAX_NOTE) return fail("dismissal_note_required");
    await deadLetters(() => dismissDeadLetter(eventId, note));
    return { eventId, status: "dismissed" };
  });
  app.get("/api/staff/ledger/orders", async (request2) => {
    await requireStaff(request2, "treasurer");
    return { orders: await treasurerOrders() };
  });
  app.get("/api/staff/orders/:reference/ledger", async (request2) => {
    await requireStaff(request2, "treasurer");
    return orderLedger(param(request2, "reference"));
  });
  app.post("/api/staff/orders/:reference/refunds", async (request2, reply) => {
    await requireStaff(request2, "treasurer");
    const reference = param(request2, "reference");
    await requireOrder(pool, reference);
    const key = request2.headers["idempotency-key"];
    if (typeof key !== "string" || key === "") return fail("validation_failed");
    const amount = request2.body?.amountOre;
    const replay = await begin("refund", key, fingerprint("POST", `/api/staff/orders/${reference}/refunds`, { amountOre: amount }));
    if (replay) return reply.code(replay.status).send(replay.body);
    try {
      const outcome = await startStaffRefund(reference, typeof amount === "number" ? amount : Number.NaN, key);
      await finish("refund", key, outcome.status, outcome.body);
      return reply.code(outcome.status).send(outcome.body);
    } catch (error) {
      await forget("refund", key);
      throw error;
    }
  });
  app.get("/api/staff/charity-rates", async (request2) => {
    await requireStaff(request2, "treasurer");
    return { rates: await ratesList() };
  });
  app.post("/api/staff/charity-rates", async (request2, reply) => {
    await requireStaff(request2, "treasurer");
    const body = request2.body ?? {};
    return reply.code(201).send(await scheduleRate(body.rateBasisPoints, body.effectiveFrom, businessNow()));
  });
  app.get("/api/staff/statements", async (request2) => {
    await requireStaff(request2, "treasurer");
    return { statements: await listStatements() };
  });
  app.post("/api/staff/statements", async (request2, reply) => {
    await requireStaff(request2, "treasurer");
    return reply.code(201).send(await issueStatement(request2.body?.month));
  });
  app.get("/api/staff/statements/:id/pdf", async (request2, reply) => {
    await requireStaff(request2, "treasurer");
    return reply.header("content-type", "application/pdf").send(await statementPdf(param(request2, "id"), null));
  });
  app.put("/api/staff/charity-endpoint", async (request2) => {
    await requireStaff(request2, "treasurer");
    const url = request2.body?.url;
    const parsed = typeof url === "string" ? URL.canParse(url) && /^https?:$/.test(new URL(url).protocol) : false;
    if (!parsed) return fail("endpoint_invalid");
    await saveEndpoint(url);
    await syncEndpoint().catch(() => void 0);
    return { url };
  });
  app.get("/api/staff/deliveries", async (request2) => {
    await requireStaff(request2, "treasurer");
    try {
      return { deliveries: await listDeliveries() };
    } catch (error) {
      if (error instanceof SvixUnreachable) return fail("deliveries_unreachable");
      throw error;
    }
  });
  app.post("/api/staff/plates/:plate/art", async (request2, reply) => {
    await requireStaff(request2, "maker");
    const upload = await request2.file();
    if (!upload) return fail("validation_failed");
    return reply.code(201).send(await saveArt(param(request2, "plate"), await upload.toBuffer()));
  });
  app.get("/api/staff/stock", async (request2) => {
    await requireStaff(request2, "maker");
    return { remaining: await availableCount(pool), thresholds: config.lowStockThresholds };
  });
};

// server/static.ts
import { readFile as readFile2 } from "node:fs/promises";
var CLIENT = new URL("../client/", import.meta.url);
var TYPES2 = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json"
};
var SHELL_ROUTE = /^\/(shelf|checkout|lookup|staff(\/(packing|dead-letters|refunds|rates|statements|plates))?|box\/\d+|order\/[A-Za-z0-9-]+)?$/;
var FILE = /^\/(assets|fonts)\/[A-Za-z0-9._-]+$/;
var registerStatic = (app) => {
  app.get("/*", async (request2, reply) => {
    let path;
    try {
      path = decodeURIComponent(request2.url.split("?")[0] ?? "/");
    } catch {
      return fail("not_found");
    }
    if (SHELL_ROUTE.test(path)) {
      return reply.header("content-type", TYPES2[".html"]).header("cache-control", "no-cache").send(await readFile2(new URL("index.html", CLIENT)));
    }
    if (!FILE.test(path)) return fail("not_found");
    const extension = path.slice(path.lastIndexOf("."));
    const bytes = await readFile2(new URL(`.${path}`, CLIENT)).catch(() => null);
    if (!bytes || !TYPES2[extension]) return fail("not_found");
    return reply.header("content-type", TYPES2[extension]).header("cache-control", "public, max-age=31536000, immutable").send(bytes);
  });
};

// server/sweeper.ts
var references = async (sql, params = []) => (await pool.query(sql, params)).rows.map((row) => row.reference);
var running = /* @__PURE__ */ new Set();
var launch = (kind, keys2, work) => {
  for (const key of keys2) {
    const id = `${kind}:${key}`;
    if (running.has(id)) continue;
    running.add(id);
    void work(key).catch(() => void 0).finally(() => running.delete(id));
  }
};
var sweep = async () => {
  try {
    launch("lapse", await references("SELECT reference FROM orders WHERE payment_state = 'pending' AND deadline_at <= $1", [businessNow()]), lapseTransfer);
    launch("expire", await references(
      "SELECT reference FROM orders WHERE payment_state IN ('authorised', 'capture_failed') AND auth_expires_at <= now() AND NOT void_pending"
    ), expireAuthorisation);
    launch("void", await references("SELECT reference FROM orders WHERE void_pending"), attemptVoid);
    launch("record", await references(
      "SELECT reference FROM orders WHERE payment_state = 'authorised' AND live AND kb_payment_id IS NULL AND NOT void_pending"
    ), resumeAuthorisationRecord);
    launch("capture", await references(
      "SELECT reference FROM orders WHERE capture_confirmed AND payment_state IN ('authorised', 'capture_failed')"
    ), finishCapture);
    launch("settle", await references("SELECT reference FROM orders WHERE settle_confirmed AND payment_state = 'pending'"), finishSettlement);
    launch("close", await references(
      "SELECT reference FROM orders WHERE payment_state IN ('voided', 'authorisation_expired') AND NOT kb_closed AND kb_payment_id IS NOT NULL"
    ), closeLedger);
    launch("refund", (await pool.query("SELECT refund_id FROM refunds WHERE gateway_confirmed AND state = 'pending'")).rows.map((row) => row.refund_id), finishRefund);
  } catch {
    return;
  }
};
var startSweeper = () => {
  setInterval(() => void sweep(), 1e3).unref();
};

// server/ntfy.ts
var NtfyUnreachable = class extends Error {
  constructor() {
    super("ntfy unreachable");
  }
};
var publishAlert = async (title, message) => {
  let response;
  try {
    response = await fetch(config.ntfy.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString("base64")}`
      },
      body: JSON.stringify({ topic: named("svovlstik-maker"), title, message }),
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw new NtfyUnreachable();
  }
  if (!response.ok) throw new NtfyUnreachable();
};

// server/handlers.ts
registerJob("mail", async (payload) => {
  const order = await requireOrder(pool, String(payload.reference));
  await sendMail(await buildMail(payload.template, order, Number(payload.refundOre ?? 0)));
});
registerJob("alert", async (payload) => {
  await publishAlert(String(payload.title), String(payload.message));
});
registerJob("webhook", async (payload) => {
  const found = await pool.query("SELECT * FROM refunds WHERE refund_id = $1", [payload.refundId]);
  const refund = found.rows[0];
  const order = await requireOrder(pool, refund.reference);
  const eventId = `evt_refund_${refund.refund_id}`;
  await sendMessage(eventId, "refund.settled", {
    eventId,
    reference: refund.reference,
    boxNumber: order.box_number,
    refundId: refund.refund_id,
    refundOre: refund.amount_ore,
    netOre: refund.net_ore,
    vatOre: refund.vat_ore,
    charityOre: refund.charity_ore,
    makerOre: refund.maker_ore,
    settledAt: refund.settled_at.toISOString()
  });
});
registerJob("statement-hook", async (payload) => {
  const body = await statementPayload(String(payload.statementId));
  await sendMessage(String(body.eventId), "statement.issued", body);
});

// server/main.ts
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var untilDone = (name, work) => {
  void (async () => {
    for (; ; ) {
      try {
        await work();
        return;
      } catch (error) {
        process.stderr.write(`${name}: waiting for the service (${error instanceof Error ? error.constructor.name : "error"})
`);
        await sleep(2e3);
      }
    }
  })();
};
var migrated = async () => {
  for (let attempt2 = 0; attempt2 < 10; attempt2 += 1) {
    try {
      await migrate();
      return true;
    } catch {
      await sleep(1e3);
    }
  }
  return false;
};
var main = async () => {
  const app = await buildApp();
  registerAuthRoutes(app);
  registerPublicRoutes(app);
  registerStaffRoutes(app);
  registerStatic(app);
  connectValkey();
  const ready = await migrated();
  for (let waited = 0; waited < 3e3 && !isUp(); waited += 100) await sleep(100);
  await app.listen({ host: "0.0.0.0", port: config.port });
  if (!ready) untilDone("database", migrate);
  startShelf();
  startJobs();
  startFulfilment();
  startSweeper();
  untilDone("identity", provision);
  untilDone("storage", ensureBucket);
  untilDone("search", async () => {
    await prepareIndexes();
    await syncBoxes(null);
  });
  untilDone("webhooks", async () => {
    await ensureApplication();
    await syncEndpoint();
  });
  const stop = () => {
    void closeBroker().finally(() => void app.close().finally(() => process.exit(0)));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
};
void main();
