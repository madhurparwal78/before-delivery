// The dispatcher's channel board: rail, window grid, detail pane, the R
// shortcut, the Publish restriction and Ration dialogs, and the board address.
import { api, errorOf, fieldErrorsOf, isNotSignedIn } from "./api.ts";
import type { WindowRecord, OrderRecord, CardRecord, NoticeRecord, ChannelRecord } from "./types.ts";
import { WINDOW_STATUS_LABEL, ORDER_STATUS_LABEL } from "./types.ts";
import { h, clear, text, dec, statusRegion, group } from "./html.ts";
import { currentUser, goSignIn, navigate, startPolling, stopPolling, topBar, route } from "./app.ts";

const root = () => document.getElementById("root")!;

type BoardState = {
  channels: ChannelRecord[];
  windows: WindowRecord[];
  orders: OrderRecord[];
  cards: CardRecord[];
  notices: NoticeRecord[];
  growers: Record<string, string>;
};

route("/board", async (m) => {
  const me = currentUser()!;
  const rootEl = root();
  clear(rootEl);

  // board address
  const selectedChannelIds = (m.query.get("channels") ?? "").split(",").filter(Boolean);
  let selectedWindow: string | null = m.query.get("window");
  let selectedTab: "capacity" | "orders" | "restrictions" = (m.query.get("tab") ?? "capacity") as "capacity" | "orders" | "restrictions";

  const boardStatusEl = statusRegion("Board status", "board-status");
  const content = h("div");
  rootEl.append(topBar("/board"), content, boardStatusEl);

  const st: BoardState = { channels: [], windows: [], orders: [], cards: [], notices: [], growers: {} };
  let pendingAction: string | null = null;

  function boardUrl(): string {
    const q = new URLSearchParams();
    if (selectedChannelIds.length > 0) q.set("channels", selectedChannelIds.join(","));
    if (selectedWindow) q.set("window", selectedWindow);
    if (selectedTab !== "capacity") q.set("tab", selectedTab);
    const s = q.toString();
    return `/board${s ? `?${s}` : ""}`;
  }

  function pushBoard(): void {
    history.pushState(null, "", boardUrl());
  }

  function status(copy: string): void {
    clear(boardStatusEl);
    boardStatusEl.append(text(copy));
  }

  async function refresh(): Promise<void> {
    try {
      const [channels, windows, orders, cards] = await Promise.all([
        api<{ channels: ChannelRecord[] }>("GET", "/api/channels"),
        api<{ windows: WindowRecord[] }>("GET", "/api/windows"),
        api<{ orders: OrderRecord[]; growers?: Record<string, string> }>("GET", "/api/orders"),
        api<{ cards: CardRecord[] }>("GET", "/api/gate-cards"),
      ]);
      st.channels = channels.channels;
      st.windows = windows.windows;
      st.orders = orders.orders;
      st.cards = cards.cards;
      st.growers = orders.growers ?? {};
      if (selectedWindow) {
        try {
          const n = await api<{ notices: NoticeRecord[] }>("GET", `/api/windows/${selectedWindow}/notices`);
          st.notices = n.notices;
        } catch {
          st.notices = [];
        }
      }
      render();
    } catch (e) {
      if (isNotSignedIn(e)) await goSignIn("/board");
    }
  }

  function visibleWindows(): WindowRecord[] {
    return st.windows.filter((w) => selectedChannelIds.length === 0 || selectedChannelIds.includes(w.channel_id));
  }

  function currentWindow(): WindowRecord | null {
    if (!selectedWindow) return null;
    return st.windows.find((w) => w.id === selectedWindow) ?? null;
  }

  function render(): void {
    clear(content);
    const wide = window.innerWidth >= 1100;
    const mid = window.innerWidth >= 900;

    // panes
    const board = h("div", { class: `board ${mid ? "rail-open" : "rail-closed"}` });

    // --- rail
    let rail: HTMLElement | null = null;
    if (mid) {
      rail = h("aside", { class: "rail rail-static", role: "region", "aria-label": "Channel rail" });
      const h3 = h("h3", null, "Channels");
      rail.append(h3);
      for (const c of st.channels) {
        const checked = selectedChannelIds.includes(c.id);
        const cb = h("input", {
          type: "checkbox",
          id: `ch-${c.id}`,
          checked: checked || null,
          onchange: () => {
            const idx = selectedChannelIds.indexOf(c.id);
            if (idx >= 0) selectedChannelIds.splice(idx, 1);
            else selectedChannelIds.push(c.id);
            st.channels.forEach((x, i) => {
              const pos = selectedChannelIds.indexOf(x.id);
            });
            pushBoard();
            render();
          },
        }) as HTMLInputElement;
        rail.append(h("label", { class: "check", for: `ch-${c.id}` }, cb, text(c.name)));
      }
      board.append(rail);
    }

    // --- grid
    const grid = h("div", { class: "window-grid", role: "grid", "aria-label": "Window grid" });
    for (const w of visibleWindows()) {
      const cell = h("button", {
        class: "cell",
        role: "gridcell",
        "aria-label": `${w.channel_name}, ${w.label}, ${w.remaining_ml} ML remaining`,
        onclick: () => {
          selectedWindow = w.id;
          pushBoard();
          render();
        },
      },
        h("span", { class: "cname" }, w.channel_name),
        h("span", { class: "wlabel" }, w.label),
        h("span", { class: "remaining" }, dec(w.remaining_ml)),
        h("span", { class: "meta" },
          h("span", { class: "hint" }, WINDOW_STATUS_LABEL[w.status]),
          w.restriction_cap_ml_day ? h("span", { class: "tag restricted" }, "Restricted") : null,
        ),
      );
      grid.append(cell);
    }

    // --- detail
    const detail = h("aside", { class: "detail-pane", role: "region", "aria-label": "Window detail" });
    const w = currentWindow();
    if (!w) {
      detail.append(h("p", { class: "hint" }, "Select a window"));
    } else {
      detail.append(renderDetail(w));
    }

    if (mid) {
      board.append(grid, detail);
      content.append(board);
    } else {
      content.append(rail ?? text(""), board);
      board.append(grid);
      if (w) {
        // modal sheet on small screens
        const sheet = h("dialog", { class: "alert-dialog", "aria-label": "Window detail" },
          h("div", { class: "dialog-body" }, renderDetail(w)),
          h("div", { class: "dialog-actions" }, h("button", { onclick: () => { sheet.close(); } }, "Close window detail")),
        ) as HTMLDialogElement;
        document.body.append(sheet);
        sheet.showModal();
        sheet.addEventListener("close", () => sheet.remove());
      }
    }

    // --- keyboard: R opens the Publish restriction dialog for the selected
    // window, unless focus is in a text field. The listener is on document so
    // it works wherever focus rests on the board.
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "r" || ev.key === "R") {
        const t = ev.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
        if (!selectedWindow) return;
        ev.preventDefault();
        openPublishRestriction();
      }
    };
    document.addEventListener("keydown", onKey);
    // the poll is restarted below; the document listener is cleaned up on the next route
    const priorCleanup = (window as unknown as { __boardCleanup?: () => void }).__boardCleanup;
    priorCleanup?.();
    (window as unknown as { __boardCleanup?: () => void }).__boardCleanup = () => {
      document.removeEventListener("keydown", onKey);
    };
  }

  function renderDetail(w: WindowRecord): HTMLElement {
    const wrap = h("div");
    const windowOrders = st.orders.filter((o) => o.window_id === w.id);
    const windowCards = st.cards.filter((c) => c.window_id === w.id && (c.state === "open" || c.state === "waiting-for-store"));

    // counters
    const counters = h("div", { class: "counters" },
      group("Remaining ML", h("div", { class: "value num" }, dec(w.remaining_ml))),
      group("Delivered ML", h("div", { class: "value num" }, dec(w.delivered_ml))),
      group("Channel flow", h("div", { class: "value num" }, dec(w.channel_flow_ml_day))),
    );
    wrap.append(counters);

    // Publish restriction button
    wrap.append(h("button", { onclick: () => openPublishRestriction(), id: "publish-restriction-btn" }, "Publish restriction"));

    // tab set
    const tabs = h("div", { role: "tablist", "aria-label": "Window views" });
    const panels: Record<string, HTMLElement> = {};
    for (const [key, label] of [["capacity", "Capacity"], ["orders", "Orders"], ["restrictions", "Restrictions"]] as const) {
      const tab = h("button", {
        role: "tab",
        "aria-selected": String(selectedTab === key),
        "aria-controls": `panel-${key}`,
        id: `tab-${key}`,
        onclick: () => {
          selectedTab = key;
          history.replaceState(null, "", boardUrl());
          render();
        },
      }, label);
      tabs.append(tab);
    }
    wrap.append(tabs);

    const panel = h("div", { role: "tabpanel", id: `panel-${selectedTab}` });

    if (selectedTab === "capacity") {
      // Window details expander (open by default)
      const detailsBody = h("div", null,
        h("dl", null,
          h("div", null, h("dt", null, "Opens"), h("dd", null, w.opens_at)),
          h("div", null, h("dt", null, "Closes"), h("dd", null, w.closes_at)),
          h("div", null, h("dt", null, "Hours"), h("dd", null, String(w.hours))),
          h("div", null, h("dt", null, "Table cap"), h("dd", { class: "num" }, dec(w.table_cap_ml_day))),
          h("div", null, h("dt", null, "Effective cap"), h("dd", { class: "num" }, dec(w.effective_cap_ml_day))),
          h("div", null, h("dt", null, "Cap volume"), h("dd", { class: "num" }, dec(w.cap_volume_ml))),
          h("div", null, h("dt", null, "Rostered operator"), h("dd", null, w.rostered_operator)),
        ),
        h("p", null, h("a", { href: `/channels/${w.channel_id}/capacity` }, "Edit capacity table")),
      );
      panel.append(expander("Window details", detailsBody, true));

      // Gate cards expander
      const cardsBody = h("div");
      for (const c of windowCards) {
        cardsBody.append(h("div", { class: "row" },
          h("span", null, `${c.turnout} · ${c.kind === "start" ? "Start" : "Finish"} · ${c.holder_code} · ${c.state === "open" ? "Open" : "Waiting for the store"}`),
          h("button", {
            "aria-label": `Remove holder ${c.turnout}`,
            onclick: async () => {
              status("Handing over.");
              try {
                const r = await api<{ card: CardRecord }>("POST", `/api/gate-cards/${c.id}/remove-holder`, {});
                status(`Gate card for ${c.turnout} handed to ${r.card.holder_code}.`);
                await refresh();
              } catch (e) {
                const shape = errorOf(e);
                status(shape.code === "no_successor" ? "No standby or rostered operator can take this card."
                  : shape.code === "card_not_open" ? "This gate card is no longer open."
                  : "Something went wrong.");
              }
            },
          }, "Remove holder"),
        ));
      }
      if (windowCards.length === 0) cardsBody.append(h("p", { class: "hint" }, "No open gate cards."));
      panel.append(expander("Gate cards", cardsBody, false));

      // Notices expander
      const noticesBody = h("div");
      for (const n of st.notices) {
        noticesBody.append(h("div", null,
          h("span", { class: "tag" }, n.kind), " ",
          h("b", null, n.grower_name), " ",
          h("span", null, n.subject), " ",
          h("span", { class: "hint" }, n.state === "queued" ? "Queued" : "Sent"),
        ));
      }
      if (st.notices.length === 0) noticesBody.append(h("p", { class: "hint" }, "No notices."));
      panel.append(expander("Notices", noticesBody, false));
    }

    if (selectedTab === "orders") {
      const requestedCount = windowOrders.filter((o) => o.status === "requested").length;
      const rationBtn = h("button", {
        id: "ration-window-btn",
        "aria-disabled": String(pendingAction !== null || w.status === "closed" || requestedCount === 0),
        onclick: () => openRationDialog(),
      }, "Ration window");
      panel.append(rationBtn);

      const table = h("table", { "aria-label": "Window orders" },
        h("thead", null, h("tr", null,
          h("th", null, "Order"), h("th", null, "Turnout"), h("th", null, "Grower"),
          h("th", { class: "num" }, "Volume (ML)"), h("th", null, "Status"), h("th", null, "Actions"),
        )));
      const tbody = h("tbody");
      for (const o of windowOrders) {
        const tr = h("tr", null,
          h("td", null, o.number),
          h("td", null, o.turnout),
          h("td", null, growerNameOf(o.grower_id)),
          h("td", { class: "num" }, dec(o.volume_ml), o.rationed ? h("div", { class: "hint" }, `Asked ${o.requested_ml} ML`) : null),
          h("td", null, o.status === "closed" && o.conflict === "lapsed" ? "Closed (lapsed)" : ORDER_STATUS_LABEL[o.status]),
        );
        const actions = h("td", null);
        if (w.status !== "closed") {
          if (o.status === "requested") {
            actions.append(h("button", { "aria-label": `Schedule order ${o.number}`, onclick: () => void orderAction("schedule", o.number) }, "Schedule"));
          }
          if (o.status === "requested" || o.status === "scheduled" || o.status === "running") {
            actions.append(h("button", { "aria-label": `Close order ${o.number}`, onclick: () => void orderAction("close", o.number) }, "Close"));
          }
          if (o.status === "closed" && o.closed_after_flow) {
            actions.append(h("button", { "aria-label": `Reopen order ${o.number}`, onclick: () => void orderAction("reopen", o.number) }, "Reopen"));
          }
        }
        tr.append(actions);
        tbody.append(tr);
      }
      table.append(tbody);
      panel.append(h("div", { class: "pane-scroll" }, table));
    }

    if (selectedTab === "restrictions") {
      if (w.restriction_cap_ml_day) {
        panel.append(h("p", null,
          `Restricted to ${w.restriction_cap_ml_day} ML/day from ${w.restriction_effective_at}.`,
        ));
      } else {
        panel.append(h("p", { class: "hint" }, "This window has no restriction."));
      }
    }

    wrap.append(panel);
    return wrap;
  }

  function growerNameOf(growerId: number): string {
    return st.growers[String(growerId)] ?? `Grower ${growerId}`;
  }

  function expander(title: string, body: HTMLElement, open: boolean): HTMLElement {
    let expanded = open;
    const btn = h("button", { class: "expander", "aria-expanded": String(expanded) }, title);
    const bodyWrap = h("div", { hidden: !expanded }, body);
    btn.addEventListener("click", () => {
      expanded = !expanded;
      btn.setAttribute("aria-expanded", String(expanded));
      bodyWrap.hidden = !expanded;
    });
    return h("div", null, btn, bodyWrap);
  }

  async function orderAction(action: "schedule" | "close" | "reopen", number: string): Promise<void> {
    if (pendingAction) return;
    pendingAction = action;
    status(`Updating order ${number}.`);
    try {
      const r = await api<{ order: OrderRecord; window: WindowRecord }>("POST", `/api/orders/${number}/${action}`, {});
      status(`Order ${number} is now ${ORDER_STATUS_LABEL[r.order.status]}.`);
      await refresh();
    } catch (e) {
      const shape = errorOf(e);
      const copy: Record<string, string> = {
        illegal_transition: "That change is not allowed for this order now.",
        turnout_busy: "This turnout already has an order scheduled or running.",
        window_full: "Not enough capacity left in this window.",
        allocation_exceeded: "This grower does not have enough allocation left.",
        not_reopenable: "This order cannot be reopened.",
        window_closed: "This window has closed.",
      };
      status(copy[shape.code] ?? "Something went wrong.");
      await refresh();
    } finally {
      pendingAction = null;
    }
  }

  function openPublishRestriction(): void {
    const capInput = h("input", { type: "text", id: "cap-ml-day", "aria-label": "Cap (ML/day)" }) as HTMLInputElement;
    const reasonInput = h("input", { type: "text", id: "reason", "aria-label": "Reason" }) as HTMLInputElement;
    const capErr = h("div", { class: "err" });
    const reasonErr = h("div", { class: "err" });
    const publishBtn = h("button", { class: "primary" }, "Publish");
    const cancelBtn = h("button", { type: "button" }, "Cancel");
    const dlg = h("dialog", { "aria-label": "Publish restriction" },
      h("div", { class: "dialog-body" },
        h("h2", null, "Publish restriction"),
        h("div", { class: "field" }, h("label", { for: "cap-ml-day" }, "Cap (ML/day)"), capInput, capErr),
        h("div", { class: "field" }, h("label", { for: "reason" }, "Reason"), reasonInput, reasonErr),
      ),
      h("div", { class: "dialog-actions" }, cancelBtn, publishBtn),
    ) as HTMLDialogElement;
    document.body.append(dlg);
    const opener = document.getElementById("publish-restriction-btn") as HTMLButtonElement | null;
    dlg.showModal();
    capInput.focus();

    cancelBtn.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      dlg.remove();
      opener?.focus();
    });
    dlg.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        dlg.close();
      }
    });

    publishBtn.addEventListener("click", async () => {
      clear(capErr);
      clear(reasonErr);
      status("Publishing restriction.");
      try {
        const w = currentWindow();
        const r = await api<{ restriction: { id: number } }>("POST", `/api/windows/${w!.id}/restrictions`, {
          cap_ml_day: capInput.value.trim(),
          reason: reasonInput.value.trim(),
        });
        dlg.close();
        navigate(`/restrictions/${r.restriction.id}`);
      } catch (e) {
        const shape = errorOf(e);
        const fields = fieldErrorsOf(e);
        if (fields.cap_ml_day) capErr.append(text(fields.cap_ml_day));
        if (fields.reason) reasonErr.append(text(fields.reason));
        if (shape.code === "restriction_exists") status("This window already has a restriction.");
        else if (shape.code === "window_closed") status("This window has closed.");
        else if (shape.code !== "validation") status("Something went wrong.");
      }
    });
  }

  function openRationDialog(): void {
    const w = currentWindow();
    if (!w) return;
    const remaining = w.remaining_ml;
    const requestedCount = st.orders.filter((o) => o.window_id === w.id && o.status === "requested").length;
    const body = h("p", null, `Share ${remaining} ML among ${requestedCount} requested orders in proportion to what each asked for.`);
    const rationBtn = h("button", { class: "primary" }, "Ration");
    const cancelBtn = h("button", { type: "button" }, "Cancel");
    const dlg = h("dialog", { class: "alert-dialog", "aria-label": `Ration ${w.label}` },
      h("div", { class: "dialog-body" }, h("h2", null, `Ration ${w.label}`), body),
      h("div", { class: "dialog-actions" }, cancelBtn, rationBtn),
    ) as HTMLDialogElement;
    document.body.append(dlg);
    const opener = document.getElementById("ration-window-btn") as HTMLButtonElement | null;
    dlg.showModal();
    rationBtn.focus();

    cancelBtn.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      dlg.remove();
      opener?.focus();
    });
    dlg.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        dlg.close();
      }
    });

    rationBtn.addEventListener("click", async () => {
      status("Rationing.");
      try {
        const r = await api<{ window: WindowRecord; rationed: Array<{ order_number: string }>; left_requested: string[] }>(
          "POST", `/api/windows/${w.id}/ration`, {},
        );
        dlg.close();
        status(`Window rationed. ${r.rationed.length} orders scheduled, ${r.left_requested.length} left requested.`);
        await refresh();
      } catch (e) {
        const shape = errorOf(e);
        dlg.close();
        if (shape.code === "nothing_to_ration") status("No requested orders to ration.");
        else if (shape.code === "window_closed") status("This window has closed.");
        else status("Something went wrong.");
        await refresh();
      }
    });
  }

  await refresh();
  startPolling(refresh, 3000);
  window.addEventListener("resize", () => render());
});
