import { type Ctx, sendHtml } from "../http.js";
import { ApiError, errors } from "../errors.js";
import { COPY } from "../../shared/copy.js";
import { formatMoney, money, type Money } from "../../shared/money.js";
import { PLANS, isCarePlan, planName } from "../../shared/plans.js";
import { studioInstant } from "../time.js";
import * as cms from "../services/cms.js";
import { accountById, contractors } from "../domain/accounts.js";
import { allOrders, paymentsOfOrder, projectIdOfOrder } from "../domain/orders.js";
import { allPriceRows } from "../domain/prices.js";
import { escapeHtml, renderPage } from "./layout.js";
import { liveRegion } from "./components.js";

function sumMoney(values: Money[], fallbackCurrency: "USD" | "ARS"): Money {
  if (values.length === 0) return money(fallbackCurrency, 0n);
  return values.reduce((total, value) => money(value.currency, total.minor + value.minor));
}

export async function studioConsole(ctx: Ctx): Promise<void> {
  const user = ctx.user;
  if (!user) throw errors.unauthenticated();
  if (user.role !== "studio_owner") throw errors.forbidden();
  const orders = await allOrders();
  const people = await contractors();
  let rows = "";
  for (const order of orders) {
    const account = order.accountId ? await accountById(order.accountId) : null;
    const payments = await paymentsOfOrder(order.id);
    const projectId = await projectIdOfOrder(order.id);
    const paid = sumMoney(
      payments.map((payment) => payment.amount),
      order.currency,
    );
    const refunded = sumMoney(
      payments.map((payment) => payment.refunded),
      order.currency,
    );
    const actions: string[] = [];
    if (order.state === "deposit_paid") {
      actions.push(`<button type="button" data-order-transition="in_build" data-order="${order.id}">Start build</button>`);
    }
    if (order.state === "in_build") {
      actions.push(
        `<button type="button" data-order-transition="balance_invoiced" data-order="${order.id}">Invoice launch balance</button>`,
      );
    }
    if (order.state === "paid_in_full" && !isCarePlan(order.plan)) {
      actions.push(`<button type="button" data-order-transition="closed" data-order="${order.id}">Close project</button>`);
    }
    if (payments.some((payment) => payment.kind === "deposit" || payment.kind === "balance")) {
      actions.push(`<button type="button" data-refund-open="${order.id}">Refund</button>`);
    }
    const assignment =
      projectId && !isCarePlan(order.plan)
        ? `<label class="assign">Assign contractor
            <select data-assign-project="${projectId}">
              <option value="">Choose a contractor</option>
              ${people
                .map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`)
                .join("")}
            </select>
          </label>`
        : "";
    rows += `<tr>
      <td class="date">${escapeHtml(order.number)}</td>
      <td>${escapeHtml(account?.businessName ?? "")}</td>
      <td>${escapeHtml(planName(order.plan))}</td>
      <td>${escapeHtml(order.currency)}</td>
      <td data-order-state="${order.id}">${escapeHtml(order.state)}</td>
      <td class="amount">${escapeHtml(formatMoney(order.total))}</td>
      <td class="amount" data-order-paid="${order.id}">${escapeHtml(formatMoney(paid))}</td>
      <td class="amount" data-order-refunded="${order.id}">${escapeHtml(formatMoney(refunded))}</td>
      <td>${actions.join(" ")}${assignment}</td>
    </tr>`;
  }

  const prices = await allPriceRows();
  const priceRows = prices
    .map(
      (row) => `<tr>
      <td>${escapeHtml(planName(row.plan))}</td>
      <td>${escapeHtml(row.currency)}</td>
      <td class="amount">${escapeHtml(formatMoney(row.amount))}</td>
      <td class="date">${escapeHtml(studioInstant(row.effectiveAt))}</td>
    </tr>`,
    )
    .join("");

  let entryRows = "";
  try {
    const entries = await cms.allEntries();
    entryRows = entries
      .map(
        (entry) => `<tr>
        <td>${escapeHtml(entry.title)}</td>
        <td>${escapeHtml(entry.kind)}</td>
        <td data-entry-status="${escapeHtml(entry.id)}">${escapeHtml(entry.status)}</td>
        <td>${
          entry.status === "draft"
            ? `<button type="button" data-entry-publish="${escapeHtml(entry.id)}">Publish</button>`
            : entry.status === "published"
              ? `<button type="button" data-entry-withdraw="${escapeHtml(entry.id)}">Withdraw</button>`
              : ""
        }</td>
      </tr>`,
      )
      .join("");
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "cms_unavailable") throw error;
    entryRows = `<tr><td colspan="4">${escapeHtml(COPY.cmsOutage)}</td></tr>`;
  }

  const body = `<h1>Studio</h1>
<section class="table-frame">
  <table class="ledger-table" aria-label="Orders">
    <thead><tr><th scope="col">Number</th><th scope="col">Client</th><th scope="col">Plan</th>
    <th scope="col">Currency</th><th scope="col">State</th><th scope="col">Total</th>
    <th scope="col">Paid</th><th scope="col">Refunded</th><th scope="col">Actions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>
<div class="dialog-backdrop" data-refund-dialog hidden>
  <div role="dialog" aria-modal="true" aria-label="Issue refund" class="dialog">
    <h2>Issue refund</h2>
    <form class="stack" data-refund-form>
      <div role="radiogroup" aria-label="Payment" class="refund-payments">
        <label><input type="radio" name="refund-payment" value="deposit" checked> Deposit</label>
        <label><input type="radio" name="refund-payment" value="balance"> Launch balance</label>
      </div>
      <p data-refund-so-far>Refunded so far</p>
      <p data-refund-remaining>Left on this payment</p>
      <label>Amount <input name="amount" inputmode="decimal"></label>
      <label>Reason <input name="reason"></label>
      <p class="field-error" data-refund-field hidden></p>
      <button type="submit" class="primary">Issue refund</button>
      <button type="button" data-refund-close>Close</button>
    </form>
    ${liveRegion("Refund status", "data-refund-status")}
  </div>
</div>
<section class="prices">
  <h2>Peso prices</h2>
  <form class="stack" aria-label="Peso prices" data-price-form>
    <label>Plan
      <select name="plan">
        ${PLANS.map((plan) => `<option value="${plan.id}">${escapeHtml(plan.name)}</option>`).join("")}
      </select>
    </label>
    <label>Amount (ARS) <input name="amount" inputmode="decimal"></label>
    <label>Effective from <input name="effectiveAt" placeholder="2026-12-01T09:00:00-03:00"></label>
    <p class="field-error" data-price-field hidden></p>
    <button type="submit" class="primary">Schedule price</button>
  </form>
  <div class="table-frame"><table class="ledger-table" aria-label="Price schedule">
    <thead><tr><th scope="col">Plan</th><th scope="col">Currency</th><th scope="col">Amount</th>
    <th scope="col">Effective from</th></tr></thead>
    <tbody data-price-rows>${priceRows}</tbody>
  </table></div>
</section>
<section class="entries">
  <h2>Entries</h2>
  <div class="table-frame"><table class="ledger-table" aria-label="Entries">
    <thead><tr><th scope="col">Title</th><th scope="col">Kind</th><th scope="col">Status</th>
    <th scope="col">Actions</th></tr></thead>
    <tbody>${entryRows}</tbody>
  </table></div>
</section>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({ title: "Studio", shell: "studio", user, body, data: { page: "studio" } }),
  );
}
