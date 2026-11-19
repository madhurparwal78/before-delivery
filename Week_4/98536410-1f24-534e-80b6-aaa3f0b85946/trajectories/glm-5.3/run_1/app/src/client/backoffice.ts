// Manager back office: orders, holds, stock, opening hours, returns.
import { ApiFailure, StaleAnswer, clear, el, euroText, reducedMotion, trapFocus } from "./core.js";
import type { AppContext } from "./app.js";

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

interface OrderAnswer extends OrderRow {
  timezone: string;
  slot_local_date: string;
  slot_local_time: string;
  customer: { name: string; email: string };
  lines: { sku: string; name: string; quantity: number; unit_price_milli: number; line_total_cents: number; vat_rate: number; vat_cents: number; returned_quantity: number }[];
  vat_cents: number;
  refunded_cents: number;
}

interface HoldRow {
  id: string;
  status: string;
  store_id: string;
  lines: { sku: string; quantity: number }[];
  created_at: string;
  expires_at: string;
  seconds_left: number;
}

interface StockRow {
  sku: string;
  name: string;
  on_hand: number;
  held: number;
  available: number;
  critical: boolean;
}

interface HoursAnswer {
  store_id: string;
  timezone: string;
  local_today: string;
  days: { weekday: number; open: boolean; opens: string | null; closes: string | null }[];
  upcoming: { effective_from: string; days: { weekday: number; open: boolean; opens: string | null; closes: string | null }[] } | null;
}

interface DayPlanAnswer {
  store_id: string;
  date: string;
  timezone: string;
  open: boolean;
  opens_local: string | null;
  closes_local: string | null;
  slots: { start_local: string; start_utc: string; utc_offset: string; remaining: number }[];
}

interface ReturnRow {
  id: string;
  number: string;
  order_id: string;
  status: string;
  lines: { sku: string; quantity: number; refund_cents: number }[];
  refund_cents: number;
  reason: string;
  created_at: string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const ORDER_ACTIONS: Record<string, string[]> = {
  placed: ["picking", "cancelled"],
  picking: ["ready", "cancelled"],
  ready: ["collected", "cancelled"],
  collected: [],
  cancelled: [],
};

const RETURN_ACTIONS: Record<string, string[]> = {
  requested: ["received", "declined"],
  received: ["settled"],
  settled: [],
  declined: [],
};

export function mountBackOffice(ctx: AppContext): () => void {
  const storeId = window.location.pathname.split("/")[2];
  const root = ctx.root;
  const timers: number[] = [];

  const main = el("main");
  main.id = "back-office";

  const status = el("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-label", "Shop updates");
  main.appendChild(status);

  const grid = el("div");
  grid.className = "backoffice-grid";

  const sections: Record<string, { root: HTMLElement; body: HTMLElement; button: HTMLButtonElement | null }> = {};
  const sectionOrder = ["Orders", "Active holds", "Stock", "Opening hours", "Returns"];

  for (const name of sectionOrder) {
    const section = el("section");
    section.className = "bo-section";
    const button = el("button");
    button.className = "disclosure btn";
    button.textContent = name;
    button.setAttribute("aria-expanded", "false");
    const heading = el("h2");
    heading.textContent = name;
    heading.className = "section-heading";
    const body = el("div");
    body.className = "section-body";
    body.setAttribute("data-state", "open");
    section.appendChild(button);
    section.appendChild(heading);
    section.appendChild(body);
    grid.appendChild(section);
    sections[name] = { root: section, body, button };
  }

  // Orders column 1, Returns column 2 (per layout); simplest: append in DOM order.
  main.appendChild(grid);
  root.appendChild(main);

  // Restore expanded sections below 700px
  const expandedKey = `tramela-bo-${storeId}`;
  const expandedRaw = sessionStorage.getItem(expandedKey);
  const expanded = expandedRaw ? (JSON.parse(expandedRaw) as string[]) : ["Orders"];
  applyExpanded();

  function applyExpanded(): void {
    const wide = window.innerWidth >= 700;
    for (const name of sectionOrder) {
      const open = wide || expanded.includes(name);
      sections[name].button?.setAttribute("aria-expanded", String(open));
      sections[name].body.setAttribute("data-state", open ? "open" : "closed");
      sections[name].body.style.display = open ? "" : "none";
    }
  }

  function toggleSection(name: string): void {
    const index = expanded.indexOf(name);
    if (index >= 0) expanded.splice(index, 1);
    else expanded.push(name);
    sessionStorage.setItem(expandedKey, JSON.stringify(expanded));
    applyExpanded();
  }

  for (const name of sectionOrder) {
    sections[name].button?.addEventListener("click", () => toggleSection(name));
  }

  // --- Orders table ---
  const ordersBody = buildTable(sections["Orders"].body, "Orders", ["Number", "Status", "Collection", "Total", "Actions"]);
  const returnsBody = buildTable(sections["Returns"].body, "Returns", ["Number", "Status", "Refund", "Reason", "Actions"]);

  function buildTable(parent: HTMLElement, label: string, heads: string[]): HTMLElement {
    const wrap = el("div");
    wrap.className = "table-scroll";
    const table = el("table");
    table.className = "data";
    table.setAttribute("aria-label", label);
    table.setAttribute("tabindex", "0");
    const thead = el("thead");
    const headRow = el("tr");
    for (const head of heads) {
      const th = el("th");
      th.textContent = head;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    table.appendChild(tbody);
    wrap.appendChild(table);
    parent.appendChild(wrap);
    return tbody;
  }

  async function reloadOrders(): Promise<void> {
    try {
      const answer = await ctx.api.get<{ count: number; orders: OrderRow[] }>(`/api/orders?store_id=${storeId}&limit=100`);
      const existing = new Map<string, HTMLElement>();
      for (const child of Array.from(ordersBody.children)) {
        const row = child as HTMLElement;
        if (row.dataset.orderId) existing.set(row.dataset.orderId, row);
      }
      const keep = new Set<string>();
      for (const order of answer.orders) {
        keep.add(order.id);
        let row = existing.get(order.id);
        if (!row) {
          row = el("tr");
          row.dataset.orderId = order.id;
          const numberCell = el("td");
          row.appendChild(numberCell);
          const statusCell = el("td");
          row.appendChild(statusCell);
          const slotCell = el("td");
          row.appendChild(slotCell);
          const totalCell = el("td");
          totalCell.className = "num";
          row.appendChild(totalCell);
          const actionsCell = el("td");
          actionsCell.className = "row-actions";
          row.appendChild(actionsCell);
          ordersBody.appendChild(row);
        }
        row.children[0].textContent = order.number;
        row.children[1].textContent = order.status;
        row.children[2].textContent = order.slot_start_utc.slice(0, 16).replace("T", " ");
        row.children[3].textContent = euroText(order.total_cents);
        const actionsCell = row.children[4];
        renderOrderActions(actionsCell as HTMLElement, order);
      }
      for (const [id, row] of existing) {
        if (!keep.has(id)) row.remove();
      }
    } catch {
      void 0;
    }
  }

  function renderOrderActions(cell: HTMLElement, order: OrderRow): void {
    clear(cell);
    const legal = ORDER_ACTIONS[order.status] ?? [];
    const labels: Record<string, string> = {
      picking: "Start picking",
      ready: "Mark ready",
      collected: "Hand over",
      cancelled: "Cancel",
    };
    let returnPossible = order.status === "collected";
    for (const target of legal) {
      const btn = el("button");
      btn.className = "btn small";
      btn.textContent = `${labels[target]} ${order.number}`;
      btn.addEventListener("click", () => void doTransition(order, target, btn, cell));
      cell.appendChild(btn);
    }
    if (returnPossible) {
      const btn = el("button");
      btn.className = "btn small";
      btn.textContent = `Start return ${order.number}`;
      btn.addEventListener("click", () => openReturnDialog(order, btn));
      cell.appendChild(btn);
    }
  }

  async function doTransition(order: OrderRow, target: string, btn: HTMLElement, cell: HTMLElement): Promise<void> {
    status.textContent = "Saving...";
    try {
      const updated = await ctx.api.post<OrderAnswer>(`/api/orders/${order.id}/transitions`, { to: target });
      status.textContent = `Order ${updated.number} is now ${updated.status}.`;
      order.status = updated.status;
      renderOrderActions(cell, order);
      const first = cell.querySelector<HTMLElement>("button");
      if (first) first.focus();
      else {
        const table = cell.closest("table");
        table?.focus();
      }
      await reloadOrders();
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      if (err instanceof ApiFailure) {
        if (err.body.code === "invalid_transition") {
          status.textContent = `That step is not possible for order ${order.number} now.`;
          await reloadOrders();
          const row = ordersBody.querySelector<HTMLElement>(`[data-order-id='${order.id}']`);
          const newCell = row?.children[4] as HTMLElement | undefined;
          if (newCell) {
            const first = newCell.querySelector<HTMLElement>("button");
            if (first) first.focus();
            else (newCell.closest("table") as HTMLElement).focus();
          }
        } else {
          status.textContent = `That step is not possible for order ${order.number} now.`;
        }
      }
    }
    void btn;
  }

  // --- Holds table ---
  const holdsBody = buildTable(sections["Active holds"].body, "Active holds", ["Lines", "Created", "Expires"]);

  async function reloadHolds(): Promise<void> {
    try {
      const answer = await ctx.api.get<{ holds: HoldRow[] }>(`/api/stores/${storeId}/holds`);
      clear(holdsBody);
      for (const hold of answer.holds) {
        const row = el("tr");
        const linesCell = el("td");
        linesCell.textContent = hold.lines.map((l) => `${l.sku} × ${l.quantity}`).join(", ");
        row.appendChild(linesCell);
        const createdCell = el("td");
        createdCell.textContent = hold.created_at.slice(0, 16).replace("T", " ");
        row.appendChild(createdCell);
        const expiresCell = el("td");
        expiresCell.textContent = hold.expires_at.slice(11, 16);
        row.appendChild(expiresCell);
        holdsBody.appendChild(row);
      }
    } catch {
      void 0;
    }
  }

  // --- Stock table ---
  const stockBody = buildTable(sections["Stock"].body, "Stock", ["SKU", "Name", "On hand", "Held", "Available", "Actions"]);
  const recordSaleBtn = el("button");
  recordSaleBtn.className = "btn";
  recordSaleBtn.textContent = "Record till sale";
  sections["Stock"].body.appendChild(recordSaleBtn);

  async function reloadStock(): Promise<void> {
    try {
      const answer = await ctx.api.get<{ lines: StockRow[] }>(`/api/stores/${storeId}/stock`);
      const existing = new Map<string, HTMLElement>();
      for (const child of Array.from(stockBody.children)) {
        const row = child as HTMLElement;
        if (row.dataset.sku) existing.set(row.dataset.sku, row);
      }
      const keep = new Set<string>();
      for (const line of answer.lines) {
        keep.add(line.sku);
        let row = existing.get(line.sku);
        if (!row) {
          row = el("tr");
          row.dataset.sku = line.sku;
          const skuCell = el("td");
          row.appendChild(skuCell);
          const nameCell = el("td");
          row.appendChild(nameCell);
          const onHandCell = el("td");
          onHandCell.className = "num";
          onHandCell.setAttribute("data-figure", "on-hand");
          row.appendChild(onHandCell);
          const heldCell = el("td");
          heldCell.className = "num";
          heldCell.setAttribute("data-figure", "held");
          row.appendChild(heldCell);
          const availCell = el("td");
          availCell.className = "num";
          availCell.setAttribute("data-figure", "available");
          row.appendChild(availCell);
          const actionsCell = el("td");
          const countBtn = el("button");
          countBtn.className = "btn small";
          countBtn.textContent = "Count";
          countBtn.addEventListener("click", () => openCountDialog(line, countBtn));
          actionsCell.appendChild(countBtn);
          row.appendChild(actionsCell);
          stockBody.appendChild(row);
        }
        row.children[0].textContent = line.sku;
        row.children[1].textContent = line.name;
        row.children[2].textContent = String(line.on_hand);
        row.children[2].setAttribute("data-value", String(line.on_hand));
        row.children[3].textContent = String(line.held);
        row.children[3].setAttribute("data-value", String(line.held));
        row.children[4].textContent = String(line.available);
        row.children[4].setAttribute("data-value", String(line.available));
      }
      for (const [sku, row] of existing) {
        if (!keep.has(sku)) row.remove();
      }
    } catch {
      void 0;
    }
  }

  function openCountDialog(line: StockRow, opener: HTMLElement): void {
    const backdrop = el("div");
    backdrop.className = "dialog-backdrop";
    const dialog = el("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Stock count");
    dialog.setAttribute("data-state", "open");
    const h2 = el("h2");
    h2.textContent = `Stock count — ${line.sku}`;
    dialog.appendChild(h2);
    const label = el("label");
    label.htmlFor = "counted-units";
    label.textContent = "Counted units";
    const input = el("input");
    input.id = "counted-units";
    input.type = "number";
    input.min = "0";
    input.max = "99999";
    input.value = String(line.on_hand);
    const error = el("p");
    error.className = "field-error";
    const save = el("button");
    save.className = "btn";
    save.textContent = "Save count";
    dialog.appendChild(label);
    dialog.appendChild(input);
    dialog.appendChild(error);
    dialog.appendChild(save);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    input.focus();
    const close = (): void => {
      backdrop.remove();
      opener.focus();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Tab") trapFocus(dialog, event);
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    save.addEventListener("click", async () => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > 99999) {
        error.textContent = "Enter a whole number from 0 to 99999.";
        return;
      }
      status.textContent = "Saving...";
      try {
        await ctx.api.post(`/api/stores/${storeId}/stock/${line.sku}/count`, { on_hand: value });
        status.textContent = "Count saved.";
        close();
        await reloadStock();
      } catch (err) {
        if (err instanceof ApiFailure && err.body.code === "below_held") {
          status.textContent = `${err.body.held} units are held for collection; the count cannot be lower.`;
        } else if (!(err instanceof StaleAnswer)) {
          status.textContent = "Something went wrong. Try again.";
        }
      }
    });
  }

  recordSaleBtn.addEventListener("click", openTillSaleDialog);

  function openTillSaleDialog(): void {
    const backdrop = el("div");
    backdrop.className = "dialog-backdrop";
    const dialog = el("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Till sale");
    dialog.setAttribute("data-state", "open");
    const h2 = el("h2");
    h2.textContent = "Till sale";
    dialog.appendChild(h2);
    const itemLabel = el("label");
    itemLabel.htmlFor = "till-item";
    itemLabel.textContent = "Item";
    const itemSelect = el("select");
    itemSelect.id = "till-item";
    itemSelect.setAttribute("aria-label", "Item");
    const unitsLabel = el("label");
    unitsLabel.htmlFor = "till-units";
    unitsLabel.textContent = "Units";
    const units = el("input");
    units.id = "till-units";
    units.type = "number";
    units.min = "1";
    units.max = "999";
    units.value = "1";
    units.setAttribute("aria-label", "Units");
    const record = el("button");
    record.className = "btn";
    record.textContent = "Record sale";
    dialog.appendChild(itemLabel);
    dialog.appendChild(itemSelect);
    dialog.appendChild(unitsLabel);
    dialog.appendChild(units);
    dialog.appendChild(record);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let requestKey = `till-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
    let lastBody: Record<string, unknown> | null = null;

    void ctx.api
      .get<{ lines: StockRow[] }>(`/api/stores/${storeId}/stock`)
      .then((answer) => {
        for (const line of answer.lines) {
          const option = el("option");
          option.value = line.sku;
          option.textContent = `${line.sku} ${line.name}`;
          itemSelect.appendChild(option);
        }
      })
      .catch(() => void 0);

    itemSelect.focus();
    const close = (): void => {
      backdrop.remove();
      recordSaleBtn.focus();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Tab") trapFocus(dialog, event);
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    const refreshKey = (): void => {
      const body = { sku: itemSelect.value, quantity: Number(units.value) };
      if (lastBody && JSON.stringify(body) === JSON.stringify(lastBody)) return;
      lastBody = body;
      requestKey = `till-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
    };
    itemSelect.addEventListener("change", refreshKey);
    units.addEventListener("change", refreshKey);
    record.addEventListener("click", async () => {
      refreshKey();
      const body = { sku: itemSelect.value, quantity: Number(units.value) };
      if (!itemSelect.value || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 999) {
        status.textContent = "Something went wrong. Try again.";
        return;
      }
      status.textContent = "Saving...";
      try {
        const answer = await ctx.api.post<{ on_hand: number; held: number; available: number; sku: string }>(
          `/api/stores/${storeId}/till-sales`,
          body,
          { "Request-Key": requestKey },
        );
        status.textContent = `Till sale recorded.`;
        void answer;
        close();
        await reloadStock();
      } catch (err) {
        if (err instanceof StaleAnswer) return;
        if (err instanceof ApiFailure && err.body.code === "stock_conflict") {
          const store = await ctx.api.get<{ name: string }>(`/api/stores/${storeId}`).catch(() => null);
          status.textContent = `Only ${err.body.remaining} left at ${store?.name ?? "this shop"}.`;
        } else {
          status.textContent = "Something went wrong. Try again.";
        }
      }
    });
  }

  // --- Opening hours ---
  const hoursBody = sections["Opening hours"].body;
  const hoursGroup = el("div");
  hoursGroup.setAttribute("role", "group");
  hoursGroup.setAttribute("aria-label", "Opening hours");

  const effectiveLabel = el("label");
  effectiveLabel.htmlFor = "effective-from";
  effectiveLabel.textContent = "Effective from";
  const effective = el("input");
  effective.id = "effective-from";
  effective.type = "date";
  effective.setAttribute("aria-label", "Effective from");
  hoursGroup.appendChild(effectiveLabel);
  hoursGroup.appendChild(effective);

  const timeBoxes: Record<number, { open: HTMLInputElement; opens: HTMLInputElement; closes: HTMLInputElement }> = {};
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const row = el("div");
    row.className = "hours-row";
    const label = el("label");
    label.className = "inline";
    const openBox = el("input");
    openBox.type = "checkbox";
    openBox.setAttribute("aria-label", `Open on ${WEEKDAYS[weekday - 1]}`);
    label.appendChild(openBox);
    const name = el("span");
    name.textContent = WEEKDAYS[weekday - 1];
    label.appendChild(name);
    row.appendChild(label);
    const opensBox = el("input");
    opensBox.className = "time-box";
    opensBox.type = "time";
    opensBox.step = "1800";
    opensBox.setAttribute("aria-label", `${WEEKDAYS[weekday - 1]} opens`);
    const closesBox = el("input");
    closesBox.className = "time-box";
    closesBox.type = "time";
    closesBox.step = "1800";
    closesBox.setAttribute("aria-label", `${WEEKDAYS[weekday - 1]} closes`);
    const openWrap = el("span");
    openWrap.className = "time-box";
    openWrap.appendChild(opensBox);
    const closeWrap = el("span");
    closeWrap.className = "time-box";
    closeWrap.appendChild(closesBox);
    row.appendChild(openWrap);
    row.appendChild(closeWrap);
    hoursGroup.appendChild(row);
    timeBoxes[weekday] = { open: openBox, opens: opensBox, closes: closesBox };
  }

  const publishBtn = el("button");
  publishBtn.className = "btn";
  publishBtn.textContent = "Publish hours";
  hoursGroup.appendChild(publishBtn);
  const upcomingNote = el("p");
  upcomingNote.className = "upcoming-note";
  hoursGroup.appendChild(upcomingNote);

  const previewLabel = el("label");
  previewLabel.htmlFor = "preview-date";
  previewLabel.textContent = "Preview date";
  const previewDate = el("input");
  previewDate.id = "preview-date";
  previewDate.type = "date";
  previewDate.setAttribute("aria-label", "Preview date");
  hoursGroup.appendChild(previewLabel);
  hoursGroup.appendChild(previewDate);

  const slotCount = el("p");
  const slotCountFigure = el("span");
  slotCountFigure.className = "num";
  slotCountFigure.setAttribute("data-figure", "slot-count");
  slotCount.appendChild(document.createTextNode("Slots: "));
  slotCount.appendChild(slotCountFigure);
  hoursGroup.appendChild(slotCount);

  const slotsList = el("ul");
  slotsList.setAttribute("role", "list");
  slotsList.setAttribute("aria-label", "Slots on preview date");
  hoursGroup.appendChild(slotsList);
  const timezoneLine = el("p");
  timezoneLine.className = "timezone-line";
  hoursGroup.appendChild(timezoneLine);

  hoursBody.appendChild(hoursGroup);

  let draftLoaded = false;
  const draftKey = `tramela-hours-${storeId}`;
  const savedDraft = sessionStorage.getItem(draftKey);

  async function loadHours(): Promise<void> {
    try {
      const hours = await ctx.api.get<HoursAnswer>(`/api/stores/${storeId}/hours`);
      effective.value = hours.local_today;
      for (const day of hours.days) {
        const boxes = timeBoxes[day.weekday];
        if (!boxes) continue;
        boxes.open.checked = day.open;
        boxes.opens.value = day.opens ?? "";
        boxes.closes.value = day.closes ?? "";
      }
      if (hours.upcoming) {
        upcomingNote.textContent = `New hours start on ${hours.upcoming.effective_from}.`;
      } else {
        upcomingNote.textContent = "";
      }
      if (savedDraft && !draftLoaded) {
        draftLoaded = true;
        const draft = JSON.parse(savedDraft) as {
          effective: string;
          days: Record<string, { open: boolean; opens: string; closes: string }>;
        };
        effective.value = draft.effective;
        for (const [weekday, day] of Object.entries(draft.days)) {
          const boxes = timeBoxes[Number(weekday)];
          if (!boxes) continue;
          boxes.open.checked = day.open;
          boxes.opens.value = day.opens;
          boxes.closes.value = day.closes;
        }
      }
    } catch {
      void 0;
    }
  }

  function saveDraft(): void {
    const days: Record<string, { open: boolean; opens: string; closes: string }> = {};
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      days[weekday] = {
        open: timeBoxes[weekday].open.checked,
        opens: timeBoxes[weekday].opens.value,
        closes: timeBoxes[weekday].closes.value,
      };
    }
    sessionStorage.setItem(draftKey, JSON.stringify({ effective: effective.value, days }));
  }

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const boxes = timeBoxes[weekday];
    boxes.open.addEventListener("change", saveDraft);
    boxes.opens.addEventListener("change", saveDraft);
    boxes.closes.addEventListener("change", saveDraft);
  }
  effective.addEventListener("change", saveDraft);

  publishBtn.addEventListener("click", async () => {
    const days = [];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const boxes = timeBoxes[weekday];
      days.push({
        weekday,
        open: boxes.open.checked,
        opens: boxes.open.checked ? boxes.opens.value || null : null,
        closes: boxes.open.checked ? boxes.closes.value || null : null,
      });
    }
    status.textContent = "Publishing...";
    try {
      const answer = await ctx.api.put<HoursAnswer>(`/api/stores/${storeId}/hours`, {
        effective_from: effective.value,
        days,
      });
      status.textContent = `Opening hours published from ${answer.local_today === effective.value ? effective.value : effective.value}.`;
      status.textContent = `Opening hours published from ${effective.value}.`;
      sessionStorage.removeItem(draftKey);
      if (answer.upcoming) upcomingNote.textContent = `New hours start on ${answer.upcoming.effective_from}.`;
      await loadHours();
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      if (err instanceof ApiFailure) {
        const errors = err.body.errors as Record<string, string> | undefined;
        if (errors) {
          const first = Object.entries(errors)[0];
          status.textContent = first ? first[1] : "Something went wrong. Try again.";
        } else {
          status.textContent = "Something went wrong. Try again.";
        }
      }
    }
  });

  async function loadPreview(date: string): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    status.textContent = "Loading slots.";
    try {
      const plan = await ctx.api.get<DayPlanAnswer>(`/api/stores/${storeId}/day-plan?date=${date}`);
      const existing = new Map<string, HTMLElement>();
      for (const child of Array.from(slotsList.children)) {
        const node = child as HTMLElement;
        if (node.dataset.slot) existing.set(node.dataset.slot, node);
      }
      const keep = new Set<string>();
      for (const slot of plan.slots) {
        keep.add(slot.start_local);
        let item = existing.get(slot.start_local);
        if (!item) {
          item = el("li");
          item.dataset.slot = slot.start_local;
          slotsList.appendChild(item);
        }
        item.textContent = `${slot.start_local} (UTC${slot.utc_offset}), ${slot.remaining} left`;
      }
      for (const [key, node] of existing) {
        if (!keep.has(key)) node.remove();
      }
      slotCountFigure.textContent = String(plan.slots.length);
      slotCountFigure.setAttribute("data-value", String(plan.slots.length));
      const storeName = await ctx.api.get<{ name: string; timezone: string }>(`/api/stores/${storeId}`);
      timezoneLine.textContent = `Times are local to ${storeName.name} (${storeName.timezone}).`;
      status.textContent = "";
    } catch (err) {
      if (err instanceof ApiFailure && err.body.code === "validation_failed") {
        status.textContent = "Pick a date from 2026 to 2030.";
      }
    }
  }

  previewDate.addEventListener("change", () => {
    void loadPreview(previewDate.value);
  });

  // --- Returns ---
  async function reloadReturns(): Promise<void> {
    try {
      const answer = await ctx.api.get<{ returns: ReturnRow[] }>(`/api/returns?store_id=${storeId}`);
      const existing = new Map<string, HTMLElement>();
      for (const child of Array.from(returnsBody.children)) {
        const row = child as HTMLElement;
        if (row.dataset.returnId) existing.set(row.dataset.returnId, row);
      }
      const keep = new Set<string>();
      for (const ret of answer.returns) {
        keep.add(ret.id);
        let row = existing.get(ret.id);
        if (!row) {
          row = el("tr");
          row.dataset.returnId = ret.id;
          const numberCell = el("td");
          row.appendChild(numberCell);
          const statusCell = el("td");
          row.appendChild(statusCell);
          const refundCell = el("td");
          refundCell.className = "num";
          row.appendChild(refundCell);
          const reasonCell = el("td");
          row.appendChild(reasonCell);
          const actionsCell = el("td");
          actionsCell.className = "row-actions";
          row.appendChild(actionsCell);
          returnsBody.appendChild(row);
        }
        row.children[0].textContent = ret.number;
        row.children[1].textContent = ret.status;
        row.children[2].textContent = euroText(ret.refund_cents);
        row.children[3].textContent = ret.reason;
        renderReturnActions(row.children[4] as HTMLElement, ret);
      }
      for (const [id, row] of existing) {
        if (!keep.has(id)) row.remove();
      }
    } catch {
      void 0;
    }
  }

  function renderReturnActions(cell: HTMLElement, ret: ReturnRow): void {
    clear(cell);
    const legal = RETURN_ACTIONS[ret.status] ?? [];
    const labels: Record<string, string> = { received: "Receive", settled: "Settle", declined: "Decline" };
    for (const target of legal) {
      const btn = el("button");
      btn.className = "btn small";
      btn.textContent = `${labels[target]} ${ret.number}`;
      btn.addEventListener("click", () => void doReturnTransition(ret, target, cell));
      cell.appendChild(btn);
    }
    if (ret.status === "requested" || ret.status === "received") {
      const labelBtn = el("button");
      labelBtn.className = "btn small";
      labelBtn.textContent = `Return label ${ret.number}`;
      labelBtn.addEventListener("click", () => void requestLabel(ret, labelBtn));
      cell.appendChild(labelBtn);
    }
  }

  async function doReturnTransition(ret: ReturnRow, target: string, cell: HTMLElement): Promise<void> {
    status.textContent = "Saving...";
    try {
      const updated = await ctx.api.post<ReturnRow>(`/api/returns/${ret.id}/transitions`, { to: target });
      status.textContent = `Return ${updated.number} is now ${updated.status}.`;
      ret.status = updated.status;
      renderReturnActions(cell, ret);
      const first = cell.querySelector<HTMLElement>("button");
      if (first) first.focus();
      else (cell.closest("table") as HTMLElement).focus();
      await reloadReturns();
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      status.textContent = `That step is not possible for return ${ret.number} now.`;
    }
  }

  async function requestLabel(ret: ReturnRow, btn: HTMLElement): Promise<void> {
    status.textContent = "Preparing label...";
    try {
      const res = await fetch(`/api/returns/${ret.id}/label`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        status.textContent = res.status === 503 ? "Return labels are paused until storage returns." : "Something went wrong. Try again.";
        return;
      }
      const text = await res.text();
      const pre = el("pre");
      pre.className = "label-text";
      pre.textContent = text;
      const cell = btn.closest("td");
      if (cell && !cell.querySelector(".label-text")) cell.appendChild(pre);
      status.textContent = "";
      btn.focus();
    } catch {
      status.textContent = "Something went wrong. Try again.";
    }
  }

  function openReturnDialog(order: OrderRow, opener: HTMLElement): void {
    const backdrop = el("div");
    backdrop.className = "dialog-backdrop";
    const dialog = el("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Return items");
    dialog.setAttribute("data-state", "open");
    const h2 = el("h2");
    h2.textContent = `Return items — ${order.number}`;
    dialog.appendChild(h2);

    const quantityInputs: Record<string, HTMLInputElement> = {};
    const dialogScroll = el("div");
    dialogScroll.style.maxHeight = "70vh";
    dialogScroll.style.overflowY = "auto";

    void ctx.api
      .get<OrderAnswer>(`/api/orders/${order.id}`)
      .then((full) => {
        for (const line of full.lines) {
          const label = el("label");
          label.htmlFor = `return-qty-${line.sku}`;
          label.textContent = `${line.name} (max ${line.quantity - line.returned_quantity})`;
          const input = el("input");
          input.id = `return-qty-${line.sku}`;
          input.type = "number";
          input.min = "0";
          input.max = String(line.quantity - line.returned_quantity);
          input.value = "0";
          input.setAttribute("aria-label", `Return quantity ${line.sku}`);
          dialogScroll.appendChild(label);
          dialogScroll.appendChild(input);
          quantityInputs[line.sku] = input;
        }
      })
      .catch(() => void 0);

    const reasonLabel = el("label");
    reasonLabel.htmlFor = "return-reason";
    reasonLabel.textContent = "Reason";
    const reason = el("input");
    reason.id = "return-reason";
    reason.type = "text";
    reason.setAttribute("aria-label", "Reason");
    const error = el("p");
    error.className = "field-error";
    const request = el("button");
    request.className = "btn";
    request.textContent = "Request return";
    dialogScroll.appendChild(reasonLabel);
    dialogScroll.appendChild(reason);
    dialogScroll.appendChild(error);
    dialogScroll.appendChild(request);
    dialog.appendChild(dialogScroll);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    const firstField = dialog.querySelector<HTMLElement>("input");
    (firstField ?? reason).focus();

    const close = (): void => {
      backdrop.remove();
      opener.focus();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Tab") trapFocus(dialog, event);
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    request.addEventListener("click", async () => {
      const lines: { sku: string; quantity: number }[] = [];
      for (const [sku, input] of Object.entries(quantityInputs)) {
        const value = Number(input.value);
        if (Number.isInteger(value) && value > 0) lines.push({ sku, quantity: value });
      }
      if (lines.length === 0) {
        error.textContent = "Choose items to return.";
        return;
      }
      if (reason.value.trim().length < 1) {
        error.textContent = "Give a reason.";
        return;
      }
      status.textContent = "Saving...";
      try {
        const created = await ctx.api.post<ReturnRow>(`/api/orders/${order.id}/returns`, {
          lines,
          reason: reason.value.trim(),
        });
        status.textContent = `Return ${created.number} requested.`;
        close();
        await reloadReturns();
      } catch (err) {
        if (err instanceof StaleAnswer) return;
        if (err instanceof ApiFailure) {
          const errors = err.body.errors as Record<string, string> | undefined;
          if (errors) {
            const first = Object.entries(errors)[0];
            if (first && first[1] === "More than can be returned.") {
              error.textContent = "More than can be returned.";
              return;
            }
          }
          status.textContent = "Something went wrong. Try again.";
        }
      }
    });
  }

  // --- Live refresh ---
  void reloadOrders();
  void reloadHolds();
  void reloadStock();
  void reloadReturns();
  void loadHours();
  const today = new Date().toISOString().slice(0, 10);
  previewDate.value = today;
  void loadPreview(today);

  const poll = window.setInterval(() => {
    void reloadOrders();
    void reloadHolds();
    void reloadStock();
    void reloadReturns();
  }, 5000);
  timers.push(poll);

  return () => {
    for (const timer of timers) window.clearInterval(timer);
  };
}

