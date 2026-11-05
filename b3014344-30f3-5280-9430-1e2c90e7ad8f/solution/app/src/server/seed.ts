import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth";
import { catalogXml, SEED_PRICES, SEED_PRICES_FROM } from "./catalog";
import { createEntry, ensureCollection, slugTaken, type NewEntry } from "./cms";
import { exclusively, one, query, rows, tx, type Db } from "./db";
import { renderPdf, renderPng } from "./documents";
import * as billing from "./killbill";
import { accountWithOwner, firstCareInvoice } from "./orders";
import { objectKeys, putObject } from "./storage";
import { addMonths, studioDate, studioMidnight } from "./time";
import { figuresFor } from "./pricing";
import { PLAN_IDS, type OrderState, type PlanId } from "../shared/domain";
import type { Currency } from "../shared/money";

// Seeding runs on serve against an empty ledger, one step at a time, each recorded once done.
// A step whose service is down is retried on the next pass; only one process seeds at a time.

interface SeedClient {
  key: string;
  business: string;
  owner: string;
  email: string;
  password: string;
  currency: Currency;
  card: string;
}

const CLIENTS: SeedClient[] = [
  { key: "yerba", business: "Yerba Norte SRL", owner: "Mariela Sosa", email: "mariela@yerbanorte.test", password: "client-owner-ars-1", currency: "ARS", card: "4242" },
  { key: "brava", business: "Casa Brava", owner: "Olivia Brava", email: "olivia@casabrava.test", password: "client-owner-usd-1", currency: "USD", card: "4242" },
  { key: "harbor", business: "Harbor & Pine Ltd", owner: "Grace Whitlow", email: "grace@harborpine.test", password: "client-owner-usd-2", currency: "USD", card: "4242" },
  { key: "lumen", business: "Ferretería Lumen", owner: "Ramiro Díaz", email: "ramiro@lumen.test", password: "client-owner-ars-2", currency: "ARS", card: "0002" },
  { key: "panaderia", business: "Panadería Sur", owner: "Lucía Ferro", email: "lucia@panaderiasur.test", password: "client-owner-ars-3", currency: "ARS", card: "0002" },
  { key: "quill", business: "Quill & Fern Books", owner: "Noah Prescott", email: "noah@quillfern.test", password: "client-owner-usd-3", currency: "USD", card: "4242" },
];

const STAFF = [
  { role: "studio_owner", name: "Inés Calvar", email: "ines@pampero.test", password: "pampero-owner-2026" },
  { role: "contractor", name: "Tomás Rivero", email: "tomas@pampero.test", password: "pampero-contractor-1" },
  { role: "contractor", name: "Dana Okafor", email: "dana@pampero.test", password: "pampero-contractor-2" },
] as const;

interface SeedOrder {
  number: string;
  client: string;
  plan: PlanId;
  state: OrderState;
  /** Care plans: whole months before the seeding day that the subscription started. */
  monthsAgo?: number;
}

const ORDERS: SeedOrder[] = [
  { number: "PB-0001", client: "yerba", plan: "studio-site", state: "in_build" },
  { number: "PB-0002", client: "brava", plan: "launch-page", state: "paid_in_full" },
  { number: "PB-0003", client: "harbor", plan: "care-plus", state: "paid_in_full", monthsAgo: 0 },
  { number: "PB-0004", client: "lumen", plan: "care-lite", state: "paid_in_full", monthsAgo: 1 },
  { number: "PB-0005", client: "panaderia", plan: "care-plus", state: "paid_in_full", monthsAgo: 1 },
  { number: "PB-0006", client: "quill", plan: "care-lite", state: "paid_in_full", monthsAgo: 2 },
];

const ENTRIES: (NewEntry & { status: "draft" | "published" | "withdrawn"; published?: string })[] = [
  {
    kind: "case_study", slug: "mate-route", title: "Mate Route", client: "Mate Route Co.", year: 2026, status: "published", published: "2026-09-14",
    summary: "A booking site for guided yerba mate tastings across the Litoral, quoted in pesos and paid in one visit.",
    body: "Mate Route runs small tasting walks from Corrientes to Posadas. Their old site was a phone number and a gallery.\n\nWe built a four-page site around one decision: pick a date, see the price in pesos, pay the deposit. The route map is drawn in SVG so it loads instantly on rural connections, and every walk page carries the guide's own notes.\n\nBookings moved from WhatsApp threads to a single confirmed list the team checks each morning.",
  },
  {
    kind: "case_study", slug: "atelier-ombu", title: "Atelier Ombú", client: "Atelier Ombú", year: 2026, status: "published", published: "2026-07-30",
    summary: "A portfolio for a furniture workshop in San Telmo, built so each piece reads like a page from the maker's notebook.",
    body: "Atelier Ombú makes tables and benches from reclaimed lapacho. They wanted a site that felt as slow and deliberate as the work.\n\nEach piece has one long page: the timber's origin, the joinery, the finish, and the hours it took. Photography sits on a warm paper ground with generous margins, and enquiries go straight to the workshop with the piece already named.\n\nThe studio now quotes commissions from the site instead of from screenshots.",
  },
  {
    kind: "case_study", slug: "lanchas-del-delta", title: "Lanchas del Delta", client: "Lanchas del Delta", year: 2026, status: "published", published: "2026-05-02",
    summary: "Timetables, fares and live notices for a river launch service in the Tigre delta, readable on a phone at the pier.",
    body: "Lanchas del Delta carries residents and visitors between Tigre and the islands. Schedules change with the tide and the season.\n\nWe replaced a PDF timetable with pages per route that show the next three departures first, fares in pesos, and a notice strip the crew can update from the boat. Everything is large, high-contrast and works with one thumb.\n\nPier staff report far fewer calls asking when the next launch leaves.",
  },
  {
    kind: "case_study", slug: "norte-cycling-club", title: "Norte Cycling Club", client: "Norte Cycling Club", year: 2026, status: "published", published: "2026-02-11",
    summary: "A members' site for a Salta road club: ride calendar, route files and a care plan that keeps it current.",
    body: "Norte Cycling Club organises weekly rides in the hills around Salta. Their calendar lived in a group chat.\n\nThe new site lists every ride with distance, climbing and meeting point, and offers the route file for download. The club is on a Care Lite plan, so new rides and small fixes land within the week.\n\nMembership sign-ups doubled over the first season.",
  },
  {
    kind: "case_study", slug: "bodega-lince", title: "Bodega Lince", client: "Bodega Lince", year: 2026, status: "draft",
    summary: "A cellar-door site for a small Mendoza winery, in progress.",
    body: "Bodega Lince is a family winery in Luján de Cuyo. This case study is still being written.",
  },
  {
    kind: "case_study", slug: "cafe-ruta-40", title: "Café Ruta 40", client: "Café Ruta 40", year: 2025, status: "withdrawn",
    summary: "A roadside café's menu and opening hours on National Route 40.",
    body: "Café Ruta 40 served travellers on the long stretch north of Cafayate. The café has since closed.",
  },
  {
    kind: "journal", slug: "pricing-in-two-currencies", title: "Pricing in two currencies", client: "", year: null, status: "published", published: "2026-10-06",
    summary: "Why every quote here is shown in dollars or pesos, and why a peso quote is locked the moment you accept it.",
    body: "Foreign clients pay in US dollars; local businesses pay in pesos, and peso prices move every few weeks.\n\nSo every plan has a dollar price and a peso price, and the peso price has a date it takes effect. When you accept a quote, its price is locked for that order: the deposit, the launch balance and every care-plan renewal use it, whatever the price list says later.\n\nThe deposit is always 40% of the total, rounded down to the centavo, and the launch balance is the rest, so the two always add up exactly.",
  },
  {
    kind: "journal", slug: "what-a-care-plan-covers", title: "What a care plan covers", client: "", year: null, status: "published", published: "2026-08-19",
    summary: "Care Lite and Care Plus, what each includes, and how changing between them is worked out to the day.",
    body: "A care plan keeps a launched site healthy: updates, backups, small content changes and a monthly check.\n\nCare Lite covers the essentials. Care Plus adds more change requests each month and faster replies. You can switch at any time; billing credits the unused days of your current plan and charges the new one for the same days, and you see both figures before you confirm.\n\nPausing or cancelling takes effect at the end of the period you've already paid for.",
  },
];

const YERBA_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect width="240" height="240" rx="24" fill="#f3ede1"/>
  <circle cx="120" cy="126" r="70" fill="#2f5d3a"/>
  <path d="M120 64c26 20 34 52 18 82-8 15-20 24-18 34-14-12-26-30-24-58 2-24 12-44 24-58z" fill="#a3c46c"/>
  <path d="M120 70v112" stroke="#f3ede1" stroke-width="4" stroke-linecap="round"/>
  <text x="120" y="222" font-family="Helvetica, Arial, sans-serif" font-size="20" text-anchor="middle" fill="#1a1d26">Yerba Norte</text>
</svg>
`;

function palettePdf(): Buffer {
  const swatches: { name: string; hex: string; rgb: [number, number, number] }[] = [
    { name: "Terracotta", hex: "#C2603A", rgb: [194, 96, 58] },
    { name: "Lime wash", hex: "#EFE6D2", rgb: [239, 230, 210] },
    { name: "Olive", hex: "#6B6B3A", rgb: [107, 107, 58] },
    { name: "Ink", hex: "#1A1D26", rgb: [26, 29, 38] },
  ];
  return renderPdf({
    boxes: swatches.map((s, i) => ({ x: 56 + i * 124, y: 560, w: 108, h: 140, rgb: s.rgb })),
    lines: [
      { text: "Casa Brava", x: 56, y: 770, size: 22, font: "bold" },
      { text: "Brand palette", x: 56, y: 744, size: 12 },
      ...swatches.flatMap((s, i) => [
        { text: s.name, x: 56 + i * 124, y: 540, size: 11, font: "bold" as const },
        { text: s.hex, x: 56 + i * 124, y: 524, size: 10, font: "mono" as const },
      ]),
    ],
  });
}

function homepagePng(): Buffer {
  const bone: [number, number, number] = [243, 237, 225];
  const ink: [number, number, number] = [26, 29, 38];
  const terracotta: [number, number, number] = [194, 96, 58];
  const olive: [number, number, number] = [107, 107, 58];
  return renderPng(640, 400, (x, y) => {
    if (y < 40) return x > 24 && x < 140 && y > 14 && y < 26 ? ink : bone;
    if (y >= 60 && y < 250 && x >= 24 && x < 616) return x < 330 ? terracotta : olive;
    if (y >= 90 && y < 110 && x >= 48 && x < 280) return bone;
    if (y >= 280 && y < 380) {
      const column = Math.floor((x - 24) / 200);
      return x >= 24 && x < 616 && (x - 24) % 200 < 184 && column < 3 ? [230, 222, 205] : bone;
    }
    return bone;
  });
}

async function done(step: string): Promise<boolean> {
  return Boolean(await one("SELECT 1 FROM seed_steps WHERE step = $1 AND done_at IS NOT NULL", [step]));
}

async function mark(db: Db | null, step: string, value: string | null = null): Promise<void> {
  const sql = "INSERT INTO seed_steps (step, value, done_at) VALUES ($1, $2, now()) ON CONFLICT (step) DO UPDATE SET value = EXCLUDED.value, done_at = now()";
  if (db) await db.query(sql, [step, value]);
  else await query(sql, [step, value]);
}

async function seedingDay(): Promise<string> {
  const row = await one<{ value: string }>("SELECT value FROM seed_steps WHERE step = 'seeding-day'");
  return row!.value;
}

/** Users, accounts, prices and orders; ledger-only, so sign-in works as soon as the app listens. */
export async function seedLedger(): Promise<void> {
  if (await done("ledger")) return;
  const passwords = [...STAFF, ...CLIENTS, { password: "client-team-ars-1" }].map((person) => person.password);
  const hashes = new Map(await Promise.all(passwords.map(async (password) => [password, await hashPassword(password)] as const)));
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('pampero-seed-ledger'))");
    if ((await rows(db, "SELECT 1 FROM seed_steps WHERE step = 'ledger' AND done_at IS NOT NULL")).length) return;
    const day = studioDate(new Date());
    await mark(db, "seeding-day", day);
    const from = new Date(SEED_PRICES_FROM);
    for (const plan of PLAN_IDS) {
      for (const currency of ["USD", "ARS"] as const) {
        await db.query("INSERT INTO prices (id, plan, currency, amount_minor, effective_at) VALUES ($1, $2, $3, $4, $5)", [
          randomUUID(), plan, currency, SEED_PRICES[plan][currency].toString(), from,
        ]);
      }
    }
    const people = new Map<string, string>();
    for (const staff of STAFF) {
      const id = randomUUID();
      people.set(staff.email, id);
      await db.query("INSERT INTO users (id, role, name, email, password_hash) VALUES ($1, $2, $3, $4, $5)", [id, staff.role, staff.name, staff.email, hashes.get(staff.password)]);
    }
    const accounts = new Map<string, string>();
    for (const client of CLIENTS) {
      const accountId = randomUUID();
      accounts.set(client.key, accountId);
      await db.query("INSERT INTO client_accounts (id, business_name, currency, card_last4) VALUES ($1, $2, $3, $4)", [accountId, client.business, client.currency, client.card]);
      const userId = randomUUID();
      people.set(client.email, userId);
      await db.query("INSERT INTO users (id, account_id, role, name, email, password_hash) VALUES ($1, $2, 'client_owner', $3, $4, $5)", [
        userId, accountId, client.owner, client.email, hashes.get(client.password),
      ]);
    }
    await db.query("INSERT INTO users (id, account_id, role, name, email, password_hash) VALUES ($1, $2, 'teammate', 'Bruno Paz', 'bruno@yerbanorte.test', $3)", [
      randomUUID(), accounts.get("yerba"), hashes.get("client-team-ars-1"),
    ]);
    for (const seeded of ORDERS) {
      const client = CLIENTS.find((c) => c.key === seeded.client)!;
      const [price] = await rows<{ id: string }>(db, "SELECT id FROM prices WHERE plan = $1 AND currency = $2", [seeded.plan, client.currency]);
      const figures = figuresFor(seeded.plan, SEED_PRICES[seeded.plan][client.currency]);
      const start = seeded.monthsAgo === undefined ? day : addMonths(day, -seeded.monthsAgo);
      const orderId = randomUUID();
      await db.query(
        `INSERT INTO orders (id, number, plan, currency, state, total_minor, due_now_minor, due_at_launch_minor, price_id, account_id, accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [orderId, seeded.number, seeded.plan, client.currency, seeded.state, figures.total.toString(), figures.dueNow.toString(), figures.dueAtLaunch.toString(),
          price!.id, accounts.get(seeded.client), new Date(studioMidnight(start).getTime() + 10 * 3600_000)],
      );
      if (seeded.monthsAgo === undefined) {
        const projectId = randomUUID();
        await db.query("INSERT INTO projects (id, order_id, account_id) VALUES ($1, $2, $3)", [projectId, orderId, accounts.get(seeded.client)]);
        const contractor = seeded.number === "PB-0001" ? "tomas@pampero.test" : "dana@pampero.test";
        await db.query("INSERT INTO assignments (project_id, contractor_id) VALUES ($1, $2)", [projectId, people.get(contractor)]);
      }
    }
    await mark(db, "ledger");
  });
}

async function seedCms(): Promise<void> {
  if (await done("cms")) return;
  await ensureCollection();
  for (const entry of ENTRIES) {
    if (await slugTaken(entry.slug)) continue;
    const { published, ...fields } = entry;
    await createEntry({ ...fields, ...(published ? { publishedAt: studioMidnight(published) } : {}) }).catch(async (error) => {
      if (!(await slugTaken(entry.slug))) throw error;
    });
  }
  await mark(null, "cms");
}

async function seedCatalog(): Promise<void> {
  if (await done("catalog")) return;
  if (!(await billing.catalogLoaded())) await billing.uploadCatalog(catalogXml());
  await mark(null, "catalog");
}

interface SeedOrderRow {
  [key: string]: unknown;
  id: string;
  number: string;
  plan: PlanId;
  currency: Currency;
  account_id: string;
  due_now_minor: string;
  due_at_launch_minor: string;
  total_minor: string;
}

/** Pays one seeded invoice with auth and capture, then settles it, and records the payment. */
async function payInvoice(order: SeedOrderRow, kbAccountId: string, inv: billing.KbInvoice, kind: string, at: Date): Promise<void> {
  if (await one("SELECT 1 FROM payments WHERE kb_invoice_id = $1", [inv.invoiceId])) return;
  const amount = billing.kbMinor(inv.balance);
  const ids = amount > 0n ? await billing.authorize(kbAccountId, amount, order.currency, `${order.id}-${kind}`) : [];
  await billing.capture(ids, order.currency);
  const paymentId = randomUUID();
  if (amount > 0n) await billing.settleInvoice(kbAccountId, inv.invoiceId, amount, `${paymentId}-settlement`);
  await tx(async (db) => {
    await db.query(
      "INSERT INTO payments (id, order_id, kind, amount_minor, kb_payment_ids, kb_invoice_id, settled, captured_at) VALUES ($1, $2, $3, $4, $5, $6, true, $7)",
      [paymentId, order.id, kind, amount.toString(), ids, inv.invoiceId, at],
    );
    await db.query("INSERT INTO invoice_pdfs (kb_invoice_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [inv.invoiceId, order.id]);
  });
}

async function chargeInvoice(kbAccountId: string, order: SeedOrderRow, minor: bigint, description: string): Promise<billing.KbInvoice> {
  const existing = (await billing.accountInvoices(kbAccountId)).find(
    (inv) => inv.status !== "VOID" && inv.items.some((item) => item.description === description),
  );
  return existing ?? billing.externalCharge(kbAccountId, minor, order.currency, description);
}

async function seedBilling(seeded: SeedOrder, day: string): Promise<void> {
  const step = `billing:${seeded.number}`;
  if (await done(step)) return;
  const order = (await one<SeedOrderRow>("SELECT * FROM orders WHERE number = $1", [seeded.number]))!;
  const account = await accountWithOwner(null, order.account_id);
  const kbAccountId = await billing.ensureAccount({ externalKey: `pampero-${account.id}`, name: account.business_name, email: account.owner_email, currency: account.currency });
  await query("UPDATE client_accounts SET kb_account_id = $2 WHERE id = $1", [account.id, kbAccountId]);
  const now = new Date();

  if (seeded.monthsAgo === undefined) {
    const deposit = await chargeInvoice(kbAccountId, order, BigInt(order.due_now_minor), `${order.number} deposit`);
    await payInvoice(order, kbAccountId, deposit, "deposit", now);
    if (seeded.state === "paid_in_full") {
      const balance = await chargeInvoice(kbAccountId, order, BigInt(order.due_at_launch_minor), `${order.number} launch balance`);
      await query("UPDATE orders SET balance_invoice_id = $2 WHERE id = $1", [order.id, balance.invoiceId]);
      await payInvoice(order, kbAccountId, balance, "balance", now);
    }
    await mark(null, step);
    return;
  }

  const plan = order.plan as "care-lite" | "care-plus";
  const start = addMonths(day, -seeded.monthsAgo);
  const backdated = seeded.monthsAgo > 0;
  if (backdated) await billing.setAccountTag(kbAccountId, billing.AUTO_INVOICING_OFF, true).catch(() => undefined);
  const planName = `${plan}-monthly`;
  const bundle = await billing.createSubscription({
    accountId: kbAccountId,
    bundleKey: `care-${order.id}`,
    planName,
    overrides: billing.careOverride(planName, SEED_PRICES[plan][order.currency], BigInt(order.total_minor)),
    ...(backdated ? { startDate: start } : {}),
  });
  const subscription = bundle.subscriptions[0]!;
  if (backdated) await billing.generateInvoice(kbAccountId, start);
  const first = backdated
    ? (await billing.accountInvoices(kbAccountId)).find((inv) => inv.items.some((item) => item.subscriptionId === subscription.subscriptionId && item.startDate === start))
    : await firstCareInvoice(kbAccountId, subscription.subscriptionId);
  if (!first) throw new Error(`no first invoice for ${order.number}`);
  await payInvoice(order, kbAccountId, first, "care", backdated ? new Date(studioMidnight(start).getTime() + 10 * 3600_000) : now);
  if (seeded.number === "PB-0006") {
    const paused = await billing.bundle(bundle.bundleId);
    if (!paused.timeline.events.some((e) => e.eventType === "PAUSE_ENTITLEMENT")) await billing.pauseBundle(bundle.bundleId, addMonths(start, 1));
  } else if (backdated) {
    await billing.generateInvoice(kbAccountId, day);
  }
  if (backdated) await billing.setAccountTag(kbAccountId, billing.AUTO_INVOICING_OFF, false).catch(() => undefined);
  await query(
    `INSERT INTO care_plans (id, order_id, account_id, tier, monthly_minor, kb_bundle_id, kb_subscription_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (order_id) DO NOTHING`,
    [randomUUID(), order.id, account.id, plan === "care-lite" ? "lite" : "plus", order.total_minor, bundle.bundleId, subscription.subscriptionId],
  );
  await mark(null, step);
}

async function seedStorage(): Promise<void> {
  if (await done("storage")) return;
  const orders = await query<{ id: string; number: string; project_id: string | null }>(
    "SELECT o.id, o.number, p.id AS project_id FROM orders o LEFT JOIN projects p ON p.order_id = o.id WHERE o.number = ANY($1)",
    [ORDERS.map((o) => o.number)],
  );
  for (const order of orders) await putObject(objectKeys.portal(order.id), Buffer.from(`${order.number}\n`));
  const byNumber = new Map(orders.map((o) => [o.number, o]));
  const uploader = async (email: string) => (await one<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]))!.id;
  const files = [
    { order: "PB-0001", kind: "asset" as const, name: "yerba-norte-logo.svg", type: "image/svg+xml", data: Buffer.from(YERBA_LOGO), by: "mariela@yerbanorte.test" },
    { order: "PB-0002", kind: "asset" as const, name: "casa-brava-palette.pdf", type: "application/pdf", data: palettePdf(), by: "olivia@casabrava.test" },
    { order: "PB-0002", kind: "deliverable" as const, name: "casa-brava-homepage.png", type: "image/png", data: homepagePng(), by: "dana@pampero.test" },
  ];
  for (const file of files) {
    const order = byNumber.get(file.order)!;
    if (await one("SELECT 1 FROM files WHERE project_id = $1 AND name = $2", [order.project_id, file.name])) continue;
    const id = randomUUID();
    const key = objectKeys.file(order.id, file.kind, id, file.name);
    await putObject(key, file.data);
    await query("INSERT INTO files (id, project_id, kind, name, type, size, object_key, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
      id, order.project_id, file.kind, file.name, file.type, file.data.length, key, await uploader(file.by),
    ]);
  }
  await mark(null, "storage");
}

/** One seeding pass: each step that is not done yet runs; a failed step waits for the next pass. */
export async function seed(): Promise<void> {
  if (await done("complete")) return;
  await exclusively("pampero-seed", async () => {
    const day = await seedingDay();
    const failures: unknown[] = [];
    const attempt = async (work: () => Promise<void>) => work().catch((error: unknown) => void failures.push(error));
    await attempt(seedCms);
    await attempt(seedStorage);
    await attempt(async () => {
      await seedCatalog();
      for (const order of ORDERS) await seedBilling(order, day);
    });
    if (failures.length) throw failures[0];
    await mark(null, "complete");
  });
}
