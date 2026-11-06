import { type Ctx, sendHtml } from "../http.js";
import { errors } from "../errors.js";
import { COPY, formatLongDate, receiptEmailLine } from "../../shared/copy.js";
import { formatMoney, toAmountString, type Currency } from "../../shared/money.js";
import { PLANS, planName } from "../../shared/plans.js";
import { studioClockLabel, studioDate } from "../time.js";
import * as cms from "../services/cms.js";
import { priceInEffect } from "../domain/prices.js";
import { quoteAt } from "../domain/quotes.js";
import { visibleOrder } from "../domain/access.js";
import { latestPaymentOfOrder } from "../domain/orders.js";
import { ownerOfAccount } from "../domain/accounts.js";
import { inviteByToken } from "../api/portal.js";
import { accountById } from "../domain/accounts.js";
import { orderById } from "../domain/orders.js";
import { queryOne } from "../db.js";
import { escapeHtml, renderPage, STUDIO_EMAIL } from "./layout.js";
import { liveRegion, purchaseFigures, quoteSheet } from "./components.js";
import { icon } from "./icons.js";

const PROCESS_STEPS = [
  ["Quote", "Pick a plan and read the split before you commit."],
  ["Deposit", "Pay 40% to put the build in the calendar."],
  ["Build", "Share brand files; follow the build in the portal."],
  ["Launch", "Pay the balance at the locked price and go live."],
];

const PAYMENT_LABELS: Record<string, string> = {
  deposit: "Deposit",
  balance: "Launch balance",
  care: "Care plan",
  change: "Plan change",
  renewal: "Renewal",
};

async function planCards(currency: Currency): Promise<string> {
  const now = new Date();
  const amounts = new Map<string, string>();
  for (const plan of PLANS) {
    const row = await priceInEffect(plan.id, currency, now);
    if (row) amounts.set(plan.id, formatMoney(row.amount));
  }
  const buildCard = (planId: "launch-page" | "studio-site", chosen: boolean): string =>
    `<article class="plan-card" aria-labelledby="plan-${planId}" data-plan-card="${planId}">
      <h3 id="plan-${planId}">${escapeHtml(planName(planId))}</h3>
      <p class="plan-price"><span class="amount" data-plan-amount="${planId}">${escapeHtml(
        amounts.get(planId) ?? "",
      )}</span></p>
      <p class="plan-note">Fixed scope. 40% deposit, balance at launch.</p>
      <button type="button" data-choose-plan="${planId}" aria-pressed="${chosen ? "true" : "false"}">Choose ${escapeHtml(
        planName(planId),
      )}</button>
    </article>`;
  return `${buildCard("launch-page", false)}
    ${buildCard("studio-site", true)}
    <article class="plan-card" aria-labelledby="plan-care" data-plan-card="care">
      <h3 id="plan-care">Care</h3>
      <p class="plan-price"><span class="amount" data-plan-amount="care-lite">${escapeHtml(
        amounts.get("care-lite") ?? "",
      )}</span> / month</p>
      <p class="plan-price plan-price-plus">Care Plus <span class="amount" data-plan-amount="care-plus">${escapeHtml(
        amounts.get("care-plus") ?? "",
      )}</span> / month</p>
      <div role="radiogroup" aria-label="Care tier" class="tier-radios">
        <label><input type="radio" name="care-tier" value="lite" data-care-tier="lite" checked> Lite</label>
        <label><input type="radio" name="care-tier" value="plus" data-care-tier="plus"> Plus</label>
      </div>
      <button type="button" data-choose-plan="care" aria-pressed="false">Choose Care</button>
    </article>`;
}

async function workDeck(): Promise<string> {
  let entries: cms.CmsEntry[];
  try {
    entries = await cms.publishedEntries("case_study");
  } catch {
    return `<p class="outage">${escapeHtml(COPY.cmsOutage)}</p>`;
  }
  const cards = entries
    .map(
      (entry) => `<li class="case-card" data-case-card="${escapeHtml(entry.slug)}">
      <a href="/work/${escapeHtml(entry.slug)}" data-case-link="${escapeHtml(entry.slug)}">${escapeHtml(
        entry.title,
      )}</a>
      <p class="case-meta">${escapeHtml(entry.client)} — ${entry.year}</p>
      <p class="case-summary">${escapeHtml(entry.summary)}</p>
    </li>`,
    )
    .join("");
  return `<ul class="case-deck" aria-label="Case studies">${cards}</ul>`;
}

export async function home(ctx: Ctx): Promise<void> {
  const quote = await quoteAt("studio-site", "USD", new Date()).catch(() => null);
  const figures = quote ? purchaseFigures(quote.dueNow, quote.dueAtLaunch, quote.total) : null;
  const body = `
<section class="hero" id="hero" data-section="hero">
  <h1>Websites built and billed in two currencies.</h1>
  <p class="pitch">Pampero Build Co. designs, builds and cares for small studio websites from Buenos Aires — quoted in dollars or pesos, with the split in writing before you pay.</p>
</section>
<section class="work" id="work" data-section="work" role="region" aria-label="Work">
  <h2>Work</h2>
  ${await workDeck()}
</section>
<section class="process" id="process" data-section="process">
  <h2>Process</h2>
  <ol class="process-rail">
    ${PROCESS_STEPS.map(
      ([title, note], index) =>
        `<li><span class="step-number">${index + 1}</span><h3>${escapeHtml(title ?? "")}</h3><p>${escapeHtml(
          note ?? "",
        )}</p></li>`,
    ).join("")}
  </ol>
</section>
<section class="pricing" id="pricing" data-section="pricing" role="region" aria-label="Pricing">
  <h2>Pricing</h2>
  <div role="radiogroup" aria-label="Currency" class="currency-radios" data-currency-group>
    <label><input type="radio" name="currency" value="USD" data-currency="USD" checked> USD</label>
    <label><input type="radio" name="currency" value="ARS" data-currency="ARS"> ARS</label>
  </div>
  <div class="plan-cards">${await planCards("USD")}</div>
  ${quoteSheet(figures, quote ? "ready" : "outage")}
  ${liveRegion("Quote status", "data-quote-status")}
  <button type="button" class="primary" data-start-checkout>Start checkout</button>
</section>
<section class="contact" id="contact" data-section="contact">
  <h2>Contact</h2>
  <p><a href="mailto:${STUDIO_EMAIL}">${STUDIO_EMAIL}</a></p>
</section>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({
      title: "Pampero Build Co.",
      shell: "public",
      user: ctx.user,
      scene: true,
      body,
      data: { page: "home", currency: "USD", plan: "studio-site", tier: "lite" },
    }),
  );
}

export async function caseStudy(ctx: Ctx): Promise<void> {
  const entry = await cms.publishedEntry("case_study", ctx.params.slug ?? "");
  if (!entry) throw errors.notFound();
  const body = `<article class="entry">
  <h1>${escapeHtml(entry.title)}</h1>
  <p class="entry-meta">${escapeHtml(entry.client)} — ${entry.year}</p>
  <p class="entry-summary">${escapeHtml(entry.summary)}</p>
  <div class="entry-body"><p>${escapeHtml(entry.body)}</p></div>
  <a href="/#work" data-back-to-work>${icon("arrow-left")}Back to work</a>
</article>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({
      title: entry.title,
      shell: "public",
      user: ctx.user,
      scene: true,
      body,
      data: { page: "case-study", slug: entry.slug },
    }),
  );
}

export async function journal(ctx: Ctx): Promise<void> {
  let entries: cms.CmsEntry[];
  try {
    entries = await cms.publishedEntries("journal");
  } catch {
    sendHtml(
      ctx.res,
      200,
      renderPage({
        title: "Journal",
        shell: "public",
        user: ctx.user,
        scene: true,
        body: `<h1>Journal</h1><p class="outage">${escapeHtml(COPY.cmsOutage)}</p>`,
      }),
    );
    return;
  }
  const body = `<h1>Journal</h1>
<ul class="journal-list" aria-label="Journal posts">
${entries
  .map(
    (entry) =>
      `<li><a href="/journal/${escapeHtml(entry.slug)}">${escapeHtml(entry.title)}</a><p>${escapeHtml(
        entry.summary,
      )}</p></li>`,
  )
  .join("")}
</ul>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({ title: "Journal", shell: "public", user: ctx.user, scene: true, body }),
  );
}

export async function journalPost(ctx: Ctx): Promise<void> {
  const entry = await cms.publishedEntry("journal", ctx.params.slug ?? "");
  if (!entry) throw errors.notFound();
  const body = `<article class="entry">
  <h1>${escapeHtml(entry.title)}</h1>
  <p class="entry-summary">${escapeHtml(entry.summary)}</p>
  <div class="entry-body"><p>${escapeHtml(entry.body)}</p></div>
  <a href="/journal">Back to the journal</a>
</article>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({ title: entry.title, shell: "public", user: ctx.user, scene: true, body }),
  );
}

export async function signIn(ctx: Ctx): Promise<void> {
  const next = ctx.url.searchParams.get("next") ?? "";
  const body = `<h1>Sign in</h1>
<form class="stack" aria-label="Sign in" data-sign-in data-next="${escapeHtml(next)}">
  <p class="alert" role="alert" data-sign-in-error hidden></p>
  <label>Email <input type="email" name="email" autocomplete="email" required></label>
  <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
  <button type="submit" class="primary">Sign in</button>
</form>`;
  sendHtml(ctx.res, 200, renderPage({ title: "Sign in", shell: "public", user: ctx.user, body }));
}

export async function checkout(ctx: Ctx): Promise<void> {
  const order = await visibleOrder(ctx.user, ctx.sessionId, ctx.params.id ?? "");
  const awaitingBalance = order.state === "balance_invoiced";
  const paymentEnabled = order.state === "accepted" || awaitingBalance;
  const dueAmount = awaitingBalance ? order.dueAtLaunch : order.dueNow;
  const figures = purchaseFigures(order.dueNow, order.dueAtLaunch, order.total);
  const signedOut = ctx.user === null;
  const accountFields = signedOut
    ? `<label>Business name <input name="businessName" autocomplete="organization" required></label>
  <label>Your name <input name="name" autocomplete="name" required></label>
  <label>Email <input name="email" type="email" autocomplete="email" required></label>
  <label>Password <input name="password" type="password" autocomplete="new-password" required></label>`
    : "";
  const body = `<div class="checkout">
  <section class="order-summary" role="region" aria-label="Order summary">
    <h1>${escapeHtml(planName(order.plan))}</h1>
    <p class="order-number">Order ${escapeHtml(order.number)}</p>
    <p class="order-currency">Billed in ${escapeHtml(order.currency)}</p>
    ${quoteSheet(figures, "ready")}
    ${liveRegion("Quote status", "data-quote-status")}
  </section>
  <div class="checkout-forms">
    <p class="alert" role="alert" data-checkout-alert hidden></p>
    <form class="stack" aria-label="Accept quote" data-accept-form${order.state === "quoted" ? "" : " hidden"}>
      ${accountFields}
      <label class="checkbox"><input type="checkbox" name="acceptTerms" data-accept-terms> I accept the scope and price in this quote</label>
      <button type="submit" class="primary">Accept quote</button>
      ${signedOut ? `<a href="/sign-in?next=/checkout/${escapeHtml(order.id)}">Already a client? Sign in</a>` : ""}
    </form>
    <form class="stack" aria-label="Payment" data-payment-form${paymentEnabled ? "" : " data-disabled"}>
      <label>Card number <input name="cardNumber" inputmode="numeric" autocomplete="cc-number" ${
        paymentEnabled ? "" : "disabled"
      }></label>
      <label>Expiry (MM/YY) <input name="cardExpiry" inputmode="numeric" autocomplete="cc-exp" ${
        paymentEnabled ? "" : "disabled"
      }></label>
      <label>CVC <input name="cardCvc" inputmode="numeric" autocomplete="cc-csc" ${
        paymentEnabled ? "" : "disabled"
      }></label>
      <button type="submit" class="primary" ${paymentEnabled ? "" : "disabled"}>Pay ${escapeHtml(
        formatMoney(dueAmount),
      )}</button>
    </form>
    ${liveRegion("Checkout status", "data-checkout-status")}
  </div>
</div>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({
      title: `Checkout ${order.number}`,
      shell: "public",
      user: ctx.user,
      body,
      data: {
        page: "checkout",
        orderId: order.id,
        state: order.state,
        dueAmount: toAmountString(dueAmount),
        currency: order.currency,
      },
    }),
  );
}

export async function receipt(ctx: Ctx): Promise<void> {
  const order = await visibleOrder(ctx.user, ctx.sessionId, ctx.params.id ?? "");
  const payment = await latestPaymentOfOrder(order.id);
  if (!payment) throw errors.notFound();
  const owner = order.accountId ? await ownerOfAccount(order.accountId) : null;
  const body = `<section class="receipt">
  <h1>Payment received</h1>
  <p class="order-number">Order ${escapeHtml(order.number)}</p>
  <p class="payment-kind">${escapeHtml(PAYMENT_LABELS[payment.kind] ?? payment.kind)}</p>
  <p class="receipt-amount amount">${escapeHtml(formatMoney(payment.amount))}</p>
  <p class="receipt-time">Captured ${escapeHtml(
    `${formatLongDate(studioDate(payment.capturedAt))} at ${studioClockLabel(payment.capturedAt)}`,
  )}</p>
  <p class="receipt-email">${escapeHtml(receiptEmailLine(owner?.email ?? ""))}</p>
  <a href="/portal" class="primary-link">Go to your portal</a>
</section>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({ title: `Receipt ${order.number}`, shell: "public", user: ctx.user, body }),
  );
}

export async function invitePage(ctx: Ctx): Promise<void> {
  const token = ctx.params.token ?? "";
  const invite = await inviteByToken(token);
  if (!invite) throw errors.notFound();
  const account = await accountById(invite.account_id);
  const project = await queryOne<{ order_id: string }>(`select order_id from projects where id = $1`, [
    invite.project_id,
  ]);
  const order = project ? await orderById(project.order_id) : null;
  if (!account || !order) throw errors.notFound();
  const unusable = invite.used_at
    ? "That invite was already used."
    : invite.expires_at.getTime() < Date.now()
      ? "That invite expired."
      : null;
  const body = `<section class="invite">
  <h1>Join ${escapeHtml(account.businessName)}</h1>
  <p class="invite-project">${escapeHtml(planName(order.plan))}</p>
  ${unusable ? `<p class="alert" role="alert">${escapeHtml(unusable)}</p>` : ""}
  <form class="stack" aria-label="Accept invite" data-invite-form data-token="${escapeHtml(token)}"${
    unusable ? " hidden" : ""
  }>
    <p class="alert" role="alert" data-invite-error hidden></p>
    <label>Name <input name="name" autocomplete="name" required></label>
    <label>Password <input name="password" type="password" autocomplete="new-password" required></label>
    <button type="submit" class="primary">Join the project</button>
  </form>
</section>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({ title: `Join ${account.businessName}`, shell: "public", user: ctx.user, body }),
  );
}
