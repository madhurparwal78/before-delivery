import { type Ctx, sendHtml } from "../http.js";
import { ApiError, errors } from "../errors.js";
import { COPY, formatLongDate } from "../../shared/copy.js";
import { formatMoney } from "../../shared/money.js";
import { planName } from "../../shared/plans.js";
import { type UserRow } from "../domain/accounts.js";
import { accountById } from "../domain/accounts.js";
import { ordersOfAccount, orderById } from "../domain/orders.js";
import { projectsVisibleTo, visibleProject } from "../domain/access.js";
import { carePlanContext, planView, type PlanView } from "../domain/plan.js";
import { invoiceViews } from "../domain/billing.js";
import { contractorsOfProject, filesOfProject, projectSummary } from "../api/portal.js";
import { escapeHtml, renderPage } from "./layout.js";
import { liveRegion, quoteSheet } from "./components.js";
import { icon } from "./icons.js";

function portalNav(user: UserRow, active: string): string {
  const links: Array<[string, string]> = [["Overview", "/portal"]];
  links.push(["Projects", "/portal#projects"]);
  if (user.role === "client_owner") {
    links.push(["Plan", "/portal/plan"]);
    links.push(["Invoices", "/portal/invoices"]);
  }
  return `<nav aria-label="Portal" class="portal-nav">${links
    .map(
      ([label, href]) =>
        `<a href="${href}"${active === label ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`,
    )
    .join("")}</nav>`;
}

function portalShell(user: UserRow, active: string, content: string): string {
  return `<div class="portal">${portalNav(user, active)}<div class="portal-content">${content}</div></div>`;
}

function statusLabel(plan: PlanView): string {
  switch (plan.status) {
    case "active":
      return plan.pauseOn ? `Pauses on ${formatLongDate(plan.pauseOn)}` : "Active";
    case "paused":
      return "Paused";
    case "pending_cancel":
      return plan.endsOn ? `Ends on ${formatLongDate(plan.endsOn)}` : "Cancelled";
    case "past_due":
      return "Past due";
    default:
      return "Cancelled";
  }
}

export async function overview(ctx: Ctx): Promise<void> {
  const user = ctx.user;
  if (!user) throw errors.unauthenticated();
  const projects = await projectsVisibleTo(user);
  const projectRows = [];
  for (const project of projects) {
    const summary = await projectSummary(project);
    projectRows.push(
      `<li><a href="/portal/projects/${escapeHtml(project.id)}">${escapeHtml(summary.businessName)} — ${escapeHtml(
        summary.planName,
      )}</a> <span class="state">${escapeHtml(summary.state)}</span></li>`,
    );
  }
  let ordersBlock = "";
  let planBlock = "";
  if (user.role === "client_owner") {
    const orders = await ordersOfAccount(user.accountId ?? "");
    ordersBlock = `<section><h2>Orders</h2><ul class="order-list">${orders
      .map(
        (order) =>
          `<li><span>${escapeHtml(order.number)} ${escapeHtml(planName(order.plan))}</span>
           <span class="amount">${escapeHtml(formatMoney(order.total))}</span>
           <span class="state">${escapeHtml(order.state)}</span>
           ${
             order.state === "balance_invoiced"
               ? `<a href="/checkout/${escapeHtml(order.id)}">Pay launch balance</a>`
               : ""
           }</li>`,
      )
      .join("")}</ul></section>`;
    const context = await carePlanContext(user.accountId ?? "");
    if (context) {
      try {
        const plan = await planView(context);
        planBlock = `<section><h2>Care plan</h2><p>${escapeHtml(plan.planName)} — Status: ${escapeHtml(
          statusLabel(plan),
        )}</p><p class="amount">${escapeHtml(formatMoney(plan.monthlyPrice))} / month</p>
        <a href="/portal/plan">Open your plan</a></section>`;
      } catch {
        planBlock = `<section><h2>Care plan</h2><p class="outage">${escapeHtml(COPY.planPageOutage)}</p></section>`;
      }
    }
  }
  const content = `<h1>Portal</h1>
${ordersBlock}
${planBlock}
<section id="projects"><h2>Projects</h2><ul class="project-list">${projectRows.join("")}</ul></section>`;
  sendHtml(
    ctx.res,
    200,
    renderPage({ title: "Portal", shell: "portal", user, body: portalShell(user, "Overview", content) }),
  );
}

export async function projectPage(ctx: Ctx): Promise<void> {
  const user = ctx.user;
  if (!user) throw errors.unauthenticated();
  const project = await visibleProject(user, ctx.params.id ?? "");
  const summary = await projectSummary(project);
  const files = await filesOfProject(project.id);
  const assets = files.filter((file) => file.kind === "asset");
  const deliverables = files.filter((file) => file.kind === "deliverable");
  const showContractors = user.role === "client_owner" || user.role === "studio_owner";
  const contractors = showContractors ? await contractorsOfProject(project.id) : [];
  const canUploadAsset = user.role === "client_owner" || user.role === "teammate";
  const canUploadDeliverable =
    user.role === "studio_owner" ||
    (user.role === "contractor" && !project.closedAt);
  const fileList = (
    label: string,
    items: typeof files,
    attribute: string,
  ): string => `<section role="region" aria-label="${escapeHtml(label)}">
  <h2>${escapeHtml(label)}</h2>
  <ul class="file-list" ${attribute}>${items
    .map(
      (file) => `<li>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-meta">${escapeHtml(file.uploadedBy)} — ${file.size} bytes</span>
      <button type="button" data-download-file="${escapeHtml(file.id)}">${icon("download")}Download ${escapeHtml(
        file.name,
      )}</button>
    </li>`,
    )
    .join("")}</ul>
</section>`;
  const content = `<h1>${escapeHtml(summary.businessName)} — ${escapeHtml(summary.planName)}</h1>
<p class="order-state">Order ${escapeHtml(summary.orderNumber)}: ${escapeHtml(summary.state)}</p>
${fileList("Brand assets", assets, 'data-asset-list')}
${fileList("Deliverables", deliverables, 'data-deliverable-list')}
${
  showContractors
    ? `<section><h2>Assigned contractors</h2><ul class="contractor-list">${contractors
        .map((person) => `<li>${escapeHtml(person.name)}</li>`)
        .join("")}</ul></section>`
    : ""
}
<section class="uploads">
  ${
    canUploadAsset
      ? `<label>${icon("upload")}Upload brand asset <input type="file" data-upload="asset"></label>`
      : ""
  }
  ${
    canUploadDeliverable
      ? `<label>${icon("upload")}Upload deliverable <input type="file" data-upload="deliverable"></label>`
      : ""
  }
  <p class="allowlist">${escapeHtml(COPY.allowlist)}</p>
  ${liveRegion("Upload status", "data-upload-status")}
</section>
${
  user.role === "client_owner"
    ? `<section class="invites">
  <button type="button" data-invite-open>Invite teammate</button>
  <div class="dialog-backdrop" data-invite-dialog hidden>
    <div role="dialog" aria-modal="true" aria-label="Invite teammate" class="dialog">
      <h2>Invite teammate</h2>
      <form class="stack" data-invite-send>
        <label>Email <input name="email" type="email" required></label>
        <p class="field-error" data-invite-field hidden></p>
        <button type="submit" class="primary">Send invite</button>
        <button type="button" data-invite-close>Close</button>
      </form>
    </div>
  </div>
  ${liveRegion("Invite status", "data-invite-status")}
</section>`
    : ""
}`;
  sendHtml(
    ctx.res,
    200,
    renderPage({
      title: `${summary.businessName} — ${summary.planName}`,
      shell: "portal",
      user,
      body: portalShell(user, "Projects", content),
      data: { page: "project", projectId: project.id },
    }),
  );
}

function planActions(plan: PlanView): string {
  const buttons: string[] = [];
  if (plan.status === "active" && !plan.pauseOn) {
    const other = plan.tier === "lite" ? "Care Plus" : "Care Lite";
    buttons.push(
      `<button type="button" data-switch-tier="${plan.tier === "lite" ? "plus" : "lite"}">Switch to ${other}</button>`,
    );
    buttons.push(`<button type="button" data-pause-plan>Pause plan</button>`);
    buttons.push(`<button type="button" data-cancel-open>Cancel plan</button>`);
  }
  if (plan.status === "paused" || (plan.status === "active" && plan.pauseOn)) {
    buttons.push(`<button type="button" data-resume-plan>Resume plan</button>`);
  }
  return `<div class="plan-actions" data-plan-actions>${buttons.join("")}</div>`;
}

export async function planPage(ctx: Ctx): Promise<void> {
  const user = ctx.user;
  if (!user) throw errors.unauthenticated();
  if (user.role !== "client_owner") throw errors.forbidden();
  const context = await carePlanContext(user.accountId ?? "");
  if (!context) throw errors.notFound();
  let plan: PlanView | null = null;
  try {
    plan = await planView(context);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "billing_unavailable") throw error;
  }
  const content = plan
    ? `<h1>${escapeHtml(plan.planName)}</h1>
<p class="plan-price amount">${escapeHtml(formatMoney(plan.monthlyPrice))} / month</p>
<p class="plan-status" data-plan-status-text>Status: ${escapeHtml(statusLabel(plan))}</p>
<dl class="plan-dates">
  <dt>Period start</dt><dd data-period-start>${escapeHtml(plan.periodStart ?? "")}</dd>
  <dt>Charged through</dt><dd data-charged-through>${escapeHtml(plan.chargedThrough ?? "")}</dd>
  ${plan.pauseOn ? `<dt>Pauses on</dt><dd data-pause-on>${escapeHtml(plan.pauseOn)}</dd>` : ""}
  ${plan.endsOn ? `<dt>Ends on</dt><dd data-ends-on>${escapeHtml(plan.endsOn)}</dd>` : ""}
</dl>
${planActions(plan)}
${
  plan.status === "past_due"
    ? `<p class="alert" role="alert">${escapeHtml(COPY.pastDue)}</p>
<form class="stack" aria-label="Update card" data-card-form>
  <label>Card number <input name="cardNumber" inputmode="numeric"></label>
  <label>Expiry (MM/YY) <input name="cardExpiry" inputmode="numeric"></label>
  <label>CVC <input name="cardCvc" inputmode="numeric"></label>
  <button type="submit" class="primary">Update card and pay</button>
</form>`
    : ""
}
${liveRegion("Plan status", "data-plan-status")}
<div class="dialog-backdrop" data-change-dialog hidden>
  <div role="dialog" aria-modal="true" aria-label="Confirm plan change" class="dialog">
    <h2>Confirm plan change</h2>
    ${quoteSheet(null, "quoting")}
    <button type="button" class="primary" data-confirm-change disabled>Confirm change</button>
    <button type="button" data-change-close>Keep current plan</button>
  </div>
</div>
<div class="dialog-backdrop" data-cancel-dialog hidden>
  <div role="dialog" aria-modal="true" aria-label="Cancel care plan" class="dialog">
    <h2>Cancel care plan</h2>
    <p>Your plan runs to the end of the period you have paid for.</p>
    <button type="button" class="destructive" data-cancel-confirm>Cancel at period end</button>
    <button type="button" data-cancel-close>Keep plan</button>
  </div>
</div>`
    : `<h1>Care plan</h1><p class="outage" data-plan-outage>${escapeHtml(COPY.planPageOutage)}</p>
${liveRegion("Plan status", "data-plan-status")}`;
  sendHtml(
    ctx.res,
    200,
    renderPage({
      title: "Care plan",
      shell: "portal",
      user,
      body: portalShell(user, "Plan", content),
      data: { page: "plan", tier: plan?.tier ?? null, status: plan?.status ?? null },
    }),
  );
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  open: "Open",
  void: "Void",
  credit: "Credit",
};

export async function invoicesPage(ctx: Ctx): Promise<void> {
  const user = ctx.user;
  if (!user) throw errors.unauthenticated();
  if (user.role !== "client_owner") throw errors.forbidden();
  const account = await accountById(user.accountId ?? "");
  if (!account) throw errors.notFound();
  let rows = "";
  let outage = "";
  try {
    const invoices = await invoiceViews(account.id);
    for (const invoice of invoices) {
      const order = invoice.orderId ? await orderById(invoice.orderId) : null;
      const payLink =
        invoice.kind === "balance" && invoice.status === "open" && order
          ? `<a href="/checkout/${escapeHtml(order.id)}">Pay launch balance</a>`
          : "";
      rows += `<tr>
        <td class="date">${escapeHtml(invoice.number)}</td>
        <td class="date">${escapeHtml(invoice.date)}</td>
        <td>${escapeHtml(invoice.description)} ${payLink}</td>
        <td class="amount">${escapeHtml(formatMoney(invoice.amount))}</td>
        <td>${escapeHtml(INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status)}</td>
        <td>${
          invoice.pdf
            ? `<button type="button" data-download-invoice="${escapeHtml(invoice.id)}">${icon(
                "download",
              )}Download invoice ${escapeHtml(invoice.number)}</button>`
            : ""
        }</td>
      </tr>`;
    }
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "billing_unavailable") throw error;
    outage = `<p class="alert" role="alert">${escapeHtml(COPY.billingOutage)}</p>`;
  }
  const content = `<h1>Invoices</h1>
${outage}
<div class="table-frame"><table class="ledger-table" aria-label="Invoices">
  <thead><tr><th scope="col">Number</th><th scope="col">Date</th><th scope="col">Description</th>
  <th scope="col">Amount</th><th scope="col">Status</th><th scope="col">PDF</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>
${liveRegion("Upload status", "data-upload-status")}`;
  sendHtml(
    ctx.res,
    200,
    renderPage({
      title: "Invoices",
      shell: "portal",
      user,
      body: portalShell(user, "Invoices", content),
      data: { page: "invoices" },
    }),
  );
}
