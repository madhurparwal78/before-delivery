// Subscriptions: starting a Trio, running it, and mirroring every change in
// Kill Bill as blocking states and dated plan events.
import { type Pool, type PoolClient } from "pg";
import { ApiError } from "../core/http.js";
import type { Env } from "../core/env.js";
import { type Cadence, type Locale, CADENCE_MONTHS, TRIO_SCENTS } from "../core/catalog.js";
import { message, fieldMessage } from "../core/copy.js";
import { trioPrice, money, type PriceBreakdown } from "../core/money.js";
import { findProvince } from "../core/provinces.js";
import { addMonths, nextInSeries, torontoDate, torontoMidnight, dateToString } from "../core/toronto.js";
import { hasControlChars, isValidCanadianPostalCode } from "./text.js";
import { subscriptionStartedEmail } from "../core/emails.js";
import { queueNotice, type Outbox } from "../services/outbox.js";
import { KillBillClient, KillBillError, centsToKb } from "../services/killbill.js";
import type { SubscriptionRecord } from "./views.js";

export interface ShippingInput {
  name: string;
  line1: string;
  city: string;
  province: string;
  postal_code: string;
}

export interface StartSubscriptionInput {
  scent: string;
  cadence: string;
  shipping: ShippingInput;
}

export function validateShipping(locale: Locale, shipping: ShippingInput | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
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

function planNameFor(cadence: Cadence): string {
  return `trio-${cadence.toLowerCase()}`;
}

export interface StartResult {
  subscription: SubscriptionRecord;
  chargedToday: number;
  creditApplied: number;
}

export async function startSubscription(
  pool: Pool,
  kb: KillBillClient,
  outbox: Outbox,
  locale: Locale,
  customerId: number,
  email: string,
  input: StartSubscriptionInput
): Promise<StartResult> {
  const fields: Record<string, string> = {};
  if (!TRIO_SCENTS.some((scent) => scent.slug === input.scent)) {
    fields.scent = fieldMessage("scent", locale);
  }
  const cadence = input.cadence;
  if (typeof cadence !== "string" || !CADENCE_MONTHS[cadence as Cadence]) {
    fields.cadence = fieldMessage("cadence_missing", locale);
  }
  Object.assign(fields, validateShipping(locale, input.shipping));
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const chosenCadence = cadence as Cadence;

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
      // The subscription number is taken before the Kill Bill call.
      const counter = await client.query("SELECT value FROM counters WHERE name = 'subscription' FOR UPDATE");
      const number = `SUB-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
      await client.query("UPDATE counters SET value = value + 1 WHERE name = 'subscription'");

      const startedOn = torontoDate(new Date());
      const province = findProvince(input.shipping.province)!;
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
          number, customerId, input.scent, chosenCadence, startedOn,
          addMonths(startedOn, CADENCE_MONTHS[chosenCadence]),
          input.shipping.name, input.shipping.line1, input.shipping.city, input.shipping.province,
          input.shipping.postal_code, killbill.subscriptionId
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
        nextBillDate: record.next_bill_date!
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
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
}

function trioScentName(slug: string, locale: Locale): string {
  const scent = TRIO_SCENTS.find((candidate) => candidate.slug === slug);
  if (!scent) return slug;
  return locale === "fr-CA" ? scent.fr : scent.en;
}

async function lockCustomer(client: PoolClient, customerId: number): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [`customer:${customerId}`]);
}

async function unlockCustomer(client: PoolClient, customerId: number): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`customer:${customerId}`]);
}

interface StartKillBillResult {
  subscriptionId: string;
  chargedToday: number;
  creditApplied: number;
  accountId: string;
}

async function runStartKillBill(
  kb: KillBillClient,
  locale: Locale,
  email: string,
  input: StartSubscriptionInput,
  number: string,
  cadence: Cadence,
  price: PriceBreakdown
): Promise<StartKillBillResult> {
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
      itemType: "TAX" as const,
      description: tax.code,
      amount: centsToKb(tax.amount.cents),
      currency: "CAD" as const,
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
        paymentExternalKey: `${number}-${committed.invoiceDate ?? torontoDate(new Date())}`,
        transactions: [{
          transactionExternalKey: `${number}-${committed.invoiceDate ?? torontoDate(new Date())}`,
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

async function waitForSubscriptionInvoice(
  kb: KillBillClient,
  accountId: string,
  subscriptionId: string
): Promise<{ invoiceId: string }> {
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

export function toRecord(row: Record<string, unknown>): SubscriptionRecord {
  return {
    number: row.number as string,
    killbill_subscription_id: (row.killbill_subscription_id as string | null) ?? "",
    state: row.state as string,
    scent: row.scent as string,
    cadence: row.cadence as string,
    pending_cadence: (row.pending_cadence as string | null) ?? null,
    anchor_date: dateToString(row.anchor_date as string | Date),
    started_on: dateToString(row.started_on as string | Date),
    next_bill_date: row.next_bill_date ? dateToString(row.next_bill_date as string | Date) : null,
    skipped_bill_date: row.skipped_bill_date ? dateToString(row.skipped_bill_date as string | Date) : null,
    paused_from: row.paused_from ? dateToString(row.paused_from as string | Date) : null,
    name: row.name as string,
    line1: row.line1 as string,
    city: row.city as string,
    province: row.province as string,
    postal_code: row.postal_code as string,
    version: row.version as number
  };
}

// ---- running a Trio ----

export async function loadSubscription(client: PoolClient, customerId: number, number: string): Promise<SubscriptionRecord> {
  const res = await client.query("SELECT * FROM subscriptions WHERE number = $1", [number]);
  const row = res.rows[0];
  if (!row || row.customer_id !== customerId) {
    throw new ApiError(404, "not_found");
  }
  return toRecord(row);
}

export function lockInstant(date: string, lockHours: number): Date {
  return new Date(torontoMidnight(date).getTime() - lockHours * 3_600_000);
}

export async function changeSubscription(
  pool: Pool,
  env: Env,
  kb: KillBillClient,
  locale: Locale,
  customerId: number,
  number: string,
  change: { kind: "skip" } | { kind: "unskip" } | { kind: "pause" } | { kind: "resume" } | { kind: "cancel" }
): Promise<SubscriptionRecord> {
  const client = await pool.connect();
  try {
    await lockCustomer(client, customerId);
    try {
      await client.query("BEGIN");
      const record = await loadSubscription(client, customerId, number);
      const now = new Date();
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

async function applyChange(
  client: PoolClient,
  kb: KillBillClient,
  env: Env,
  locale: Locale,
  record: SubscriptionRecord,
  change: { kind: "skip" } | { kind: "unskip" } | { kind: "pause" } | { kind: "resume" } | { kind: "cancel" },
  now: Date
): Promise<void> {
  const lock = record.next_bill_date ? lockInstant(record.next_bill_date, env.subscriptionLockHours) : null;
  const locked = lock !== null && now >= lock;
  switch (change.kind) {
    case "skip": {
      if (record.state !== "active") {
        throw transitionError(locale);
      }
      if (record.skipped_bill_date) {
        throw new ApiError(409, "already_skipped", message("already_skipped", locale));
      }
      if (locked) throw lockedError(record.next_bill_date!, locale);
      const skipped = record.next_bill_date!;
      const next = nextInSeries(record.anchor_date, skipped, CADENCE_MONTHS[record.cadence as Cadence]);
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
        throw transitionError(locale);
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
        throw transitionError(locale);
      }
      if (locked) throw lockedError(record.next_bill_date!, locale);
      await addBlocking(kb, record, "TRIO_PAUSE", true, record.next_bill_date!, locale);
      await updateSubscription(client, record.number, {
        state: "paused",
        paused_from: record.next_bill_date,
        next_bill_date: null
      });
      return;
    }
    case "resume": {
      if (record.state !== "paused") {
        throw transitionError(locale);
      }
      const pausedFrom = record.paused_from!;
      const today = torontoDate(now);
      await addBlockingAt(kb, record, "TRIO_CLEAR", false, maxInstant(pausedFrom, now), locale);
      if (dateOnOrAfter(today, pausedFrom)) {
        await chargeResume(kb, record, today, locale);
        await updateSubscription(client, record.number, {
          state: "active",
          paused_from: null,
          anchor_date: today,
          next_bill_date: addMonths(today, CADENCE_MONTHS[record.cadence as Cadence])
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
        throw transitionError(locale);
      }
      if (locked) throw lockedError(record.next_bill_date!, locale);
      try {
        await kb.cancelSubscription(record.killbill_subscription_id, torontoMidnight(record.next_bill_date!).toISOString());
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

function dateOnOrAfter(a: string, b: string): boolean {
  return a >= b;
}

function maxInstant(date: string, now: Date): Date {
  const midnight = torontoMidnight(date);
  return midnight > now ? midnight : now;
}

async function addBlocking(
  kb: KillBillClient,
  record: SubscriptionRecord,
  stateName: string,
  blockBilling: boolean,
  date: string,
  locale: Locale
): Promise<void> {
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

async function addBlockingAt(
  kb: KillBillClient,
  record: SubscriptionRecord,
  stateName: string,
  blockBilling: boolean,
  instant: Date,
  locale: Locale
): Promise<void> {
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

async function chargeResume(kb: KillBillClient, record: SubscriptionRecord, today: string, locale: Locale): Promise<void> {
  try {
    const accountId = await accountForSubscription(kb, record);
    const province = findProvince(record.province)!;
    const price = trioPrice(province.taxes);
    const created = await kb.createExternalCharges(accountId, [{
      itemType: "EXTERNAL_CHARGE",
      description: "Trio",
      amount: centsToKb(price.preTax.cents),
      currency: "CAD"
    }]);
    const invoiceId = created[0].invoiceId;
    const taxItems = price.taxes.map((tax) => ({
      itemType: "TAX" as const,
      description: tax.code,
      amount: centsToKb(tax.amount.cents),
      currency: "CAD" as const,
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

async function accountForSubscription(kb: KillBillClient, record: SubscriptionRecord): Promise<string> {
  // Resume charges post to the customer's Kill Bill account, found through the
  // subscription's own account linkage.
  const subscription = await kb.getSubscriptionByKey(record.number);
  return subscription.accountId;
}

async function updateSubscription(
  client: PoolClient,
  number: string,
  patch: Partial<Record<string, string | null>>
): Promise<void> {
  const keys = Object.keys(patch);
  const sets = keys.map((key, index) => `${toSnake(key)} = $${index + 2}`);
  await client.query(
    `UPDATE subscriptions SET ${sets.join(", ")}, version = version + 1 WHERE number = $1`,
    [number, ...keys.map((key) => (patch as Record<string, unknown>)[key])]
  );
}

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function transitionError(locale: Locale): ApiError {
  return new ApiError(409, "invalid_transition", message("invalid_transition", locale));
}

function lockedError(date: string, locale: Locale): ApiError {
  return new ApiError(409, "cycle_locked", message("cycle_locked", locale, { date }));
}

function kbUnavailable(err: unknown, locale: Locale): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof KillBillError) {
    return new ApiError(503, "billing_unavailable", message("billing_unavailable_subscription", locale));
  }
  throw err;
}

export async function patchSubscription(
  pool: Pool,
  env: Env,
  kb: KillBillClient,
  locale: Locale,
  customerId: number,
  number: string,
  patch: { scent?: string; cadence?: string }
): Promise<SubscriptionRecord> {
  const fields: Record<string, string> = {};
  if (patch.scent !== undefined && !TRIO_SCENTS.some((scent) => scent.slug === patch.scent)) {
    fields.scent = fieldMessage("scent", locale);
  }
  if (patch.cadence !== undefined && !CADENCE_MONTHS[patch.cadence as Cadence]) {
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
      const now = new Date();
      const lock = record.next_bill_date ? lockInstant(record.next_bill_date, env.subscriptionLockHours) : null;
      const locked = lock !== null && now >= lock;
      if (record.state !== "active") {
        throw transitionError(locale);
      }
      if (locked) throw lockedError(record.next_bill_date!, locale);
      const fields: Record<string, string> = {};
      if (patch.scent !== undefined && !TRIO_SCENTS.some((scent) => scent.slug === patch.scent)) {
        fields.scent = fieldMessage("scent", locale);
      }
      if (patch.cadence !== undefined && !CADENCE_MONTHS[patch.cadence as Cadence]) {
        fields.cadence = fieldMessage("cadence_missing", locale);
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", null, fields);
      }
      if (patch.cadence !== undefined && patch.cadence === record.cadence) {
        throw new ApiError(422, "invalid", null, { cadence: fieldMessage("cadence_same", locale) });
      }
      if (patch.cadence !== undefined) {
        try {
          if (record.pending_cadence) {
            await kb.undoChangePlan(record.killbill_subscription_id);
          }
          await kb.changePlan(record.killbill_subscription_id, planNameFor(patch.cadence as Cadence), torontoMidnight(record.next_bill_date!).toISOString());
        } catch (err) {
          throw kbUnavailable(err, locale);
        }
      }
      const patchFields: Partial<Record<string, string>> = {};
      if (patch.scent !== undefined) patchFields.scent = patch.scent;
      if (patch.cadence !== undefined) patchFields.pending_cadence = patch.cadence;
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
