import { CRATE_SIZE, type Cadence, type FlavourSlug } from '../../shared/catalogue.js';
import { apiMessages, checkoutCopy } from '../../shared/copy.js';
import { buildQuote, planForCrate, subscriptionShape, type CanCount } from '../../shared/quote.js';
import { sellCrate } from '../db/cart.js';
import { insertOrder, findOrder, type OrderRecord, type ShipTo } from '../db/orders.js';
import { transaction, type Transaction } from '../db/pool.js';
import { loadSettings } from '../db/settings.js';
import { insertSubscription } from '../db/subscriptions.js';
import { queueMailIn } from '../db/outbox.js';
import { validateCard, chargeApproved, type StoredCard } from '../domain/cards.js';
import { ApiError, conflict, notFound, validationError } from '../http/errors.js';
import {
  BillingUnreachable,
  addExternalCharges,
  cancelImmediately,
  commitInvoice,
  createPurchase,
  createSubscription,
  findPayment,
  getInvoice,
  getOrCreateAccount,
  getSubscription,
  listAccountInvoiceIds,
  payInvoice,
  paymentKey,
  withBillingOutage,
} from '../services/killbill.js';
import { filesUnavailable } from '../http/errors.js';
import type { PocketBaseUser } from '../services/pocketbase.js';
import { storeOrderDocuments } from './documents.js';
import { boxCharges } from './renewals.js';
import { orderConfirmationMail } from './emails.js';

export interface CheckoutRequest {
  addressId: string;
  subscribe: boolean;
  cadence: Cadence | null;
  card: unknown;
}

export function readCheckoutRequest(body: unknown): CheckoutRequest {
  const payload = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const addressId = typeof payload.address_id === 'string' ? payload.address_id : '';
  if (addressId === '') fields.address_id = 'Pick a shipping address.';

  if (payload.subscribe !== true && payload.subscribe !== false) {
    fields.subscribe = 'Say whether this crate is a subscription.';
  }
  const cadence = payload.cadence;
  if (cadence !== null && cadence !== 'monthly' && cadence !== 'bimonthly') {
    fields.cadence = 'Pick a delivery rhythm.';
  }
  if (payload.subscribe === true && (cadence === null || cadence === undefined)) {
    fields.cadence = 'Pick a delivery rhythm.';
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return {
    addressId,
    subscribe: payload.subscribe === true,
    cadence: (cadence ?? null) as Cadence | null,
    card: payload.card,
  };
}

export interface CheckoutInput {
  user: PocketBaseUser;
  cartId: string;
  request: CheckoutRequest;
  shipTo: ShipTo;
}

export interface CheckoutResult {
  order: OrderRecord;
  subscriptionId: string | null;
}

function countCans(items: ReadonlyArray<{ flavour: string }>): CanCount[] {
  const counts = new Map<FlavourSlug, number>();
  for (const item of items) {
    const flavour = item.flavour as FlavourSlug;
    counts.set(flavour, (counts.get(flavour) ?? 0) + 1);
  }
  return [...counts].map(([flavour, quantity]) => ({ flavour, quantity }));
}

/**
 * Takes one payment for a full crate. Everything runs inside one transaction that
 * holds the crate's row, so the hold cannot expire under the charge and no order
 * is ever recorded without the payment Kill Bill confirmed.
 */
export async function runCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const settings = await loadSettings();
  let startedSubscription: string | null = null;

  try {
    return await runCheckoutTransaction(input, settings, (id) => {
      startedSubscription = id;
    });
  } catch (error) {
    // A checkout that fails after the subscription started leaves nothing behind.
    if (startedSubscription !== null) await cancelImmediately(startedSubscription);
    throw error;
  }
}

async function runCheckoutTransaction(
  input: CheckoutInput,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  onSubscriptionStarted: (id: string) => void,
): Promise<CheckoutResult> {
  return transaction(async (tx) => {
    const cartRows = await tx.query<{ id: string; hold_expires_at: Date | null }>(
      'select id, hold_expires_at from carts where id = $1 for update',
      [input.cartId],
    );
    const cart = cartRows[0];
    if (cart === undefined) throw conflict('crate_not_full', apiMessages.crateNotFull);

    const items = await tx.query<{ slot_index: number; flavour: string }>(
      'select slot_index, flavour from cart_items where cart_id = $1 order by slot_index',
      [input.cartId],
    );
    const holdActive =
      cart.hold_expires_at !== null && Date.now() < cart.hold_expires_at.getTime();
    if (!holdActive || items.length === 0) {
      throw conflict('hold_expired', apiMessages.holdExpired);
    }
    if (items.length !== CRATE_SIZE) {
      throw conflict('crate_not_full', apiMessages.crateNotFull);
    }

    const cans = countCans(items);
    if (input.request.subscribe && subscriptionShape(cans) === null) {
      throw conflict('not_subscribable', apiMessages.notSubscribable);
    }

    const validation = validateCard(input.request.card, new Date());
    if (!validation.ok) throw validationError(validation.fields);
    const card: StoredCard = validation.card;

    const province = input.shipTo.province;
    const quote = buildQuote(settings.pricing, {
      province,
      subscribe: input.request.subscribe,
      cans,
    });

    const accountId = await withBillingOutage(checkoutCopy.billingOutage, () =>
      getOrCreateAccount({
        externalKey: input.user.id,
        name: input.user.name,
        email: input.user.email,
      }),
    );

    const orderNumber = await insertOrder(tx, {
      userId: input.user.id,
      kind: 'checkout',
      quote,
      shipTo: input.shipTo,
      subscriptionId: null,
      killbillAccountId: accountId,
      killbillInvoiceId: null,
      customerEmail: input.user.email,
      customerName: input.user.name,
    });
    const pending = await readOrderIn(tx, orderNumber);

    try {
      await storeOrderDocuments(pending);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        throw filesUnavailable(checkoutCopy.filesOutage);
      }
      throw error;
    }

    if (!chargeApproved({ card_behaviour: card.behaviour, card_charges: card.charges })) {
      throw new ApiError(402, 'card_declined', apiMessages.cardDeclined);
    }

    let subscriptionId: string | null = null;
    await withBillingOutage(checkoutCopy.billingOutage, async () => {
      if (input.request.subscribe) {
        const planName = planForCrate(cans, input.request.cadence ?? 'monthly');
        if (planName === null) throw conflict('not_subscribable', apiMessages.notSubscribable);
        subscriptionId = await createSubscription({ accountId, planName });
        onSubscriptionStarted(subscriptionId);
        const invoiceId = await findBoxInvoice(accountId, subscriptionId);
        await addExternalCharges({
          accountId,
          invoiceId,
          charges: boxCharges(quote),
        });
        await commitInvoice(invoiceId);
        await payInvoice({ accountId, invoiceId, orderNumber, totalCents: quote.total_cents });
        await tx.execute('update orders set killbill_invoice_id = $2 where number = $1', [
          orderNumber,
          invoiceId,
        ]);
      } else {
        await createPurchase({ accountId, orderNumber, totalCents: quote.total_cents });
      }

      const payment = await findPayment(paymentKey(orderNumber));
      if (payment === null) {
        throw new ApiError(402, 'card_declined', apiMessages.cardDeclined);
      }
    });

    if (subscriptionId !== null) {
      const killBill = await getSubscription(subscriptionId);
      await insertSubscription({
        id: subscriptionId,
        userId: input.user.id,
        killbillAccountId: accountId,
        plan: killBill?.planName ?? planForCrate(cans, input.request.cadence ?? 'monthly')!,
        cadence: input.request.cadence ?? 'monthly',
        province,
        shipTo: input.shipTo,
        customerEmail: input.user.email,
        customerName: input.user.name,
        card: { ...card, charges: 1 },
      });
      await tx.execute('update orders set subscription_id = $2 where number = $1', [
        orderNumber,
        subscriptionId,
      ]);
    }

    await tx.execute(
      "update orders set status = 'paid', paid_at = now() where number = $1",
      [orderNumber],
    );
    await sellCrate(tx, input.cartId);

    const order = await readOrderIn(tx, orderNumber);
    await queueMailIn(tx, orderConfirmationMail(order));
    return { order, subscriptionId };
  });
}

const BOX_INVOICE_WAIT_MS = 10_000;

/**
 * The draft invoice Kill Bill raises for a subscription's first box. Kill Bill
 * raises it moments after the subscription starts, so this waits for it.
 */
async function findBoxInvoice(
  accountId: string,
  subscriptionId: string,
): Promise<string> {
  const deadline = Date.now() + BOX_INVOICE_WAIT_MS;
  for (;;) {
    for (const invoiceId of await listAccountInvoiceIds(accountId)) {
      const invoice = await getInvoice(invoiceId);
      if (invoice.status !== 'DRAFT') continue;
      const mine = invoice.items.some(
        (item) => item.subscriptionId === subscriptionId && item.itemType === 'RECURRING',
      );
      if (mine) return invoiceId;
    }
    if (Date.now() >= deadline) throw new BillingUnreachable();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function readOrderIn(tx: Transaction, orderNumber: string): Promise<OrderRecord> {
  const order = await findOrder(orderNumber, tx);
  if (order === null) throw notFound();
  return order;
}
