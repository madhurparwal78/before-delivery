import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { lockKey, query, queryOne, withAdvisoryLock, withTransaction } from "./db.js";
import { addMonthsToDate, studioDate } from "./time.js";
import * as killbill from "./services/killbill.js";
import * as storage from "./services/storage.js";
import * as cms from "./services/cms.js";
import { documentPdf } from "./pdf.js";
import { seedPrices, priceInEffect } from "./domain/prices.js";
import { quoteFromPrice } from "./domain/quotes.js";
import { hashPassword } from "./domain/accounts.js";
import { registerInvoice } from "./domain/billing.js";
import { type Currency, money } from "../shared/money.js";
import { type CareTier, type PlanId } from "../shared/plans.js";

async function stepDone(name: string): Promise<boolean> {
  const row = await queryOne<{ name: string }>(`select name from setup_steps where name = $1`, [name]);
  return row !== null;
}

async function markStep(name: string): Promise<void> {
  await query(`insert into setup_steps (name) values ($1) on conflict (name) do nothing`, [name]);
}

async function step(name: string, run: () => Promise<void>): Promise<void> {
  if (await stepDone(name)) return;
  await run();
  await markStep(name);
}

/** Clears what an interrupted order step left behind, so the retry starts from nothing. */
async function clearPartialOrder(number: string): Promise<void> {
  const order = await queryOne<{ id: string }>(`select id from orders where number = $1`, [number]);
  if (!order) return;
  await query(
    `delete from files where project_id in (select id from projects where order_id = $1)`,
    [order.id],
  );
  await query(
    `delete from project_assignments where project_id in (select id from projects where order_id = $1)`,
    [order.id],
  );
  await query(`delete from invites where project_id in (select id from projects where order_id = $1)`, [
    order.id,
  ]);
  await query(`delete from download_links where order_id = $1`, [order.id]);
  await query(`delete from dunning_attempts where order_id = $1`, [order.id]);
  await query(`delete from invoice_tasks where order_id = $1`, [order.id]);
  await query(`delete from refunds where payment_id in (select id from payments where order_id = $1)`, [
    order.id,
  ]);
  await query(`delete from payments where order_id = $1`, [order.id]);
  await query(`delete from plan_previews where order_id = $1`, [order.id]);
  await query(`delete from projects where order_id = $1`, [order.id]);
  await query(`delete from orders where id = $1`, [order.id]);
}

interface SeedPerson {
  name: string;
  email: string;
  password: string;
}

const STUDIO_OWNER: SeedPerson = {
  name: "Inés Calvar",
  email: "ines@pampero.test",
  password: "pampero-owner-2026",
};

const CONTRACTORS: SeedPerson[] = [
  { name: "Tomás Rivero", email: "tomas@pampero.test", password: "pampero-contractor-1" },
  { name: "Dana Okafor", email: "dana@pampero.test", password: "pampero-contractor-2" },
];

interface SeedClient {
  businessName: string;
  currency: Currency;
  owner: SeedPerson;
}

const CLIENTS: SeedClient[] = [
  {
    businessName: "Yerba Norte SRL",
    currency: "ARS",
    owner: { name: "Mariela Sosa", email: "mariela@yerbanorte.test", password: "client-owner-ars-1" },
  },
  {
    businessName: "Casa Brava",
    currency: "USD",
    owner: { name: "Olivia Brava", email: "olivia@casabrava.test", password: "client-owner-usd-1" },
  },
  {
    businessName: "Harbor & Pine Ltd",
    currency: "USD",
    owner: { name: "Grace Whitlow", email: "grace@harborpine.test", password: "client-owner-usd-2" },
  },
  {
    businessName: "Ferretería Lumen",
    currency: "ARS",
    owner: { name: "Ramiro Díaz", email: "ramiro@lumen.test", password: "client-owner-ars-2" },
  },
  {
    businessName: "Panadería Sur",
    currency: "ARS",
    owner: { name: "Lucía Ferro", email: "lucia@panaderiasur.test", password: "client-owner-ars-3" },
  },
  {
    businessName: "Quill & Fern Books",
    currency: "USD",
    owner: { name: "Noah Prescott", email: "noah@quillfern.test", password: "client-owner-usd-3" },
  },
];

const TEAMMATE: SeedPerson = {
  name: "Bruno Paz",
  email: "bruno@yerbanorte.test",
  password: "client-team-ars-1",
};

interface SeedEntry {
  kind: cms.EntryKind;
  slug: string;
  title: string;
  client: string;
  year: number;
  status: cms.EntryStatus;
  publishedAt: string | null;
  summary: string;
  body: string;
}

const ENTRIES: SeedEntry[] = [
  {
    kind: "case_study",
    slug: "mate-route",
    title: "Mate Route",
    client: "Mate Route Co.",
    year: 2026,
    status: "published",
    publishedAt: "2026-09-14",
    summary: "A touring shop for a mate roaster, built around one long scroll and a two-currency cart.",
    body:
      "Mate Route sells gourds and yerba to buyers in Argentina and abroad. We built a single long page " +
      "that carries the roast story, then a quiet checkout that quotes in pesos or dollars without a call. " +
      "The studio shipped the build in five weeks and handed over a care plan for the harvest season.",
  },
  {
    kind: "case_study",
    slug: "atelier-ombu",
    title: "Atelier Ombú",
    client: "Atelier Ombú",
    year: 2026,
    status: "published",
    publishedAt: "2026-07-30",
    summary: "A furniture atelier's portfolio, set in wide display type over a bone paper ground.",
    body:
      "Atelier Ombú makes one table at a time. The site had to feel like the workshop: warm paper, heavy " +
      "ink, and photographs that sit still. We wrote the copy with the founder over two afternoons.",
  },
  {
    kind: "case_study",
    slug: "lanchas-del-delta",
    title: "Lanchas del Delta",
    client: "Lanchas del Delta",
    year: 2026,
    status: "published",
    publishedAt: "2026-05-02",
    summary: "A river taxi service with a timetable that reads clearly on a phone at the dock.",
    body:
      "The delta runs on tides and daylight. We built a timetable that loads in under a second on a weak " +
      "signal, then a booking flow that takes a deposit and leaves the balance for the pier.",
  },
  {
    kind: "case_study",
    slug: "norte-cycling-club",
    title: "Norte Cycling Club",
    client: "Norte Cycling Club",
    year: 2026,
    status: "published",
    publishedAt: "2026-02-11",
    summary: "A club site where members find the Sunday route and pay dues in pesos.",
    body:
      "Four hundred riders, one route a week. The club wanted a page that answers where and when, and a " +
      "dues page that survives a price rise every other month.",
  },
  {
    kind: "case_study",
    slug: "bodega-lince",
    title: "Bodega Lince",
    client: "Bodega Lince",
    year: 2026,
    status: "draft",
    publishedAt: null,
    summary: "A small winery's tasting-room site, in draft while the harvest photographs are made.",
    body: "Draft notes for the Bodega Lince build.",
  },
  {
    kind: "case_study",
    slug: "cafe-ruta-40",
    title: "Café Ruta 40",
    client: "Café Ruta 40",
    year: 2025,
    status: "withdrawn",
    publishedAt: "2025-11-20",
    summary: "A roadside café's menu site, withdrawn when the café changed hands.",
    body: "The Café Ruta 40 build is no longer published.",
  },
  {
    kind: "journal",
    slug: "pricing-in-two-currencies",
    title: "Pricing in two currencies",
    client: "",
    year: 2026,
    status: "published",
    publishedAt: "2026-10-06",
    summary: "Why a peso quote has to lock the moment a client accepts it.",
    body:
      "A dollar price can sit in a document for a month. A peso price cannot. We lock the figure the " +
      "client accepted and invoice the launch balance at that same figure, whatever the new price is.",
  },
  {
    kind: "journal",
    slug: "what-a-care-plan-covers",
    title: "What a care plan covers",
    client: "",
    year: 2026,
    status: "published",
    publishedAt: "2026-08-19",
    summary: "The monthly work behind Care Lite and Care Plus, and what a tier change costs mid-month.",
    body:
      "Care Lite keeps the site patched and backed up. Care Plus adds a monthly block of design work. " +
      "Change tier whenever you like: billing credits the unused days and charges the new tier for them.",
  },
];

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A small solid-colour PNG, written here so the repository carries no binary assets. */
function solidPng(width: number, height: number, colour: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw: Buffer[] = [];
  for (let row = 0; row < height; row += 1) {
    const line = Buffer.alloc(1 + width * 3);
    for (let column = 0; column < width; column += 1) {
      line[1 + column * 3] = colour[0];
      line[2 + column * 3] = colour[1];
      line[3 + column * 3] = colour[2];
    }
    raw.push(line);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(raw))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const YERBA_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <rect width="120" height="120" fill="#F3EEE4"/>
  <path d="M24 92 C40 44, 80 28, 96 24 C92 60, 68 92, 24 92 Z" fill="#1B4DD1"/>
  <path d="M24 92 C44 72, 68 52, 96 24" stroke="#14110F" stroke-width="3" fill="none"/>
</svg>
`;

async function seedPeople(): Promise<void> {
  await withTransaction(async (client) => {
    const insertUser = async (
      accountId: string | null,
      person: SeedPerson,
      role: "client_owner" | "teammate" | "studio_owner" | "contractor",
    ): Promise<void> => {
      await client.query(
        `insert into users (id, account_id, name, email, password_hash, role)
         values ($1, $2, $3, $4, $5, $6) on conflict (email) do nothing`,
        [randomUUID(), accountId, person.name, person.email, await hashPassword(person.password), role],
      );
    };
    await insertUser(null, STUDIO_OWNER, "studio_owner");
    for (const contractor of CONTRACTORS) await insertUser(null, contractor, "contractor");
    for (const seeded of CLIENTS) {
      const accountId = randomUUID();
      await client.query(
        `insert into client_accounts (id, business_name, currency) values ($1, $2, $3)`,
        [accountId, seeded.businessName, seeded.currency],
      );
      await insertUser(accountId, seeded.owner, "client_owner");
      if (seeded.businessName === "Yerba Norte SRL") await insertUser(accountId, TEAMMATE, "teammate");
    }
  });
}

async function accountOf(businessName: string): Promise<{ id: string; businessName: string; currency: Currency }> {
  const row = await queryOne<{ id: string; business_name: string; currency: string }>(
    `select id, business_name, currency from client_accounts where business_name = $1`,
    [businessName],
  );
  if (!row) throw new Error(`seed account ${businessName} is missing`);
  return { id: row.id, businessName: row.business_name, currency: row.currency as Currency };
}

async function ownerEmailOf(accountId: string): Promise<string> {
  const row = await queryOne<{ email: string }>(
    `select email from users where account_id = $1 and role = 'client_owner'`,
    [accountId],
  );
  if (!row) throw new Error("seed owner is missing");
  return row.email;
}

async function killbillAccountFor(businessName: string): Promise<{ accountId: string; killbillAccountId: string; currency: Currency }> {
  const account = await accountOf(businessName);
  const email = await ownerEmailOf(account.id);
  const existing = await queryOne<{ killbill_account_id: string | null }>(
    `select killbill_account_id from client_accounts where id = $1`,
    [account.id],
  );
  if (existing?.killbill_account_id) {
    return { accountId: account.id, killbillAccountId: existing.killbill_account_id, currency: account.currency };
  }
  const killbillAccountId = await killbill.createAccount({
    externalKey: `pampero-${account.id}`,
    name: account.businessName,
    email,
    currency: account.currency,
  });
  await query(`update client_accounts set killbill_account_id = $2 where id = $1`, [account.id, killbillAccountId]);
  return { accountId: account.id, killbillAccountId, currency: account.currency };
}

async function insertOrder(input: {
  number: string;
  accountId: string;
  plan: PlanId;
  currency: Currency;
  state: string;
  totalMinor: bigint;
  depositMinor: bigint;
  balanceMinor: bigint;
  priceRowId: string;
  priceEffectiveAt: Date;
  careTier: CareTier | null;
}): Promise<string> {
  const id = randomUUID();
  await query(
    `insert into orders (id, number, account_id, plan, currency, state, total_minor, deposit_minor,
       balance_minor, price_row_id, price_effective_at, accepted_at, care_tier)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)`,
    [
      id,
      input.number,
      input.accountId,
      input.plan,
      input.currency,
      input.state,
      input.totalMinor.toString(),
      input.depositMinor.toString(),
      input.balanceMinor.toString(),
      input.priceRowId,
      input.priceEffectiveAt.toISOString(),
      input.careTier,
    ],
  );
  return id;
}

async function captureSeedPayment(input: {
  killbillAccountId: string;
  orderId: string;
  accountId: string;
  kind: "deposit" | "balance" | "care";
  amountMinor: bigint;
  currency: Currency;
  invoiceId: string;
  paymentExternalKey: string;
}): Promise<void> {
  const amount = money(input.currency, input.amountMinor);
  const paymentId = await killbill.authorize(input.killbillAccountId, amount, input.paymentExternalKey);
  await killbill.capture(paymentId, amount, input.paymentExternalKey);
  await killbill.settleInvoice(
    input.killbillAccountId,
    input.invoiceId,
    amount,
    `${input.paymentExternalKey}-settle`,
  );
  await query(
    `insert into payments (id, order_id, kind, amount_minor, currency, killbill_payment_id, killbill_invoice_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      input.orderId,
      input.kind,
      amount.minor.toString(),
      amount.currency,
      paymentId,
      input.invoiceId,
    ],
  );
  const invoice = await killbill.getInvoice(input.invoiceId);
  await registerInvoice({
    invoice,
    accountId: input.accountId,
    orderId: input.orderId,
    kind: input.kind,
  });
}

async function addSeedFile(input: {
  orderId: string;
  projectId: string;
  kind: "asset" | "deliverable";
  name: string;
  contentType: string;
  bytes: Buffer;
  uploaderEmail: string;
}): Promise<void> {
  const uploader = await queryOne<{ id: string }>(`select id from users where email = $1`, [
    input.uploaderEmail,
  ]);
  if (!uploader) throw new Error(`seed uploader ${input.uploaderEmail} is missing`);
  const fileId = randomUUID();
  const objectKey = storage.fileObjectKey(input.orderId, input.kind, fileId, input.name);
  await storage.putObject(objectKey, input.bytes);
  await query(
    `insert into files (id, project_id, kind, name, content_type, size_bytes, uploaded_by, object_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [fileId, input.projectId, input.kind, input.name, input.contentType, input.bytes.length, uploader.id, objectKey],
  );
}

async function assignSeedContractor(projectId: string, email: string): Promise<void> {
  const contractor = await queryOne<{ id: string }>(`select id from users where email = $1`, [email]);
  if (!contractor) throw new Error(`seed contractor ${email} is missing`);
  await query(
    `insert into project_assignments (project_id, contractor_id) values ($1, $2) on conflict do nothing`,
    [projectId, contractor.id],
  );
}

async function priceRowFor(plan: PlanId, currency: Currency) {
  const row = await priceInEffect(plan, currency, new Date());
  if (!row) throw new Error(`seed price for ${plan} ${currency} is missing`);
  return row;
}

async function seedBuildOrder(input: {
  number: string;
  businessName: string;
  plan: PlanId;
  payBalance: boolean;
  finalState: "in_build" | "paid_in_full";
  contractorEmail: string;
  assets: Array<{ name: string; contentType: string; bytes: Buffer }>;
  deliverables: Array<{ name: string; contentType: string; bytes: Buffer }>;
}): Promise<void> {
  await clearPartialOrder(input.number);
  const billing = await killbillAccountFor(input.businessName);
  const priceRow = await priceRowFor(input.plan, billing.currency);
  const quote = quoteFromPrice(input.plan, priceRow);
  const orderId = await insertOrder({
    number: input.number,
    accountId: billing.accountId,
    plan: input.plan,
    currency: billing.currency,
    state: "accepted",
    totalMinor: quote.total.minor,
    depositMinor: quote.dueNow.minor,
    balanceMinor: quote.dueAtLaunch.minor,
    priceRowId: priceRow.id,
    priceEffectiveAt: priceRow.effectiveAt,
    careTier: null,
  });
  await query(`update client_accounts set card_last4 = '4242' where id = $1`, [billing.accountId]);

  const depositInvoiceId = await killbill.createExternalCharge(
    billing.killbillAccountId,
    quote.dueNow,
    `${input.number} deposit`,
  );
  await query(`update orders set deposit_invoice_id = $2 where id = $1`, [orderId, depositInvoiceId]);
  await storage.putObject(storage.portalFolderMarkerKey(orderId), Buffer.from("pampero portal folder\n"));
  const projectId = randomUUID();
  await query(`insert into projects (id, order_id, account_id) values ($1, $2, $3)`, [
    projectId,
    orderId,
    billing.accountId,
  ]);
  await captureSeedPayment({
    killbillAccountId: billing.killbillAccountId,
    orderId,
    accountId: billing.accountId,
    kind: "deposit",
    amountMinor: quote.dueNow.minor,
    currency: billing.currency,
    invoiceId: depositInvoiceId,
    paymentExternalKey: `${orderId}-deposit`,
  });

  if (input.payBalance) {
    const balanceInvoiceId = await killbill.createExternalCharge(
      billing.killbillAccountId,
      quote.dueAtLaunch,
      `${input.number} launch balance`,
    );
    await query(`update orders set balance_invoice_id = $2 where id = $1`, [orderId, balanceInvoiceId]);
    await captureSeedPayment({
      killbillAccountId: billing.killbillAccountId,
      orderId,
      accountId: billing.accountId,
      kind: "balance",
      amountMinor: quote.dueAtLaunch.minor,
      currency: billing.currency,
      invoiceId: balanceInvoiceId,
      paymentExternalKey: `${orderId}-balance`,
    });
    await query(`update invoice_tasks set notice_sent_at = now() where killbill_invoice_id = $1`, [
      balanceInvoiceId,
    ]);
  }

  const ownerEmail = await ownerEmailOf(billing.accountId);
  for (const asset of input.assets) {
    await addSeedFile({
      orderId,
      projectId,
      kind: "asset",
      name: asset.name,
      contentType: asset.contentType,
      bytes: asset.bytes,
      uploaderEmail: ownerEmail,
    });
  }
  for (const deliverable of input.deliverables) {
    await addSeedFile({
      orderId,
      projectId,
      kind: "deliverable",
      name: deliverable.name,
      contentType: deliverable.contentType,
      bytes: deliverable.bytes,
      uploaderEmail: input.contractorEmail,
    });
  }
  await assignSeedContractor(projectId, input.contractorEmail);
  await query(`update orders set state = $2 where id = $1`, [orderId, input.finalState]);
}

const AUTO_INVOICING_OFF = "00000000-0000-0000-0000-000000000002";

async function seedCareOrder(input: {
  number: string;
  businessName: string;
  tier: CareTier;
  monthsAgo: number;
  paused: boolean;
  cardLast4: string;
}): Promise<void> {
  await clearPartialOrder(input.number);
  const billing = await killbillAccountFor(input.businessName);
  const plan: PlanId = input.tier === "lite" ? "care-lite" : "care-plus";
  const priceRow = await priceRowFor(plan, billing.currency);
  const quote = quoteFromPrice(plan, priceRow);
  const orderId = await insertOrder({
    number: input.number,
    accountId: billing.accountId,
    plan,
    currency: billing.currency,
    state: "accepted",
    totalMinor: quote.total.minor,
    depositMinor: quote.dueNow.minor,
    balanceMinor: 0n,
    priceRowId: priceRow.id,
    priceEffectiveAt: priceRow.effectiveAt,
    careTier: input.tier,
  });
  await query(`update client_accounts set card_last4 = $2 where id = $1`, [billing.accountId, input.cardLast4]);
  await storage.putObject(storage.portalFolderMarkerKey(orderId), Buffer.from("pampero portal folder\n"));

  const today = studioDate(new Date());
  const startDate = input.monthsAgo === 0 ? undefined : addMonthsToDate(today, -input.monthsAgo);
  if (input.paused) await killbill.addAccountTag(billing.killbillAccountId, AUTO_INVOICING_OFF);
  const subscription = await killbill.createSubscription({
    accountId: billing.killbillAccountId,
    bundleExternalKey: `care-${orderId}`,
    tier: input.tier,
    price: quote.total,
    startDate,
    waitForInvoice: !input.paused,
  });
  await query(
    `update orders set care_subscription_id = $2, care_bundle_id = $3 where id = $1`,
    [orderId, subscription.subscriptionId, subscription.bundleId],
  );
  if (input.paused) {
    const pauseDate = addMonthsToDate(today, -(input.monthsAgo - 1));
    await killbill.pauseBundle(subscription.bundleId, pauseDate);
    await killbill.removeAccountTag(billing.killbillAccountId, AUTO_INVOICING_OFF);
    await killbill.generateInvoices(billing.killbillAccountId, today);
  }

  let invoices: killbill.KbInvoice[] = [];
  for (let attempt = 0; attempt < 40 && invoices.length === 0; attempt += 1) {
    const all = await killbill.listInvoices(billing.killbillAccountId);
    invoices = all
      .filter((invoice) => invoice.items.some((item) => item.subscriptionId === subscription.subscriptionId))
      .sort((left, right) => {
        const leftStart = left.items.find((item) => item.itemType === "RECURRING")?.startDate ?? "";
        const rightStart = right.items.find((item) => item.itemType === "RECURRING")?.startDate ?? "";
        return leftStart.localeCompare(rightStart);
      });
    if (invoices.length === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const first = invoices[0];
  if (!first) throw new Error(`seed care order ${input.number} has no first invoice`);
  await captureSeedPayment({
    killbillAccountId: billing.killbillAccountId,
    orderId,
    accountId: billing.accountId,
    kind: "care",
    amountMinor: first.balance.minor,
    currency: billing.currency,
    invoiceId: first.invoiceId,
    paymentExternalKey: `${orderId}-care`,
  });
  await query(`update orders set state = 'paid_in_full' where id = $1`, [orderId]);
}

async function seedEntries(): Promise<void> {
  await cms.ensureCollection();
  for (const entry of ENTRIES) {
    const existing = await cms.entryBySlug(entry.slug);
    if (existing) continue;
    await cms.createEntry({
      kind: entry.kind,
      slug: entry.slug,
      title: entry.title,
      client: entry.client,
      year: entry.year,
      summary: entry.summary,
      body: entry.body,
      status: entry.status,
      publishedAt: entry.publishedAt,
    });
  }
}

/** Seeds on serve against an empty ledger, one step at a time, retrying what a down service blocked. */
export async function runSeed(): Promise<void> {
  await withAdvisoryLock(lockKey("pampero-seed"), seedEverything);
}

async function seedEverything(): Promise<void> {
  await step("prices", seedPrices);
  await step("people", seedPeople);
  await step("entries", seedEntries);
  await step("order-PB-0001", async () => {
    await seedBuildOrder({
      number: "PB-0001",
      businessName: "Yerba Norte SRL",
      plan: "studio-site",
      payBalance: false,
      finalState: "in_build",
      contractorEmail: "tomas@pampero.test",
      assets: [
        { name: "yerba-norte-logo.svg", contentType: "image/svg+xml", bytes: Buffer.from(YERBA_LOGO_SVG, "utf8") },
      ],
      deliverables: [],
    });
  });
  await step("order-PB-0002", async () => {
    await seedBuildOrder({
      number: "PB-0002",
      businessName: "Casa Brava",
      plan: "launch-page",
      payBalance: true,
      finalState: "paid_in_full",
      contractorEmail: "dana@pampero.test",
      assets: [
        {
          name: "casa-brava-palette.pdf",
          contentType: "application/pdf",
          bytes: documentPdf("Casa Brava palette", [
            "Bone paper #F3EEE4",
            "Ink #14110F",
            "Cobalt #1B4DD1",
            "Seam #D8471F",
          ]),
        },
      ],
      deliverables: [
        {
          name: "casa-brava-homepage.png",
          contentType: "image/png",
          bytes: solidPng(48, 32, [27, 77, 209]),
        },
      ],
    });
  });
  await step("order-PB-0003", async () => {
    await seedCareOrder({
      number: "PB-0003",
      businessName: "Harbor & Pine Ltd",
      tier: "plus",
      monthsAgo: 0,
      paused: false,
      cardLast4: "4242",
    });
  });
  await step("order-PB-0004", async () => {
    await seedCareOrder({
      number: "PB-0004",
      businessName: "Ferretería Lumen",
      tier: "lite",
      monthsAgo: 1,
      paused: false,
      cardLast4: "0002",
    });
  });
  await step("order-PB-0005", async () => {
    await seedCareOrder({
      number: "PB-0005",
      businessName: "Panadería Sur",
      tier: "plus",
      monthsAgo: 1,
      paused: false,
      cardLast4: "0002",
    });
  });
  await step("order-PB-0006", async () => {
    await seedCareOrder({
      number: "PB-0006",
      businessName: "Quill & Fern Books",
      tier: "lite",
      monthsAgo: 2,
      paused: true,
      cardLast4: "4242",
    });
  });
}
