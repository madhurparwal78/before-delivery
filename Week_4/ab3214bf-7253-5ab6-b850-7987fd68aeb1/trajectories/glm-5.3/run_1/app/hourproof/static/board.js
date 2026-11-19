/* Window board, lots and merit order, ledger, review queue and screens, group, check. */
"use strict";

/* --- Window board ----------------------------------------------------------- */
async function renderBoard() {
  const filter = new URLSearchParams(location.search).get("state") || "All";
  const boardStatus = el("div", { role: "status", "aria-label": "Board status" });
  const table = el("table", { "aria-label": "Window board" });
  let windows = [];
  try { windows = await api("GET", "/api/windows"); } catch (err) { return renderSignIn(); }
  const applyFilter = (rows, value) => value === "All" ? rows : rows.filter((w) => w.state === value);

  const filterBtn = el("button", { id: nextId(), text: "Filter windows" });
  filterBtn.addEventListener("click", () => {
    const { dlg, problems } = dialogShell("Filter windows");
    const combo = el("select", { "aria-label": "State", "data-field": "state" });
    for (const state of ["All", "Awaiting meters", "Reconciling", "In review", "Returned",
                        "Cancelling", "Cancelled", "Signed", "Sealed", "Restated"]) {
      const opt = el("option", { value: state, text: state });
      if (state === filter) opt.selected = true;
      combo.append(opt);
    }
    const apply = el("button", { text: "Apply" });
    const close = el("button", { text: "Close" });
    const applyNow = () => {
      const url = new URL(location.href);
      if (combo.value === "All") url.searchParams.delete("state");
      else url.searchParams.set("state", combo.value);
      history.pushState({}, "", url);
      closeDialog(dlg);
      drawRows(windows, combo.value);
      announce(boardStatus, `${applyFilter(windows, combo.value).length} windows shown.`);
    };
    apply.addEventListener("click", applyNow);
    close.addEventListener("click", () => closeDialog(dlg));
    dlg.append(combo, apply, close);
    openDialog(dlg, filterBtn);
  });

  function drawRows(all, value) {
    const rows = applyFilter(all, value);
    const tbody = el("tbody");
    if (!rows.length) {
      table.replaceChildren(el("tbody", {}, el("tr", {}, el("td", { colspan: "7", text: "NO WINDOWS MATCH." }))));
      return;
    }
    for (const win of rows) {
      const linkNode = link(`${win.site.name} ${win.month}`, `/windows/${win.id}`);
      const tr = el("tr", {},
        el("td", {}, linkNode),
        el("td", { text: win.state }),
        el("td", { text: pct(win.scores.month_bp) }),
        el("td", { text: pct(win.scores.week_bp) }),
        el("td", { text: pct(win.scores.day_bp) }),
        el("td", { text: pct(win.scores.hour_bp) }),
        el("td", { text: win.target.met ? "On target" : "Off target" }));
      if (win.state === "In review" && win.review_seconds_left !== null) {
        const timer = el("span", { role: "timer", "aria-label": "Review time left",
                                   text: fmtCountdown(win.review_seconds_left) });
        const state = { remaining: win.review_seconds_left, asked: false, el: timer,
                        fetchUpdate: async () => {
                          const fresh = await api("GET", "/api/windows");
                          const row = fresh.find((w) => w.id === win.id);
                          return row ? row.review_seconds_left : null;
                        } };
        timers.add(state);
        tr.append(el("td", {}, timer));
      }
      tbody.append(tr);
    }
    table.replaceChildren(tableHead(["Window", "State", "Month", "Week", "Day", "Hour", "Target"]),
      tbody);
  }

  drawRows(windows, filter);
  const content = el("div", { class: "board" },
    el("h1", { text: "YOUR WINDOWS." }),
    filterBtn, boardStatus, table);
  land(deskShell(content, "/windows"));
}

function tableHead(labels) {
  const thead = el("thead");
  const tr = el("tr");
  for (const label of labels) tr.append(el("th", { text: label }));
  thead.append(tr);
  return thead;
}

/* --- Lots and merit order ---------------------------------------------------- */
async function renderLots(windowId) {
  let data = null;
  try { data = await api("GET", `/api/windows/${windowId}/lots`); }
  catch (err) { return renderNotFound(); }
  const meritStatus = el("div", { role: "status", "aria-label": "Merit order status" });
  const merit = el("ol", { "aria-label": "Merit order", class: "merit-order" });
  const listRegion = el("section", { "aria-label": "Lot list", class: "lot-list" });
  let pending = false;
  let latest = data;

  const move = async (lotId, delta) => {
    if (pending) return;
    const order = latest.lots.map((l) => l.id);
    const index = order.indexOf(lotId);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = order.slice();
    next.splice(target, 0, next.splice(index, 1)[0]);
    pending = true;
    setAllDisabled(true);
    try {
      const result = await api("PUT", `/api/windows/${windowId}/merit-order`,
        { revision: latest.revision, lot_ids: next });
      latest = { lots: result.lots, revision: result.window.revision };
      announce(meritStatus, `${result.lots[target].name} is now rank ${result.lots[target].rank} of ${result.lots.length}.`);
      redraw();
    } catch (err) {
      handleActionError(err, null, null);
    } finally {
      pending = false;
      setAllDisabled(false);
    }
  };
  const setAllDisabled = (value) => {
    for (const btn of merit.querySelectorAll("button")) {
      if (value) btn.setAttribute("aria-disabled", "true");
      else btn.removeAttribute("aria-disabled");
    }
  };

  function redraw() {
    merit.replaceChildren();
    listRegion.replaceChildren();
    for (const lot of latest.lots) {
      const up = el("button", { text: "Move up" });
      const down = el("button", { text: "Move down" });
      const details = el("button", { text: "Details" });
      up.addEventListener("click", () => move(lot.id, -1));
      down.addEventListener("click", () => move(lot.id, 1));
      if (lot.rank === 1) up.setAttribute("aria-disabled", "true");
      if (lot.rank === latest.lots.length) down.setAttribute("aria-disabled", "true");
      details.addEventListener("click", () => openLotDrawer(lot, latest, meritStatus));
      const item = el("li", {}, el("span", { text: `${lot.name} ${lot.rank} ${lot.status} ${fmtThousands(lot.opening_wh)} Wh` }), up, down, details);
      merit.append(item);
      listRegion.append(el("div", { class: "lot-row" },
        el("span", { text: lot.name }),
        el("span", { text: lot.technology }),
        el("span", { text: lot.zone }),
        el("span", { text: lot.status }),
        el("span", { text: `cancel-by ${lot.cancel_by}` }),
        el("span", { text: `${lot.bundle_count} bundles` }),
        el("span", { text: `Confirmed ${lot.lines_confirmed} of ${lot.lines_total} lines` })));
    }
  }
  redraw();

  const content = el("div", { class: "lots-page" },
    el("h1", { text: "RANK YOUR LOTS." }),
    merit, meritStatus, listRegion);
  land(deskShell(content, `/windows/${windowId}/lots`));

  setInterval(async () => {
    if (refreshPaused) return;
    try {
      const fresh = await api("GET", `/api/windows/${windowId}/lots`);
      latest = fresh;
      if (!pending) redraw();
    } catch { }
  }, 5000);
}

function openLotDrawer(lot, data, meritStatus) {
  const { dlg, problems } = dialogShell("Lot drawer");
  dlg.append(el("h2", { text: lot.name }));
  const exclude = el("button", { text: lot.excluded ? "Include lot" : "Exclude lot" });
  exclude.addEventListener("click", async () => {
    try {
      const result = await api("PUT", `/api/windows/${lot.windowId || ""}/lots/${lot.id}/exclusion`,
        { revision: data.revision, excluded: !lot.excluded });
      const region = document.querySelector('[role="status"][aria-label="Desk status"]');
      announce(region || meritStatus,
        `Allocation done. Hour score ${pct(result.window.scores.hour_bp)} percent. ${result.window.unmatched_hours} unmatched hours.`);
      closeDialog(dlg);
      renderRoute();
    } catch (err) { showProblems(dlg, err); }
  });
  const close = el("button", { text: "Close" });
  close.addEventListener("click", () => closeDialog(dlg));
  dlg.append(exclude, close);
  openDialog(dlg);
}

/* --- Ledger ------------------------------------------------------------------ */
async function renderLedger(windowId) {
  let data = null;
  try { data = await api("GET", `/api/windows/${windowId}/ledger`); }
  catch (err) { return renderNotFound(); }
  const balances = el("section", { "aria-label": "Balances" },
    el("div", { text: `Opening ${fmtThousands(data.opening_wh)} Wh` }),
    el("div", { text: `Holdings ${fmtThousands(data.balances.holdings_wh)} Wh` }),
    el("div", { text: `Allocated ${fmtThousands(data.balances.allocated_wh)} Wh` }),
    el("div", { text: `Cancelled ${fmtThousands(data.balances.cancelled_wh)} Wh` }),
    el("div", { text: `Loss ${fmtThousands(data.balances.loss_wh)} Wh` }));
  const table = el("table", { "aria-label": "Ledger entries" });
  const tbody = el("tbody");
  for (const entry of data.entries) {
    tbody.append(el("tr", {},
      el("td", { text: entry.kind }),
      el("td", { text: entry.account }),
      el("td", { text: `${entry.wh < 0 ? "-" : ""}${fmtThousands(Math.abs(entry.wh))} Wh` }),
      el("td", { text: entry.label }),
      el("td", { text: entry.at })));
  }
  table.replaceChildren(tableHead(["Kind", "Account", "Wh", "Label", "At"]), tbody);
  const content = el("div", { class: "ledger-page" },
    el("h1", { text: "EVERY WATT-HOUR, ACCOUNTED." }),
    balances, table);
  land(deskShell(content, `/windows/${windowId}/ledger`));
}
