// The grower screens: home, the server-quoted order form, and the order page.
import { api, fieldErrorsOf, errorOf, ApiFailure, isNotSignedIn } from "./api.ts";
import type { WindowRecord, OrderRecord, AllocationRecord, TurnoutRecord, OperatorRecord, ChannelRecord } from "./types.ts";
import { WINDOW_STATUS_LABEL, ORDER_STATUS_LABEL } from "./types.ts";
import { h, clear, text, dec, statusRegion, group } from "./html.ts";
import { currentUser, navigate, goSignIn, startPolling, topBar, route } from "./app.ts";

const root = () => document.getElementById("root")!;

function allocationCounter(a: AllocationRecord): HTMLElement {
  return h("div", { class: "lead-counter" },
    h("div", { role: "region", "aria-label": "Allocation" },
      h("span", { class: "label" }, "Allocation"),
      h("div", { class: "value" }, dec(a.remaining_ml), h("span", { class: "unit" }, `ML of ${a.allocation_ml} ML left`)),
    ),
  );
}

// --- grower home ---------------------------------------------------------------

route("/grower", async () => {
  const me = currentUser()!;
  const rootEl = root();
  clear(rootEl);
  rootEl.append(topBar("/grower"));
  const statusEl = statusRegion("Order status", "order-status");
  const orderWrap = h("div");
  const windowWrap = h("div");
  const allocationWrap = h("div", { class: "lead-counter" });

  rootEl.append(h("div", { class: "page" }, allocationWrap, statusEl,
    h("div", { class: "cols" },
      h("div", null, h("h2", null, "Your orders"), orderWrap),
      h("div", null, h("h2", null, "Delivery windows"), windowWrap),
    ),
  ));

  async function refresh(): Promise<void> {
    try {
      const [alloc, orders, windows, channels] = await Promise.all([
        api<AllocationRecord>("GET", "/api/me/allocation"),
        api<{ orders: OrderRecord[] }>("GET", "/api/orders"),
        api<{ windows: WindowRecord[] }>("GET", "/api/windows"),
        api<{ channels: ChannelRecord[] }>("GET", "/api/channels"),
      ]);
      clear(allocationWrap);
      allocationWrap.append(allocationCounter(alloc));

      clear(orderWrap);
      const table = h("table", { "aria-label": "Your orders", class: "stacked-orders" },
        h("thead", null, h("tr", null,
          h("th", null, "Order"), h("th", null, "Turnout"), h("th", null, "Window"),
          h("th", { class: "num" }, "Volume (ML)"), h("th", { class: "num" }, "Rate (ML/day)"), h("th", null, "Status"),
        )),
      );
      const tbody = h("tbody");
      for (const o of orders.orders.slice().reverse()) {
        const w = windows.windows.find((x) => x.id === o.window_id);
        const tr = h("tr", { onclick: () => navigate(`/orders/${o.number}`), style: "cursor:pointer" },
          h("td", { "data-label": "Order" }, h("a", { href: `/orders/${o.number}` }, o.number)),
          h("td", { "data-label": "Turnout" }, o.turnout),
          h("td", { "data-label": "Window" }, w?.label ?? o.window_id),
          h("td", { class: "num", "data-label": "Volume" }, dec(o.volume_ml)),
          h("td", { class: "num", "data-label": "Rate" }, dec(o.rate_ml_day)),
          h("td", { "data-label": "Status" }, o.status === "closed" && o.conflict === "lapsed" ? "Closed (lapsed)" : ORDER_STATUS_LABEL[o.status]),
        );
        tbody.append(tr);
      }
      table.append(tbody);
      orderWrap.append(table);

      clear(windowWrap);
      const myChannels = new Set(channels.channels.map((c) => c.id));
      const winList = h("div", { class: "stack" });
      for (const w of windows.windows) {
        if (!myChannels.has(w.channel_id)) continue;
        winList.append(
          h("div", { class: "panel" },
            h("div", null, h("b", null, w.channel_name), " · ", WINDOW_STATUS_LABEL[w.status]),
            h("div", { class: "num" }, dec(w.remaining_ml), " ML remaining"),
            w.status === "closed"
              ? h("span", { class: "hint" }, "This window has closed.")
              : h("div", null, h("a", { href: `/grower/orders/new?window=${w.id}` }, "Order in this window")),
          ),
        );
      }
      windowWrap.append(winList);
    } catch (e) {
      if (isNotSignedIn(e)) await goSignIn("/grower");
    }
  }
  await refresh();
  startPolling(refresh);
});

// --- order form -----------------------------------------------------------------

route("/grower/orders/new", async (m) => {
  const me = currentUser()!;
  const preselectWindow = m.query.get("window");
  const rootEl = root();
  clear(rootEl);
  rootEl.append(topBar("/grower/orders/new"));
  const windowStatusEl = statusRegion("Window status", "window-status");
  const orderStatus = statusRegion("Order status", "order-status-2");

  const form = h("form", { "aria-label": "New order" });
  const page = h("div", { class: "page page-narrow" },
    h("h1", null, "New order"),
    h("div", { id: "alloc-counter" }),
    form,
    orderStatus,
  );
  rootEl.append(page);

  type Draft = { turnout: string; windowId: string; volume: string; operator: string; standby: string; consumedAnnounced?: boolean };
  const draftKey = `ditchbook-draft-${me.id}`;
  const draftRaw = sessionStorage.getItem(draftKey);
  let draft: Draft | null = null;
  if (draftRaw) {
    try {
      draft = JSON.parse(draftRaw) as Draft;
    } catch {
      draft = null;
    }
  }

  const turnoutSel = h("select", { id: "turnout", "aria-label": "Turnout" }) as HTMLSelectElement;
  const windowSel = h("select", { id: "window", "aria-label": "Delivery window" }) as HTMLSelectElement;
  const volumeInput = h("input", { type: "text", id: "volume", "aria-label": "Volume (ML)", inputmode: "decimal" }) as HTMLInputElement;
  const gateSel = h("select", { id: "gate", "aria-label": "Gate worked by" }) as HTMLSelectElement;
  const standbySel = h("select", { id: "standby", "aria-label": "Standby operator" }) as HTMLSelectElement;
  const rateGroup = group("Flow rate", h("span", { id: "rate" }, "—"));
  const remainingGroup = group("Window remaining", h("span", { id: "remaining" }, "—"));
  const volumeErr = h("div", { class: "err", id: "volume-err" });
  const turnoutErr = h("div", { class: "err", id: "turnout-err" });
  const placeBtn = h("button", { type: "submit", class: "primary", "aria-disabled": "true" }, "Place order") as HTMLButtonElement;
  const pendingEl = statusRegion("Order status", "pending-status");

  form.append(
    h("div", { class: "field" }, h("label", { for: "turnout" }, "Turnout"), turnoutSel, turnoutErr),
    h("div", { class: "field" }, h("label", { for: "window" }, "Delivery window"), windowSel),
    h("div", { class: "field" }, h("label", null, "Window status"), windowStatusEl),
    h("div", { class: "field" }, h("label", { for: "volume" }, "Volume (ML)"), volumeInput, volumeErr),
    h("div", { class: "field" }, h("label", null, "Flow rate"), rateGroup),
    h("div", { class: "field" }, h("label", null, "Window remaining"), remainingGroup),
    h("div", { class: "field" }, h("label", { for: "gate" }, "Gate worked by"), gateSel),
    h("div", { class: "field" }, h("label", { for: "standby" }, "Standby operator"), standbySel),
    h("div", { style: "margin-top:8px" }, placeBtn),
    pendingEl,
  );

  type State = {
    turnouts: TurnoutRecord[];
    channels: ChannelRecord[];
    operators: OperatorRecord[];
    selectedTurnout: string;
    selectedWindow: string;
    windowRecord: WindowRecord | null;
    remainingFigure: string | null;
    pending: boolean;
    lastQuoteToken: number;
  };
  const st: State = {
    turnouts: [],
    channels: [],
    operators: [],
    selectedTurnout: "",
    selectedWindow: "",
    windowRecord: null,
    remainingFigure: null,
    pending: false,
    lastQuoteToken: 0,
  };

  function saveDraft(): void {
    const d: Draft = {
      turnout: turnoutSel.value,
      windowId: windowSel.value,
      volume: volumeInput.value,
      operator: gateSel.value,
      standby: standbySel.value,
    };
    sessionStorage.setItem(draftKey, JSON.stringify(d));
  }

  function railSortedChannelIds(): string[] {
    return st.channels.map((c) => c.id);
  }

  function rebuildTurnoutOptions(): void {
    const choice = turnoutSel.value;
    clear(turnoutSel);
    const none = h("option", { value: "" }, "Choose a turnout");
    turnoutSel.append(none);
    for (const t of st.turnouts) {
      turnoutSel.append(h("option", { value: t.code }, t.code));
    }
    if (choice && [...turnoutSel.options].some((o) => o.value === choice)) turnoutSel.value = choice;
    else if (draft?.turnout) turnoutSel.value = draft.turnout;
  }

  // The window options: non-closed windows of the grower's channels (or the
  // chosen turnout's channel), plus the selected window kept even when closed.
  function rebuildWindowOptions(): void {
    clear(windowSel);
    const seen = new Set<string>();
    const channelFilter = st.selectedTurnout
      ? st.turnouts.find((t) => t.code === st.selectedTurnout)?.channel_id
      : null;
    const options: Array<{ id: string; label: string; sortKey: string }> = [];
    for (const channelId of railSortedChannelIds()) {
      for (const w of latestWindows) {
        if (w.channel_id !== channelId) continue;
        if (seen.has(w.id)) continue;
        if (w.status === "closed" && w.id !== st.selectedWindow) continue;
        if (channelFilter && w.channel_id !== channelFilter) continue;
        seen.add(w.id);
        options.push({ id: w.id, label: `${w.channel_name}, ${w.label}`, sortKey: `${channelId}|${w.opens_at}|${w.id}` });
      }
    }
    windowSel.append(h("option", { value: "" }, "Choose a delivery window"));
    for (const o of options) {
      windowSel.append(h("option", { value: o.id }, o.label));
    }
    if (st.selectedWindow && seen.has(st.selectedWindow)) {
      windowSel.value = st.selectedWindow;
    } else {
      windowSel.value = "";
    }
  }

  let latestWindows: WindowRecord[] = [];

  function setFlowRate(v: string | null): void {
    const rateEl = document.getElementById("rate");
    if (rateEl) {
      clear(rateEl);
      rateEl.append(text(v === null ? "—" : `${v} ML/day`));
    }
  }

  function setRemaining(v: string | null): void {
    const el = document.getElementById("remaining");
    if (el) {
      clear(el);
      el.append(text(v === null ? "—" : `${v} ML`));
    }
  }

  function paintWindowStatus(w: WindowRecord | null): void {
    clear(windowStatusEl);
    if (!w) return;
    let copy = WINDOW_STATUS_LABEL[w.status];
    if (w.restriction_cap_ml_day) {
      copy += ` Restricted to ${w.restriction_cap_ml_day} ML/day, ${w.remaining_ml} ML left.`;
    }
    windowStatusEl.append(text(copy));
    placeBtn.setAttribute("aria-disabled", String(!w.orderable || st.pending));
  }

  async function quote(): Promise<void> {
    const token = ++st.lastQuoteToken;
    if (!st.selectedWindow || volumeInput.value.trim() === "") {
      setFlowRate(null);
      clear(volumeErr);
      return;
    }
    const params = new URLSearchParams({ window: st.selectedWindow, volume_ml: volumeInput.value.trim() });
    if (st.selectedTurnout) params.set("turnout", st.selectedTurnout);
    try {
      const r = await api<{ rate_ml_day: string | null; window: WindowRecord; turnout_max_ml: string | null }>(
        "GET", `/api/orders/quote?${params.toString()}`,
      );
      if (token !== st.lastQuoteToken) return;
      setFlowRate(r.rate_ml_day);
      st.remainingFigure = r.window.remaining_ml;
      setRemaining(r.window.remaining_ml);
      st.windowRecord = r.window;
      paintWindowStatus(r.window);
      clear(volumeErr);
      clear(turnoutErr);
    } catch (e) {
      if (token !== st.lastQuoteToken) return;
      const fields = fieldErrorsOf(e);
      setFlowRate(null);
      clear(volumeErr);
      if (fields.volume_ml) volumeErr.append(text(fields.volume_ml));
      if (fields.turnout) turnoutErr.append(text(fields.turnout));
      if (isNotSignedIn(e)) {
        saveDraft();
        await goSignIn(location.pathname + location.search);
      }
    }
  }

  let quoteTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleQuote(): void {
    if (quoteTimer) clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => void quote(), 500);
  }

  turnoutSel.addEventListener("change", () => {
    st.selectedTurnout = turnoutSel.value;
    if (st.selectedTurnout && st.selectedWindow) {
      const t = st.turnouts.find((x) => x.code === st.selectedTurnout);
      const w = latestWindows.find((x) => x.id === st.selectedWindow);
      if (t && w && t.channel_id !== w.channel_id) {
        st.selectedWindow = "";
      }
    }
    rebuildWindowOptions();
    saveDraft();
    scheduleQuote();
  });
  windowSel.addEventListener("change", () => {
    st.selectedWindow = windowSel.value;
    saveDraft();
    if (st.selectedWindow) {
      void refreshWindow();
    }
    scheduleQuote();
  });
  volumeInput.addEventListener("input", () => {
    saveDraft();
    scheduleQuote();
  });
  gateSel.addEventListener("change", saveDraft);
  standbySel.addEventListener("change", saveDraft);

  async function refreshWindow(): Promise<void> {
    if (!st.selectedWindow) return;
    try {
      const r = await api<{ window: WindowRecord }>("GET", `/api/windows/${st.selectedWindow}`);
      st.windowRecord = r.window;
      if (st.remainingFigure === null || !volumeInput.value) {
        st.remainingFigure = r.window.remaining_ml;
        setRemaining(r.window.remaining_ml);
      }
      paintWindowStatus(r.window);
    } catch {
      // the next poll refreshes
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (st.pending) return;
    if (!st.windowRecord || !st.windowRecord.orderable) return;
    st.pending = true;
    placeBtn.setAttribute("aria-disabled", "true");
    clear(orderStatus);
    orderStatus.append(text("Placing your order."));
    try {
      const r = await api<{ order: OrderRecord }>("POST", "/api/orders", {
        turnout: turnoutSel.value,
        window_id: windowSel.value,
        volume_ml: volumeInput.value.trim(),
        operator_code: gateSel.value,
        standby_code: standbySel.value === "" ? null : standbySel.value,
      });
      sessionStorage.removeItem(draftKey);
      navigate(`/orders/${r.order.number}`);
    } catch (e) {
      st.pending = false;
      const shape = errorOf(e);
      clear(orderStatus);
      const fields = fieldErrorsOf(e);
      if (fields.volume_ml) {
        clear(volumeErr);
        volumeErr.append(text(fields.volume_ml));
        try {
          const a = await api<AllocationRecord>("GET", "/api/me/allocation");
          const allocEl = document.getElementById("alloc-counter");
          if (allocEl) {
            clear(allocEl);
            const wrap = h("div", { class: "lead-counter" });
            wrap.append(allocationCounter(a));
            allocEl.append(wrap);
          }
        } catch {
          // ignore
        }
      }
      if (shape.code === "window_full") {
        const rem = (shape.extra.remaining_ml as string) ?? st.remainingFigure;
        if (rem) setRemaining(rem);
        try {
          const a = await api<AllocationRecord>("GET", "/api/me/allocation");
          const allocEl = document.getElementById("alloc-counter");
          if (allocEl) {
            clear(allocEl);
            const wrap = h("div", { class: "lead-counter" });
            wrap.append(allocationCounter(a));
            allocEl.append(wrap);
          }
        } catch {
          // ignore
        }
        openCapacityTaken();
        return;
      }
      const copy: Record<string, string> = {
        window_closed: "This window has closed.",
        too_early: "Orders open 10 days before a window opens.",
        turnout_busy: "This turnout already has an order scheduled or running.",
      };
      orderStatus.append(text(copy[shape.code] ?? fields.volume_ml ?? fields.turnout ?? "Something went wrong."));
      if (shape.code === "window_closed" || shape.code === "too_early") {
        await refreshWindow();
      }
    }
  });

  function openCapacityTaken(): void {
    const close = () => {
      dlg.close();
    };
    const backBtn = h("button", { class: "primary", onclick: close }, "Back to the order");
    const dlg = h("dialog", { class: "alert-dialog", "aria-label": "Capacity taken" },
      h("div", { class: "dialog-body" },
        h("h2", null, "Capacity taken"),
        h("p", null, "Another order took the last of this window's capacity. Nothing was debited from your allocation."),
      ),
      h("div", { class: "dialog-actions" }, backBtn),
    ) as HTMLDialogElement;
    document.body.append(dlg);
    dlg.showModal();
    const lastFocus = placeBtn;
    dlg.addEventListener("close", () => {
      dlg.remove();
      lastFocus.focus();
    });
    // keep focus inside the dialog
    dlg.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
        return;
      }
      if (ev.key === "Tab") {
        const focusables = [backBtn];
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    });
    backBtn.focus();
  }

  async function refresh(): Promise<void> {
    try {
      const [alloc, turnouts, channels, operators, windows] = await Promise.all([
        api<AllocationRecord>("GET", "/api/me/allocation"),
        api<{ turnouts: TurnoutRecord[] }>("GET", "/api/turnouts"),
        api<{ channels: ChannelRecord[] }>("GET", "/api/channels"),
        api<{ operators: OperatorRecord[] }>("GET", "/api/operators"),
        api<{ windows: WindowRecord[] }>("GET", "/api/windows"),
      ]);
      latestWindows = windows.windows;
      const turnoutCountBefore = st.turnouts.length;
      st.turnouts = turnouts.turnouts;
      st.channels = channels.channels;
      st.operators = operators.operators;

      const allocEl = document.getElementById("alloc-counter");
      if (allocEl) {
        clear(allocEl);
        allocEl.append(allocationCounter(alloc));
      }

      if (turnoutCountBefore !== turnouts.turnouts.length) rebuildTurnoutOptions();
      if (!st.selectedTurnout && draft?.turnout) st.selectedTurnout = draft.turnout;
      if (!turnoutSel.value) turnoutSel.value = st.selectedTurnout;

      rebuildWindowOptions();
      if (!st.selectedWindow) {
        if (draft?.windowId) st.selectedWindow = draft.windowId;
        else if (preselectWindow) st.selectedWindow = preselectWindow;
        if (st.selectedWindow) {
          rebuildWindowOptions();
        }
      }

      // live refreshes rebuild the operator lists but keep what the grower chose
      const gateChoice = gateSel.value;
      const standbyChoice = standbySel.value;
      clear(gateSel);
      gateSel.append(h("option", { value: "" }, "Choose an operator"));
      for (const o of st.operators.filter((x) => !x.erased)) {
        gateSel.append(h("option", { value: o.code }, `${o.name ?? "Operator"} (${o.code})`));
      }
      clear(standbySel);
      standbySel.append(h("option", { value: "" }, "No standby"));
      for (const o of st.operators.filter((x) => !x.erased)) {
        standbySel.append(h("option", { value: o.code }, `${o.name ?? "Operator"} (${o.code})`));
      }
      if (draft?.operator && !gateChoice) gateSel.value = draft.operator;
      else if (gateChoice && [...gateSel.options].some((o) => o.value === gateChoice)) gateSel.value = gateChoice;
      if (draft?.standby && !standbyChoice) standbySel.value = draft.standby;
      else if (standbyChoice && [...standbySel.options].some((o) => o.value === standbyChoice)) standbySel.value = standbyChoice;

      if (draft?.volume && !volumeInput.value) volumeInput.value = draft.volume;

      // window status refresh
      if (st.selectedWindow) {
        const w = latestWindows.find((x) => x.id === st.selectedWindow);
        if (w) {
          st.windowRecord = w;
          paintWindowStatus(w);
          if (!volumeInput.value && st.remainingFigure === null) {
            st.remainingFigure = w.remaining_ml;
            setRemaining(w.remaining_ml);
          } else if (st.remainingFigure === null) {
            st.remainingFigure = w.remaining_ml;
            setRemaining(w.remaining_ml);
          }
        }
      }
    } catch (e) {
      if (isNotSignedIn(e)) {
        saveDraft();
        await goSignIn(location.pathname + location.search);
      }
    }
  }

  // draft restored announcement (only on landing with a draft)
  if (draft && !draft.consumedAnnounced) {
    orderStatus.append(text("Your session ended. Your order is as you left it. Check it and place it again."));
    draft.consumedAnnounced = true;
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  }
  await refresh();
  startPolling(async () => {
    await refresh();
  }, 3000);
});

// --- order page -----------------------------------------------------------------

route("/orders/<number>", async (m) => {
  const number = m.params.number!;
  const me = currentUser()!;
  const rootEl = root();
  clear(rootEl);
  const statusEl = statusRegion("Order status", "order-status");
  const content = h("div");
  rootEl.append(topBar(`/orders/${number}`), h("div", { class: "page page-narrow" }, content, statusEl));

  let lastStatus: string | null = null;
  async function refresh(): Promise<void> {
    try {
      const [{ order }, windows] = await Promise.all([
        api<{ order: OrderRecord }>("GET", `/api/orders/${number}`),
        api<{ windows: WindowRecord[] }>("GET", "/api/windows"),
      ]);
      const w = windows.windows.find((x) => x.id === order.window_id);
      clear(content);
      content.append(
        h("h1", null, `Order ${order.number}`),
        h("div", { class: "lead-counter" },
          w ? h("div", { role: "region", "aria-label": "Remaining ML" },
            h("span", { class: "label" }, "Remaining ML"),
            h("div", { class: "value" }, dec(w.remaining_ml), h("span", { class: "unit" }, "ML")),
          ) : null,
        ),
        group("Order state",
          h("div", { class: "value" }, order.status === "closed" && order.conflict === "lapsed" ? "Closed (lapsed)" : ORDER_STATUS_LABEL[order.status]),
        ),
        h("dl", null,
          h("div", null, h("dt", null, "Turnout"), h("dd", null, order.turnout)),
          h("div", null, h("dt", null, "Window"), h("dd", null, w?.label ?? order.window_id)),
          h("div", null, h("dt", null, "Volume"), h("dd", { class: "num" }, dec(order.volume_ml))),
          h("div", null, h("dt", null, "Rate"), h("dd", { class: "num" }, dec(order.rate_ml_day))),
          h("div", null, h("dt", null, "Gate worked by"), h("dd", null, order.holder_code ?? "—")),
          h("div", null, h("dt", null, "Standby"), h("dd", null, order.standby_code ?? "No standby")),
        ),
      );
      if (order.conflict === "restriction") {
        content.append(h("p", null, "Moved back by a restriction."));
      }
      if (order.conflict === "lapsed") {
        content.append(h("p", null, "Lapsed when the window closed."));
      }
      if (order.rationed) {
        content.append(h("p", null, `Rationed from ${order.requested_ml} ML.`));
      }
      if (me.role === "grower" && (order.status === "requested" || order.status === "scheduled")) {
        const cancelBtn = h("button", { onclick: async () => {
          clear(statusEl);
          statusEl.append(text("Cancelling."));
          try {
            const r = await api<{ order: OrderRecord; window: WindowRecord }>("POST", `/api/orders/${number}/cancel`, {});
            clear(statusEl);
            statusEl.append(text(`Order ${r.order.number} is now Closed.`));
            await refresh();
          } catch (e) {
            clear(statusEl);
            statusEl.append(text(errorOf(e).code === "illegal_transition"
              ? "That change is not allowed for this order now."
              : "Something went wrong."));
          }
        } }, "Cancel order");
        content.append(cancelBtn);
      }
      if (lastStatus !== null && lastStatus !== order.status) {
        if (order.status === "closed" && order.conflict === "lapsed") {
          clear(statusEl);
          statusEl.append(text(`Order ${order.number} lapsed when the window closed.`));
        } else {
          clear(statusEl);
          statusEl.append(text(`Order ${order.number} is now ${order.status === "closed" ? "Closed" : ORDER_STATUS_LABEL[order.status]}.`));
        }
      }
      lastStatus = order.status;
    } catch (e) {
      if (isNotSignedIn(e)) {
        await goSignIn(location.pathname + location.search);
      }
    }
  }
  await refresh();
  startPolling(refresh, 3000);
});
