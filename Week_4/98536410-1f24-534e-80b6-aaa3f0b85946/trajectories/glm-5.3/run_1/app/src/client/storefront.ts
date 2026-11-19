// Storefront pages: catalogue, product, cart with checkout, order page.
import { ApiFailure, Figure, Sheet, StaleAnswer, clear, el, euroText, formatCountdown, historyParams, reducedMotion, trapFocus } from "./core.js";
import type { AppContext } from "./app.js";
import { navigate, readTabStateFor, writeTabState } from "./app.js";

interface CartLine {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
  line_total_cents: number;
  vat_cents: number | null;
  available: number | null;
  status: "ok" | "short";
}

interface CartAnswer {
  store_id: string | null;
  store_name: string | null;
  area: { lat: number; lon: number } | null;
  lines: CartLine[];
  total_cents: number;
  vat_cents: number | null;
  units: number;
  hold: HoldAnswer | null;
}

interface HoldAnswer {
  id: string;
  status: string;
  store_id: string;
  lines: { sku: string; quantity: number }[];
  created_at: string;
  expires_at: string;
  seconds_left: number;
  released_at: string | null;
}

interface ProductAnswer {
  sku: string;
  name: string;
  unit_price_milli: number;
}

interface AvailabilityAnswer {
  sku: string;
  lat: number;
  lon: number;
  shops: { store_id: string; name: string; city: string; distance_km: number; on_hand: number; held: number; available: number; display_state: string; holdable: boolean }[];
}

interface CartShopsAnswer {
  shops: { store_id: string; name: string; distance_km: number; complete: boolean }[];
}

interface SlotsAnswer {
  store_id: string;
  timezone: string;
  days: { date: string; slots: { start_local: string; start_utc: string; utc_offset: string; remaining: number }[] }[];
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
  lines: { sku: string; name: string; quantity: number; unit_price_milli: number; line_total_cents: number; vat_rate: number; vat_cents: number; returned_quantity: number }[];
  total_cents: number;
  vat_cents: number;
  refunded_cents: number;
  created_at: string;
}

const AREAS = [
  { name: "Lisboa", lat: 38.7223, lon: -9.1393 },
  { name: "Porto", lat: 41.1579, lon: -8.6291 },
  { name: "Faro", lat: 37.0194, lon: -7.9304 },
  { name: "Coimbra", lat: 40.2033, lon: -8.4103 },
  { name: "Braga", lat: 41.5454, lon: -8.4265 },
  { name: "Ponta Delgada", lat: 37.7412, lon: -25.6756 },
  { name: "Angra do Heroísmo", lat: 38.655, lon: -27.221 },
];

function newRequestKey(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 20; i += 1) {
    key += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `req-${key}`;
}

// --- Catalogue ---

export function mountCatalogue(ctx: AppContext): () => void {
  const root = ctx.root;
  const main = el("main");
  main.id = "catalogue";

  const search = el("input");
  search.type = "search";
  search.setAttribute("aria-label", "Search products");
  search.className = "catalogue-search";
  main.appendChild(search);

  const statusResults = el("div");
  statusResults.className = "status";
  statusResults.setAttribute("role", "status");
  statusResults.setAttribute("aria-label", "Catalogue results");
  main.appendChild(statusResults);

  const grid = el("div");
  grid.className = "catalogue-grid";
  main.appendChild(grid);
  root.appendChild(main);
  search.focus();

  let timer: number | null = null;
  let generation = 0;

  async function runSearch(): Promise<void> {
    const gen = ++generation;
    const q = search.value.trim();
    statusResults.textContent = "Searching...";
    try {
      const answer = await ctx.api.get<{ count: number; products: ProductAnswer[] }>(
        `/api/products${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      );
      if (gen !== generation) return;
      clear(grid);
      for (const product of answer.products) {
        const card = el("div");
        card.className = "product-card";
        const link = el("a");
        link.href = `/products/${product.sku}`;
        link.textContent = product.name;
        card.appendChild(link);
        const price = el("span");
        price.className = "num";
        price.textContent = euroText(Math.round(product.unit_price_milli / 10));
        card.appendChild(price);
        grid.appendChild(card);
      }
      statusResults.textContent = `${answer.count} products found.`;
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      statusResults.textContent = "Something went wrong. Try again.";
    }
  }

  search.addEventListener("input", () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(runSearch, 300);
  });

  void runSearch();
  return () => {
    if (timer !== null) window.clearTimeout(timer);
  };
}

// --- Product page ---

export function mountProduct(ctx: AppContext): () => void {
  const root = ctx.root;
  const sku = window.location.pathname.split("/")[2];
  const main = el("main");
  main.id = "product-page";

  const layout = el("div");
  layout.className = "product-layout";
  const item = el("div");
  item.className = "panel-white product-item";
  layout.appendChild(item);

  const right = el("div");
  const areaWrap = el("div");
  areaWrap.className = "panel-charcoal";
  const listWrap = el("div");
  right.appendChild(areaWrap);
  right.appendChild(listWrap);
  layout.appendChild(right);
  main.appendChild(layout);

  const statusRanking = el("div");
  statusRanking.className = "status";
  statusRanking.setAttribute("role", "status");
  statusRanking.setAttribute("aria-label", "Shop ranking");
  const statusCart = el("div");
  statusCart.className = "status";
  statusCart.setAttribute("role", "status");
  statusCart.setAttribute("aria-label", "Cart updates");
  main.appendChild(statusRanking);
  main.appendChild(statusCart);

  root.appendChild(main);

  let quantityValue = "1";
  let cartArea: { lat: number; lon: number } | null = null;
  let areaChoice: string | null = null;
  let rankedGeneration = 0;
  let priceMilli = 0;
  let addPending = false;
  const timers: number[] = [];

  const heading = el("h1");
  item.appendChild(heading);
  const priceLine = el("p");
  priceLine.className = "num";
  item.appendChild(priceLine);
  const quantityLabel = el("label");
  quantityLabel.htmlFor = "quantity";
  quantityLabel.textContent = "Quantity";
  const quantity = el("input");
  quantity.id = "quantity";
  quantity.type = "number";
  quantity.min = "1";
  quantity.max = "999";
  quantity.value = quantityValue;
  quantity.setAttribute("aria-label", "Quantity");
  const quantityError = el("p");
  quantityError.className = "field-error";
  item.appendChild(quantityLabel);
  item.appendChild(quantity);
  item.appendChild(quantityError);
  const addBtn = el("button");
  addBtn.className = "btn";
  addBtn.textContent = "Add to cart";
  item.appendChild(addBtn);
  const cartTotalLine = el("p");
  const cartTotal = el("span");
  cartTotal.className = "num";
  cartTotal.setAttribute("data-figure", "cart-total");
  const cartFigure = new Figure(cartTotal, { unit: "cents" });
  cartTotalLine.appendChild(document.createTextNode("Cart total: "));
  cartTotalLine.appendChild(cartTotal);
  item.appendChild(cartTotalLine);

  const areaLabel = el("label");
  areaLabel.htmlFor = "area";
  areaLabel.textContent = "Your area";
  const area = el("select");
  area.id = "area";
  area.setAttribute("aria-label", "Your area");
  const emptyOption = el("option");
  emptyOption.value = "";
  emptyOption.textContent = "Choose your area";
  area.appendChild(emptyOption);
  for (const a of AREAS) {
    const option = el("option");
    option.value = a.name;
    option.textContent = a.name;
    area.appendChild(option);
  }
  const useLocation = el("button");
  useLocation.className = "btn";
  useLocation.textContent = "Use my location";
  areaWrap.appendChild(areaLabel);
  areaWrap.appendChild(area);
  areaWrap.appendChild(useLocation);

  const shopList = el("ul");
  shopList.className = "shop-list";
  shopList.setAttribute("role", "list");
  shopList.setAttribute("aria-label", "Shops with this item");
  shopList.setAttribute("data-phase", "settled");
  listWrap.appendChild(shopList);

  quantity.addEventListener("input", () => {
    quantityValue = quantity.value;
    if (quantityError.textContent) quantityError.textContent = "";
  });

  addBtn.addEventListener("click", async () => {
    const parsed = Number(quantityValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999) {
      quantityError.textContent = "Enter a whole number from 1 to 999.";
      quantity.setAttribute("aria-invalid", "true");
      quantity.setAttribute("aria-describedby", "quantity-error");
      quantityError.id = "quantity-error";
      return;
    }
    if (addPending) return;
    addPending = true;
    try {
      const cart = await ctx.api.get<CartAnswer>("/api/cart");
      const existing = cart.lines.find((l) => l.sku === sku)?.quantity ?? 0;
      const next = existing + parsed;
      if (next > 999) {
        statusCart.textContent = "Something went wrong. Try again.";
        addPending = false;
        return;
      }
      const updated = await ctx.api.put<CartAnswer>(`/api/cart/lines/${sku}`, { quantity: next });
      cartFigure.set(updated.total_cents);
      statusCart.textContent = `Cart total ${euroText(updated.total_cents)}.`;
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      statusCart.textContent = "Something went wrong. Try again.";
    }
    addPending = false;
  });

  async function saveArea(lat: number, lon: number): Promise<void> {
    try {
      await ctx.api.put<CartAnswer>("/api/cart/area", { lat, lon });
      cartArea = { lat, lon };
      void reloadCartTotal();
      await reloadRanking(lat, lon, null);
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      statusRanking.textContent = "Something went wrong. Try again.";
    }
  }

  area.addEventListener("change", () => {
    const chosen = AREAS.find((a) => a.name === area.value);
    if (!chosen) return;
    areaChoice = chosen.name;
    void saveArea(chosen.lat, chosen.lon);
  });

  useLocation.addEventListener("click", () => {
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        areaChoice = null;
        area.value = "";
        void saveArea(position.coords.latitude, position.coords.longitude);
      },
      () => {
        statusRanking.textContent = "Something went wrong. Try again.";
      },
    );
  });

  async function reloadCartTotal(): Promise<void> {
    try {
      const cart = await ctx.api.get<CartAnswer>("/api/cart");
      cartFigure.set(cart.total_cents);
      if (cart.area) {
        cartArea = cart.area;
        const match = AREAS.find(
          (a) => Math.abs(a.lat - cart.area!.lat) < 0.0001 && Math.abs(a.lon - cart.area!.lon) < 0.0001,
        );
        areaChoice = match?.name ?? null;
        area.value = match?.name ?? "";
        if (cartArea && shopList.children.length === 0) {
          void reloadRanking(cartArea.lat, cartArea.lon, match?.name ?? null);
        }
      }
      const chosen = cart.store_id;
      for (const child of Array.from(shopList.children)) {
        const btn = child.querySelector<HTMLButtonElement>("button");
        if (btn) btn.setAttribute("aria-pressed", btn.dataset.storeId === chosen ? "true" : "false");
      }
    } catch {
      void 0;
    }
  }

  async function reloadRanking(lat: number, lon: number, areaName: string | null): Promise<void> {
    const gen = ++rankedGeneration;
    statusRanking.textContent = "Ranking shops...";
    try {
      const answer = await ctx.api.get<AvailabilityAnswer>(
        `/api/products/${sku}/availability?lat=${lat}&lon=${lon}`,
      );
      if (gen !== rankedGeneration) return;
      const existing = new Map<string, HTMLElement>();
      for (const child of Array.from(shopList.children)) {
        const node = child as HTMLElement;
        if (node.dataset.storeId) existing.set(node.dataset.storeId, node);
      }
      const keep = new Set<string>();
      answer.shops.forEach((shop, index) => {
        keep.add(shop.store_id);
        let item = existing.get(shop.store_id);
        if (!item) {
          item = el("li");
          item.dataset.storeId = shop.store_id;
          const name = el("span");
          name.className = "shop-name";
          item.appendChild(name);
          const dist = el("span");
          dist.className = "num distance";
          dist.setAttribute("data-figure", "distance");
          item.appendChild(dist);
          const avail = el("span");
          avail.className = "num shop-available";
          avail.setAttribute("data-figure", "shop-available");
          item.appendChild(avail);
          const btn = el("button");
          btn.className = "btn small";
          btn.dataset.storeId = shop.store_id;
          btn.addEventListener("click", async () => {
            try {
              const cart = await ctx.api.put<CartAnswer>("/api/cart/store", { store_id: shop.store_id });
              for (const child2 of Array.from(shopList.children)) {
                const other = child2.querySelector<HTMLButtonElement>("button");
                if (other) other.setAttribute("aria-pressed", other.dataset.storeId === shop.store_id ? "true" : "false");
              }
              void cart;
              btn.focus();
            } catch {
              statusCart.textContent = "Something went wrong. Try again.";
            }
          });
          item.appendChild(btn);
          shopList.appendChild(item);
        }
        item.dataset.rank = String(index + 1);
        const nameEl = item.querySelector<HTMLElement>(".shop-name");
        if (nameEl) nameEl.textContent = `${shop.name} (${shop.city})`;
        const distEl = item.querySelector<HTMLElement>(".distance");
        if (distEl) {
          distEl.textContent = `${shop.distance_km.toFixed(2)} km`;
          distEl.setAttribute("data-value", shop.distance_km.toFixed(2));
        }
        const availEl = item.querySelector<HTMLElement>(".shop-available");
        if (availEl) {
          availEl.textContent = `${shop.available} available`;
          availEl.setAttribute("data-value", String(shop.available));
        }
        const btn = item.querySelector<HTMLButtonElement>("button");
        if (btn) {
          btn.textContent = "Collect from";
          btn.setAttribute("aria-label", `Collect from ${shop.name}`);
          btn.setAttribute("aria-pressed", "false");
        }
      });
      for (const [id, node] of existing) {
        if (!keep.has(id)) node.remove();
      }
      if (!reducedMotion() && shopList.getAttribute("data-phase") !== "settled") {
        shopList.setAttribute("data-phase", "moving");
        window.setTimeout(() => shopList.setAttribute("data-phase", "settled"), 260);
      }
      statusRanking.textContent = areaName
        ? `${answer.shops.length} shops ranked from ${areaName}.`
        : `${answer.shops.length} shops ranked from your location.`;
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      statusRanking.textContent = "Something went wrong. Try again.";
    }
  }

  void ctx.api
    .get<ProductAnswer>(`/api/products/${sku}`)
    .then((product) => {
      heading.textContent = product.name;
      priceMilli = product.unit_price_milli;
      priceLine.textContent = euroText(Math.round(product.unit_price_milli / 10));
      document.title = `${product.name} — Tramela Estate`;
    })
    .catch(() => {
      navigate("/catalogue");
    });

  void reloadCartTotal();

  return () => {
    for (const timer of timers) window.clearInterval(timer);
  };
}

function updateCheckoutListNodes(list: HTMLElement, answer: CartAnswer): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(list.children)) {
    const node = child as HTMLElement;
    if (node.dataset.sku) existing.set(node.dataset.sku, node);
  }
  const keep = new Set<string>();
  for (const line of answer.lines) {
    keep.add(line.sku);
    let item = existing.get(line.sku);
    if (!item) {
      item = el("li");
      item.dataset.sku = line.sku;
      list.appendChild(item);
    }
    const shortText = line.status === "short" ? ` Only ${line.available} left at ${answer.store_name}.` : "";
    item.textContent = `${line.name} × ${line.quantity}.${shortText}`;
  }
  for (const [sku, node] of existing) {
    if (!keep.has(sku)) node.remove();
  }
}

// --- Cart page with checkout ---

export function mountCart(ctx: AppContext): () => void {
  const root = ctx.root;
  const checkoutOpen = historyParams().get("checkout") === "open";
  const timers: number[] = [];

  const main = el("main");
  main.id = "cart-page";
  const layout = el("div");
  layout.className = "cart-layout";

  const linesWrap = el("div");
  const linesScroll = el("div");
  linesScroll.className = "table-scroll";
  const linesTable = el("table");
  linesTable.className = "data";
  linesTable.setAttribute("aria-label", "Cart lines");
  const thead = el("thead");
  const headRow = el("tr");
  for (const head of ["Item", "Quantity", "Total", "Status"]) {
    const th = el("th");
    th.textContent = head;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  linesTable.appendChild(thead);
  const tbody = el("tbody");
  linesTable.appendChild(tbody);
  linesScroll.appendChild(linesTable);
  linesWrap.appendChild(linesScroll);

  const totals = el("div");
  totals.className = "panel-charcoal cart-totals";
  const totalFigureEl = el("p");
  const totalFigure = el("span");
  totalFigure.className = "num";
  totalFigure.setAttribute("data-figure", "cart-total");
  const totalFigureAnim = new Figure(totalFigure, { unit: "cents" });
  totalFigureEl.appendChild(document.createTextNode("Total: "));
  totalFigureEl.appendChild(totalFigure);
  totals.appendChild(totalFigureEl);
  const checkoutBtn = el("button");
  checkoutBtn.className = "btn";
  checkoutBtn.textContent = "Checkout";
  totals.appendChild(checkoutBtn);
  const emptyNote = el("p");
  totals.appendChild(emptyNote);

  layout.appendChild(linesWrap);
  layout.appendChild(totals);
  main.appendChild(layout);

  const statusCart = el("div");
  statusCart.className = "status";
  statusCart.setAttribute("role", "status");
  statusCart.setAttribute("aria-label", "Cart updates");
  main.appendChild(statusCart);
  root.appendChild(main);

  let cart: CartAnswer | null = null;
  let holdTimer: number | null = null;
  let holdSecondsLeft = 0;
  let holdExpiresAt = 0;
  let oneMinuteAnnounced = false;
  let holdState = "checking";

  const savedCheckout = readTabStateFor("checkout", ctx.me.user.id);

  interface CheckoutState {
    shopId: string | null;
    day: string | null;
    time: string | null;
    name: string;
    email: string;
    focusedControl: string | null;
    scrollTop: number;
    requestKey: string;
    requestBody: Record<string, unknown> | null;
  }

  const checkout: CheckoutState = {
    shopId: null,
    day: null,
    time: null,
    name: "",
    email: "",
    focusedControl: null,
    scrollTop: 0,
    requestKey: newRequestKey(),
    requestBody: null,
  };

  if (savedCheckout) {
    checkout.shopId = (savedCheckout.shopId as string) ?? null;
    checkout.day = (savedCheckout.day as string) ?? null;
    checkout.time = (savedCheckout.time as string) ?? null;
    checkout.name = (savedCheckout.name as string) ?? "";
    checkout.email = (savedCheckout.email as string) ?? "";
    checkout.focusedControl = (savedCheckout.focusedControl as string) ?? null;
    checkout.scrollTop = (savedCheckout.scrollTop as number) ?? 0;
    checkout.requestKey = (savedCheckout.requestKey as string) ?? newRequestKey();
    checkout.requestBody = (savedCheckout.requestBody as Record<string, unknown>) ?? null;
  }

  function persistCheckout(open: boolean): void {
    writeTabState({
      kind: "checkout",
      accountId: ctx.me.user.id,
      open,
      shopId: checkout.shopId,
      day: checkout.day,
      time: checkout.time,
      name: checkout.name,
      email: checkout.email,
      focusedControl: document.activeElement?.id ?? null,
      scrollTop: dialogScroll?.scrollTop ?? 0,
      requestKey: checkout.requestKey,
      requestBody: checkout.requestBody,
    });
  }

  async function reloadCart(): Promise<CartAnswer | null> {
    try {
      const answer = await ctx.api.get<CartAnswer>("/api/cart");
      cart = answer;
      renderLines(answer);
      totalFigureAnim.set(answer.total_cents);
      if (answer.hold) {
        holdSecondsLeft = answer.hold.seconds_left;
        holdExpiresAt = new Date(answer.hold.expires_at).getTime();
        holdState = answer.hold.status;
        if (dialogEl && holdTimerEl) {
          holdTimerEl.textContent = formatCountdown(holdSecondsLeft);
          holdTimerEl.setAttribute("data-seconds-left", String(holdSecondsLeft));
          holdTimerEl.setAttribute("data-hold-state", holdState);
        }
      }
      if (answer.lines.length === 0) {
        emptyNote.textContent = "Your cart is empty.";
      } else {
        emptyNote.textContent = "";
      }
      return answer;
    } catch (err) {
      if (err instanceof StaleAnswer) return null;
      return null;
    }
  }

  function renderLines(answer: CartAnswer): void {
    const existing = new Map<string, HTMLElement>();
    for (const child of Array.from(tbody.children)) {
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
        const nameCell = el("td");
        nameCell.textContent = line.name;
        row.appendChild(nameCell);
        const qtyCell = el("td");
        const qty = el("input");
        qty.type = "number";
        qty.min = "0";
        qty.max = "999";
        qty.setAttribute("aria-label", `Quantity of ${line.sku}`);
        qty.addEventListener("change", async () => {
          const value = Number(qty.value);
          if (!Number.isInteger(value) || value < 0 || value > 999) {
            qty.value = String(line.quantity);
            statusCart.textContent = "Something went wrong. Try again.";
            return;
          }
          try {
            const updated = await ctx.api.put<CartAnswer>(`/api/cart/lines/${line.sku}`, { quantity: value });
            renderLines(updated);
            totalFigureAnim.set(updated.total_cents);
            statusCart.textContent = `Cart total ${euroText(updated.total_cents)}.`;
            if (dialogEl) {
              const list = dialogEl.querySelector<HTMLElement>("[aria-label='Checkout lines']");
              if (list) updateCheckoutListNodes(list, updated);
            }
          } catch {
            qty.value = String(line.quantity);
            statusCart.textContent = "Something went wrong. Try again.";
          }
        });
        qtyCell.appendChild(qty);
        row.appendChild(qtyCell);
        const totalCell = el("td");
        totalCell.className = "num";
        row.appendChild(totalCell);
        const statusCell = el("td");
        const shortMsg = el("span");
        statusCell.appendChild(shortMsg);
        const removeWrap = el("td");
        const remove = el("button");
        remove.className = "btn small";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${line.sku}`);
        remove.addEventListener("click", async () => {
          try {
            const updated = await ctx.api.put<CartAnswer>(`/api/cart/lines/${line.sku}`, { quantity: 0 });
            renderLines(updated);
            totalFigureAnim.set(updated.total_cents);
            statusCart.textContent = `Cart total ${euroText(updated.total_cents)}.`;
          } catch {
            statusCart.textContent = "Something went wrong. Try again.";
          }
        });
        removeWrap.appendChild(remove);
        row.appendChild(removeWrap);
        tbody.appendChild(row);
      }
      const qtyInput = row.querySelector<HTMLInputElement>("input");
      if (qtyInput && qtyInput.value === "") qtyInput.value = String(line.quantity);
      else if (qtyInput) qtyInput.value = String(line.quantity);
      const totalCell = row.children[2];
      totalCell.textContent = euroText(line.line_total_cents);
      const shortMsg = row.querySelector<HTMLElement>("td:nth-child(4) span");
      if (shortMsg) {
        if (line.status === "short") {
          shortMsg.textContent = `Only ${line.available} left at ${answer.store_name}.`;
        } else {
          shortMsg.textContent = "";
        }
      }
    }
    for (const [sku, row] of existing) {
      if (!keep.has(sku)) row.remove();
    }
  }

  // --- Checkout dialog ---
  let dialogOpen = false;
  let dialogEl: HTMLElement | null = null;
  let dialogScroll: HTMLElement | null = null;
  let holdTimerEl: HTMLElement | null = null;
  let holdMeterEl: HTMLElement | null = null;
  let placeOrderBtn: HTMLButtonElement | null = null;
  let closeCheckoutBtn: HTMLButtonElement | null = null;
  let stockChangedOpen = false;
  let placing = false;

  checkoutBtn.addEventListener("click", () => openCheckout(false));

  function openCheckout(restored: boolean): void {
    if (dialogEl) return;
    dialogOpen = true;
    window.history.replaceState({}, "", "/cart?checkout=open");
    const backdrop = el("div");
    backdrop.className = "dialog-backdrop";
    const dialog = el("div");
    dialog.className = "dialog wide";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Checkout");
    dialog.setAttribute("data-state", restored ? "open" : "opening");
    dialogEl = dialog;
    const scroller = el("div");
    scroller.className = "dialog-scroll";
    scroller.style.maxHeight = "80vh";
    scroller.style.overflowY = "auto";
    dialogScroll = scroller;

    const statusCheckoutTotal = el("div");
    statusCheckoutTotal.className = "status";
    statusCheckoutTotal.setAttribute("role", "status");
    statusCheckoutTotal.setAttribute("aria-label", "Checkout total");
    const statusHold = el("div");
    statusHold.className = "status";
    statusHold.setAttribute("role", "status");
    statusHold.setAttribute("aria-label", "Hold status");
    const statusMessages = el("div");
    statusMessages.className = "status";
    statusMessages.setAttribute("role", "status");
    statusMessages.setAttribute("aria-label", "Checkout messages");

    const h2 = el("h2");
    h2.textContent = "Checkout";
    scroller.appendChild(h2);

    const linesHeading = el("h3");
    linesHeading.textContent = "Items";
    scroller.appendChild(linesHeading);
    const checkoutLines = el("ul");
    checkoutLines.setAttribute("role", "list");
    checkoutLines.setAttribute("aria-label", "Checkout lines");
    scroller.appendChild(checkoutLines);

    const shopGroup = el("fieldset");
    shopGroup.setAttribute("role", "radiogroup");
    shopGroup.setAttribute("aria-label", "Collection shop");
    const shopLegend = el("legend");
    shopLegend.textContent = "Collection shop";
    shopGroup.appendChild(shopLegend);
    scroller.appendChild(shopGroup);

    const holdControls = el("div");
    holdControls.className = "hold-controls";
    scroller.appendChild(holdControls);

    holdTimerEl = el("p");
    holdTimerEl.setAttribute("role", "timer");
    holdTimerEl.setAttribute("aria-label", "Hold time left");
    holdTimerEl.className = "num";
    holdTimerEl.textContent = restored ? "" : "";
    holdMeterEl = el("div");
    holdMeterEl.className = "hold-meter";
    holdMeterEl.style.height = "10px";
    holdMeterEl.style.background = "var(--pink)";
    holdMeterEl.style.borderRadius = "6px";
    scroller.appendChild(holdTimerEl);
    scroller.appendChild(holdMeterEl);

    const dayGroup = el("fieldset");
    dayGroup.setAttribute("role", "radiogroup");
    dayGroup.setAttribute("aria-label", "Collection day");
    const dayLegend = el("legend");
    dayLegend.textContent = "Collection day";
    dayGroup.appendChild(dayLegend);
    scroller.appendChild(dayGroup);

    const timeGroup = el("fieldset");
    timeGroup.setAttribute("role", "radiogroup");
    timeGroup.setAttribute("aria-label", "Collection time");
    const timeLegend = el("legend");
    timeLegend.textContent = "Collection time";
    timeGroup.appendChild(timeLegend);
    scroller.appendChild(timeGroup);

    const nameLabel = el("label");
    nameLabel.htmlFor = "checkout-name";
    nameLabel.textContent = "Full name";
    const nameInput = el("input");
    nameInput.id = "checkout-name";
    nameInput.value = checkout.name;
    nameInput.setAttribute("aria-label", "Full name");
    scroller.appendChild(nameLabel);
    scroller.appendChild(nameInput);

    const emailLabel = el("label");
    emailLabel.htmlFor = "checkout-email";
    emailLabel.textContent = "Email";
    const emailInput = el("input");
    emailInput.id = "checkout-email";
    emailInput.value = checkout.email;
    emailInput.setAttribute("aria-label", "Email");
    scroller.appendChild(emailLabel);
    scroller.appendChild(emailInput);

    const totalLine = el("p");
    const checkoutTotalEl = el("span");
    checkoutTotalEl.className = "num";
    checkoutTotalEl.setAttribute("data-figure", "checkout-total");
    totalLine.appendChild(document.createTextNode("Total: "));
    totalLine.appendChild(checkoutTotalEl);
    scroller.appendChild(totalLine);

    placeOrderBtn = el("button");
    placeOrderBtn.className = "btn";
    placeOrderBtn.textContent = "Place order";
    scroller.appendChild(placeOrderBtn);
    closeCheckoutBtn = el("button");
    closeCheckoutBtn.className = "btn";
    closeCheckoutBtn.textContent = "Close checkout";
    scroller.appendChild(closeCheckoutBtn);

    scroller.appendChild(statusCheckoutTotal);
    scroller.appendChild(statusHold);
    scroller.appendChild(statusMessages);
    dialog.appendChild(scroller);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    if (!restored && !reducedMotion()) {
      window.setTimeout(() => dialog.setAttribute("data-state", "open"), 200);
    } else {
      dialog.setAttribute("data-state", "open");
    }

    const checkoutTotalFigure = new Figure(checkoutTotalEl, { unit: "cents" });

    nameInput.addEventListener("input", () => {
      checkout.name = nameInput.value;
      checkout.requestBody = null;
      persistCheckout(true);
    });
    emailInput.addEventListener("input", () => {
      checkout.email = emailInput.value;
      checkout.requestBody = null;
      persistCheckout(true);
    });

    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !stockChangedOpen) trapFocus(dialog, event);
      if (event.key === "Escape" && !stockChangedOpen) {
        event.preventDefault();
        closeCheckout();
      }
    });

    closeCheckoutBtn.addEventListener("click", () => closeCheckout());

    function closeCheckout(): void {
      persistCheckout(false);
      dialogOpen = false;
      backdrop.remove();
      dialogEl = null;
      window.history.replaceState({}, "", "/cart");
      checkoutBtn.focus();
    }

    async function renderCheckoutData(answer: CartAnswer): Promise<void> {
      checkoutTotalFigure.set(answer.total_cents);
      renderCheckoutLines(answer);
      // Shop radios
      if (!answer.area) {
        clear(shopGroup);
        holdControls.textContent = "";
        statusMessages.textContent = "Choose your area on a product page first.";
        return;
      }
      statusMessages.textContent = "";
      try {
        const shopsAnswer = await ctx.api.get<CartShopsAnswer>("/api/cart/shops");
        clear(shopGroup);
        for (const shop of shopsAnswer.shops) {
          const label = el("label");
          label.className = "inline";
          const radio = el("input");
          radio.type = "radio";
          radio.name = "collection-shop";
          radio.value = shop.store_id;
          radio.dataset.storeId = shop.store_id;
          if (checkout.shopId === shop.store_id || (!checkout.shopId && answer.store_id === shop.store_id)) {
            radio.checked = true;
            checkout.shopId = shop.store_id;
          }
          radio.addEventListener("change", async () => {
            if (checkout.shopId && checkout.shopId !== shop.store_id && cart?.hold) {
              try {
                await ctx.api.del(`/api/holds/${cart.hold.id}`);
              } catch {
                void 0;
              }
            }
            checkout.shopId = shop.store_id;
            checkout.day = null;
            checkout.time = null;
            checkout.requestBody = null;
            persistCheckout(true);
            const updated = await ctx.api.put<CartAnswer>("/api/cart/store", { store_id: shop.store_id });
            cart = updated;
            renderCheckoutData(updated);
            statusHold.textContent = "";
          });
          label.appendChild(radio);
          const span = el("span");
          span.textContent = `${shop.name}, ${shop.distance_km.toFixed(2)} km`;
          label.appendChild(span);
          shopGroup.appendChild(label);
        }
        await renderHoldControls(answer);
        await renderSlots(answer);
      } catch {
        statusMessages.textContent = "Something went wrong. Try again.";
      }
    }

    async function renderHoldControls(answer: CartAnswer): Promise<void> {
      clear(holdControls);
      if (!answer.area) return;
      if (answer.hold && answer.hold.status === "active") {
        holdSecondsLeft = answer.hold.seconds_left;
        holdExpiresAt = new Date(answer.hold.expires_at).getTime();
        holdState = "active";
        renderHoldTimer();
        const release = el("button");
        release.className = "btn";
        release.textContent = "Release hold";
        release.addEventListener("click", async () => {
          try {
            const released = await ctx.api.del<HoldAnswer>(`/api/holds/${answer.hold?.id}`);
            holdState = released.status;
            holdSecondsLeft = 0;
            renderHoldTimer();
            await reloadCart();
            await renderHoldControls(cart as CartAnswer);
          } catch {
            void 0;
          }
        });
        holdControls.appendChild(release);
        return;
      }
      const holdBtn = el("button");
      holdBtn.className = "btn";
      holdBtn.id = "hold-items-btn";
      holdBtn.textContent = checkout.requestBody || answer.hold?.status === "released" ? "Hold again" : "Hold items";
      holdBtn.addEventListener("click", async () => {
        statusHold.textContent = "Holding your items...";
        try {
          const hold = await ctx.api.post<HoldAnswer>("/api/holds", {});
          holdState = hold.status;
          holdSecondsLeft = hold.seconds_left;
          holdExpiresAt = new Date(hold.expires_at).getTime();
          oneMinuteAnnounced = false;
          renderHoldTimer();
          statusHold.textContent = `Items held at ${cart?.store_name}.`;
          const updated = await reloadCart();
          if (updated) {
            await renderHoldControls(updated);
            await renderSlots(updated);
          }
        } catch (err) {
          if (err instanceof StaleAnswer) return;
          if (err instanceof ApiFailure) {
            if (err.body.code === "stock_conflict") {
              openStockChanged(err.body.remaining as number, cart?.store_name ?? "");
              statusMessages.textContent = `Only ${err.body.remaining} left at ${cart?.store_name}.`;
            } else if (err.body.code === "store_suspended") {
              statusMessages.textContent = `${cart?.store_name} is not taking orders right now.`;
            } else if (err.body.code === "hold_active") {
              void 0;
            }
          }
        }
      });
      holdControls.appendChild(holdBtn);
    }

    function renderHoldTimer(): void {
      if (!holdTimerEl || !holdMeterEl) return;
      holdTimerEl.textContent = formatCountdown(holdSecondsLeft);
      holdTimerEl.setAttribute("data-seconds-left", String(holdSecondsLeft));
      const fraction = holdExpiresAt > 0 ? holdSecondsLeft / 600 : 0;
      holdTimerEl.setAttribute("data-hold-fraction", fraction.toFixed(3));
      holdTimerEl.setAttribute("data-hold-state", holdState);
      holdMeterEl.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
      if (holdSecondsLeft <= 60 && holdSecondsLeft > 0 && !oneMinuteAnnounced && holdState === "active") {
        oneMinuteAnnounced = true;
        statusHold.textContent = "One minute left on your hold.";
      }
      if (holdSecondsLeft === 0 && holdState === "active") {
        holdState = "checking";
        holdTimerEl.setAttribute("data-hold-state", "checking");
        statusHold.textContent = "Checking your hold...";
      }
    }

    function startHoldTick(): void {
      if (holdTimer !== null) window.clearInterval(holdTimer);
      holdTimer = window.setInterval(() => {
        if (holdState !== "active") return;
        holdSecondsLeft = Math.max(0, holdSecondsLeft - 1);
        renderHoldTimer();
      }, 1000);
    }
    startHoldTick();
    timers.push(holdTimer === null ? -1 : holdTimer);

    async function pollHold(): Promise<void> {
      if (!dialogOpen) return;
      try {
        const cartNow = await ctx.api.get<CartAnswer>("/api/cart");
        cart = cartNow;
        if (cartNow.hold) {
          holdState = cartNow.hold.status;
          holdSecondsLeft = cartNow.hold.seconds_left;
          holdExpiresAt = new Date(cartNow.hold.expires_at).getTime();
          renderHoldTimer();
          if (cartNow.hold.status === "released") {
            statusHold.textContent = "Your hold has ended. Hold again to keep these items.";
            await renderHoldControls(cartNow);
          }
        } else if (holdState === "active") {
          holdState = "released";
          statusHold.textContent = "Your hold has ended. Hold again to keep these items.";
          await renderHoldControls(cartNow);
        }
        renderCheckoutLines(cartNow);
        checkoutTotalFigure.set(cartNow.total_cents);
        statusCheckoutTotal.textContent = `Cart total ${euroText(cartNow.total_cents)}.`;
      } catch {
        void 0;
      }
    }

    const pollTimer = window.setInterval(pollHold, 5000);
    timers.push(pollTimer);

    async function renderSlots(answer: CartAnswer): Promise<void> {
      clear(dayGroup);
      clear(timeGroup);
      if (!checkout.shopId || answer.hold === null) return;
      try {
        const slots = await ctx.api.get<SlotsAnswer>(`/api/stores/${checkout.shopId}/slots`);
        if (slots.days.length === 0) {
          statusMessages.textContent = "No collection times in the next 7 days.";
          return;
        }
        for (const day of slots.days) {
          const label = el("label");
          label.className = "inline";
          const radio = el("input");
          radio.type = "radio";
          radio.name = "collection-day";
          radio.value = day.date;
          if (checkout.day === day.date) radio.checked = true;
          radio.addEventListener("change", () => {
            checkout.day = day.date;
            checkout.time = null;
            persistCheckout(true);
            renderTimeGroup(slots);
          });
          label.appendChild(radio);
          const span = el("span");
          const weekday = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long" });
          span.textContent = `${weekday}, ${day.date}`;
          label.appendChild(span);
          dayGroup.appendChild(label);
        }
        if (!checkout.day && slots.days[0]) {
          checkout.day = slots.days[0].date;
          const firstRadio = dayGroup.querySelector<HTMLInputElement>("input");
          if (firstRadio) firstRadio.checked = true;
        }
        renderTimeGroup(slots);
      } catch {
        void 0;
      }

      function renderTimeGroup(slots: SlotsAnswer): void {
        clear(timeGroup);
        const day = slots.days.find((d) => d.date === checkout.day);
        if (!day) return;
        for (const slot of day.slots) {
          const label = el("label");
          label.className = "inline";
          const radio = el("input");
          radio.type = "radio";
          radio.name = "collection-time";
          radio.value = slot.start_utc;
          if (checkout.time === slot.start_utc) radio.checked = true;
          radio.addEventListener("change", () => {
            checkout.time = slot.start_utc;
            checkout.requestBody = null;
            persistCheckout(true);
          });
          label.appendChild(radio);
          const span = el("span");
          span.textContent = slot.start_local;
          label.appendChild(span);
          timeGroup.appendChild(label);
        }
      }
    }

    function renderCheckoutLines(answer: CartAnswer): void {
      if (!scroller.isConnected) return;
      const list = scroller.querySelector<HTMLElement>("[aria-label='Checkout lines']");
      if (!list) return;
      updateCheckoutListNodes(list, answer);
    }

    function openStockChanged(remaining: number, storeName: string): void {
      stockChangedOpen = true;
      const backdrop2 = el("div");
      backdrop2.className = "dialog-backdrop";
      const dialog2 = el("div");
      dialog2.className = "dialog wide";
      dialog2.setAttribute("role", "alertdialog");
      dialog2.setAttribute("aria-label", "Stock changed");
      dialog2.setAttribute("data-state", "open");
      const h2 = el("h2");
      h2.textContent = "Stock changed";
      dialog2.appendChild(h2);
      const message = el("p");
      message.textContent = `Only ${remaining} left at ${storeName}.`;
      dialog2.appendChild(message);
      const actions = el("div");
      actions.className = "actions";
      const removeLine = el("button");
      removeLine.className = "btn";
      removeLine.textContent = "Remove line";
      const back = el("button");
      back.className = "btn";
      back.textContent = "Back to checkout";
      actions.appendChild(removeLine);
      actions.appendChild(back);
      dialog2.appendChild(actions);
      backdrop2.appendChild(dialog2);
      document.body.appendChild(backdrop2);
      removeLine.focus();

      const close2 = (): void => {
        stockChangedOpen = false;
        backdrop2.remove();
        const holdBtn = document.getElementById("hold-items-btn") as HTMLElement | null;
        (holdBtn ?? (placeOrderBtn as HTMLElement))?.focus();
      };
      const removeAndClose = async (): Promise<void> => {
        const shortLine = cart?.lines.find((l) => l.status === "short");
        if (shortLine) {
          try {
            const updated = await ctx.api.put<CartAnswer>(`/api/cart/lines/${shortLine.sku}`, { quantity: 0 });
            cart = updated;
            renderLines(updated);
            renderCheckoutLines(updated);
            checkoutTotalFigure.set(updated.total_cents);
          } catch {
            void 0;
          }
        }
        close2();
      };
      removeLine.addEventListener("click", () => void removeAndClose());
      back.addEventListener("click", close2);
      dialog2.addEventListener("keydown", (event) => {
        if (event.key === "Tab") trapFocus(dialog2, event);
        if (event.key === "Escape") {
          event.preventDefault();
          close2();
        }
      });
    }

    placeOrderBtn.addEventListener("click", async () => {
      if (placing || placeOrderBtn?.getAttribute("aria-disabled") === "true") return;
      if (!cart?.hold || cart.hold.status !== "active") {
        statusMessages.textContent = "Hold your items first.";
        return;
      }
      if (!checkout.time) {
        statusMessages.textContent = "Pick a collection time.";
        return;
      }
      const body = {
        hold_id: cart.hold.id,
        slot_start_utc: checkout.time,
        customer: { name: checkout.name, email: checkout.email },
      };
      placing = true;
      placeOrderBtn?.setAttribute("aria-disabled", "true");
      persistCheckout(true);
      statusMessages.textContent = "Placing your order...";
      const keyForBody = checkout.requestBody === null ? newRequestKey() : checkout.requestKey;
      const sentBody = checkout.requestBody ?? body;
      try {
        const order = await ctx.api.post<OrderAnswer>("/api/orders", sentBody, { "Request-Key": keyForBody });
        persistCheckout(false);
        dialogOpen = false;
        backdrop.remove();
        dialogEl = null;
        sessionStorage.setItem("tramela-order-success", JSON.stringify(order));
        window.location.href = `/orders/${order.id}`;
      } catch (err) {
        placing = false;
        placeOrderBtn?.removeAttribute("aria-disabled");
        if (err instanceof StaleAnswer) return;
        if (err instanceof ApiFailure) {
          if (err.body.code === "request_in_progress") {
            statusMessages.textContent = "Your order is still being placed. Wait a moment.";
          } else if (err.body.code === "slot_unavailable") {
            statusMessages.textContent = "That collection time is no longer available. Pick another.";
          } else if (err.body.code === "hold_expired") {
            statusHold.textContent = "Your hold has ended. Hold again to keep these items.";
            statusMessages.textContent = "Your hold has ended. Hold again to keep these items.";
            const holdBtn = document.getElementById("hold-items-btn");
            holdBtn?.focus();
          } else if (err.body.code === "storage_unavailable") {
            statusMessages.textContent = "Placing orders is paused until order documents can be stored.";
          } else {
            statusMessages.textContent = "Something went wrong. Try again.";
          }
        }
      }
    });

    void reloadCart().then((answer) => {
      if (answer) void renderCheckoutData(answer);
    });
    if (restored) {
      scroller.scrollTop = checkout.scrollTop;
      const focusTarget =
        (checkout.focusedControl && document.getElementById(checkout.focusedControl)) ||
        shopGroup.querySelector<HTMLInputElement>("input");
      focusTarget?.focus();
    } else {
      const first = shopGroup.querySelector<HTMLInputElement>("input");
      first?.focus();
    }
    persistCheckout(true);
  }

  if (checkoutOpen) {
    openCheckout(true);
  }

  void reloadCart();
  const cartPoll = window.setInterval(() => {
    void reloadCart();
  }, 5000);
  timers.push(cartPoll);

  return () => {
    for (const timer of timers) {
      if (timer > 0) window.clearInterval(timer);
    }
  };
}

// --- Order page ---

export function mountOrder(ctx: AppContext): () => void {
  const root = ctx.root;
  const orderId = window.location.pathname.split("/")[2];
  const main = el("main");
  main.className = "order-page";

  const statusMessages = el("div");
  statusMessages.className = "status";
  statusMessages.setAttribute("role", "status");
  statusMessages.setAttribute("aria-label", "Order messages");

  const heading = el("h1");
  heading.setAttribute("tabindex", "-1");
  main.appendChild(heading);
  main.appendChild(statusMessages);

  const facts = el("div");
  main.appendChild(facts);

  const linesScroll = el("div");
  linesScroll.className = "table-scroll";
  const linesTable = el("table");
  linesTable.className = "data";
  linesTable.setAttribute("aria-label", "Order lines");
  const thead = el("thead");
  const headRow = el("tr");
  for (const head of ["Item", "Quantity", "Line total", "VAT"]) {
    const th = el("th");
    th.textContent = head;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  linesTable.appendChild(thead);
  const tbody = el("tbody");
  linesTable.appendChild(tbody);
  linesScroll.appendChild(linesTable);
  main.appendChild(linesScroll);

  const totalLine = el("p");
  const totalEl = el("span");
  totalEl.className = "num";
  totalEl.setAttribute("data-figure", "order-total");
  totalLine.appendChild(document.createTextNode("Order total: "));
  totalLine.appendChild(totalEl);
  main.appendChild(totalLine);

  const downloadBtn = el("button");
  downloadBtn.className = "btn";
  downloadBtn.textContent = "Download order document";
  main.appendChild(downloadBtn);

  root.appendChild(main);

  const successRaw = sessionStorage.getItem("tramela-order-success");
  let successOrder: OrderAnswer | null = null;
  if (successRaw) {
    try {
      const parsed = JSON.parse(successRaw) as OrderAnswer;
      if (parsed.id === orderId) successOrder = parsed;
    } catch {
      void 0;
    }
  }

  async function load(): Promise<void> {
    let order = successOrder;
    if (!order) {
      try {
        order = await ctx.api.get<OrderAnswer>(`/api/orders/${orderId}`);
      } catch {
        navigate("/catalogue");
        return;
      }
    }
    if (successOrder) {
      sessionStorage.removeItem("tramela-order-success");
    }
    heading.textContent = `Order ${order.number}`;
    document.title = `Order ${order.number} — Tramela Estate`;
    clear(facts);
    const statusLine = el("p");
    statusLine.textContent = `Status: ${order.status}`;
    facts.appendChild(statusLine);
    const shopLine = el("p");
    shopLine.textContent = `Collect at ${order.store_name} on ${order.slot_local_date} at ${order.slot_local_time} (${order.timezone}).`;
    facts.appendChild(shopLine);
    clear(tbody);
    for (const line of order.lines) {
      const row = el("tr");
      const nameCell = el("td");
      nameCell.textContent = `${line.name}`;
      row.appendChild(nameCell);
      const qtyCell = el("td");
      qtyCell.textContent = String(line.quantity);
      row.appendChild(qtyCell);
      const totalCell = el("td");
      totalCell.className = "num";
      totalCell.textContent = euroText(line.line_total_cents);
      row.appendChild(totalCell);
      const vatCell = el("td");
      vatCell.className = "num";
      vatCell.textContent = euroText(line.vat_cents);
      row.appendChild(vatCell);
      tbody.appendChild(row);
    }
    totalEl.textContent = euroText(order.total_cents);
    totalEl.setAttribute("data-value", String(order.total_cents));
    if (successOrder) {
      statusMessages.textContent = `Order ${order.number} placed. Collect at ${order.store_name} on ${order.slot_local_date} at ${order.slot_local_time}.`;
    }
  }

  downloadBtn.addEventListener("click", async () => {
    if (downloadBtn.getAttribute("aria-disabled") === "true") {
      statusMessages.textContent = "Order documents are unavailable until storage returns.";
      return;
    }
    statusMessages.textContent = "Preparing document...";
    try {
      const res = await fetch(`/api/orders/${orderId}/document`, { credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!res.ok) {
        statusMessages.textContent = "Something went wrong. Try again.";
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = el("a");
      anchor.href = url;
      anchor.download = "order-document.json";
      anchor.click();
      URL.revokeObjectURL(url);
      statusMessages.textContent = "";
    } catch {
      statusMessages.textContent = "Something went wrong. Try again.";
    }
  });

  void load();
  heading.focus();
  return () => undefined;
}
