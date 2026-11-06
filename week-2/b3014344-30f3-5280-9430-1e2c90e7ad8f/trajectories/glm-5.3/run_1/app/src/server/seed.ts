import type { Db } from './db.js';
import { pool } from './db.js';
import { newId, baDate } from './util.js';
import { insertPrice } from './pricing.js';
import { createAccount, createUser } from './auth.js';
import { amountFromMinor, type Currency } from './money.js';
import { ensureEntriesCollection, createEntry, getEntryBySlug } from './cms.js';
import {
  addAutoPayOff,
  addExternalPaymentMethod,
  authorizePayment,
  capturePayment,
  createKbAccount,
  createChargeInvoice,
  createSubscription,
  getKbAccountPaymentMethod,
  getSubscription,
  pauseBundle,
  settleInvoice,
  getPaymentByKey,
  type KbSubscription,
} from './killbill.js';
import { putObject, folderMarkerKey } from './storage.js';
import { recordInvoice, waitForFirstInvoice } from './billing.js';

const SEED_PRICES: { plan: 'launch-page' | 'studio-site' | 'care-lite' | 'care-plus'; usd: string; ars: string }[] = [
  { plan: 'launch-page', usd: '1849.99', ars: '233333.33' },
  { plan: 'studio-site', usd: '4999.99', ars: '587654.32' },
  { plan: 'care-lite', usd: '149.00', ars: '189999.99' },
  { plan: 'care-plus', usd: '349.00', ars: '449999.99' },
];

export function buildCatalogXml(): string {
  const plan = (name: string, product: string, pretty: string, usd: string, ars: string): string => `\
    <plan name="${name}" prettyName="${pretty}">
      <product>${product}</product>
      <finalPhase type="EVERGREEN" prettyName="${pretty} monthly">
        <duration>
          <unit>UNLIMITED</unit>
          <number>-1</number>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price><currency>USD</currency><value>${usd}</value></price>
            <price><currency>ARS</currency><value>${ars}</value></price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
    <effectiveDate>2026-01-01T00:00:00+00:00</effectiveDate>
    <catalogName>Pampero</catalogName>
    <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
    <currencies>
        <currency>USD</currency>
        <currency>ARS</currency>
    </currencies>
    <products>
        <product name="care-lite">
            <category>BASE</category>
        </product>
        <product name="care-plus">
            <category>BASE</category>
        </product>
    </products>
    <rules>
        <changePolicy>
            <changePolicyCase>
                <policy>IMMEDIATE</policy>
            </changePolicyCase>
        </changePolicy>
        <changeAlignment>
            <changeAlignmentCase>
                <alignment>START_OF_SUBSCRIPTION</alignment>
            </changeAlignmentCase>
        </changeAlignment>
        <cancelPolicy>
            <cancelPolicyCase>
                <policy>END_OF_TERM</policy>
            </cancelPolicyCase>
        </cancelPolicy>
        <createAlignment>
            <createAlignmentCase>
                <alignment>START_OF_SUBSCRIPTION</alignment>
            </createAlignmentCase>
        </createAlignment>
        <billingAlignment>
            <billingAlignmentCase>
                <alignment>ACCOUNT</alignment>
            </billingAlignmentCase>
        </billingAlignment>
    </rules>
    <plans>
${plan('care-lite-monthly', 'care-lite', 'Care Lite', '149.00', '189999.99')}
${plan('care-plus-monthly', 'care-plus', 'Care Plus', '349.00', '449999.99')}
    </plans>
    <priceLists>
        <defaultPriceList name="DEFAULT">
            <plans>
                <plan>care-lite-monthly</plan>
                <plan>care-plus-monthly</plan>
            </plans>
        </defaultPriceList>
    </priceLists>
</catalog>
`;
}

function monthsAgo(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y!, (m! - 1) - months, 1));
  const targetMonthDays = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const dayNumber = Math.min(d!, targetMonthDays);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), dayNumber)).toISOString().slice(0, 10);
}

async function seedMarker(db: Db, key: string): Promise<boolean> {
  const result = await db.query('INSERT INTO seed_markers (key, done_at) VALUES ($1, now()) ON CONFLICT (key) DO NOTHING RETURNING key', [key]);
  return (result.rowCount ?? 0) > 0;
}

/** Apply schema, catalog, CMS collection and seed data on serve, idempotently, retrying while services are down. */
export async function ensureSeeded(): Promise<void> {
  for (;;) {
    try {
      const { applySchema } = await import('./db.js');
      await applySchema();
      const db = await pool.connect();
      let pricesSeeded = false;
      try {
        pricesSeeded = await seedMarker(db, 'seed-prices');
      } finally {
        db.release();
      }
      if (pricesSeeded) await seedPrices();
      const catalogSeeded = await (async () => {
        const c = await pool.connect();
        try {
          return await seedMarker(c, 'billing-catalog');
        } finally {
          c.release();
        }
      })();
      if (catalogSeeded) await uploadCatalog();
      await seedUsersAndOrders();
      await seedCms();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

async function uploadCatalog(): Promise<void> {
  const { kbUploadXml } = await import('./killbill.js');
  for (;;) {
    try {
      await kbUploadXml(buildCatalogXml());
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

async function seedPrices(): Promise<void> {
  const db = await pool.connect();
  try {
    const effective = new Date('2026-01-01T00:00:00-03:00');
    for (const price of SEED_PRICES) {
      await insertPrice(db, { plan: price.plan, currency: 'USD', amount: amountFromMinor('USD', BigInt(Math.round(Number(price.usd) * 100))), effectiveAt: effective });
      await insertPrice(db, { plan: price.plan, currency: 'ARS', amount: amountFromMinor('ARS', BigInt(Math.round(Number(price.ars) * 100))), effectiveAt: effective });
    }
  } finally {
    db.release();
  }
}

interface SeedAccount {
  key: string;
  businessName: string;
  currency: Currency;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  cardLast4: string;
}

const SEED_ACCOUNTS: SeedAccount[] = [
  { key: 'yerba-norte', businessName: 'Yerba Norte SRL', currency: 'ARS', ownerName: 'Mariela Sosa', ownerEmail: 'mariela@yerbanorte.test', ownerPassword: 'client-owner-ars-1', cardLast4: '4242' },
  { key: 'casa-brava', businessName: 'Casa Brava', currency: 'USD', ownerName: 'Olivia Brava', ownerEmail: 'olivia@casabrava.test', ownerPassword: 'client-owner-usd-1', cardLast4: '4242' },
  { key: 'harbor-pine', businessName: 'Harbor & Pine Ltd', currency: 'USD', ownerName: 'Grace Whitlow', ownerEmail: 'grace@harborpine.test', ownerPassword: 'client-owner-usd-2', cardLast4: '4242' },
  { key: 'ferreteria-lumen', businessName: 'Ferretería Lumen', currency: 'ARS', ownerName: 'Ramiro Díaz', ownerEmail: 'ramiro@lumen.test', ownerPassword: 'client-owner-ars-2', cardLast4: '0002' },
  { key: 'panaderia-sur', businessName: 'Panadería Sur', currency: 'ARS', ownerName: 'Lucía Ferro', ownerEmail: 'lucia@panaderiasur.test', ownerPassword: 'client-owner-ars-3', cardLast4: '0002' },
  { key: 'quill-fern', businessName: 'Quill & Fern Books', currency: 'USD', ownerName: 'Noah Prescott', ownerEmail: 'noah@quillfern.test', ownerPassword: 'client-owner-usd-3', cardLast4: '4242' },
];

async function seedUsersAndOrders(): Promise<void> {
  const seedingDay = baDate(new Date());
  const d = await pool.connect();
  try {
    const tomas = await ensureUser(d, { accountId: null, name: 'Tomás Rivero', email: 'tomas@pampero.test', role: 'contractor', password: 'pampero-contractor-1' });
    const dana = await ensureUser(d, { accountId: null, name: 'Dana Okafor', email: 'dana@pampero.test', role: 'contractor', password: 'pampero-contractor-2' });
    await ensureUser(d, { accountId: null, name: 'Inés Calvar', email: 'ines@pampero.test', role: 'studio_owner', password: 'pampero-owner-2026' });

    const accounts: Record<string, { id: string; killbillAccountId: string }> = {};
    const accountUsers: Record<string, string> = {};
    for (const seedAccount of SEED_ACCOUNTS) {
      const account = await ensureSeedAccount(d, seedAccount);
      const user = await ensureUser(d, {
        accountId: account.id,
        name: seedAccount.ownerName,
        email: seedAccount.ownerEmail,
        role: 'client_owner',
        password: seedAccount.ownerPassword,
      });
      accounts[seedAccount.key] = { id: account.id, killbillAccountId: account.killbillAccountId };
      accountUsers[seedAccount.key] = user.id;
    }
    await ensureUser(d, {
      accountId: accounts['yerba-norte']!.id,
      name: 'Bruno Paz',
      email: 'bruno@yerbanorte.test',
      role: 'teammate',
      password: 'client-team-ars-1',
    });

    // PB-0001: Yerba Norte, Studio Site ARS, deposit captured, in_build
    if (await seedMarker(d, 'seed-order-PB-0001')) {
      const pb1Id = newId();
      await d.query(
        `INSERT INTO orders (id, number, account_id, plan, plan_name, currency, state, total_minor, due_now_minor, due_at_launch_minor, accepted_at, created_at)
         VALUES ($1, 'PB-0001', $2, 'studio-site', 'Studio Site', 'ARS', 'in_build', $3, $4, $5, now() - interval '10 days', now() - interval '12 days')`,
        [pb1Id, accounts['yerba-norte']!.id, 58765432n, 23506172n, 35259260n],
      );
      const deposit1 = await createChargeInvoice(accounts['yerba-norte']!.killbillAccountId, 'PB-0001 deposit', amountFromMinor('ARS', 23506172n));
      await paySeedInvoice(accounts['yerba-norte']!.killbillAccountId, deposit1.invoiceId, amountFromMinor('ARS', 23506172n), `${pb1Id}-deposit`);
      await insertSeedPayment(d, pb1Id, 'deposit', 23506172n, 'ARS', deposit1.invoiceId, `${pb1Id}-deposit`);
      await recordInvoice(d, { invoiceId: deposit1.invoiceId, accountId: accounts['yerba-norte']!.id, orderId: pb1Id, kind: 'deposit' });
      await putObject(folderMarkerKey(pb1Id), Buffer.alloc(0), 'application/octet-stream').catch(() => undefined);
      const pb1Project = newId();
      await d.query('INSERT INTO projects (id, order_id, business_name, plan_name) VALUES ($1, $2, $3, $4)', [pb1Project, pb1Id, 'Yerba Norte SRL', 'Studio Site']);
      await d.query('UPDATE orders SET project_id = $1 WHERE id = $2', [pb1Project, pb1Id]);
      await d.query('INSERT INTO assignments (project_id, contractor_id, assigned_at) VALUES ($1, $2, now())', [pb1Project, tomas.id]);
      await insertSeedFile(d, pb1Project, 'asset', 'yerba-norte-logo.svg', 'SVG', 1240, accountUsers['yerba-norte']!);
      await putSeedObject(`portal/${pb1Id}/assets/${newId()}/yerba-norte-logo.svg`, svgBytes('Yerba Norte'), 'image/svg+xml');
    }

    // PB-0002: Casa Brava, Launch Page USD, deposit and balance captured, paid_in_full
    if (await seedMarker(d, 'seed-order-PB-0002')) {
      const pb2Id = newId();
      await d.query(
        `INSERT INTO orders (id, number, account_id, plan, plan_name, currency, state, total_minor, due_now_minor, due_at_launch_minor, accepted_at, created_at)
         VALUES ($1, 'PB-0002', $2, 'launch-page', 'Launch Page', 'USD', 'paid_in_full', $3, $4, $5, now() - interval '20 days', now() - interval '22 days')`,
        [pb2Id, accounts['casa-brava']!.id, 184999n, 73999n, 111000n],
      );
      const deposit2 = await createChargeInvoice(accounts['casa-brava']!.killbillAccountId, 'PB-0002 deposit', amountFromMinor('USD', 73999n));
      await paySeedInvoice(accounts['casa-brava']!.killbillAccountId, deposit2.invoiceId, amountFromMinor('USD', 73999n), `${pb2Id}-deposit`);
      await insertSeedPayment(d, pb2Id, 'deposit', 73999n, 'USD', deposit2.invoiceId, `${pb2Id}-deposit`);
      await recordInvoice(d, { invoiceId: deposit2.invoiceId, accountId: accounts['casa-brava']!.id, orderId: pb2Id, kind: 'deposit' });
      const balance2 = await createChargeInvoice(accounts['casa-brava']!.killbillAccountId, 'PB-0002 launch balance', amountFromMinor('USD', 111000n));
      await paySeedInvoice(accounts['casa-brava']!.killbillAccountId, balance2.invoiceId, amountFromMinor('USD', 111000n), `${pb2Id}-balance`);
      await insertSeedPayment(d, pb2Id, 'balance', 111000n, 'USD', balance2.invoiceId, `${pb2Id}-balance`);
      await recordInvoice(d, { invoiceId: balance2.invoiceId, accountId: accounts['casa-brava']!.id, orderId: pb2Id, kind: 'balance' });
      await putObject(folderMarkerKey(pb2Id), Buffer.alloc(0), 'application/octet-stream').catch(() => undefined);
      const pb2Project = newId();
      await d.query('INSERT INTO projects (id, order_id, business_name, plan_name) VALUES ($1, $2, $3, $4)', [pb2Project, pb2Id, 'Casa Brava', 'Launch Page']);
      await d.query('UPDATE orders SET project_id = $1 WHERE id = $2', [pb2Project, pb2Id]);
      await d.query('INSERT INTO assignments (project_id, contractor_id, assigned_at) VALUES ($1, $2, now())', [pb2Project, dana.id]);
      await insertSeedFile(d, pb2Project, 'asset', 'casa-brava-palette.pdf', 'PDF', 5210, accountUsers['casa-brava']!);
      await putSeedObject(`portal/${pb2Id}/assets/${newId()}/casa-brava-palette.pdf`, pdfBytes('Casa Brava palette'), 'application/pdf');
      await insertSeedFile(d, pb2Project, 'deliverable', 'casa-brava-homepage.png', 'PNG', 8300, dana.id);
      await putSeedObject(`portal/${pb2Id}/deliverables/${newId()}/casa-brava-homepage.png`, pngBytes(), 'image/png');
    }
  } finally {
    d.release();
  }

  await seedCareOrder({
    number: 'PB-0003',
    accountKey: 'harbor-pine',
    tier: 'plus',
    currency: 'USD',
    amountMinor: 34900n,
    startMonthsAgo: 0,
    pauseFromCtdMonthsAgo: null,
    seedingDay,
  });
  await seedCareOrder({
    number: 'PB-0004',
    accountKey: 'ferreteria-lumen',
    tier: 'lite',
    currency: 'ARS',
    amountMinor: 18999999n,
    startMonthsAgo: 1,
    pauseFromCtdMonthsAgo: null,
    seedingDay,
  });
  await seedCareOrder({
    number: 'PB-0005',
    accountKey: 'panaderia-sur',
    tier: 'plus',
    currency: 'ARS',
    amountMinor: 44999999n,
    startMonthsAgo: 1,
    pauseFromCtdMonthsAgo: null,
    seedingDay,
  });
  await seedCareOrder({
    number: 'PB-0006',
    accountKey: 'quill-fern',
    tier: 'lite',
    currency: 'USD',
    amountMinor: 14900n,
    startMonthsAgo: 2,
    pauseFromCtdMonthsAgo: 1,
    seedingDay,
  });
}

/** Create the user if absent, keyed by email, so seeding is resumable. */
async function ensureUser(db: Db, input: { accountId: string | null; name: string; email: string; role: string; password: string }): Promise<{ id: string }> {
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [input.email]);
  if ((existing.rowCount ?? 0) > 0) {
    return { id: (existing.rows[0] as { id: string }).id };
  }
  const user = await createUser(db, {
    accountId: input.accountId,
    name: input.name,
    email: input.email,
    role: input.role as 'client_owner' | 'teammate' | 'studio_owner' | 'contractor',
    password: input.password,
  });
  return { id: user.id };
}

/** Create the account and its billing account if absent, keyed by business name. */
async function ensureSeedAccount(db: Db, seedAccount: SeedAccount): Promise<{ id: string; killbillAccountId: string }> {
  const existing = await db.query('SELECT id, killbill_account_id FROM accounts WHERE business_name = $1', [seedAccount.businessName]);
  if ((existing.rowCount ?? 0) > 0) {
    const row = existing.rows[0] as { id: string; killbill_account_id: string | null };
    if (row.killbill_account_id) return { id: row.id, killbillAccountId: row.killbill_account_id };
    const killbillAccountId = await createKbAccount({
      name: seedAccount.businessName,
      email: seedAccount.ownerEmail,
      currency: seedAccount.currency,
      externalKey: `pampero-${row.id}`,
    });
    await addAutoPayOff(killbillAccountId);
    await addExternalPaymentMethod(killbillAccountId);
    await db.query('UPDATE accounts SET killbill_account_id = $1, card_last4 = $2 WHERE id = $3', [killbillAccountId, seedAccount.cardLast4, row.id]);
    return { id: row.id, killbillAccountId };
  }
  const account = await createAccount(db, seedAccount.businessName, seedAccount.currency);
  await db.query('UPDATE accounts SET card_last4 = $1 WHERE id = $2', [seedAccount.cardLast4, account.id]);
  const killbillAccountId = await createKbAccount({
    name: seedAccount.businessName,
    email: seedAccount.ownerEmail,
    currency: seedAccount.currency,
    externalKey: `pampero-${account.id}`,
  });
  await addAutoPayOff(killbillAccountId);
  await addExternalPaymentMethod(killbillAccountId);
  await db.query('UPDATE accounts SET killbill_account_id = $1 WHERE id = $2', [killbillAccountId, account.id]);
  return { id: account.id, killbillAccountId };
}

async function paySeedInvoice(killbillAccountId: string, invoiceId: string, amount: { currency: Currency; minor: bigint }, paymentKey: string): Promise<void> {
  const paymentMethodId = await getKbAccountPaymentMethod(killbillAccountId);
  await authorizePayment(killbillAccountId, paymentMethodId, amount, paymentKey, `${paymentKey}-auth`);
  const payment = await getPaymentByKey(paymentKey);
  await capturePayment(payment.paymentId, paymentMethodId, amount, `${paymentKey}-cap`);
  await settleInvoice(invoiceId, killbillAccountId, paymentMethodId, amount, `${paymentKey}-settle`, `${paymentKey}-settle-t`);
}

async function insertSeedPayment(db: Db, orderId: string, kind: 'deposit' | 'balance', amountMinor: bigint, currency: Currency, invoiceId: string, paymentKey: string): Promise<void> {
  const payment = await getPaymentByKey(paymentKey);
  await db.query(
    'INSERT INTO payments (id, order_id, kind, amount_minor, currency, killbill_payment_id, killbill_invoice_id, captured_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
    [newId(), orderId, kind, amountMinor, currency, payment.paymentId, invoiceId],
  );
}

async function insertSeedFile(db: Db, projectId: string, kind: 'asset' | 'deliverable', name: string, type: string, size: number, uploadedBy: string): Promise<void> {
  await db.query(
    'INSERT INTO files (id, project_id, kind, name, type, size, uploaded_by, uploaded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
    [newId(), projectId, kind, name, type, size, uploadedBy],
  );
}

async function putSeedObject(objectKey: string, bytes: Buffer, contentType: string): Promise<void> {
  await putObject(objectKey, bytes, contentType);
}

interface SeedCareInput {
  number: string;
  accountKey: string;
  tier: 'lite' | 'plus';
  currency: Currency;
  amountMinor: bigint;
  startMonthsAgo: number;
  pauseFromCtdMonthsAgo: number | null;
  seedingDay: string;
}

async function seedCareOrder(input: SeedCareInput): Promise<void> {
  const db = await pool.connect();
  const account = SEED_ACCOUNTS.find((a) => a.key === input.accountKey)!;
  try {
    if (!(await seedMarker(db, `seed-order-${input.number}`))) return;
    const accountIdRow = await db.query('SELECT id, killbill_account_id FROM accounts WHERE business_name = $1', [account.businessName]);
    const row = accountIdRow.rows[0] as { id: string; killbill_account_id: string };
    const orderId = newId();
    const startDate = monthsAgo(input.seedingDay, input.startMonthsAgo);
    await db.query(
      `INSERT INTO orders (id, number, account_id, plan, plan_name, currency, state, total_minor, due_now_minor, due_at_launch_minor, accepted_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'paid_in_full', $7, $7, 0, $8, $8)`,
      [
        orderId,
        input.number,
        row.id,
        input.tier === 'lite' ? 'care-lite' : 'care-plus',
        input.tier === 'lite' ? 'Care Lite' : 'Care Plus',
        input.currency,
        input.amountMinor,
        `${startDate}T10:00:00+00:00`,
      ],
    );
    const subscription: KbSubscription = await createSubscription({
      accountId: row.killbill_account_id,
      bundleExternalKey: `care-${orderId}`,
      planName: input.tier === 'lite' ? 'care-lite-monthly' : 'care-plus-monthly',
      recurringPrice: amountFromMinor(input.currency, input.amountMinor),
      entitlementDate: input.startMonthsAgo === 0 ? undefined : `${startDate}T10:00:00.000Z`,
    });
    await db.query('UPDATE orders SET killbill_bundle_id = $1, killbill_subscription_id = $2 WHERE id = $3', [
      subscription.bundleId,
      subscription.subscriptionId,
      orderId,
    ]);
    const firstInvoice = await waitForFirstInvoice(row.killbill_account_id, subscription.subscriptionId, 60_000);
    await paySeedInvoice(row.killbill_account_id, firstInvoice.invoiceId, amountFromMinor(input.currency, input.amountMinor), `${orderId}-care`);
    await db.query(
      'INSERT INTO payments (id, order_id, kind, amount_minor, currency, killbill_payment_id, killbill_invoice_id, captured_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
      [newId(), orderId, 'care', input.amountMinor, input.currency, (await getPaymentByKey(`${orderId}-care`)).paymentId, firstInvoice.invoiceId],
    );
    await recordInvoice(db, { invoiceId: firstInvoice.invoiceId, accountId: row.id, orderId, kind: 'care' });
    await putObject(folderMarkerKey(orderId), Buffer.alloc(0), 'application/octet-stream').catch(() => undefined);
    if (input.pauseFromCtdMonthsAgo !== null) {
      const fresh = await getSubscription(subscription.subscriptionId);
      const pauseDate = monthsAgo(input.seedingDay, input.pauseFromCtdMonthsAgo);
      await pauseBundle(fresh.bundleId, pauseDate);
    }
  } finally {
    db.release();
  }
}

async function seedCms(): Promise<void> {
  const db = await pool.connect();
  try {
    if (!(await seedMarker(db, 'seed-cms'))) return;
  } finally {
    db.release();
  }
  for (;;) {
    try {
      await ensureEntriesCollection();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  const entries: {
    kind: 'case_study' | 'journal';
    slug: string;
    title: string;
    client: string;
    year: string;
    status: 'draft' | 'published' | 'withdrawn';
    publishedAt: string | null;
    summary: string;
    body: string;
  }[] = [
    { kind: 'case_study', slug: 'mate-route', title: 'Mate Route', client: 'Mate Route Co.', year: '2026', status: 'published', publishedAt: '2026-09-14T00:00:00-03:00', summary: 'A route-planning site for the mate tea circuit of Buenos Aires.', body: 'We mapped the city mate by mate and shipped a route planner that works on a budget phone. The deck folds out into the case study itself, and the quote sheet settled the price before the first call.' },
    { kind: 'case_study', slug: 'atelier-ombu', title: 'Atelier Ombú', client: 'Atelier Ombú', year: '2026', status: 'published', publishedAt: '2026-07-30T00:00:00-03:00', summary: 'A quiet portfolio for a ceramics atelier under the ombú trees.', body: 'Slow photography, warm paper tones and a checkout that never gets in the way of the work. The deposit landed in pesos and the launch balance in the same centavos.' },
    { kind: 'case_study', slug: 'lanchas-del-delta', title: 'Lanchas del Delta', client: 'Lanchas del Delta', year: '2026', status: 'published', publishedAt: '2026-05-02T00:00:00-03:00', summary: 'Timetables and tickets for the river buses of the Tigre delta.', body: 'We rebuilt the timetable around the way locals actually travel, with live water levels and a care plan that keeps the timetable honest through the season.' },
    { kind: 'case_study', slug: 'norte-cycling-club', title: 'Norte Cycling Club', client: 'Norte Cycling Club', year: '2026', status: 'published', publishedAt: '2026-02-11T00:00:00-03:00', summary: 'A club site that signs up members and sells the season kit.', body: 'Ride calendar, kit shop and a members ledger that volunteers can actually run. The club bills in dollars and renews its care plan without a single email from us.' },
    { kind: 'case_study', slug: 'bodega-lince', title: 'Bodega Lince', client: 'Bodega Lince', year: '2026', status: 'draft', publishedAt: null, summary: 'A winery shop still in the studio.', body: 'The labels are printed and the checkout comes next.' },
    { kind: 'case_study', slug: 'cafe-ruta-40', title: 'Café Ruta 40', client: 'Café Ruta 40', year: '2025', status: 'withdrawn', publishedAt: null, summary: 'A roadside café that closed its Ruta 40 stop.', body: 'Withdrawn when the second branch closed.' },
    { kind: 'journal', slug: 'pricing-in-two-currencies', title: 'Pricing in two currencies', client: '', year: '', status: 'published', publishedAt: '2026-10-06T00:00:00-03:00', summary: 'Why we quote in dollars and pesos, and lock the price the day you accept.', body: 'A peso quote is honest for the day it is accepted. Here is how we keep it that way, to the centavo, through every renewal.' },
    { kind: 'journal', slug: 'what-a-care-plan-covers', title: 'What a care plan covers', client: '', year: '', status: 'published', publishedAt: '2026-08-19T00:00:00-03:00', summary: 'The monthly work behind a live site, and what stays out of scope.', body: 'Care Lite and Care Plus keep a site alive. This is exactly what that means each month, and what happens when a renewal needs a new card.' },
  ];
  for (const e of entries) {
    if (await getEntryBySlug(e.slug)) continue;
    await createEntry(e);
  }
}

function svgBytes(label: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" rx="8" fill="#1B4965"/><text x="10" y="26" font-family="sans-serif" font-size="16" fill="#F6F1E7">${label}</text></svg>`,
  );
}

function pdfBytes(label: string): Buffer {
  const stream = `BT /F1 12 Tf 1 0 0 1 56 780 Tm (${label.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

function pngBytes(): Buffer {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63647805c0c0c4c0403001d0d0d2d0006bc00a97b9dbd40000000049454e44ae426082',
    'hex',
  );
}

