// The contract sheet: the register catalogue entry page with the 3D model,
// terms, invoice, ledger, history, condition checks, the Buyout Rail and
// every owner action (DP-15, DP-17, DP-20, DP-22, DP-36, DP-56, DP-73).
import { api, ApiError } from "../api.js";
import { h, statusRegion, focusStatus, clearChildren } from "../ui/dom.js";
import { openDialog } from "../ui/dialog.js";
import { formatMoney, formatTaxPercent, formatDateShort, formatDateTime, parseCents } from "../format.js";
import { navigate, type RenderContext } from "../router.js";
import { createDrawing } from "../components/model.js";
import { createRail } from "../components/rail.js";
import { animateValue, prefersReducedMotion } from "../ui/motion.js";
import { SIZES_BY_TYPE, SIZE_ORDER, visibleSize, type InstrumentType, type Quote, type Size, type Tier } from "../../shared/domain.js";

interface ContractBody {
  id: string;
  status: string;
  student: { id: string; name: string; grade: number } | null;
  school: { id: string; name: string } | null;
  family_id: string;
  instrument: { serial: string; instrument_type: string; size: string; model: string; label: string };
  waiver: boolean;
  terms: {
    price_list_id: string | null;
    bound: boolean;
    base_rent_cents: number;
    waiver_cents: number;
    purchase_price_cents: number;
    tax_rate_bp: number;
    term_months: number;
    tiers: Tier[];
  };
  equity_cents: number;
  contract_month: number;
  delivery_date: string;
  hold_expires_at: string | null;
  signing_link: { status: string; expires_at: string | null };
  agreement_stored: boolean;
  bill_of_sale_stored: boolean;
  subscription_state: string | null;
  signed_at: string | null;
  activated_at: string | null;
  closed_at: string | null;
  billing_anchor_date: string | null;
  next_billing_date: string | null;
  predecessor_id: string | null;
  successor_id: string | null;
  history: { from: string | null; to: string; at: string; actor: string; actor_name: string | null }[];
}

interface InvoiceBody {
  invoice: {
    price_list_id: string;
    billing_date: string | null;
    upcoming_billing_dates: string[];
    tax_rate_bp: number;
    lines: { code: string; label: string; amount_cents: number }[];
    total_cents: number;
  };
}

interface EquityBody {
  equity_cents: number;
  purchase_price_cents: number;
  contract_month: number;
  closed: boolean;
  entries: {
    id: string;
    kind: string;
    amount_cents: number;
    transfer_id: string | null;
    payment_id: string | null;
    reversed: boolean | null;
    created_at: string | null;
    payment_amount_cents?: number;
    payment_base_cents?: number;
  }[];
}

const KIND_WORDS: Record<string, string> = {
  opening: "Opening balance",
  payment: "Payment",
  reversal: "Reversal of",
  exchange_out: "Exchange out to",
  exchange_in: "Exchange in from",
  buyout: "Buyout",
};

const STATUS_WORDS: Record<string, string> = {
  reserved: "Reserved",
  agreement_sent: "Agreement sent",
  signed: "Signed",
  active: "Active",
  paid_off: "Owned",
  exchanged: "Exchanged",
  returned: "Returned",
  written_off: "Written off",
  expired: "Expired",
};

export async function renderContractSheet(ctx: RenderContext): Promise<void> {
  const contractId = ctx.path.split("/contracts/")[1]?.split("?")[0] ?? "";
  const status = statusRegion("Contract status");
  const sheet = h("div", { class: "contract-sheet" });

  async function load(contract: ContractBody): Promise<void> {
    clearChildren(sheet);
    const isOwner = ctx.user!.role === "owner";
    const isTech = ctx.user!.role === "tech";

    // The header: the contract id, instrument label, serial, student, school
    // and status.
    const header = h("div", { class: "contract-header", role: "group", "aria-label": "Contract header" });
    header.appendChild(h("h1", { class: "contract-heading", text: `${contract.id} · ${contract.instrument.label} ${contract.instrument.serial}` }));
    header.appendChild(
      h("p", { class: "contract-subline" },
        `${contract.student?.name ?? "—"} · ${contract.school?.name ?? "—"} · ${STATUS_WORDS[contract.status] ?? contract.status}`)
    );
    sheet.appendChild(header);

    const layout = h("div", { class: "contract-layout" });
    const left = h("div", { class: "contract-left" });
    const right = h("div", { class: "contract-right" });
    layout.append(left, right);

    // The drawing group: the turnable 3D model with the brass equity gauge.
    const showBrass = !isTech;
    const drawing = createDrawing(contract.instrument.instrument_type, contract.instrument.size, showBrass);
    left.appendChild(drawing.group);

    if (isTech) {
      // The tech's sheet: only the header, the model without its brass band
      // and gauge, the condition history and Record condition.
      right.appendChild(await conditionArea(contract));
      sheet.append(layout);
      const techActions = h("div", { class: "actions-bar" });
      if (["signed", "active", "exchanged", "returned"].includes(contract.status)) {
        techActions.appendChild(h("button", {
          class: "btn btn-secondary",
          text: "Record condition",
          onclick: (event: MouseEvent) => recordCondition(event.currentTarget as HTMLElement, contract, status, reload),
        }));
      }
      sheet.append(status, techActions);
      attachRowGrow(header);
      return;
    }

    // 1. The terms.
    const termsRegion = h("section", { class: "sheet-region", role: "region", "aria-label": "Terms" });
    termsRegion.appendChild(h("h2", { class: "region-heading", text: "Terms" }));
    const termsList = h("dl", { class: "terms-list" });
    const addTerm = (label: string, value: string): void => {
      termsList.appendChild(h("dt", { class: "field-label", text: label }));
      termsList.appendChild(h("dd", { class: "mono", text: value }));
    };
    addTerm("Price list", contract.terms.price_list_id ?? "—");
    addTerm("Monthly rent", formatMoney(contract.terms.base_rent_cents));
    addTerm("Waiver", contract.waiver ? formatMoney(contract.terms.waiver_cents) : "—");
    addTerm("Sales tax today", formatTaxPercent(contract.terms.tax_rate_bp));
    addTerm("Purchase price", formatMoney(contract.terms.purchase_price_cents));
    addTerm("Term", `${contract.terms.term_months} months`);
    if (contract.status === "active" && contract.billing_anchor_date) {
      addTerm("Billing anchor", formatDateShort(contract.billing_anchor_date));
    }
    if (contract.status === "active" && contract.next_billing_date) {
      addTerm("Next billing", formatDateShort(contract.next_billing_date));
    }
    for (const tier of contract.terms.tiers) {
      addTerm(tier.name, tier.label);
    }
    termsRegion.appendChild(termsList);
    right.appendChild(termsRegion);

    // 2. The monthly invoice.
    const invoiceArea = h("section", { class: "sheet-region" });
    right.appendChild(invoiceArea);
    let invoiceBody: InvoiceBody | null = null;
    try {
      invoiceBody = await api<InvoiceBody>("GET", `/api/contracts/${contract.id}/invoice`);
      invoiceArea.appendChild(buildInvoiceTable(invoiceBody, contract.status));
    } catch {
      invoiceArea.appendChild(h("p", { class: "muted", text: "Invoice unavailable." }));
    }

    // 3. The equity ledger.
    const ledgerArea = h("section", { class: "sheet-region" });
    right.appendChild(ledgerArea);
    let equityBody: EquityBody | null = null;
    try {
      equityBody = await api<EquityBody>(`GET`, `/api/contracts/${contract.id}/equity`);
      ledgerArea.appendChild(buildLedgerTable(equityBody, isOwner, contract, status, reload));
    } catch {
      ledgerArea.appendChild(h("p", { class: "muted", text: "Ledger unavailable." }));
    }

    // 4. The agreement PDF, and the bill of sale on a paid-off contract.
    const documentsArea = h("section", { class: "sheet-region document-links" });
    if (contract.agreement_stored || contract.signed_at) {
      documentsArea.appendChild(
        h("a", { class: "document-link", href: `/api/contracts/${contract.id}/agreement.pdf`, target: "_blank", rel: "noopener", text: "Signed agreement (PDF)" })
      );
    }
    if (contract.bill_of_sale_stored) {
      documentsArea.appendChild(
        h("a", { class: "document-link", href: `/api/contracts/${contract.id}/bill-of-sale.pdf`, target: "_blank", rel: "noopener", text: "Bill of sale (PDF)" })
      );
    }
    right.appendChild(documentsArea);

    // 5. The contract history.
    const historyArea = h("section", { class: "sheet-region" });
    historyArea.appendChild(h("h2", { class: "region-heading", text: "Contract history" }));
    const historyList = h("ul", { class: "contract-history", "aria-label": "Contract history" });
    for (const entry of contract.history) {
      const from = entry.from ?? "new";
      const actor = entry.actor === "system" ? "System" : entry.actor_name ?? "Keel & Bell";
      historyList.appendChild(h("li", { class: "history-line", text: `${formatDateTime(entry.at)} · ${from} → ${entry.to} · ${actor}` }));
    }
    historyArea.appendChild(historyList);
    right.appendChild(historyArea);

    // 6. The condition history.
    right.appendChild(await conditionArea(contract));

    sheet.appendChild(layout);

    // The owner's actions, each shown only where it is legal.
    const actionsBar = h("div", { class: "actions-bar" });
    if (isOwner) {
      if (contract.status === "reserved" || contract.status === "agreement_sent") {
        actionsBar.appendChild(h("button", {
          class: "btn btn-primary",
          text: "Send signing link",
          onclick: (event: MouseEvent) => sendSigningLink(event.currentTarget as HTMLElement, contract, status, reload),
        }));
        if (contract.signing_link.status === "live") {
          actionsBar.appendChild(h("button", {
            class: "btn btn-secondary",
            text: "Revoke signing link",
            onclick: (event: MouseEvent) => revokeSigningLink(event.currentTarget as HTMLElement, contract, status, reload),
          }));
        }
      }
      if (contract.status === "signed") {
        const activate = h("button", {
          class: "btn btn-primary",
          text: "Activate contract",
          onclick: async (event: MouseEvent) => {
            const button = event.currentTarget as HTMLElement;
            button.setAttribute("disabled", "true");
            status.textContent = "Activating…";
            try {
              await api("POST", `/api/contracts/${contract.id}/activate`, {});
              await reload();
              status.textContent = "Contract active. Monthly billing is set up.";
              focusStatus("Contract status");
            } catch (err) {
              button.removeAttribute("disabled");
              status.textContent = ownerErrorCopy(err, "activate");
              focusStatus("Contract status");
            }
          },
        });
        actionsBar.appendChild(activate);
      }
      if (contract.status === "active") {
        actionsBar.append(
          h("button", {
            class: "btn btn-primary",
            text: "Record payment",
            onclick: (event: MouseEvent) => recordPayment(event.currentTarget as HTMLElement, contract, status, reload),
          }),
          h("button", {
            class: "btn btn-secondary",
            text: "Exchange size",
            onclick: (event: MouseEvent) => exchangeSize(event.currentTarget as HTMLElement, contract, status),
          }),
          h("button", {
            class: "btn btn-secondary",
            text: "Mark returned",
            onclick: (event: MouseEvent) => confirmClose(event.currentTarget as HTMLElement, contract, "returned", status, reload),
          }),
          h("button", {
            class: "btn btn-danger",
            text: "Write off",
            onclick: (event: MouseEvent) => confirmClose(event.currentTarget as HTMLElement, contract, "written_off", status, reload),
          })
        );
      }
      if (contract.status === "signed" || contract.status === "active") {
        actionsBar.appendChild(h("button", {
          class: "btn btn-secondary",
          text: "Record condition",
          onclick: (event: MouseEvent) => recordCondition(event.currentTarget as HTMLElement, contract, status, reload),
        }));
      }
    } else if (["signed", "active", "exchanged", "returned"].includes(contract.status)) {
      actionsBar.appendChild(h("button", {
        class: "btn btn-secondary",
        text: "Record condition",
        onclick: (event: MouseEvent) => recordCondition(event.currentTarget as HTMLElement, contract, status, reload),
      }));
    }
    sheet.appendChild(status);
    sheet.appendChild(actionsBar);

    // The Buyout Rail on signed and active contracts; the word Owned and a
    // full gauge on a paid-off contract.
    if (contract.status === "signed" || contract.status === "active") {
      let quotes: Quote[] = [];
      try {
        quotes = (await api<{ quotes: Quote[] }>("GET", `/api/contracts/${contract.id}/quotes`)).quotes;
      } catch {
        status.textContent = "Couldn't load the payoff schedule. Reload to try again.";
      }
      const quotesOk = quotes.length > 0;

      const railRegion = h("div", { class: "rail-wrap" });
      const buyoutBar = h("div", { class: "buyout-bar" });
      const urlMonth = Number(ctx.query.get("month"));
      const startMonth = Number.isInteger(urlMonth) && urlMonth >= 0 && urlMonth <= contract.terms.term_months
        ? urlMonth
        : contract.contract_month;
      const rail = createRail({
        termMonths: contract.terms.term_months,
        currentMonth: startMonth,
        quotes,
        disabled: !quotesOk,
        reducedTable: (current: number) => buildReducedTable(quotes, current),
        onRelease: (m: number) => {
          const quote = quotes[m];
          if (!quote) return;
          status.textContent = `Month ${m} payoff ${formatMoney(quote.payoff_cents)}. Quote valid until ${formatDateShort(quote.valid_until)}.`;
          updateBuyoutButton(quotes[contract.contract_month]);
          // The URL query becomes ?month=N without a history entry.
          const url = new URL(window.location.href);
          url.searchParams.set("month", String(m));
          history.replaceState(null, "", url.pathname + (url.search || ""));
        },
      });
      void rail;
      railRegion.appendChild(rail.region);

      const updateDrawing = (m: number): void => {
        const quote = quotes[m];
        if (quote) {
          drawing.setEquityFraction(quote.equity_cents / contract.terms.purchase_price_cents);
        }
      };
      const syncDrawing = (): void => {
        const m = Number((rail.region.querySelector("input") as HTMLInputElement).value);
        updateDrawing(m);
      };
      rail.region.querySelector("input")?.addEventListener("input", syncDrawing);
      const buyButton = h("button", {
        class: "btn btn-primary buyout-button",
        text: "Buy out",
      });
      const updateBuyoutButton = (quote: Quote | undefined): void => {
        if (!quote) return;
        buyButton.textContent = `Buy out for ${formatMoney(quote.total_cents)}`;
      };
      updateBuyoutButton(quotes[contract.contract_month]);
      buyButton.addEventListener("click", () => {
        confirmBuyout(buyButton, contract, quotes[contract.contract_month], status, reload);
      });
      buyoutBar.appendChild(buyButton);
      sheet.append(railRegion, buyoutBar);
      rail.setQuotes(quotes, contract.contract_month);
      updateDrawing(startMonth);
      drawing.setEquityFraction(quotes[startMonth]?.equity_cents ?? 0 / Math.max(1, contract.terms.purchase_price_cents));
    } else if (contract.status === "paid_off") {
      drawing.setEquityFraction(1);
      const owned = h("p", { class: "owned-mark", text: "Owned" });
      sheet.appendChild(owned);
    } else {
      drawing.setEquityFraction(contract.terms.purchase_price_cents > 0 ? contract.equity_cents / contract.terms.purchase_price_cents : 0);
    }

    attachRowGrow(header);
  }

  function attachRowGrow(header: HTMLElement): void {
    // When the sheet opens from the register, the header is painted first at
    // the box of the register entry that was chosen, and reaches its own
    // resting box between 350 and 500 milliseconds later. A direct load shows
    // the header at rest at once.
    const source = sessionStorage.getItem("bellroll:row-rect");
    sessionStorage.removeItem("bellroll:row-rect");
    if (!source || prefersReducedMotion()) return;
    try {
      const rect = JSON.parse(source) as { left: number; top: number; width: number; height: number };
      const targetBox = header.getBoundingClientRect();
      const dx = rect.left - targetBox.left;
      const dy = rect.top - targetBox.top;
      header.style.transformOrigin = "top left";
      header.style.transform = `translate(${dx}px, ${dy}px)`;
      animateValue(
        header,
        { from: { transform: `translate(${dx}px, ${dy}px)` }, to: { transform: "translate(0px, 0px)" } },
        "medium"
      );
    } catch {
      // A malformed rect shows the header at rest at once.
    }
  }

  async function reload(): Promise<void> {
    try {
      const data = await api<{ contract: ContractBody }>("GET", `/api/contracts/${encodeURIComponent(contractId)}`);
      await load(data.contract);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        renderNotFound(ctx);
        return;
      }
      status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
    }
  }

  ctx.root.appendChild(sheet);
  try {
    const data = await api<{ contract: ContractBody }>("GET", `/api/contracts/${encodeURIComponent(contractId)}`);
    await load(data.contract);
    if (pendingStatusCopy) {
      status.textContent = pendingStatusCopy;
      pendingStatusCopy = null;
      focusStatus("Contract status");
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      renderNotFound(ctx);
      return;
    }
    status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
    ctx.root.appendChild(status);
  }
}

function renderNotFound(ctx: RenderContext): void {
  const root = ctx.root.parentElement ?? document.body;
  const main = ctx.root;
  clearChildren(main);
  main.appendChild(h("h1", { text: "Contract not found" }));
  const link = ctx.user?.role === "parent"
    ? h("a", { class: "btn btn-secondary", href: "/family", text: "My family" })
    : h("a", { class: "btn btn-secondary", href: "/register", text: "Back to the register" });
  main.appendChild(link);
  void root;
}

function buildInvoiceTable(invoiceBody: InvoiceBody, status: string): HTMLElement {
  const invoice = invoiceBody.invoice;
  const caption = invoice.billing_date && status === "active"
    ? `Due ${formatDateShort(invoice.billing_date)}`
    : "Not billing";
  const table = h("table", { class: "sheet-table invoice-table", "aria-label": "Monthly invoice" });
  const captionEl = h("caption", { text: caption });
  table.appendChild(captionEl);
  const head = h("thead", {}, h("tr", {},
    h("th", { scope: "col", text: "Line" }),
    h("th", { scope: "col", text: "Amount" })
  ));
  table.appendChild(head);
  const body = h("tbody", {});
  let total = 0;
  for (const line of invoice.lines) {
    total += line.amount_cents;
    body.appendChild(h("tr", {},
      h("td", { text: line.label }),
      h("td", { class: "mono brass-cell", text: line.code === "base_rent" ? formatMoney(line.amount_cents) : formatMoney(line.amount_cents) })
    ));
  }
  body.appendChild(h("tr", { class: "invoice-total" },
    h("td", { text: "Total" }),
    h("td", { class: "mono", text: formatMoney(total) })
  ));
  table.appendChild(body);
  void invoice.total_cents;
  return table;
}

function buildLedgerTable(
  equityBody: EquityBody,
  isOwner: boolean,
  contract: ContractBody,
  status: HTMLElement,
  reload: () => Promise<void>
): HTMLElement {
  const table = h("table", { class: "sheet-table ledger-table", "aria-label": "Equity ledger" });
  table.appendChild(h("thead", {}, h("tr", {},
    h("th", { scope: "col", text: "Date" }),
    h("th", { scope: "col", text: "Entry" }),
    h("th", { scope: "col", text: "Amount" }),
    h("th", { scope: "col", text: "Equity after" })
  )));
  const body = h("tbody", {});
  let running = 0;
  for (const entry of equityBody.entries) {
    running += entry.amount_cents;
    let entryText = KIND_WORDS[entry.kind] ?? entry.kind;
    if (entry.transfer_id) {
      if (entry.kind === "exchange_out") entryText = `Exchange out to ${contract.successor_id ?? ""}`;
      if (entry.kind === "exchange_in") entryText = `Exchange in from ${contract.predecessor_id ?? ""}`;
    }
    if (entry.kind === "payment" && entry.payment_id) entryText = `Payment ${entry.payment_id}`;
    if (entry.kind === "reversal" && entry.payment_id) entryText = `Reversal of ${entry.payment_id}`;
    if (entry.reversed) entryText += " (reversed)";
    const row = h("tr", { class: entry.kind === "reversal" ? "ledger-reversal-row" : "" },
      h("td", { class: "mono", text: entry.created_at ? formatDateTime(entry.created_at) : "—" }),
      h("td", { text: entryText }),
      h("td", { class: `mono ${entry.amount_cents < 0 ? "minus-amount" : ""}`, text: formatMoney(entry.amount_cents) }),
      h("td", { class: "mono brass-cell", text: formatMoney(running) })
    );
    // The owner's Reverse buttons sit on unreversed payment rows.
    if (isOwner && entry.kind === "payment" && entry.payment_id && !entry.reversed && contract.status === "active") {
      const actionsCell = h("td", { class: "ledger-actions" });
      actionsCell.appendChild(h("button", {
        class: "btn btn-danger btn-small",
        text: `Reverse ${entry.payment_id}`,
        onclick: (event: MouseEvent) => reversePayment(event.currentTarget as HTMLElement, contract, entry.payment_id!, (entry as { payment_amount_cents?: number }).payment_amount_cents ?? entry.amount_cents, (entry as { payment_base_cents?: number }).payment_base_cents ?? entry.amount_cents, status, reload),
      }));
      row.appendChild(actionsCell);
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  return table;
}

async function conditionArea(contract: ContractBody): Promise<HTMLElement> {
  const area = h("section", { class: "sheet-region" });
  area.appendChild(h("h2", { class: "region-heading", text: "Condition history" }));
  const list = h("ul", { class: "condition-history", "aria-label": "Condition history" });
  try {
    const data = await api<{
      events: {
        id: string;
        kind: string;
        notes: string | null;
        recorded_by: string;
        created_at: string;
        photos: { id: string; url: string }[];
      }[];
    }>("GET", `/api/contracts/${contract.id}/condition-events`);
    for (const event of data.events) {
      const item = h("li", { class: "condition-line" });
      const head = h("div", { class: "condition-line-head" },
        h("span", { class: "mono", text: formatDateTime(event.created_at) }),
        h("span", { text: ` · ${kindWord(event.kind)} · ${event.recorded_by}` })
      );
      item.appendChild(head);
      if (event.notes) item.appendChild(h("p", { class: "muted", text: event.notes }));
      for (const photo of event.photos) {
        item.appendChild(h("a", { class: "condition-photo-link", href: photo.url, target: "_blank", rel: "noopener", text: "Photo" }));
      }
      list.appendChild(item);
    }
  } catch {
    list.appendChild(h("li", { class: "muted", text: "Condition history unavailable." }));
  }
  area.appendChild(list);
  return area;
}

async function familyEmailFor(familyId: string): Promise<string> {
  try {
    const data = await api<{ families: { id: string; email: string }[] }>("GET", "/api/families");
    return data.families.find((f) => f.id === familyId)?.email ?? "the family";
  } catch {
    return "the family";
  }
}

// A status message the next sheet shows after a move like an exchange.
let pendingStatusCopy: string | null = null;
export function setPendingStatus(copy: string): void {
  pendingStatusCopy = copy;
}

function kindWord(kind: string): string {
  const words: Record<string, string> = {
    checkout: "Check-out",
    exchange: "Exchange",
    return: "Return",
  };
  return words[kind] ?? kind;
}

function buildReducedTable(quotes: Quote[], currentMonth: number): HTMLElement {
  const table = h("table", { class: "sheet-table buyout-schedule", "aria-label": "Buyout schedule" });
  table.appendChild(h("thead", {}, h("tr", {},
    h("th", { scope: "col", text: "Month" }),
    h("th", { scope: "col", text: "Equity" }),
    h("th", { scope: "col", text: "Tier" }),
    h("th", { scope: "col", text: "Payoff" })
  )));
  const body = h("tbody", {});
  for (const quote of quotes) {
    const now = quote.month === currentMonth ? " (now)" : "";
    body.appendChild(h("tr", { class: quote.month === currentMonth ? "schedule-now" : "" },
      h("td", { class: "mono", text: `${quote.month}${now}` }),
      h("td", { class: "mono", text: formatMoney(quote.equity_cents) }),
      h("td", { text: quote.tier.label }),
      h("td", { class: "mono", text: formatMoney(quote.payoff_cents) })
    ));
  }
  table.appendChild(body);
  return table;
}

function ownerErrorCopy(err: unknown, action: string): string {
  if (!(err instanceof ApiError)) {
    return "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
  }
  const map: Record<string, Record<string, string>> = {
    activate: {
      invalid_transition: "This contract can't be activated now.",
      agreement_not_stored: "The signed agreement isn't stored yet.",
      billing_unavailable: "Billing is unreachable. The contract is still signed; try again in a moment.",
      storage_unavailable: "File storage is unreachable. The contract is still signed; try again in a moment.",
    },
  };
  const specific = map[action]?.[err.code];
  return specific ?? "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
}

function sendSigningLink(opener: HTMLElement, contract: ContractBody, status: HTMLElement, reload: () => Promise<void>): void {
  openDialog({
    name: "Send signing link",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Send signing link" }));
      body.appendChild(h("p", { text: `Email a signing link to the family of ${contract.student?.name ?? ""}.` }));
      const send = h("button", {
        class: "btn btn-primary",
        text: "Send signing link",
        onclick: async () => {
          send.disabled = true;
          status.textContent = "Sending…";
          try {
            const result = await api<{ contract: ContractBody }>("POST", `/api/contracts/${contract.id}/signing-link`, {});
            close();
            await reload();
            const expires = result.contract.signing_link.expires_at;
            const email = await familyEmailFor(contract.family_id);
            status.textContent = `Signing link queued for ${email}. It works until ${formatDateTime(expires)}.`;
            focusStatus("Contract status");
          } catch (err) {
            send.disabled = false;
            close();
            status.textContent = err instanceof ApiError && err.status === 409
              ? "This contract can't be sent for signing now."
              : "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
            focusStatus("Contract status");
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.appendChild(h("div", { class: "dialog-actions" }, cancel, send));
    },
  });
}

function revokeSigningLink(opener: HTMLElement, contract: ContractBody, status: HTMLElement, reload: () => Promise<void>): void {
  void opener;
  openDialog({
    name: "Revoke signing link",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Revoke signing link" }));
      body.appendChild(h("p", { text: "The family's live signing link stops working. You can send a new one." }));
      const confirm = h("button", {
        class: "btn btn-danger",
        text: "Revoke signing link",
        onclick: async () => {
          confirm.disabled = true;
          status.textContent = "Revoking…";
          try {
            await api("POST", `/api/contracts/${contract.id}/signing-link/revoke`, {});
            close();
            await reload();
            status.textContent = "Signing link revoked.";
            focusStatus("Contract status");
          } catch (err) {
            confirm.disabled = false;
            close();
            status.textContent = err instanceof ApiError && err.code === "no_live_link"
              ? "There is no live signing link to revoke."
              : "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
            focusStatus("Contract status");
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.appendChild(h("div", { class: "dialog-actions" }, cancel, confirm));
    },
  });
}

function recordPayment(opener: HTMLElement, contract: ContractBody, status: HTMLElement, reload: () => Promise<void>): void {
  openDialog({
    name: "Record payment",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Record payment" }));
      const amount = h("input", { class: "input mono", "aria-label": "Amount", placeholder: "58.46", inputmode: "decimal" });
      const amountField = h("label", { class: "field" }, h("span", { class: "field-label", text: "Amount" }), amount);
      amount.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void form.requestSubmit();
        }
      });
      const key = `pay-${contract.id}-${Date.now()}`;
      const form = h("form", {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          const save = form.querySelector("button.btn-primary") as HTMLButtonElement;
          save.disabled = true;
          status.textContent = "Recording payment…";
          const cents = parseCents(amount.value);
          try {
            const result = await api<{
              payment: { id: string; amount_cents: number; base_rent_cents: number; waiver_cents: number; tax_cents: number };
              contract: ContractBody;
            }>("POST", `/api/contracts/${contract.id}/payments`, { amount_cents: cents }, {
              headers: { "Idempotency-Key": key },
            });
            close();
            await reload();
            const p = result.payment;
            let copy = `Payment of ${formatMoney(p.amount_cents)} recorded: ${formatMoney(p.base_rent_cents)} rent toward ownership, ${formatMoney(p.waiver_cents)} waiver, ${formatMoney(p.tax_cents)} tax. Receipt queued for the family.`;
            if (result.contract.status === "paid_off") {
              copy += " The instrument is now owned.";
            }
            status.textContent = copy;
            focusStatus("Contract status");
          } catch (err) {
            save.disabled = false;
            if (err instanceof ApiError && err.status === 422) {
              const fieldMessage = err.fields?.amount_cents;
              status.textContent = fieldMessage === "exceeds_remaining"
                ? "That's more than the remaining balance. Use buyout instead."
                : "Enter an amount above $0.00.";
            } else if (err instanceof ApiError && err.status === 409) {
              status.textContent = err.code === "idempotency_conflict"
                ? "Billing already holds a different charge for this payment. Nothing was recorded."
                : "This contract can't take payments now.";
            } else if (err instanceof ApiError && err.status === 503) {
              status.textContent = err.code === "billing_unavailable"
                ? "Billing is unreachable. Nothing was recorded; try again in a moment."
                : "File storage is unreachable, so this final payment can't close the contract. Nothing was recorded; try again in a moment.";
            } else {
              status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
            }
            focusStatus("Contract status");
          }
        },
      });
      const save = h("button", { class: "btn btn-primary", text: "Save payment", type: "submit" });
      const cancel = h("button", {
        class: "btn btn-secondary",
        text: "Cancel",
        type: "button",
        onclick: close,
      });
      form.append(amountField, h("div", { class: "dialog-actions" }, cancel, save));
      body.appendChild(form);
    },
  });
}

function reversePayment(
  opener: HTMLElement,
  contract: ContractBody,
  paymentId: string,
  paymentAmount: number,
  paymentBase: number,
  status: HTMLElement,
  reload: () => Promise<void>
): void {
  openDialog({
    name: "Reverse payment",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Reverse payment" }));
      body.appendChild(
        h("p", { text: `Refund ${formatMoney(paymentAmount)} and remove ${formatMoney(paymentBase)} of equity from ${contract.id}?` })
      );
      const group = h("fieldset", { class: "radio-group", role: "radiogroup", "aria-label": "Reason" });
      group.appendChild(h("legend", { class: "field-label", text: "Reason" }));
      const reasons = [
        { value: "returned_check", label: "Returned check" },
        { value: "chargeback", label: "Chargeback" },
        { value: "entered_in_error", label: "Entered in error" },
      ];
      let chosen = "returned_check";
      for (const reason of reasons) {
        const id = `reason-${reason.value}`;
        const radio = h("input", { type: "radio", name: "reason", id, value: reason.value, ...(reason.value === chosen ? { checked: true } : {}) });
        radio.addEventListener("change", () => {
          chosen = reason.value;
        });
        group.appendChild(h("label", { class: "radio-label", for: id }, radio, h("span", { text: reason.label })));
      }
      body.appendChild(group);
      const key = `reversal-${paymentId}-${Date.now()}`;
      const confirm = h("button", {
        class: "btn btn-danger",
        text: "Confirm reversal",
        onclick: async () => {
          confirm.disabled = true;
          status.textContent = "Reversing…";
          try {
            const result = await api<{ reversal: { id: string; amount_cents: number; base_rent_cents: number }; contract: ContractBody }>(
              "POST",
              `/api/contracts/${contract.id}/payments/${paymentId}/reversal`,
              { reason: chosen },
              { headers: { "Idempotency-Key": key } }
            );
            close();
            await reload();
            status.textContent = `Payment ${paymentId} reversed: ${formatMoney(result.reversal.amount_cents)} refunded, ${formatMoney(result.reversal.base_rent_cents)} equity removed.`;
            focusStatus("Contract status");
          } catch (err) {
            confirm.disabled = false;
            if (err instanceof ApiError && err.code === "payment_reversed") {
              status.textContent = `Payment ${paymentId} was already reversed.`;
              close();
            } else if (err instanceof ApiError && err.code === "invalid_transition") {
              status.textContent = "Payments can only be reversed on an active contract.";
              close();
            } else if (err instanceof ApiError && err.status === 503) {
              status.textContent = "Billing is unreachable. Nothing was reversed; try again in a moment.";
              close();
            } else {
              status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
            }
            focusStatus("Contract status");
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.appendChild(h("div", { class: "dialog-actions" }, cancel, confirm));
    },
  });
}

function exchangeSize(opener: HTMLElement, contract: ContractBody, status: HTMLElement): void {
  openDialog({
    name: "Exchange size",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Exchange size" }));
      const type = contract.instrument.instrument_type as InstrumentType;
      const sizes = SIZES_BY_TYPE[type];
      const group = h("fieldset", { class: "radio-group", role: "radiogroup", "aria-label": "New size" });
      group.appendChild(h("legend", { class: "field-label", text: "New size" }));
      const radios: { size: Size; radio: HTMLInputElement }[] = [];
      let chosen: Size | null = null;
      const rebuild = async (): Promise<void> => {
        const availability = await api<{ items: { instrument_type: string; size: string; available: number }[] }>("GET", "/api/availability");
        for (const entry of radios) {
          const count = availability.items.find((a) => a.instrument_type === type && a.size === entry.size)?.available ?? 0;
          entry.radio.disabled = count === 0;
          const labelSpan = entry.radio.parentElement?.querySelector("span");
          if (labelSpan) {
            labelSpan.textContent = `${visibleSize(type, entry.size)}, ${count} available`;
          }
        }
      };
      for (const size of sizes) {
        if (SIZE_ORDER[size] <= SIZE_ORDER[contract.instrument.size as Size]) continue;
        const id = `size-${size.replace("/", "-")}`;
        const radio = h("input", { type: "radio", name: "new-size", id, value: size }) as HTMLInputElement;
        radio.addEventListener("change", () => {
          chosen = size;
        });
        const label = h("label", { class: "radio-label", for: id }, radio, h("span", { text: `${visibleSize(type, size)}, 0 available` }));
        group.appendChild(label);
        radios.push({ size, radio });
      }
      body.appendChild(group);
      void rebuild();
      const confirm = h("button", {
        class: "btn btn-primary",
        text: "Confirm exchange",
        onclick: async () => {
          if (!chosen) return;
          confirm.disabled = true;
          status.textContent = "Exchanging…";
          const key = `exchange-${contract.id}-${Date.now()}`;
          try {
            const result = await api<{ old_contract: ContractBody; new_contract: ContractBody; transfer_id: string }>(
              "POST",
              `/api/contracts/${contract.id}/exchange`,
              { size: chosen },
              { headers: { "Idempotency-Key": key } }
            );
            close();
            // The owner lands on the new contract, which carries the equity.
            setPendingStatus(
              `Exchanged to ${result.new_contract.instrument.label} ${result.new_contract.instrument.serial}. ${formatMoney(result.new_contract.equity_cents)} equity moved from ${contract.id}.`
            );
            navigate(`/contracts/${result.new_contract.id}`);
          } catch (err) {
            confirm.disabled = false;
            if (err instanceof ApiError && err.code === "unavailable") {
              status.textContent = "That size is no longer available.";
              await rebuild();
            } else if (err instanceof ApiError && err.status === 503) {
              status.textContent = err.code === "storage_unavailable"
                ? "File storage is unreachable. Nothing was exchanged; try again in a moment."
                : "Billing is unreachable. Nothing was exchanged; try again in a moment.";
              close();
            } else {
              status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
              close();
            }
            focusStatus("Contract status");
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.appendChild(h("div", { class: "dialog-actions" }, cancel, confirm));
    },
  });
}

function confirmClose(
  opener: HTMLElement,
  contract: ContractBody,
  action: "returned" | "written_off",
  status: HTMLElement,
  reload: () => Promise<void>
): void {
  openDialog({
    name: action === "returned" ? "Confirm return" : "Confirm write-off",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: action === "returned" ? "Confirm return" : "Confirm write-off" }));
      body.appendChild(h("p", {
        text: action === "returned"
          ? `Mark ${contract.id} returned? The instrument goes back to the fleet.`
          : `Write off ${contract.id}? The instrument leaves the fleet as retired.`,
      }));
      const confirm = h("button", {
        class: "btn btn-danger",
        text: "Confirm",
        onclick: async () => {
          confirm.disabled = true;
          status.textContent = "Saving…";
          try {
            await api("POST", `/api/contracts/${contract.id}/${action === "returned" ? "return" : "write-off"}`, {});
            close();
            await reload();
            status.textContent = action === "returned" ? "Contract marked returned." : "Contract written off.";
            focusStatus("Contract status");
          } catch (err) {
            confirm.disabled = false;
            close();
            status.textContent = err instanceof ApiError && err.status === 503
              ? "Billing is unreachable or hasn't confirmed the cancellation. Nothing was changed; try again in a moment."
              : "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
            focusStatus("Contract status");
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.appendChild(h("div", { class: "dialog-actions" }, cancel, confirm));
    },
  });
}

function confirmBuyout(
  button: HTMLElement,
  contract: ContractBody,
  quote: Quote | undefined,
  status: HTMLElement,
  reload: () => Promise<void>
): void {
  if (!quote) return;
  openDialog({
    name: "Confirm buyout",
    opener: button,
    build(body, close) {
      body.appendChild(h("h2", { text: "Confirm buyout" }));
      body.appendChild(h("p", {
        text: `Pay ${formatMoney(quote.total_cents)} now (${formatMoney(quote.payoff_cents)} plus ${formatMoney(quote.tax_cents)} tax) and own ${contract.instrument.serial}. ${quote.tier.label} applies.`,
      }));
      const confirm = h("button", {
        class: "btn btn-primary",
        text: "Confirm buyout",
        onclick: async () => {
          confirm.disabled = true;
          status.textContent = "Processing buyout…";
          const key = `buyout-${contract.id}-${Date.now()}`;
          try {
            await api("POST", `/api/contracts/${contract.id}/buyout`, {
              expected_payoff_cents: quote.payoff_cents,
            }, { headers: { "Idempotency-Key": key } });
            close();
            await reload();
            status.textContent = `Bought out for ${formatMoney(quote.total_cents)}. ${contract.student?.name ?? "The student"} owns ${contract.instrument.serial}. Ownership letter queued for the family.`;
            focusStatus("Contract status");
          } catch (err) {
            confirm.disabled = false;
            if (err instanceof ApiError && err.code === "quote_changed") {
              const fresh = err.body.error.quote as Quote | undefined;
              status.textContent = `The payoff is now ${formatMoney(fresh?.total_cents ?? 0)} with tax. Review and confirm again.`;
              if (fresh) {
                button.textContent = `Buy out for ${formatMoney(fresh.total_cents)}`;
              }
              close();
            } else if (err instanceof ApiError && err.code === "invalid_transition") {
              status.textContent = "This contract can't be bought out now.";
              close();
            } else if (err instanceof ApiError && err.status === 503) {
              status.textContent = err.code === "billing_unavailable"
                ? "Billing is unreachable. The contract is unchanged; try again in a moment."
                : "File storage is unreachable. Nothing was charged; the contract is unchanged.";
              close();
            } else {
              status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
              close();
            }
            focusStatus("Contract status");
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.appendChild(h("div", { class: "dialog-actions" }, cancel, confirm));
    },
  });
}

function recordCondition(opener: HTMLElement, contract: ContractBody, status: HTMLElement, reload: () => Promise<void>): void {
  openDialog({
    name: "Record condition",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Record condition" }));
      const group = h("fieldset", { class: "radio-group", role: "radiogroup", "aria-label": "Condition check" });
      group.appendChild(h("legend", { class: "field-label", text: "Condition check" }));
      const kinds = [
        { value: "checkout", label: "Check-out" },
        { value: "exchange", label: "Exchange" },
        { value: "return", label: "Return" },
      ];
      let chosenKind = "checkout";
      for (const kind of kinds) {
        const id = `kind-${kind.value}`;
        const radio = h("input", { type: "radio", name: "condition-kind", id, value: kind.value, checked: kind.value === "checkout" });
        radio.addEventListener("change", () => {
          chosenKind = kind.value;
        });
        group.appendChild(h("label", { class: "radio-label", for: id }, radio, h("span", { text: kind.label })));
      }
      const notes = h("textarea", { class: "input", "aria-label": "Notes", rows: "3" });
      const notesField = h("label", { class: "field" }, h("span", { class: "field-label", text: "Notes" }), notes);
      const fileInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, "aria-label": "Photos" }) as HTMLInputElement;
      const thumbs = h("div", { class: "photo-thumbs" });
      const dialogStatus = statusRegion("Condition status", "status-text dialog-status");
      interface ChosenPhoto { file: File; thumb: HTMLElement; remove: HTMLButtonElement; refused: boolean }
      const chosen: ChosenPhoto[] = [];
      fileInput.addEventListener("change", () => {
        for (const file of Array.from(fileInput.files ?? [])) {
          const remove = h("button", {
            class: "btn btn-small btn-secondary photo-remove",
            text: `Remove ${file.name}`,
            "aria-label": `Remove ${file.name}`,
            onclick: () => {
              const idx = chosen.findIndex((p) => p.file === file);
              if (idx >= 0) {
                chosen[idx].thumb.remove();
                chosen.splice(idx, 1);
                dialogStatus.textContent = "";
              }
            },
          }) as HTMLButtonElement;
          const img = h("img", { class: "photo-thumb", alt: "" }) as HTMLImageElement;
          img.src = URL.createObjectURL(file);
          const thumb = h("div", { class: "photo-thumb-wrap" }, img, remove, h("span", { class: "photo-name", text: file.name }));
          thumbs.appendChild(thumb);
          chosen.push({ file, thumb, remove, refused: false });
        }
        fileInput.value = "";
      });
      const photosField = h("label", { class: "field" }, h("span", { class: "field-label", text: "Photos" }), fileInput);
      const save = h("button", {
        class: "btn btn-primary",
        text: "Save condition",
        onclick: async () => {
          if (chosen.length === 0) {
            dialogStatus.textContent = "Add between 1 and 6 photos.";
            return;
          }
          save.disabled = true;
          dialogStatus.textContent = "Uploading photos…";
          const formData = new FormData();
          formData.append("kind", chosenKind);
          formData.append("notes", notes.value);
          for (const photo of chosen) {
            formData.append("photos", photo.file, photo.file.name);
          }
          try {
            const response = await fetch(`/api/contracts/${contract.id}/condition-events`, {
              method: "POST",
              credentials: "same-origin",
              body: formData,
            });
            if (!response.ok) {
              const errorBody = (await response.json()) as ApiErrorShape;
              const photoIndex = errorBody.error.photo_index;
              const name = photoIndex !== undefined && chosen[photoIndex] ? chosen[photoIndex].file.name : "";
              const code = errorBody.error.code;
              if (code === "unsupported_image") {
                if (photoIndex !== undefined && chosen[photoIndex]) {
                  chosen[photoIndex].refused = true;
                  chosen[photoIndex].thumb.classList.add("photo-refused");
                  const marker = chosen[photoIndex].thumb.querySelector(".photo-refused-mark") ?? h("span", { class: "photo-refused-mark", text: "Not saved" });
                  if (!chosen[photoIndex].thumb.querySelector(".photo-refused-mark")) {
                    chosen[photoIndex].thumb.appendChild(marker);
                  }
                  dialogStatus.textContent = `${name} isn't a JPEG, PNG or WebP photo. Nothing was saved.`;
                  chosen[photoIndex].remove.focus();
                } else {
                  dialogStatus.textContent = "That photo isn't a JPEG, PNG or WebP photo. Nothing was saved.";
                }
              } else if (code === "photo_too_large") {
                dialogStatus.textContent = `${name} is over 5,000,000 bytes. Nothing was saved.`;
                if (photoIndex !== undefined && chosen[photoIndex]) chosen[photoIndex].remove.focus();
              } else if (code === "payload_too_large") {
                dialogStatus.textContent = "These photos are too large to send together. Nothing was saved.";
              } else if (errorBody.error.fields?.photos === "dimensions") {
                dialogStatus.textContent = `${name} is over 8,000 pixels on a side. Nothing was saved.`;
                if (photoIndex !== undefined && chosen[photoIndex]) chosen[photoIndex].remove.focus();
              } else if (errorBody.error.fields?.photos === "count") {
                dialogStatus.textContent = "Add between 1 and 6 photos.";
              } else if (code === "contract_not_open") {
                dialogStatus.textContent = "Condition can't be recorded on this contract.";
                close();
                status.textContent = "Condition can't be recorded on this contract.";
              } else if (code === "storage_unavailable") {
                dialogStatus.textContent = "File storage is unreachable. Nothing was saved; try again in a moment.";
              } else {
                dialogStatus.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
              }
              save.disabled = false;
              return;
            }
            close();
            await reload();
            status.textContent = `Condition recorded with ${chosen.length} photo${chosen.length === 1 ? "" : "s"}.`;
            focusStatus("Contract status");
          } catch {
            save.disabled = false;
            dialogStatus.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.append(group, notesField, photosField, thumbs, dialogStatus, h("div", { class: "dialog-actions" }, cancel, save));
    },
  });
}

interface ApiErrorShape {
  error: { code: string; message: string; fields?: Record<string, string>; photo_index?: number };
}
