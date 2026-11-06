import { api, problemOf } from "./api.ts";
import type { Drop, OrchardListEntry, Order, User } from "./api.ts";
import { announceProblem, announceUpdate, clear, h } from "./ui.ts";
import { makeBlockReadout, tierLabel, tierPattern, type BlockReadout } from "./odometer.ts";
import { DROP_STATUS_LABELS, formatDateText, formatDateTimeText, formatMoney, LINK_STATUS_LABELS, orderStatusLabel } from "./format.ts";
import {
  openCommitDialog, openLogDropDialog, openOrchardDialog, openNewOrderDialog, openLinkDialog,
  openSettleDialog, runOrderAction, runCancelOrder, runPlaceOrder,
} from "./dialogs.ts";

export interface DeskState {
  user: User;
  orchards: OrchardListEntry[];
  orders: Order[];
  drops: Drop[];
  growers: { id: string; name: string; contact_name: string; email: string }[];
  selectedOrchardId: string | null;
  selectedOrderId: string | null;
  selectedBlockId: string | null;
  readouts: Map<string, BlockReadout>;
  lastStatus: string | null;
  /** Structural fingerprint of the selected order, for quiet live refresh. */
  structure: string | null;
}

/** Everything that forces a full desk re-render, ignoring rolling figures. */
function structureOf(order: Order): string {
  return JSON.stringify({
    status: order.status,
    settlement_status: order.settlement_status,
    hives_ordered: order.hives_ordered,
    hives_committed: order.hives_committed,
    hives_delivered: order.hives_delivered,
    payable_cents: order.payable_cents,
    commission_cents: order.commission_cents,
    deposit_cents: order.deposit_cents,
    report_available: order.report_available,
    inspection_link: order.inspection_link,
    blocks: (order.blocks ?? []).map((block) => ({
      id: block.id,
      hives_ordered: block.hives_ordered,
      hives_delivered: block.hives_delivered,
      placements: (block.placements ?? []).map((placement) => [placement.yard_name, placement.hives, placement.delivered_on, placement.status]),
    })),
    my_drops: (order.my_drops ?? []).map((drop) => [drop.id, drop.status, drop.block?.id ?? null]),
  });
}

export interface DeskView {
  rail: HTMLElement;
  canvas: HTMLElement;
  ledger: HTMLElement;
}

/**
 * The desk at `/desk`: left rail, plat-map canvas and right ledger column, per
 * role. Broker and grower desks live-refresh; the beekeeper desk refreshes
 * after that beekeeper's own actions only.
 */
export async function renderDesk(app: HTMLElement): Promise<void> {
  let user: User;
  try {
    const me = await api<{ user: User }>("/api/me");
    user = me.body.user;
  } catch (error) {
    if (problemOf(error)?.status === 401) {
      announceProblem("Your session has ended. Sign in again.");
    }
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }

  const state: DeskState = {
    user,
    orchards: [],
    orders: [],
    drops: [],
    growers: [],
    selectedOrchardId: null,
    selectedOrderId: null,
    selectedBlockId: null,
    readouts: new Map(),
    lastStatus: null,
    structure: null,
  };

  clear(app);
  const skip = h("a", { href: "#plat-map", class: "skip-link", text: "Skip to plat map" });
  skip.addEventListener("click", (event) => {
    event.preventDefault();
    const group = document.getElementById("plat-map");
    group?.setAttribute("tabindex", "-1");
    group?.focus();
    group?.addEventListener("blur", () => group.removeAttribute("tabindex"), { once: true });
  });
  const header = h("header", { class: "desk-header" },
    h("span", { class: "wordmark", text: "Swarmline Bloom Desk" }),
    h("span", { class: "who" }, h("strong", { text: user.name }), ` · ${roleLabel(user.role)}`),
    h("button", {
      type: "button",
      onclick: async () => {
        await api("/api/session", { method: "DELETE" });
        window.history.replaceState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
    }, icon("/icons/log-out.svg", "Sign out"), " Sign out"),
  );
  const orchardsButton = h("button", {
    type: "button",
    class: "drawer-toggle",
    text: "Orchards",
    "aria-expanded": "false",
    "aria-controls": "rail",
  });
  const backdrop = h("button", { type: "button", class: "drawer-backdrop", "aria-label": "Close the drawer", tabindex: "-1" });
  const rail = h("aside", { class: "rail", id: "rail" });
  const canvas = h("main", { class: "canvas", id: "main-canvas" });
  const ledgerColumn = h("aside", { class: "ledger-column", id: "ledger-column" });
  const desk = h("div", { class: "desk" }, header, orchardsButton, backdrop, rail, canvas, ledgerColumn);
  app.append(skip, desk);

  const view: DeskView = { rail, canvas, ledger: ledgerColumn };
  const refresh = async (): Promise<void> => {
    await reload(state, view, true);
  };

  const closeDrawer = (): void => {
    rail.removeAttribute("open");
    orchardsButton.setAttribute("aria-expanded", "false");
    desk.removeAttribute("data-drawer-open");
  };
  orchardsButton.addEventListener("click", () => {
    if (rail.hasAttribute("open")) {
      closeDrawer();
      orchardsButton.focus();
    } else {
      rail.setAttribute("open", "");
      orchardsButton.setAttribute("aria-expanded", "true");
      desk.setAttribute("data-drawer-open", "true");
      rail.querySelector<HTMLElement>("a")?.focus();
    }
  });
  backdrop.addEventListener("click", () => {
    closeDrawer();
    orchardsButton.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && rail.hasAttribute("open")) {
      closeDrawer();
      orchardsButton.focus();
    }
  });

  if (user.role === "broker") {
    const growers = await api<{ id: string; name: string; contact_name: string; email: string }[]>("/api/growers");
    state.growers = growers.body;
  }

  await reload(state, view, true);

  if (user.role !== "beekeeper") {
    const poll = window.setInterval(async () => {
      await liveRefresh(state, view);
    }, 3000);
    window.addEventListener("popstate", () => window.clearInterval(poll), { once: true });
  }
}

/** An inline Lucide line icon at hairline weight. */
function icon(path: string, label: string): HTMLElement {
  const element = h("span", { class: "icon", role: "img", "aria-label": label });
  element.innerHTML = `<img src="${path}" alt="" width="18" height="18">`;
  const image = element.querySelector("img");
  if (image) {
    image.style.width = "18px";
    image.style.height = "18px";
    image.style.strokeWidth = "1.2";
  }
  return element;
}

function roleLabel(role: string): string {
  if (role === "broker") return "Broker";
  if (role === "grower") return "Grower";
  return "Beekeeper";
}

export async function reload(state: DeskState, view: DeskView, full: boolean): Promise<void> {
  const orchardsResponse = await api<OrchardListEntry[]>("/api/orchards");
  state.orchards = orchardsResponse.body;
  const ordersResponse = await api<Order[]>("/api/orders");
  state.orders = ordersResponse.body;
  if (state.user.role !== "grower") {
    const dropsResponse = await api<Drop[]>("/api/drops");
    state.drops = dropsResponse.body;
  }
  if (!state.selectedOrchardId) {
    const withOrders = state.orchards.filter((orchard) => orchard.orders.length > 0);
    state.selectedOrchardId = (withOrders[0] ?? state.orchards[0])?.id ?? null;
  }
  const orchardOrders = state.orders
    .filter((order) => order.orchard.id === state.selectedOrchardId)
    .sort((a, b) => (a.bloom_start > b.bloom_start ? -1 : a.bloom_start < b.bloom_start ? 1 : 0));
  const current = orchardOrders.find((order) => order.id === state.selectedOrderId) ?? orchardOrders[0];
  state.selectedOrderId = current?.id ?? null;
  let loaded: Order | null = null;
  if (state.selectedOrderId) {
    loaded = await loadOrder(state, state.selectedOrderId);
    if (loaded) {
      state.orders = state.orders.map((order) => (order.id === loaded!.id ? loaded! : order));
    }
  }
  if (loaded) state.structure = structureOf(loaded);
  renderRail(state, view);
  renderCanvas(state, view, loaded);
  renderLedger(state, view, loaded);
  if (full) {
    const brokerButtons = view.canvas;
    void brokerButtons;
  }
}

async function liveRefresh(state: DeskState, view: DeskView): Promise<void> {
  try {
    if (!state.selectedOrderId) return;
    const fresh = await loadOrder(state, state.selectedOrderId);
    if (!fresh) return;
    state.orders = state.orders.map((order) => (order.id === fresh.id ? fresh : order));
    const status = orderStatusLabel(fresh);
    if (state.lastStatus !== null && state.lastStatus !== status) {
      if (status === "Settled") {
        announceUpdate(`${fresh.orchard.name} settled.`);
      } else {
        announceUpdate(`${fresh.ref} is now ${status}.`);
      }
    }
    state.lastStatus = status;
    const structure = structureOf(fresh);
    if (structure === state.structure) return;
    const structureChanged = state.structure !== null;
    state.structure = structure;
    // Quiet updates roll the readouts and ledger in place; only structural
    // changes rebuild the canvas, so an open picker or focus is preserved.
    if (structureChanged) {
      renderCanvas(state, view, fresh);
      renderLedger(state, view, fresh);
      renderRail(state, view);
      return;
    }
    let figuresChanged = false;
    for (const block of fresh.blocks ?? []) {
      const readout = state.readouts.get(block.id);
      if (!readout) continue;
      if (readout.currentAverage !== block.average_frames || readout.currentTier !== block.tier) {
        figuresChanged = true;
        readout.update(block, {
          provisional: false,
          announce: true,
          payableText: formatMoney(fresh.payable_cents ?? 0),
          onTierSettled: (tier) => {
            const button = Array.from(document.querySelectorAll<HTMLElement>(".plat-grid .block"))
              .find((node) => node.querySelector(".block-name")?.textContent === block.name);
            if (button) button.className = `block ${tierPattern(tier)}`;
          },
        });
      }
    }
    if (figuresChanged || state.drops.length > 0) {
      renderLedger(state, view, fresh);
    }
  } catch {
    // The next poll retries; the desk keeps its figures.
  }
}

async function loadOrder(state: DeskState, orderId: string): Promise<Order | null> {
  try {
    const response = await api<Order>(`/api/orders/${orderId}`);
    return response.body;
  } catch {
    return null;
  }
}

function renderRail(state: DeskState, view: DeskView): void {
  const rail = view.rail;
  clear(rail);
  if (state.orchards.length === 0) {
    rail.append(h("nav", { "aria-label": "Orchards" },
    h("h2", { class: "rail-heading" }, icon("/icons/map-pin.svg", "Orchards"), " Orchards"),
    h("p", { class: "empty", text: "No orchards yet." })));
    return;
  }
  const list = h("ul");
  for (const orchard of state.orchards) {
    const latest = orchard.orders.at(-1);
    const link = h("a", {
      href: "#",
      "aria-current": orchard.id === state.selectedOrchardId ? "true" : null,
    },
      h("span", { text: orchard.name }),
      h("span", { class: "orchard-county", text: orchard.county }),
      h("span", { class: "orchard-status", text: latest ? `Status: ${latest.status}` : "Status: Draft" }),
    );
    link.addEventListener("click", (event) => {
      event.preventDefault();
      state.selectedOrchardId = orchard.id;
      state.selectedOrderId = null;
      state.selectedBlockId = null;
      void reload(state, view, true).then(() => {
        if (rail.hasAttribute("open")) {
          rail.removeAttribute("open");
          document.querySelector<HTMLButtonElement>(".drawer-toggle")?.focus();
        }
      });
    });
    list.append(h("li", {}, link));
  }
  rail.append(h("nav", { "aria-label": "Orchards" },
    h("h2", { class: "rail-heading" }, icon("/icons/map-pin.svg", "Orchards"), " Orchards"),
    list));
}

interface PlatBlock {
  id: string;
  name: string;
  acres: number;
}

/** Blocks in listed order, tiled across up to three rows like parcels. */
function platRows(blocks: PlatBlock[]): PlatBlock[][] {
  if (blocks.length === 0) return [];
  const rows = Math.min(3, Math.max(1, Math.ceil(blocks.length / 2)));
  const base = Math.floor(blocks.length / rows);
  const extra = blocks.length % rows;
  const result: PlatBlock[][] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    const size = base + (row < extra ? 1 : 0);
    result.push(blocks.slice(index, index + size));
    index += size;
  }
  return result;
}

function renderCanvas(state: DeskState, view: DeskView, order: Order | null): void {
  const canvas = view.canvas;
  clear(canvas);
  if (!order) {
    canvas.append(h("p", { class: "empty", text: state.user.role === "beekeeper" ? "No open orders right now." : "Choose an orchard to see its plat map." }));
    renderBeekeeperLists(state, canvas);
    return;
  }
  const pickerOptions = state.orders
    .filter((entry) => entry.orchard.id === state.selectedOrchardId)
    .sort((a, b) => (a.bloom_start > b.bloom_start ? 1 : -1));
  const orderPicker = h("select", { id: "order-picker" });
  for (const candidate of pickerOptions) {
    orderPicker.append(h("option", {
      value: candidate.id,
      text: `${candidate.ref} — bloom ${formatDateText(candidate.bloom_start)}`,
    }));
  }
  orderPicker.value = order.id;
  orderPicker.addEventListener("change", () => {
    state.selectedOrderId = orderPicker.value;
    state.selectedBlockId = null;
    void reload(state, view, false);
  });
  canvas.append(h("div", { class: "order-picker" },
    h("label", { for: "order-picker", class: "visually-hidden", text: "Order" }),
    orderPicker,
  ));

  const strengthByBlock = new Map((order.blocks ?? []).map((block) => [block.id, block]));
  const platGrid = h("div", { class: "plat-grid" });
  const blocks: PlatBlock[] = (order.blocks ?? []).map((block) => ({
    id: block.id,
    name: block.name,
    acres: block.acres ?? 10,
  }));
  for (const row of platRows(blocks)) {
    const rowElement = h("div", { class: "plat-row" });
    for (const block of row) {
      const strength = strengthByBlock.get(block.id)!;
      const readout = state.readouts.get(block.id) ?? makeBlockReadout(block, {
        average_frames: strength.average_frames,
        tier: strength.tier,
      });
      state.readouts.set(block.id, readout);
      const button = h("button", {
        type: "button",
        class: `block ${tierPattern(strength.tier)}`,
        style: `flex-grow: ${Math.max(block.acres, 1)}`,
        "aria-pressed": state.selectedBlockId === block.id ? "true" : "false",
        "aria-label": blockLabel(block.name, strength.average_frames, strength.tier),
      },
        h("span", { class: "block-name", text: block.name }),
        h("span", { class: "block-acres", text: `${block.acres} acres` }),
        readout.container,
      );
      button.addEventListener("click", () => {
        state.selectedBlockId = block.id;
        for (const element of platGrid.querySelectorAll<HTMLElement>(".block")) {
          element.setAttribute("aria-pressed", element === button ? "true" : "false");
        }
        renderPlacements(state, canvas, order, block.id);
        button.focus();
      });
      rowElement.append(button);
    }
    platGrid.append(rowElement);
  }
  const north = h("span", { class: "north-arrow", "aria-hidden": "true" }, icon("/icons/compass.svg", "North"));
  canvas.append(h("section", {
    class: "plat",
    id: "plat-map",
    role: "group",
    "aria-label": `Plat map, ${order.orchard.name}`,
  },
    platGrid,
    h("p", { class: "plat-notes" }, north, h("span", { text: "Scale: parcels in proportion to acres" })),
  ));

  const legend = h("section", { class: "legend" },
    h("h3", { text: "Tier legend" }),
    h("ul", {},
      legendItem("pattern-uninspected", "Not inspected"),
      legendItem("pattern-none", "None"),
      legendItem("pattern-reduced", "Reduced"),
      legendItem("pattern-standard", "Standard"),
      legendItem("pattern-bonus", "Bonus"),
    ),
  );
  canvas.append(legend);

  renderPlacements(state, canvas, order, state.selectedBlockId);
  renderBeekeeperLists(state, canvas);
}

function legendItem(pattern: string, label: string): HTMLElement {
  return h("li", {}, h("span", { class: `swatch ${pattern}`, "aria-hidden": "true" }), h("span", { text: label }));
}

function blockLabel(name: string, average: number | null, tier: string | null): string {
  return average === null || tier === null
    ? `${name}, Not inspected`
    : `${name}, ${tierLabel(tier)}, ${average.toFixed(1)} frames`;
}

function renderPlacements(state: DeskState, canvas: HTMLElement, order: Order, blockId: string | null): void {
  document.getElementById("placements-area")?.remove();
  const block = order.blocks?.find((entry) => entry.id === blockId);
  if (!block) return;
  const area = h("section", { id: "placements-area" });
  const isBroker = state.user.role === "broker";
  const head = isBroker
    ? ["Yard", "Hives", "Delivered", "Strength", "Beekeeper", "Status", "Pay per hive", "Payout"]
    : ["Yard", "Hives", "Delivered", "Strength"];
  const table = h("table", { class: "responsive", "aria-label": `Placements, ${block.name}` });
  table.append(h("thead", {}, h("tr", {}, ...head.map((label) => h("th", { scope: "col", text: label })))));
  const body = h("tbody");
  if (!block.placements || block.placements.length === 0) {
    area.append(table, h("p", { class: "empty", text: "No drops in this block yet." }));
  } else {
    area.append(table);
    for (const placement of block.placements) {
      const cells: { value: string; label: string; numeric?: boolean }[] = [
        { value: placement.yard_name, label: head[0]! },
        { value: String(placement.hives), label: head[1]!, numeric: true },
        { value: formatDateText(placement.delivered_on), label: head[2]! },
        { value: placement.average_frames === null ? "—" : `${placement.average_frames.toFixed(1)} frames`, label: head[3]! },
      ];
      if (isBroker) {
        cells.push(
          { value: placement.beekeeper?.name ?? "—", label: head[4]! },
          { value: DROP_STATUS_LABELS[placement.status ?? ""] ?? "—", label: head[5]! },
          { value: placement.pay_per_hive_cents == null ? "—" : formatMoney(placement.pay_per_hive_cents), label: head[6]!, numeric: true },
          { value: placement.payout_cents == null ? "—" : formatMoney(placement.payout_cents), label: head[7]!, numeric: true },
        );
      }
      body.append(h("tr", {}, ...cells.map((cell) =>
        h("td", { class: cell.numeric ? "num" : "", "data-label": cell.label, text: cell.value }))));
    }
    table.append(body);
  }
  area.prepend(h("h3", { text: `Placements, ${block.name}` }));
  canvas.append(area);
}

function renderBeekeeperLists(state: DeskState, canvas: HTMLElement): void {
  document.getElementById("open-orders-area")?.remove();
  document.getElementById("my-drops-area")?.remove();
  if (state.user.role !== "beekeeper") return;
  const view: DeskView = { rail: document.getElementById("rail")!, canvas, ledger: document.getElementById("ledger-column")! };

  const ordersArea = h("section", { id: "open-orders-area" });
  ordersArea.append(h("h3", { text: "Open orders" }));
  const openOrders = state.orders.filter((order) => order.status === "open");
  if (openOrders.length === 0) {
    ordersArea.append(h("p", { class: "empty", text: "No open orders right now." }));
  }
  for (const order of openOrders) {
    const payByTier = order.pay_per_hive_cents ?? {};
    const payText = `None ${formatMoney(payByTier.none ?? 0)} · Reduced ${formatMoney(payByTier.reduced ?? 0)} · Standard ${formatMoney(payByTier.standard ?? 0)} · Bonus ${formatMoney(payByTier.bonus ?? 0)}`;
    ordersArea.append(h("article", { class: "open-order" },
      h("p", {}, h("strong", { text: `${order.ref} · ${order.orchard.name}` })),
      h("p", { class: "num", text: `Deadline ${formatDateText(order.delivery_deadline)} · Still open ${order.hives_remaining ?? 0} hives` }),
      h("p", { class: "num", text: `Pay per hive: ${payText}` }),
      h("button", {
        type: "button",
        text: `Commit truckload to ${order.ref}`,
        onclick: (event: Event) => openCommitDialog(state, order, event.target as HTMLButtonElement, view),
      }),
    ));
  }
  canvas.append(ordersArea);

  const dropsArea = h("section", { id: "my-drops-area" });
  dropsArea.append(h("h3", { text: "My drops" }));
  const drops = state.drops;
  if (drops.length === 0) {
    dropsArea.append(h("p", { class: "empty", text: "You haven't committed any truckloads yet." }));
  } else {
    const head = ["Yard", "Hives", "Status", "Block", "Delivered", "Expected pay", "Open"];
    const table = h("table", { class: "responsive", "aria-label": "My drops" });
    table.append(h("thead", {}, h("tr", {}, ...head.map((label) => h("th", { scope: "col", text: label })))));
    const body = h("tbody");
    for (const drop of drops) {
      const order = state.orders.find((entry) => entry.id === drop.order.id);
      body.append(h("tr", {},
        h("td", { "data-label": "Yard" }, h("a", { href: `/desk/drops/${drop.id}`, text: `View drop ${drop.yard_name}, ${drop.hives} hives` })),
        h("td", { class: "num", "data-label": "Hives", text: String(drop.hives) }),
        h("td", { "data-label": "Status", text: DROP_STATUS_LABELS[drop.status] ?? drop.status }),
        h("td", { "data-label": "Block", text: drop.block?.name ?? "—" }),
        h("td", { class: "num", "data-label": "Delivered", text: drop.delivered_on ? formatDateText(drop.delivered_on) : "—" }),
        h("td", { class: "num", "data-label": "Expected pay", text: expectedPay(drop) }),
        h("td", { "data-label": "Open" },
          drop.status === "committed" && order
            ? h("button", { type: "button", text: "Log drop", onclick: (event: Event) => { void openLogDropDialog(state, order, drop, event.target as HTMLButtonElement, view); } })
            : "",
        ),
      ));
    }
    table.append(body);
    dropsArea.append(table);
  }
  canvas.append(dropsArea);
}

function expectedPay(drop: Drop): string {
  if (drop.payout_cents != null) return formatMoney(drop.payout_cents);
  if (drop.tier && drop.pay_per_hive_cents) return formatMoney(drop.pay_per_hive_cents * drop.hives);
  return "—";
}

function renderLedger(state: DeskState, view: DeskView, order: Order | null): void {
  const ledgerColumn = view.ledger;
  clear(ledgerColumn);
  const section = h("section", { class: "ledger" });
  const actions = h("div", { class: "ledger-actions" });
  if (!order) {
    // An orchard with no order yet still lets the broker draft one.
    if (state.user.role === "broker") {
      actions.append(
        h("button", { type: "button", text: "New orchard", onclick: (event: Event) => openOrchardDialog(state, event.target as HTMLButtonElement, view) }),
        h("button", { type: "button", text: "New order", onclick: (event: Event) => openNewOrderDialog(state, event.target as HTMLButtonElement, view) }),
      );
      section.append(actions);
    }
    ledgerColumn.append(section);
    return;
  }
  const isBroker = state.user.role === "broker";
  const isGrower = state.user.role === "grower";
  section.append(h("h3", { class: "visually-hidden", text: "Order ledger" }));
  const table = h("table", { class: "responsive", "aria-label": "Order ledger" });
  const body = h("tbody");
  const row = (label: string, value: string): void => {
    body.append(h("tr", {},
      h("th", { scope: "row", text: label }),
      h("td", { class: "num", text: value })));
  };
  if (isBroker) {
    row("Ordered", String(order.hives_ordered));
    row("Committed", String(order.hives_committed ?? 0));
    row("Delivered", String(order.hives_delivered ?? 0));
    row("Deposit", formatMoney(order.deposit_cents ?? 0));
    row("Payable", formatMoney(order.payable_cents ?? 0));
    row("Commission", formatMoney(order.commission_cents ?? 0));
    row("Beekeeper payouts", formatMoney((order.payable_cents ?? 0) - (order.commission_cents ?? 0)));
  } else if (isGrower) {
    row("Ordered", String(order.hives_ordered));
    row("Delivered", String(order.hives_delivered ?? 0));
    row("Deposit", formatMoney(order.deposit_cents ?? 0));
    row("Payable", formatMoney(order.payable_cents ?? 0));
  } else {
    const mine = state.drops.filter((drop) => drop.order.id === order.id);
    const committed = mine.filter((drop) => drop.status === "committed").reduce((sum, drop) => sum + drop.hives, 0);
    const delivered = mine.filter((drop) => drop.status !== "committed").reduce((sum, drop) => sum + drop.hives, 0);
    const pay = mine.reduce((sum, drop) => sum + (drop.payout_cents ?? (drop.tier && drop.pay_per_hive_cents ? drop.pay_per_hive_cents * drop.hives : 0)), 0);
    row("Ordered", String(order.hives_ordered));
    row("Still open", String(order.hives_remaining ?? 0));
    row("My committed", String(committed));
    row("My delivered", String(delivered));
    row("My expected pay", formatMoney(pay));
  }
  table.append(body);
  section.append(table);
  const status = orderStatusLabel(order);
  if (state.lastStatus === null) state.lastStatus = status;
  section.append(h("p", { class: "status-line", text: `Order status: ${status}` }));
  section.append(h("p", { class: "status-line bloom-window" },
    `Bloom ${formatDateText(order.bloom_start)} to ${formatDateText(order.bloom_end)} · Delivery deadline ${formatDateText(order.delivery_deadline)}`));

  if (isBroker) {
    actions.append(
      h("button", { type: "button", text: "New orchard", onclick: (event: Event) => openOrchardDialog(state, event.target as HTMLButtonElement, view) }),
      h("button", { type: "button", text: "New order", onclick: (event: Event) => openNewOrderDialog(state, event.target as HTMLButtonElement, view) }),
    );
    if (order.status === "draft") {
      actions.append(h("button", { type: "button", text: "Open order", onclick: (event: Event) => runOrderAction(state, order, event.target as HTMLButtonElement, view) }));
    }
    if (["draft", "open", "filled"].includes(order.status)) {
      actions.append(h("button", { type: "button", text: "Cancel order", onclick: (event: Event) => runCancelOrder(state, order, event.target as HTMLButtonElement, view) }));
    }
    if (order.status === "filled") {
      actions.append(h("button", { type: "button", text: "Mark placed", onclick: (event: Event) => runPlaceOrder(state, order, event.target as HTMLButtonElement, view) }));
    }
    if (order.status === "placed") {
      actions.append(h("button", { type: "button", text: "Send inspection link", onclick: (event: Event) => openLinkDialog(state, order, event.target as HTMLButtonElement, view) }));
    }
    if (order.status === "inspected" && order.settlement_status === "none") {
      actions.append(h("button", { type: "button", text: "Settle orchard", onclick: (event: Event) => openSettleDialog(state, order, event.target as HTMLButtonElement, view) }));
    }
    if (order.inspection_link) {
      section.append(h("p", { class: "link-status", text: `Inspection link: ${LINK_STATUS_LABELS[order.inspection_link.status] ?? order.inspection_link.status} to ${order.inspection_link.inspector_email}, expires ${formatDateTimeText(order.inspection_link.expires_at)}` }));
    }
  }
  if (isGrower && order.report_available) {
    actions.append(h("a", { class: "button", href: `/api/orders/${order.id}/report`, text: "Inspection report (PDF)" }));
  }
  section.append(actions);
  ledgerColumn.append(section);
}
