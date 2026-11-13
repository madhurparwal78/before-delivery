import { db } from '../db/pool';
import { Ctx } from '../http/context';
import { loadCart } from '../domain/cart';
import { CLAIM_COMPONENTS, INDIAN_STATES, RETURN_REASONS } from '../domain/constants';
import { formatDateTimeIst, rupees } from '../domain/money';
import { exchangeCandidates, loadOrder, loadOrderLines, orderPayload } from '../domain/orders';
import { ORDER_STATUS_WORDS, PAYMENT_STATUS_WORDS, canCancelOrder } from '../domain/rules';
import { Shell, attr, escapeHtml, renderPage } from './layout';

function totalsRegion(totals: {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  gift_card: number;
  total: number;
}): string {
  return `
<div role="region" aria-label="Bag totals" class="totals" data-bag-totals data-motion-ms="180">
  <p><span>Subtotal</span> <span data-total="subtotal">${escapeHtml(rupees(totals.subtotal))}</span></p>
  <p><span>Discount</span> <span data-total="discount">${escapeHtml(
    totals.discount === 0 ? rupees(0) : `-${rupees(totals.discount)}`
  )}</span></p>
  <p><span>Shipping</span> <span data-total="shipping">${escapeHtml(
    totals.shipping === 0 ? 'Free' : rupees(totals.shipping)
  )}</span></p>
  <p><span>Tax</span> <span data-total="tax">${escapeHtml(rupees(totals.tax))}</span></p>
  <p><span>Gift card</span> <span data-total="gift_card">${escapeHtml(
    totals.gift_card === 0 ? rupees(0) : `-${rupees(totals.gift_card)}`
  )}</span></p>
  <p><span>Total</span> <span data-total="total">${escapeHtml(rupees(totals.total))}</span></p>
</div>`;
}

export async function bagPage(ctx: Ctx, shell: Shell): Promise<string> {
  const cart = await loadCart(db, { sessionId: ctx.sessionId, userId: ctx.user?.id ?? null });
  const content = `
<h1>Your bag</h1>
<div class="bag-layout">
  <div class="left-zone">
    ${totalsRegion(cart.totals)}
    ${
      cart.gift_card === null
        ? ''
        : `<p data-gift-remainder>Gift card balance after this order: ${escapeHtml(
            rupees(Math.max(0, cart.gift_card.balance - cart.totals.gift_card))
          )}</p>`
    }
  </div>
  <div class="bag-main">
    <div data-bag-lines>
      ${
        cart.lines.length === 0
          ? '<section class="panel colour-panel"><p>Your bag is empty.</p><a href="/collections/all">Browse collections</a></section>'
          : cart.lines
              .map(
                (line) => `
      <div role="group" aria-label="${attr(`${line.product} — ${line.colour}, ${line.size}`)}" class="bag-line"
           data-line="${attr(line.id)}">
        <p>${escapeHtml(line.product)}</p>
        <label class="visually-hidden" for="qty-${attr(line.id)}">Quantity</label>
        <input id="qty-${attr(line.id)}" type="number" min="1" max="10" step="1" value="${line.quantity}"
               aria-label="Quantity" data-quantity>
        <p>${escapeHtml(rupees(line.line_subtotal))}</p>
        <button type="button" data-remove-line>Remove ${escapeHtml(line.product)}</button>
      </div>`
              )
              .join('')
      }
    </div>
    <div data-bag-undo></div>
    <form data-code-form novalidate>
      <label for="bag-page-code">Discount or gift card code</label>
      <input id="bag-page-code" type="text" aria-label="Discount or gift card code" data-code-input
             aria-describedby="bag-page-code-error">
      <p class="field-error" id="bag-page-code-error" data-code-error></p>
      <button type="submit" data-code-apply>Apply</button>
    </form>
    <div data-code-applied>
      ${
        cart.discount === null
          ? ''
          : `<button type="button" data-remove-code="${attr(cart.discount.code)}">Remove code ${escapeHtml(
              cart.discount.code
            )}</button>`
      }
      ${cart.gift_card === null ? '' : '<button type="button" data-remove-gift-card>Remove gift card</button>'}
    </div>
    <a href="/bag/checkout" data-check-out>Check out</a>
  </div>
</div>`;
  return renderPage(shell, { title: 'Your bag', page: 'bag', content, showBagDrawer: false });
}

const STEPS: Array<{ key: string; label: string }> = [
  { key: 'contact', label: 'Contact' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'shipping', label: 'Shipping' },
  { key: 'payment', label: 'Payment' }
];

export async function checkoutPage(ctx: Ctx, shell: Shell, checkoutId: string): Promise<string | null> {
  if (ctx.user === null) return null;
  const row = await db.one<{ id: string; step: string }>(
    'SELECT id, step FROM checkouts WHERE id::text = $1 AND user_id = $2',
    [checkoutId, ctx.user.id]
  );
  if (row === null) return null;
  const addresses = await db.query<{ id: string; label: string }>(
    'SELECT id, label FROM addresses WHERE user_id = $1 AND deleted = false ORDER BY position ASC',
    [ctx.user.id]
  );
  const stepFromQuery = ctx.query.get('step');
  const currentStep = STEPS.some((step) => step.key === stepFromQuery) ? stepFromQuery! : row.step;

  const content = `
<h1>Checkout</h1>
<div class="checkout-layout">
  <div class="left-zone">
    <ol aria-label="Checkout progress" class="progress" data-progress>
      ${STEPS.map(
        (step) =>
          `<li data-step-item="${attr(step.key)}" ${
            step.key === currentStep ? 'aria-current="step"' : ''
          }>${escapeHtml(step.label)}</li>`
      ).join('')}
    </ol>
    ${totalsRegion({ subtotal: 0, discount: 0, shipping: 0, tax: 0, gift_card: 0, total: 0 })}
  </div>
  <div class="checkout-main">
    <p role="status" aria-live="polite" aria-label="Checkout updates" data-checkout-updates data-region="checkout-updates"></p>
    <p role="timer" aria-label="Hold time left" data-hold-timer></p>
    <div role="alert" class="error-summary" data-error-summary hidden>
      <h2>There is a problem</h2>
      <ul data-error-list></ul>
    </div>

    <section data-step="contact" ${currentStep === 'contact' ? '' : 'hidden'}>
      <h2 tabindex="-1">Contact</h2>
      <label for="checkout-email">Email</label>
      <input id="checkout-email" type="text" aria-label="Email" aria-describedby="checkout-email-error">
      <p class="field-error" id="checkout-email-error" data-error-for="email"></p>
      <label for="checkout-phone">Mobile number</label>
      <input id="checkout-phone" type="text" aria-label="Mobile number" aria-describedby="checkout-phone-error">
      <p class="field-error" id="checkout-phone-error" data-error-for="phone"></p>
      <button type="button" data-continue="contact">Continue</button>
    </section>

    <section data-step="delivery" ${currentStep === 'delivery' ? '' : 'hidden'}>
      <h2 tabindex="-1">Delivery</h2>
      <div role="radiogroup" aria-label="Saved addresses" data-address-group>
        ${addresses
          .map(
            (address, index) => `<button type="button" role="radio" aria-label="${attr(address.label)}"
          aria-checked="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}"
          data-address-id="${attr(address.id)}">${escapeHtml(address.label)}</button>`
          )
          .join('')}
        <button type="button" role="radio" aria-label="New address"
          aria-checked="${addresses.length === 0 ? 'true' : 'false'}" tabindex="${addresses.length === 0 ? '0' : '-1'}"
          data-address-id="new">New address</button>
      </div>
      <div data-new-address ${addresses.length === 0 ? '' : 'hidden'}>
        <label for="address-name">Full name</label>
        <input id="address-name" type="text" aria-label="Full name" aria-describedby="address-name-error">
        <p class="field-error" id="address-name-error" data-error-for="address.name"></p>
        <label for="address-line1">Address line 1</label>
        <input id="address-line1" type="text" aria-label="Address line 1" aria-describedby="address-line1-error">
        <p class="field-error" id="address-line1-error" data-error-for="address.line1"></p>
        <label for="address-line2">Address line 2</label>
        <input id="address-line2" type="text" aria-label="Address line 2" aria-describedby="address-line2-error">
        <p class="field-error" id="address-line2-error" data-error-for="address.line2"></p>
        <label for="address-city">Town or city</label>
        <input id="address-city" type="text" aria-label="Town or city" aria-describedby="address-city-error">
        <p class="field-error" id="address-city-error" data-error-for="address.city"></p>
        <label for="address-state">State</label>
        <select id="address-state" aria-label="State" aria-describedby="address-state-error">
          <option value="">Choose a state</option>
          ${INDIAN_STATES.map((state) => `<option value="${attr(state)}">${escapeHtml(state)}</option>`).join('')}
        </select>
        <p class="field-error" id="address-state-error" data-error-for="address.state"></p>
        <label for="address-postcode">PIN code</label>
        <input id="address-postcode" type="text" aria-label="PIN code" aria-describedby="address-postcode-error">
        <p class="field-error" id="address-postcode-error" data-error-for="address.postcode"></p>
        <label for="address-phone">Mobile number</label>
        <input id="address-phone" type="text" aria-label="Mobile number" aria-describedby="address-phone-error">
        <p class="field-error" id="address-phone-error" data-error-for="address.phone"></p>
      </div>
      <button type="button" data-back="contact">Back</button>
      <button type="button" data-continue="delivery">Continue</button>
    </section>

    <section data-step="shipping" ${currentStep === 'shipping' ? '' : 'hidden'}>
      <h2 tabindex="-1">Shipping</h2>
      <div role="radiogroup" aria-label="Shipping method" data-shipping-group aria-describedby="shipping-error">
        <button type="button" role="radio" aria-label="Standard" aria-checked="true" tabindex="0"
                data-method="standard">Standard</button>
        <button type="button" role="radio" aria-label="Express" aria-checked="false" tabindex="-1"
                data-method="express">Express</button>
      </div>
      <p class="field-error" id="shipping-error" data-error-for="method"></p>
      <div class="field-row">
        <input id="checkout-gift" type="checkbox" data-gift>
        <label for="checkout-gift">This is a gift</label>
      </div>
      <label for="checkout-gift-message">Gift message</label>
      <textarea id="checkout-gift-message" aria-label="Gift message" data-gift-message
                aria-describedby="gift-message-error"></textarea>
      <p class="field-error" id="gift-message-error" data-error-for="gift_message"></p>
      <button type="button" data-back="delivery">Back</button>
      <button type="button" data-continue="shipping">Continue</button>
    </section>

    <section data-step="payment" ${currentStep === 'payment' ? '' : 'hidden'}>
      <h2 tabindex="-1">Payment</h2>
      <div data-card-fields>
        <label for="card-number">Card number</label>
        <input id="card-number" type="text" aria-label="Card number" aria-describedby="card-number-error"
               autocomplete="cc-number">
        <p class="field-error" id="card-number-error" data-error-for="card.number"></p>
        <label for="card-expiry">Expiry (MM/YY)</label>
        <input id="card-expiry" type="text" aria-label="Expiry (MM/YY)" aria-describedby="card-expiry-error">
        <p class="field-error" id="card-expiry-error" data-error-for="card.expiry"></p>
        <label for="card-cvc">Security code</label>
        <input id="card-cvc" type="text" aria-label="Security code" aria-describedby="card-cvc-error">
        <p class="field-error" id="card-cvc-error" data-error-for="card.cvc"></p>
      </div>
      <div role="alert" data-payment-alert hidden></div>
      <button type="button" data-back="shipping">Back</button>
      <button type="button" data-pay>Pay ₹0</button>
    </section>
  </div>
</div>`;

  return renderPage(shell, {
    title: 'Checkout',
    page: 'checkout',
    content,
    showBagDrawer: false,
    bodyData: { checkout: row.id, 'checkout-step': currentStep }
  });
}

export async function orderPage(ctx: Ctx, shell: Shell, number: string): Promise<string | null> {
  if (ctx.user === null) return null;
  const order = await loadOrder(db, number);
  if (order === null || order.user_id !== ctx.user.id) return null;
  const payload = await orderPayload(db, order, new Date());
  const lines = await loadOrderLines(db, number);
  const candidatesByLine = new Map<string, Array<{ sku: string; colour: string; size: string; available: number }>>();
  for (const line of lines) {
    candidatesByLine.set(line.id, await exchangeCandidates(db, line));
  }
  const payloadLines = payload.lines as Array<Record<string, unknown>>;

  const windowCopy = (label: string, window: unknown): string => {
    if (window === null || typeof window !== 'object') return '';
    const state = window as { seconds_left: number; open: boolean };
    if (!state.open) return '';
    const days = Math.floor(state.seconds_left / 86400);
    const hours = Math.floor((state.seconds_left % 86400) / 3600);
    return `<p>${escapeHtml(label)}: ${days} days ${hours} hours left</p>`;
  };

  const content = `
<div class="order-layout">
  <div class="left-zone">
    ${windowCopy('Return window', payload.return_window)}
    ${windowCopy('Trial window', payload.trial_window)}
    ${totalsRegion(order.totals)}
  </div>
  <div class="order-main">
    ${
      ctx.query.get('placed') === '1'
        ? `<section class="panel colour-panel">
      <h1 tabindex="-1" data-confirmation>Thank you — order ${escapeHtml(order.number)} is placed.</h1>
      <p>Confirmation emailed to ${escapeHtml(order.email)}.</p>
    </section>`
        : ''
    }
    <h1 tabindex="-1">Order ${escapeHtml(order.number)}</h1>
    <p role="status" aria-live="polite" aria-label="Order status" data-order-status>${escapeHtml(
      ORDER_STATUS_WORDS[order.status]
    )}</p>
    <p role="status" aria-live="polite" aria-label="Payment status" data-payment-status>${escapeHtml(
      PAYMENT_STATUS_WORDS[order.payment_status]
    )}</p>
    <ol aria-label="Order timeline" class="timeline" data-timeline>
      ${(payload.timeline as Array<{ label: string; at: string }>)
        .map((item) => `<li>${escapeHtml(item.label)} — ${escapeHtml(formatDateTimeIst(new Date(item.at)))}</li>`)
        .join('')}
    </ol>
    ${
      canCancelOrder(order.status)
        ? '<button type="button" data-cancel-open aria-haspopup="dialog">Cancel order</button>'
        : ''
    }
    <div data-order-lines>
      ${payloadLines
        .map((line) => {
          const id = String(line.id);
          const label = `${String(line.product)} — ${String(line.colour)}, ${String(line.size)}`;
          const shipment = line.shipment as { carrier: string; tracking_number: string } | null;
          const warranty = line.warranty as { registration_id: string; covered_until: string } | null;
          return `
      <div role="group" aria-label="${attr(label)}" class="order-line" data-order-line="${attr(id)}">
        <p>${escapeHtml(label)}</p>
        <p data-line-tracking>${shipment === null ? '' : escapeHtml(`${shipment.carrier} ${shipment.tracking_number}`)}</p>
        ${line.return_eligible === true ? `<button type="button" data-return-open="${attr(id)}" aria-haspopup="dialog">Request return</button>` : ''}
        ${line.trial_eligible === true ? `<button type="button" data-trial-open="${attr(id)}" aria-haspopup="dialog">Send back from trial</button>` : ''}
        ${
          warranty === null
            ? `<button type="button" data-register-warranty="${attr(id)}">Register warranty</button>`
            : `<p>Covered until ${escapeHtml(new Date(warranty.covered_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
               <button type="button" data-claim-open="${attr(warranty.registration_id)}" aria-haspopup="dialog">Make a warranty claim</button>`
        }
      </div>`;
        })
        .join('')}
    </div>
  </div>
</div>
<dialog aria-label="Cancel this order?" role="alertdialog" data-dialog="cancel" data-motion-ms="320" data-state="closed">
  <h2>Cancel this order?</h2>
  <button type="button" data-dialog-close="cancel">Keep order</button>
  <button type="button" data-cancel-confirm>Yes, cancel order</button>
</dialog>
<dialog aria-label="Request a return" data-dialog="return" data-motion-ms="320" data-state="closed">
  <h2>Request a return</h2>
  <div role="radiogroup" aria-label="Reason" data-reason-group>
    ${RETURN_REASONS.map(
      (reason, index) => `<button type="button" role="radio" aria-label="${attr(reason)}"
      aria-checked="false" tabindex="${index === 0 ? '0' : '-1'}" data-reason="${attr(reason)}">${escapeHtml(
        reason
      )}</button>`
    ).join('')}
  </div>
  <label for="return-quantity">Quantity to return</label>
  <input id="return-quantity" type="number" min="1" max="10" value="1" aria-label="Quantity to return"
         data-return-quantity>
  <div role="radiogroup" aria-label="Outcome" data-outcome-group>
    <button type="button" role="radio" aria-label="Refund" aria-checked="false" tabindex="0"
            data-outcome="refund">Refund</button>
    <button type="button" role="radio" aria-label="Exchange" aria-checked="false" tabindex="-1"
            data-outcome="exchange">Exchange</button>
  </div>
  <div role="radiogroup" aria-label="Exchange for" data-exchange-group hidden></div>
  <div role="alert" data-return-error></div>
  <button type="button" data-submit-return>Submit return request</button>
  <button type="button" data-dialog-close="return">Close</button>
</dialog>
<dialog aria-label="Send back from trial" data-dialog="trial" data-motion-ms="320" data-state="closed">
  <h2>Send back from trial</h2>
  <label for="trial-note">How did it travel?</label>
  <textarea id="trial-note" aria-label="How did it travel?" maxlength="500" data-trial-note></textarea>
  <div role="alert" data-trial-error></div>
  <button type="button" data-submit-trial>Submit trial return</button>
  <button type="button" data-dialog-close="trial">Close</button>
</dialog>
<dialog aria-label="Warranty claim" data-dialog="claim" data-motion-ms="320" data-state="closed">
  <h2>Warranty claim</h2>
  <div role="radiogroup" aria-label="Component" data-component-group>
    ${CLAIM_COMPONENTS.map(
      (component, index) => `<button type="button" role="radio" aria-label="${attr(component)}"
      aria-checked="false" tabindex="${index === 0 ? '0' : '-1'}" data-component="${attr(component)}">${escapeHtml(
        component
      )}</button>`
    ).join('')}
  </div>
  <label for="claim-description">What happened?</label>
  <textarea id="claim-description" aria-label="What happened?" data-claim-description
            aria-describedby="claim-description-error"></textarea>
  <p class="field-error" id="claim-description-error" data-error-for="description"></p>
  <button type="button" data-add-photo>Add photo</button>
  <label class="visually-hidden" for="claim-photo">Evidence photo</label>
  <input id="claim-photo" type="file" accept="image/jpeg,image/png,image/webp" data-photo-input>
  <button type="button" data-add-receipt>Add receipt</button>
  <label class="visually-hidden" for="claim-receipt">Receipt PDF</label>
  <input id="claim-receipt" type="file" accept="application/pdf" data-receipt-input>
  <ul aria-label="Evidence" data-evidence-list></ul>
  <p role="status" aria-live="polite" aria-label="Upload progress" data-upload-progress></p>
  <div role="alert" data-claim-error></div>
  <button type="button" data-submit-claim>Submit claim</button>
  <button type="button" data-dialog-close="claim">Close</button>
</dialog>
<script type="application/json" id="order-data">${JSON.stringify({
    order: payload,
    exchange_candidates: Object.fromEntries(candidatesByLine)
  })}</script>`;

  return renderPage(shell, {
    title: `Order ${order.number}`,
    page: 'order',
    content,
    bodyData: { order: order.number }
  });
}

export async function accountPage(ctx: Ctx, shell: Shell): Promise<string | null> {
  if (ctx.user === null) return null;
  const tabs = ['Orders', 'Returns', 'Trials', 'Warranty', 'Addresses', 'Notifications'];
  const orders = await db.query<{ number: string; status: string; placed_at: Date; totals: { total: number } }>(
    'SELECT number, status, placed_at, totals FROM orders WHERE user_id = $1 ORDER BY placed_at DESC',
    [ctx.user.id]
  );
  const notifications = await db.query<{ text: string; email_status: string }>(
    'SELECT text, email_status FROM notifications WHERE user_id = $1 ORDER BY at DESC',
    [ctx.user.id]
  );
  const addresses = await db.query<{ id: string; label: string; line1: string; city: string }>(
    'SELECT id, label, line1, city FROM addresses WHERE user_id = $1 AND deleted = false ORDER BY position ASC',
    [ctx.user.id]
  );
  const returns = await db.query<{ number: string; status: string }>(
    'SELECT number, status FROM returns WHERE user_id = $1 ORDER BY created_at DESC',
    [ctx.user.id]
  );
  const trials = await db.query<{ number: string; status: string }>(
    'SELECT number, status FROM trials WHERE user_id = $1 ORDER BY created_at DESC',
    [ctx.user.id]
  );
  const claims = await db.query<{ number: string; status: string }>(
    'SELECT number, status FROM warranty_claims WHERE user_id = $1 ORDER BY created_at DESC',
    [ctx.user.id]
  );

  const content = `
<h1>Account</h1>
<div role="tablist" aria-label="Account" class="tabs" data-account-tabs>
  ${tabs
    .map(
      (tab, index) => `<button type="button" role="tab" aria-label="${attr(tab)}"
    aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}"
    data-tab="${attr(tab.toLowerCase())}">${escapeHtml(tab)}</button>`
    )
    .join('')}
</div>
<section data-panel="orders">
  ${
    orders.length === 0
      ? '<p>No orders yet.</p>'
      : `<ul>${orders
          .map(
            (order) =>
              `<li><a href="/orders/${attr(order.number)}">${escapeHtml(order.number)}</a> ${escapeHtml(
                ORDER_STATUS_WORDS[order.status]
              )} ${escapeHtml(rupees(order.totals.total))}</li>`
          )
          .join('')}</ul>`
  }
</section>
<section data-panel="returns" hidden>
  ${returns.length === 0 ? '<p>Nothing waiting.</p>' : `<ul>${returns.map((item) => `<li>${escapeHtml(item.number)} ${escapeHtml(item.status)}</li>`).join('')}</ul>`}
</section>
<section data-panel="trials" hidden>
  ${trials.length === 0 ? '<p>Nothing waiting.</p>' : `<ul>${trials.map((item) => `<li>${escapeHtml(item.number)} ${escapeHtml(item.status)}</li>`).join('')}</ul>`}
</section>
<section data-panel="warranty" hidden>
  ${claims.length === 0 ? '<p>Nothing waiting.</p>' : `<ul>${claims.map((item) => `<li>${escapeHtml(item.number)} ${escapeHtml(item.status)}</li>`).join('')}</ul>`}
</section>
<section data-panel="addresses" hidden>
  <ul>${addresses
    .map((address) => `<li>${escapeHtml(address.label)} — ${escapeHtml(address.line1)}, ${escapeHtml(address.city)}</li>`)
    .join('')}</ul>
</section>
<section data-panel="notifications" hidden>
  <div role="region" aria-label="Notifications">
    <ul>${notifications
      .map(
        (notification) =>
          `<li>${escapeHtml(notification.text)} — ${escapeHtml(
            notification.email_status === 'emailed' ? 'Emailed' : 'Email pending'
          )}</li>`
      )
      .join('')}</ul>
  </div>
</section>
<button type="button" data-sign-out>Sign out</button>`;

  return renderPage(shell, { title: 'Account', page: 'account', content });
}
