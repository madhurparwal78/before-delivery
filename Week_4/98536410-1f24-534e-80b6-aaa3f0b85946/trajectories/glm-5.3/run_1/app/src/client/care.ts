// Customer care: order search and order history page.
import { ApiFailure, StaleAnswer, clear, el, euroText, trapFocus } from "./core.js";
import type { AppContext } from "./app.js";
import { navigate } from "./app.js";

interface OrderRow {
  id: string;
  number: string;
  status: string;
  store_id: string;
  store_name: string;
  slot_start_utc: string;
  total_cents: number;
  customer_email: string;
  created_at: string;
}

interface OrdersAnswer {
  count: number;
  orders: OrderRow[];
  next_before: string | null;
}

interface OrderAnswer {
  id: string;
  number: string;
  status: string;
  store_id: string;
  store_name: string;
  timezone: string;
  slot_start_utc: string;
  slot_local_date: string;
  slot_local_time: string;
  customer: { name: string; email: string };
  lines: { sku: string; name: string; quantity: number; line_total_cents: number; vat_cents: number; returned_quantity: number }[];
  total_cents: number;
  vat_cents: number;
  refunded_cents: number;
  created_at: string;
}

interface EventsAnswer {
  order_id: string;
  events: { seq: number; type: string; at: string; data: Record<string, unknown>; digest: string }[];
}

interface ReplayAnswer {
  order_id: string;
  status: string;
  last_seq: number;
  total_cents: number;
  refunded_cents: number;
  returns: { id: string; status: string; refund_cents: number }[];
}

export function mountCareSearch(ctx: AppContext): () => void {
  const root = ctx.root;
  const main = el("main");
  main.className = "care-wrap";

  const search = el("input");
  search.type = "search";
  search.setAttribute("aria-label", "Find order");
  search.className = "care-search";
  main.appendChild(search);

  const status = el("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-label", "Care updates");
  main.appendChild(status);

  const tableScroll = el("div");
  tableScroll.className = "table-scroll";
  const table = el("table");
  table.className = "data";
  table.setAttribute("aria-label", "Orders");
  const thead = el("thead");
  const headRow = el("tr");
  for (const head of ["Number", "Status", "Shop", "Customer", "Created"]) {
    const th = el("th");
    th.textContent = head;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  table.appendChild(tbody);
  tableScroll.appendChild(table);
  main.appendChild(tableScroll);

  const moreBtn = el("button");
  moreBtn.className = "btn";
  moreBtn.textContent = "Show more orders";
  moreBtn.setAttribute("hidden", "hidden");
  main.appendChild(moreBtn);
  root.appendChild(main);
  search.focus();

  let generation = 0;
  let cursor: string | null = null;
  let shown = 0;
  let totalCount = 0;
  let searchTimer: number | null = null;

  async function runSearch(append: boolean): Promise<void> {
    const gen = ++generation;
    const q = search.value.trim();
    status.textContent = append ? "Loading more orders." : "Searching...";
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (append && cursor) params.set("before", cursor);
      const answer = await ctx.api.get<OrdersAnswer>(`/api/orders?${params.toString()}`);
      if (gen !== generation) return;
      if (!append) {
        clear(tbody);
        shown = 0;
        cursor = null;
      }
      for (const order of answer.orders) {
        const row = el("tr");
        const numberCell = el("td");
        const link = el("a");
        link.href = `/care/orders/${order.id}`;
        link.textContent = order.number;
        link.setAttribute("aria-label", `Open order ${order.number}`);
        numberCell.appendChild(link);
        row.appendChild(numberCell);
        const statusCell = el("td");
        statusCell.textContent = order.status;
        row.appendChild(statusCell);
        const shopCell = el("td");
        shopCell.textContent = order.store_name;
        row.appendChild(shopCell);
        const customerCell = el("td");
        customerCell.textContent = order.customer_email;
        row.appendChild(customerCell);
        const createdCell = el("td");
        createdCell.textContent = order.created_at.slice(0, 16).replace("T", " ");
        row.appendChild(createdCell);
        tbody.appendChild(row);
        shown += 1;
      }
      cursor = answer.next_before;
      totalCount = answer.count;
      if (!append) status.textContent = totalCount === 0 ? "No orders match." : `${totalCount} orders found.`;
      else status.textContent = `Showing ${shown} of ${totalCount} orders.`;
      moreBtn.toggleAttribute("hidden", cursor === null);
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      status.textContent = "Something went wrong. Try again.";
    }
  }

  search.addEventListener("input", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void runSearch(false), 300);
  });
  moreBtn.addEventListener("click", async () => {
    const firstAppended = tbody.children[shown] as HTMLElement | undefined;
    await runSearch(true);
    const link = firstAppended?.querySelector<HTMLElement>("a");
    link?.focus();
  });

  void runSearch(false);
  return () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
  };
}

export function mountCareOrder(ctx: AppContext): () => void {
  const orderId = window.location.pathname.split("/")[3];
  const root = ctx.root;
  const main = el("main");
  main.className = "care-order-wrap";

  const status = el("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-label", "Care updates");
  main.appendChild(status);

  const layout = el("div");
  layout.className = "care-order-layout";
  const facts = el("div");
  const historyColumn = el("div");

  const h1 = el("h1");
  facts.appendChild(h1);

  const linesScroll = el("div");
  linesScroll.className = "table-scroll";
  const linesTable = el("table");
  linesTable.className = "data";
  linesTable.setAttribute("aria-label", "Order lines");
  const thead = el("thead");
  const headRow = el("tr");
  for (const head of ["Item", "Qty", "Line total", "Returned"]) {
    const th = el("th");
    th.textContent = head;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  linesTable.appendChild(thead);
  const tbody = el("tbody");
  linesTable.appendChild(tbody);
  linesScroll.appendChild(linesTable);

  const controls = el("div");
  controls.className = "care-controls";
  const verifyBtn = el("button");
  verifyBtn.className = "btn";
  verifyBtn.textContent = "Verify history";
  const downloadBtn = el("button");
  downloadBtn.className = "btn";
  downloadBtn.textContent = "Download order document";
  const cancelBtn = el("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel order";
  controls.appendChild(verifyBtn);
  controls.appendChild(downloadBtn);
  controls.appendChild(cancelBtn);

  const historyHeading = el("h2");
  historyHeading.textContent = "Order history";
  const historyScroll = el("div");
  historyScroll.className = "history-panel";
  const historyList = el("ol");
  historyList.setAttribute("role", "list");
  historyList.setAttribute("aria-label", "Order history");
  historyScroll.appendChild(historyList);

  historyColumn.appendChild(controls);
  historyColumn.appendChild(historyHeading);
  historyColumn.appendChild(historyScroll);

  layout.appendChild(facts);
  layout.appendChild(linesScroll);
  layout.appendChild(historyColumn);
  main.appendChild(layout);
  root.appendChild(main);

  let storageOffline = false;
  const storagePoll = window.setInterval(async () => {
    try {
      const res = await fetch("/api/status", { credentials: "same-origin" });
      const data = (await res.json()) as { storage: string };
      storageOffline = data.storage === "down";
      downloadBtn.setAttribute("aria-disabled", storageOffline ? "true" : "false");
    } catch {
      void 0;
    }
  }, 3000);
  const storageDown = (): boolean => storageOffline;

  const scrollKey = `tramela-care-scroll-${orderId}`;
  const savedScroll = sessionStorage.getItem(scrollKey);
  const savedMessage = sessionStorage.getItem(`tramela-care-msg-${orderId}`);

  async function load(): Promise<void> {
    let order: OrderAnswer;
    try {
      order = await ctx.api.get<OrderAnswer>(`/api/orders/${orderId}`);
    } catch {
      navigate("/care");
      return;
    }
    h1.textContent = `Order ${order.number}`;
    document.title = `Order ${order.number} — Tramela Estate`;
    clear(facts);
    const h1Restored = el("h1");
    h1Restored.textContent = `Order ${order.number}`;
    facts.appendChild(h1Restored);
    for (const [label, value] of [
      ["Status", order.status],
      ["Shop", order.store_name],
      ["Collection", `${order.slot_local_date} ${order.slot_local_time} (${order.timezone})`],
      ["Total", euroText(order.total_cents)],
      ["Refunded", euroText(order.refunded_cents)],
      ["Customer", `${order.customer.name} <${order.customer.email}>`],
    ] as [string, string][]) {
      const p = el("p");
      p.textContent = `${label}: ${value}`;
      facts.appendChild(p);
    }
    clear(tbody);
    for (const line of order.lines) {
      const row = el("tr");
      const nameCell = el("td");
      nameCell.textContent = line.name;
      row.appendChild(nameCell);
      const qtyCell = el("td");
      qtyCell.textContent = String(line.quantity);
      row.appendChild(qtyCell);
      const totalCell = el("td");
      totalCell.className = "num";
      totalCell.textContent = euroText(line.line_total_cents);
      row.appendChild(totalCell);
      const returnedCell = el("td");
      returnedCell.textContent = String(line.returned_quantity);
      row.appendChild(returnedCell);
      tbody.appendChild(row);
    }
    cancelBtn.toggleAttribute("hidden", !["placed", "picking", "ready"].includes(order.status));
    await loadHistory();
    if (savedScroll) {
      historyScroll.scrollTop = Number(savedScroll);
      sessionStorage.removeItem(scrollKey);
    }
    if (savedMessage) {
      status.textContent = savedMessage;
      sessionStorage.removeItem(`tramela-care-msg-${orderId}`);
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const answer = await ctx.api.get<EventsAnswer>(`/api/orders/${orderId}/events`);
      clear(historyList);
      for (const event of answer.events) {
        const li = el("li");
        const lisbon = new Date(event.at).toLocaleString("en-GB", { timeZone: "Europe/Lisbon", hour12: false });
        li.textContent = `#${event.seq} ${event.type} ${lisbon.slice(0, 16).replace(",", "")}`;
        historyList.appendChild(li);
      }
    } catch {
      void 0;
    }
  }

  historyScroll.addEventListener("scroll", () => {
    sessionStorage.setItem(scrollKey, String(historyScroll.scrollTop));
  });

  verifyBtn.addEventListener("click", async () => {
    status.textContent = "Checking history...";
    try {
      const replay = await ctx.api.get<ReplayAnswer>(`/api/orders/${orderId}/replay`);
      status.textContent = `History verified: ${replay.last_seq} entries.`;
      sessionStorage.setItem(`tramela-care-msg-${orderId}`, status.textContent);
    } catch (err) {
      if (err instanceof ApiFailure && err.body.code === "sequence_broken") {
        status.textContent = `History is damaged from entry ${err.body.first_bad_seq}.`;
      } else if (!(err instanceof StaleAnswer)) {
        status.textContent = "Something went wrong. Try again.";
      }
    }
  });

  downloadBtn.addEventListener("click", async () => {
    if (storageDown()) {
      status.textContent = "Order documents are unavailable until storage returns.";
      return;
    }
    status.textContent = "Preparing document...";
    try {
      const res = await fetch(`/api/orders/${orderId}/document`, { credentials: "same-origin" });
      if (res.status === 503) {
        status.textContent = "Order documents are unavailable until storage returns.";
        return;
      }
      if (!res.ok) {
        status.textContent = "Something went wrong. Try again.";
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = el("a");
      anchor.href = url;
      anchor.download = "order-document.json";
      anchor.click();
      URL.revokeObjectURL(url);
      status.textContent = "";
    } catch {
      status.textContent = "Something went wrong. Try again.";
    }
  });

  cancelBtn.addEventListener("click", () => {
    const backdrop = el("div");
    backdrop.className = "dialog-backdrop";
    const dialog = el("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-label", "Cancel order");
    dialog.setAttribute("data-state", "open");
    const h2 = el("h2");
    h2.textContent = "Cancel order";
    dialog.appendChild(h2);
    const p = el("p");
    p.textContent = "Cancel this order?";
    dialog.appendChild(p);
    const actions = el("div");
    actions.className = "actions";
    const keep = el("button");
    keep.className = "btn";
    keep.textContent = "Keep order";
    const cancel = el("button");
    cancel.className = "btn";
    cancel.textContent = "Cancel order";
    actions.appendChild(keep);
    actions.appendChild(cancel);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    keep.focus();
    const close = (): void => {
      backdrop.remove();
      cancelBtn.focus();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Tab") trapFocus(dialog, event);
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    keep.addEventListener("click", close);
    cancel.addEventListener("click", async () => {
      status.textContent = "Saving...";
      try {
        const order = await ctx.api.post<OrderAnswer>(`/api/orders/${orderId}/transitions`, { to: "cancelled" });
        status.textContent = `Order ${order.number} is now cancelled.`;
        close();
        await load();
      } catch (err) {
        if (err instanceof StaleAnswer) return;
        status.textContent = `That step is not possible for this order now.`;
        close();
      }
    });
  });

  void load();
  void storagePoll;
  return () => {
    window.clearInterval(storagePoll);
  };
}
