import { api, problemOf, ApiProblem } from "./api.ts";
import type { Drop, Order, Settlement } from "./api.ts";
import { announceProblem, announceUpdate, busyButton, clear, clearFieldErrors, h, openDialog, showFieldErrors } from "./ui.ts";
import { formatDateText, formatMoney, pacificInstant, pacificNow } from "./format.ts";
import { reload, type DeskState, type DeskView } from "./desk.ts";

/** Runs a desk action with the standard pending/success/refusal feedback. */
async function runAction(
  button: HTMLButtonElement,
  pending: string,
  success: string | null,
  run: () => Promise<unknown>,
): Promise<ApiProblem | null> {
  const restore = busyButton(button);
  announceUpdate(pending);
  try {
    await run();
    if (success) announceUpdate(success);
    return null;
  } catch (error) {
    const problem = problemOf(error);
    announceProblem(problem?.message ?? "Bloom Desk can't reach its server. Check your connection and try again.");
    return problem;
  } finally {
    restore();
  }
}

function problemCopy(problem: ApiProblem | null, ref: string, status: string): string {
  if (!problem) return "Bloom Desk can't reach its server. Check your connection and try again.";
  if (problem.status === 401) return "Your session has ended. Sign in again.";
  if (problem.status === 404) return "That record isn't available to you.";
  if (problem.code === "invalid_transition") return `That can't be done while ${ref} is ${status}.`;
  if (problem.code === "idempotency_key_reused") return "That request was already sent with different details. Reload and try again.";
  if (problem.status >= 500) return "Something went wrong on our side. Try again in a minute.";
  return problem.message;
}

async function refreshDesk(state: DeskState, view: DeskView): Promise<void> {
  await reload(state, view, true);
}

/** Dialog "Commit truckload": the Hives field starts at the still-open count. */
export function openCommitDialog(state: DeskState, order: Order, opener: HTMLButtonElement, view: DeskView): void {
  const yard = h("input", { type: "text", "data-field": "yard_name", id: "commit-yard" });
  const hives = h("input", { type: "number", "data-field": "hives", id: "commit-hives", min: "1", step: "1", value: String(order.hives_remaining ?? 0) });
  hives.setAttribute("max", String(order.hives_remaining ?? 0));
  const submit = h("button", { type: "submit", class: "primary", text: "Commit" });
  const form = h("form", { novalidate: "" },
    h("h2", { text: "Commit truckload" }),
    h("div", { class: "field" }, h("label", { for: "commit-yard", text: "Yard name" }), yard),
    h("div", { class: "field" }, h("label", { for: "commit-hives", text: "Hives" }), hives),
    h("div", { class: "dialog-actions" }, submit),
  );
  const dialog = openDialog({ label: "Commit truckload", content: [form], opener });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const hivesValue = Number(hives.value);
    const problem = await runAction(submit, `Committing ${hivesValue} hives to ${order.ref}…`, null, async () => {
      await api(`/api/orders/${order.id}/drops`, {
        method: "POST",
        body: { yard_name: yard.value, hives: hivesValue },
      });
    });
    if (problem) {
      if (problem.code === "not_enough_open_hives") {
        const remaining = problem.remaining ?? 0;
        hives.setAttribute("max", String(remaining));
        showFieldErrors(form, { hives: `Only ${remaining} hives are still open on ${order.ref}.` });
        announceProblem(`Only ${remaining} hives are still open on ${order.ref}.`);
      } else {
        if (problem.fields && Object.keys(problem.fields).length > 0) {
          showFieldErrors(form, problem.fields);
        } else {
          announceProblem(problemCopy(problem, order.ref, order.status));
        }
      }
      return;
    }
    announceUpdate(`${hivesValue} hives committed to ${order.ref}.`);
    dialog.close();
    opener.focus();
    await refreshDesk(state, view);
  });
}

/** Dialog "Log drop": date and time default to the current Pacific clock. */
export async function openLogDropDialog(state: DeskState, order: Order, drop: Drop, opener: HTMLButtonElement, view: DeskView): Promise<void> {
  const full = order.blocks
    ? order
    : (await api<Order>(`/api/orders/${order.id}`)).body;
  const blockSelect = h("select", { "data-field": "block_id", id: "log-block" });
  for (const block of full.blocks ?? []) {
    blockSelect.append(h("option", { value: block.id, text: block.name }));
  }
  const now = pacificNow();
  const date = h("input", { type: "date", "data-field": "delivered_at.date", id: "log-date", value: now.date });
  const time = h("input", { type: "time", "data-field": "delivered_at.time", id: "log-time", value: now.time });
  const submit = h("button", { type: "submit", class: "primary", text: "Log drop" });
  const form = h("form", { novalidate: "" },
    h("h2", { text: "Log drop" }),
    h("div", { class: "field" }, h("label", { for: "log-block", text: "Block" }), blockSelect),
    h("div", { class: "field" }, h("label", { for: "log-date", text: "Delivery date (Pacific)" }), date),
    h("div", { class: "field" }, h("label", { for: "log-time", text: "Delivery time (Pacific)" }), time),
    h("div", { class: "dialog-actions" }, submit),
  );
  const dialog = openDialog({ label: "Log drop", content: [form], opener });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const blockName = blockSelect.selectedOptions[0]?.textContent ?? "";
    const problem = await runAction(submit, "Logging drop…", null, async () => {
      await api(`/api/drops/${drop.id}/deliver`, {
        method: "POST",
        body: { block_id: blockSelect.value, delivered_at: pacificInstant(date.value, time.value) },
      });
    });
    if (problem) {
      if (problem.fields && Object.keys(problem.fields).length > 0) {
        const mapped: Record<string, string> = {};
        for (const [field, message] of Object.entries(problem.fields)) {
          if (field === "block_id") {
            mapped["block_id"] = message;
            blockSelect.closest(".field")?.querySelector("select")?.focus();
          } else {
            mapped[field] = message;
          }
        }
        showFieldErrors(form, mapped);
      } else {
        announceProblem(problemCopy(problem, order.ref, order.status));
      }
      return;
    }
    announceUpdate(`Drop logged: ${drop.hives} hives in ${blockName}, delivered ${formatDateText(pacificNow().date)}.`);
    dialog.close();
    opener.focus();
    await refreshDesk(state, view);
  });
}

/** Dialog "New orchard": grower, name, county and its blocks. */
export function openOrchardDialog(state: DeskState, opener: HTMLButtonElement, view: DeskView): void {
  const form = h("form", { novalidate: "" });
  const name = h("input", { type: "text", "data-field": "name", id: "orchard-name" });
  const county = h("input", { type: "text", "data-field": "county", id: "orchard-county" });
  const blockRows: { name: HTMLInputElement; acres: HTMLInputElement }[] = [];
  const blocksArea = h("div", { class: "block-inputs" });
  const addBlock = (): void => {
    const row = h("div", { class: "field block-input-row" });
    const blockName = h("input", { type: "text", "data-field": `blocks.${blockRows.length}.name` });
    const acres = h("input", { type: "number", "data-field": `blocks.${blockRows.length}.acres`, min: "1", max: "500", step: "0.1" });
    blockRows.push({ name: blockName, acres });
    row.append(
      h("label", { text: `Block ${blockRows.length} name` }), blockName,
      h("label", { text: `Block ${blockRows.length} acres` }), acres,
    );
    blocksArea.append(row);
  };
  addBlock();
  addBlock();
  const growerSelect = h("select", { "data-field": "grower_id", id: "orchard-grower" });
  for (const grower of state.growers ?? []) {
    growerSelect.append(h("option", { value: grower.id, text: grower.name }));
  }
  const submit = h("button", { type: "submit", class: "primary", text: "Save orchard" });
  const addBlockButton = h("button", { type: "button", text: "Add block", onclick: () => addBlock() });
  form.append(
    h("h2", { text: "New orchard" }),
    h("div", { class: "field" }, h("label", { for: "orchard-grower", text: "Grower" }), growerSelect),
    h("div", { class: "field" }, h("label", { for: "orchard-name", text: "Orchard name" }), name),
    h("div", { class: "field" }, h("label", { for: "orchard-county", text: "County" }), county),
    blocksArea,
    h("div", { class: "dialog-actions" }, addBlockButton, submit),
  );
  const dialog = openDialog({ label: "New orchard", content: [form], opener });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const blocks = blockRows.map((row) => ({ name: row.name.value, acres: Number(row.acres.value) }));
    const orchardName = name.value;
    let orchardId = "";
    const problem = await runAction(submit, "Saving orchard…", null, async () => {
      const response = await api<{ id: string }>("/api/orchards", {
        method: "POST",
        body: { grower_id: growerSelect.value, name: orchardName, county: county.value, blocks },
      });
      orchardId = response.body.id;
      state.orchards = [...state.orchards];
    });
    if (problem) {
      if (problem.fields && Object.keys(problem.fields).length > 0) {
        showFieldErrors(form, problem.fields);
      } else {
        announceProblem(problemCopy(problem, "", ""));
      }
      return;
    }
    announceUpdate(`Orchard ${orchardName} saved.`);
    state.selectedOrchardId = orchardId;
    state.selectedOrderId = null;
    state.selectedBlockId = null;
    dialog.close();
    opener.focus();
    await refreshDesk(state, view);
  });
}

/** Dialog "New order": bloom dates, delivery deadline and hives per block. */
export function openNewOrderDialog(state: DeskState, opener: HTMLButtonElement, view: DeskView): void {
  const orchardSelect = h("select", { "data-field": "orchard_id", id: "order-orchard" });
  for (const orchard of state.orchards) {
    orchardSelect.append(h("option", { value: orchard.id, text: orchard.name }));
  }
  const bloomStart = h("input", { type: "date", "data-field": "bloom_start", id: "order-bloom-start" });
  const bloomEnd = h("input", { type: "date", "data-field": "bloom_end", id: "order-bloom-end" });
  const deadline = h("input", { type: "date", "data-field": "delivery_deadline", id: "order-deadline" });
  const submit = h("button", { type: "submit", class: "primary", text: "Save draft" });
  const blocksArea = h("div", { class: "block-inputs" });
  const renderBlocks = (): void => {
    clear(blocksArea);
    const orchard = state.orchards.find((entry) => entry.id === orchardSelect.value);
    (orchard?.blocks ?? []).forEach((block, index) => {
      blocksArea.append(h("div", { class: "field" },
        h("label", {},
          `Hives, ${block.name}`,
          h("input", { type: "number", "data-field": `blocks.${index}.hives`, min: "1", max: "2000", step: "1", value: String(Math.round(block.acres * 2)) }),
        ),
      ));
    });
  };
  renderBlocks();
  orchardSelect.addEventListener("change", renderBlocks);
  const form = h("form", { novalidate: "" },
    h("h2", { text: "New order" }),
    h("div", { class: "field" }, h("label", { for: "order-orchard", text: "Orchard" }), orchardSelect),
    h("div", { class: "field" }, h("label", { for: "order-bloom-start", text: "Bloom start" }), bloomStart),
    h("div", { class: "field" }, h("label", { for: "order-bloom-end", text: "Bloom end" }), bloomEnd),
    h("div", { class: "field" }, h("label", { for: "order-deadline", text: "Delivery deadline" }), deadline),
    blocksArea,
    h("div", { class: "dialog-actions" }, submit),
  );
  let draftOrderId = "";
  const dialog = openDialog({ label: "New order", content: [form], opener });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const orchard = state.orchards.find((entry) => entry.id === orchardSelect.value);
    const blocks = (orchard?.blocks ?? []).map((block, index) => ({
      block_id: block.id,
      hives: Number((form.querySelector(`[data-field="blocks.${index}.hives"]`) as HTMLInputElement)?.value ?? "0"),
    }));
    let ref = "draft";
    const problem = await runAction(submit, "Saving draft order…", null, async () => {
      const response = await api<{ id: string; ref: string }>("/api/orders", {
        method: "POST",
        body: {
          orchard_id: orchardSelect.value,
          bloom_start: bloomStart.value,
          bloom_end: bloomEnd.value,
          delivery_deadline: deadline.value,
          blocks,
        },
      });
      ref = response.body.ref;
      draftOrderId = response.body.id;
    });
    if (problem) {
      if (problem.fields && Object.keys(problem.fields).length > 0) {
        showFieldErrors(form, problem.fields);
      } else {
        announceProblem(problemCopy(problem, "", ""));
      }
      return;
    }
    announceUpdate(`Draft order ${ref} saved.`);
    state.selectedOrchardId = orchardSelect.value;
    state.selectedOrderId = draftOrderId;
    state.selectedBlockId = null;
    dialog.close();
    opener.focus();
    await refreshDesk(state, view);
  });
}

/** "Open order" invoices the deposit. */
export async function runOrderAction(state: DeskState, order: Order, opener: HTMLButtonElement, view: DeskView): Promise<void> {
  const problem = await runAction(opener, `Opening ${order.ref}…`, null, async () => {
    await api(`/api/orders/${order.id}/open`, { method: "POST", body: {} });
  });
  if (problem) {
    if (problem.status === 503) {
      announceProblem(`Billing is unreachable, so ${order.ref} is still a draft. Try again in a minute.`);
    } else {
      announceProblem(problemCopy(problem, order.ref, order.status));
    }
    return;
  }
  announceUpdate(`${order.ref} is open to beekeepers. Deposit invoice recorded.`);
  await refreshDesk(state, view);
}

/** "Cancel order" asks for confirmation and voids the deposit. */
export async function runCancelOrder(state: DeskState, order: Order, opener: HTMLButtonElement, view: DeskView): Promise<void> {
  const form = h("form", { novalidate: "" },
    h("h2", { text: `Cancel ${order.ref}?` }),
    h("p", { text: "Cancelling voids the order's deposit invoice." }),
    h("div", { class: "dialog-actions" },
      h("button", { type: "submit", text: `Cancel order ${order.ref}` }),
      h("button", { type: "button", text: "Keep order", class: "dialog-close" }),
    ),
  );
  const dialog = openDialog({ label: "Cancel order", content: [form], opener });
  form.querySelector(".dialog-close")?.addEventListener("click", () => dialog.close());
  const confirm = form.querySelector("button[type=submit]") as HTMLButtonElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const problem = await runAction(confirm, `Cancelling ${order.ref}…`, null, async () => {
      await api(`/api/orders/${order.id}/cancel`, { method: "POST", body: {} });
    });
    if (problem) {
      if (problem.code === "drops_delivered") {
        announceProblem(`${order.ref} has delivered drops and can't be cancelled.`);
      } else if (problem.status === 503) {
        announceProblem(`Billing is unreachable, so ${order.ref} is not cancelled. Try again in a minute.`);
      } else {
        announceProblem(problemCopy(problem, order.ref, order.status));
      }
      return;
    }
    announceUpdate(`${order.ref} cancelled. Its deposit invoice is void.`);
    dialog.close();
    opener.focus();
    await refreshDesk(state, view);
  });
}

/** "Mark placed" confirms to the grower. */
export async function runPlaceOrder(state: DeskState, order: Order, opener: HTMLButtonElement, view: DeskView): Promise<void> {
  const problem = await runAction(opener, `Marking ${order.ref} placed…`, null, async () => {
    await api(`/api/orders/${order.id}/place`, { method: "POST", body: {} });
  });
  if (problem) {
    if (problem.code === "drops_not_delivered") {
      announceProblem(`Every drop on ${order.ref} must be delivered first.`);
    } else {
      announceProblem(problemCopy(problem, order.ref, order.status));
    }
    return;
  }
  announceUpdate(`${order.ref} placed. The grower's placement confirmation is on its way.`);
  await refreshDesk(state, view);
}

/** Dialog "Send inspection link". */
export function openLinkDialog(state: DeskState, order: Order, opener: HTMLButtonElement, view: DeskView): void {
  const email = h("input", { type: "email", "data-field": "inspector_email", id: "inspector-email" });
  const submit = h("button", { type: "submit", class: "primary", text: "Send link" });
  const form = h("form", { novalidate: "" },
    h("h2", { text: "Send inspection link" }),
    h("div", { class: "field" }, h("label", { for: "inspector-email", text: "Inspector email" }), email),
    h("div", { class: "dialog-actions" }, submit),
  );
  const dialog = openDialog({ label: "Send inspection link", content: [form], opener });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const problem = await runAction(submit, "Sending inspection link…", null, async () => {
      await api(`/api/orders/${order.id}/inspection-links`, { method: "POST", body: { inspector_email: email.value } });
    });
    if (problem) {
      if (problem.fields && Object.keys(problem.fields).length > 0) {
        showFieldErrors(form, problem.fields);
      } else {
        announceProblem(problemCopy(problem, order.ref, order.status));
      }
      return;
    }
    announceUpdate(`Inspection link for ${order.ref} is on its way to ${email.value}. Any earlier link has stopped working.`);
    dialog.close();
    opener.focus();
    await refreshDesk(state, view);
  });
}

/** Dialog "Settle orchard": the settlement split and the payment date. */
export function openSettleDialog(state: DeskState, order: Order, opener: HTMLButtonElement, view: DeskView): void {
  const paymentDate = h("input", { type: "date", "data-field": "payment_received_on", id: "payment-date", value: pacificNow().date });
  const splitArea = h("div", { class: "split" });
  const submit = h("button", { type: "submit", class: "primary", text: "Settle" });
  const form = h("form", { novalidate: "" },
    h("h2", { text: "Settle orchard" }),
    splitArea,
    h("div", { class: "field" }, h("label", { for: "payment-date", text: "Payment received" }), paymentDate),
    h("div", { class: "dialog-actions" }, submit),
  );
  const dialog = openDialog({ label: "Settle orchard", content: [form], opener });
  void api<Settlement>(`/api/orders/${order.id}/settlement`).then((response) => {
    const settlement = response.body;
    const table = h("table", { class: "responsive", "aria-label": "Settlement split" });
    table.append(h("thead", {}, h("tr", {},
      ...["Beekeeper", "Hives", "Gross", "Payout"].map((label) => h("th", { scope: "col", text: label })))));
    const body = h("tbody");
    for (const share of settlement.shares) {
      body.append(h("tr", {},
        h("td", { "data-label": "Beekeeper", text: share.beekeeper.name }),
        h("td", { class: "num", "data-label": "Hives", text: String(share.hives) }),
        h("td", { class: "num", "data-label": "Gross", text: formatMoney(share.gross_cents) }),
        h("td", { class: "num", "data-label": "Payout", text: formatMoney(share.payout_cents) }),
      ));
    }
    body.append(h("tr", {},
      h("td", { "data-label": "Beekeeper", text: "Broker commission" }),
      h("td", { class: "num", "data-label": "Hives", text: "—" }),
      h("td", { class: "num", "data-label": "Gross", text: formatMoney(settlement.payable_cents) }),
      h("td", { class: "num", "data-label": "Payout", text: formatMoney(settlement.commission_cents) }),
    ));
    table.append(body);
    splitArea.append(table, h("p", { class: "num", text: `Orchard payable: ${formatMoney(settlement.payable_cents)}` }));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const key = `settle-${crypto.randomUUID()}`;
    const problem = await runAction(submit, `Settling ${order.orchard.name}…`, null, async () => {
      const response = await api<{ status: string }>(`/api/orders/${order.id}/settle`, {
        method: "POST",
        idempotencyKey: key,
        body: { payment_received_on: paymentDate.value },
      });
      return response.body;
    });
    if (problem) {
      if (problem.fields && Object.keys(problem.fields).length > 0) {
        showFieldErrors(form, problem.fields);
      } else if (problem.code === "drops_not_accepted") {
        announceProblem(`Every drop must be accepted before ${order.orchard.name} can be settled.`);
      } else {
        announceProblem(problemCopy(problem, order.ref, order.status));
      }
      return;
    }
    const settlementResponse = await api<Settlement>(`/api/orders/${order.id}/settlement`);
    if (settlementResponse.body.status === "settled") {
      announceUpdate(`${order.orchard.name} settled.`);
    } else {
      announceUpdate("Settlement queued: billing is unreachable. It will finish on its own when billing returns.");
    }
    dialog.close();
    opener.focus();
    await refreshDesk(state, view);
  });
}
