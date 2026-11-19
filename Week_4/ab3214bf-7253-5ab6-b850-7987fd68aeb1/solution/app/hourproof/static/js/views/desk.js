// The window desk: Break the Month, the Hour Wall, the hour panel and every analyst action on a window.
import { h, commas, pct, link, allocationLine, lineItem, wholeNumber } from "../dom.js";
import { get, post, put, ApiError, SessionCancelled } from "../api.js";
import { countdown } from "../clock.js";
import { openDialog } from "../dialog.js";
import { problems } from "../problems.js";
import { poll } from "../poll.js";
import { createWall } from "../wall.js";
import { createScorePanel, grainIndex, GRAINS, grainName } from "../grain.js";

const TIMED_OUT = "REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.";
const HELD_COPY = { held_press: "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE.", held_store: "THE STORE IS DOWN. YOUR SIGNATURE IS SAFE." };
const CANCEL_STATES = ["Cancelling", "Cancelled", "Signed", "Sealed", "Restated"];
const DIGITS = /^\d+$/;

export function figureShape(w) {
  return JSON.stringify([w.revision, w.scores, w.consumed_wh, w.unmatched_wh, w.unmatched_hours, w.missing_hours, w.state]);
}

export function mount({ container, params, query, user, shell, navigate }) {
  const [id] = params;
  const isAnalyst = user.role === "analyst";
  const state = {
    window: null, known: 0, pending: false, error: null, shapeSeen: "", selection: 0, panelOpen: null,
    banners: new Map(), shown: new Set(), gone: false,
  };
  const seen = { revision: 0, bump(r) { if (r > this.revision) this.revision = r; } };
  const timers = { review: null, opens: null };
  const windowGroup = { async ask() { await refreshWindow(); } };
  let panel = null;
  let loop = null;
  let hourDialog = null;
  let wall = null;

  // ---- skeleton --------------------------------------------------------------------------------------------
  const title = h("h1", { class: "desk-title" });
  const stateWord = h("p", { class: "state-word" });
  const targetLine = h("p", { class: "target-line" });
  const bannerBox = h("div", { class: "banners" });
  const gradeStatus = h("div", { role: "status", "aria-label": "Grain score", "aria-live": "polite", class: "sr-only" });
  const stats = h("div", { class: "stats" });
  const timerBox = h("div", { class: "timers" });
  const returned = h("p", { class: "returned", hidden: true });
  const side = h("aside", { class: "desk-side" });
  const buttons = {};
  const actionsRegion = h("section", { role: "region", "aria-label": "Window actions", class: "actions field-band" });
  const defineAction = (key, text, run) => {
    buttons[key] = h("button", { type: "button", text, hidden: true });
    buttons[key].addEventListener("click", () => runAction(buttons[key], run));
    actionsRegion.append(buttons[key]);
  };
  const lotsLink = link(`/windows/${id}/lots`, "Lots");
  const ledgerLink = link(`/windows/${id}/ledger`, "Ledger");
  const readOnly = h("p", { class: "muted", hidden: true, text: "This window is read-only for your role." });
  side.append(actionsRegion, readOnly, stats, timerBox, h("nav", { class: "side-links", "aria-label": "Window pages" }, lotsLink, ledgerLink));
  const region = h("section", { role: "region", "aria-label": "Window desk", class: "desk" });

  // ---- actions ---------------------------------------------------------------------------------------------
  const revisionBody = (extra = {}) => ({ revision: state.window.revision, ...extra });

  function announceAllocation(w, ...lead) {
    shell.status([...lead, allocationLine(w)].join(" "));
  }

  async function adopt(w) {
    state.known = Math.max(state.known, w.revision);
    seen.bump(w.revision);
    applyWindow(w);
    state.shapeSeen = figureShape(w);
    await panel.refresh();
    await hourDialog?.refresh();
  }

  function setBusy(on, own) {
    for (const button of Object.values(buttons)) {
      if (on) button.setAttribute("aria-disabled", "true"); else button.removeAttribute("aria-disabled");
    }
    if (own && on) own.setAttribute("aria-disabled", "true");
  }

  // A pending action marks its own control, keeps focus on it and sets the panel's figure to COUNTING.
  async function busy(own, work) {
    state.pending = true;
    setBusy(true, own);
    panel.setLoading(true);
    try {
      return await work();
    } finally {
      state.pending = false;
      setBusy(false);
      panel.setLoading(false);
      renderActions();
    }
  }

  async function runAction(button, run) {
    if (state.pending || button.getAttribute("aria-disabled") === "true") return;
    setError(null);
    try {
      await busy(button, run);
    } catch (error) {
      if (error instanceof SessionCancelled) { /* the typed work stays; nothing was sent */ }
      else if (error instanceof ApiError) { setError(error.message); await recover(); }
      else throw error;
    }
  }

  async function recover() {
    try { await adopt(await get(`/api/windows/${id}`)); } catch { /* the next poll tries again */ }
  }

  defineAction("pull", "Pull meters", async () => {
    const reply = await post(`/api/windows/${id}/meters/pull`, revisionBody());
    await adopt(reply);
    announceAllocation(reply, `Pull done. ${reply.hours_read} hours read. ${reply.missing_hours} hours still Missing.`);
  });
  defineAction("repair", "Repair gaps", async () => {
    const reply = await post(`/api/windows/${id}/gaps/repair`, revisionBody());
    await adopt(reply.window);
    announceAllocation(reply.window, `Repair done. ${reply.filled.length} hours filled. ${reply.unfilled.length} hours still Missing.`);
  });
  buttons.spread = h("button", { type: "button", text: "Spread a total", hidden: true });
  buttons.spread.addEventListener("click", () => openSpread());
  actionsRegion.append(buttons.spread);
  defineAction("rerun", "Rerun allocation", () => rerun());
  defineAction("sync", "Sync holdings", async () => {
    const reply = await post(`/api/windows/${id}/holdings/sync`, revisionBody());
    await adopt(reply.window);
    const held = reply.held_elsewhere.length;
    announceAllocation(reply.window, ...(held ? [`${held} bundles are held by another window.`] : []));
  });
  defineAction("submit", "Submit for review", async () => {
    const reply = await post(`/api/windows/${id}/submit`, revisionBody());
    await adopt(reply);
    shell.status("Sent for review. The verifier has 25 hours to test.");
  });
  defineAction("resume", "Resume reconciling", async () => {
    await adopt(await post(`/api/windows/${id}/resume`, revisionBody()));
  });
  defineAction("cancel", "Cancel certificates", async () => {
    const reply = await post(`/api/windows/${id}/cancellations`, {});
    await adopt(reply.window);
    shell.status("Sent to the registry. Lots read Cancelled once it confirms.");
  });

  async function rerun() {
    const reply = await post(`/api/windows/${id}/allocation`, revisionBody());
    await adopt(reply.window);
    announceAllocation(reply.window);
  }

  function renderActions() {
    const w = state.window;
    if (!w) return;
    const show = (key, on) => { buttons[key].hidden = !(isAnalyst && on); };
    show("pull", w.state === "Awaiting meters" || w.state === "Reconciling");
    show("repair", w.state === "Reconciling");
    show("spread", w.state === "Reconciling" && state.selection >= 2);
    show("rerun", w.state === "Reconciling");
    show("sync", w.state === "Reconciling");
    show("submit", w.state === "Reconciling");
    show("resume", w.state === "Returned");
    show("cancel", w.state === "Cancelling");
    readOnly.hidden = isAnalyst;
  }

  // ---- window rendering ------------------------------------------------------------------------------------
  function stat(label, value, unit = "") {
    return h("p", { class: "stat" }, h("span", { text: label }), " ",
      h("span", { class: "nowrap" }, h("span", { class: "figure small", text: value }), unit));
  }

  function applyWindow(w) {
    state.window = w;
    title.textContent = `${w.site.name} ${w.month}`;
    stateWord.textContent = w.state;
    targetLine.textContent = `Target ${w.target.grain} ${pct(w.target.bp)}% · ${w.target.met ? "On target" : "Off target"}`;
    const residual = w.residual_emissions_g === null ? "unknown" : commas(w.residual_emissions_g);
    stats.replaceChildren(
      stat("Missing hours", String(w.missing_hours)),
      stat("Unmatched", commas(w.unmatched_wh), " Wh"),
      stat("Unmatched hours", String(w.unmatched_hours)),
      stat("Residual", residual, " g CO2"),
      ...(CANCEL_STATES.includes(w.state) ? [stat("Confirmed", `${w.lines_confirmed} of ${w.lines_total} lines`)] : []));
    returned.hidden = !(w.state === "Returned" && w.returned_reason && w.returned_reason !== TIMED_OUT);
    returned.textContent = w.returned_reason || "";
    setTimers(w);
    renderActions();
    renderBanners();
  }

  function setTimers(w) {
    for (const key of Object.keys(timers)) timers[key]?.stop();
    timerBox.replaceChildren();
    timers.review = timers.opens = null;
    if (w.state === "In review" && w.review_seconds_left !== null) {
      const el = h("span", { role: "timer", "aria-label": "Review time left" });
      timerBox.append(el);
      timers.review = countdown(el, w.review_seconds_left, windowGroup);
    }
    if (w.state === "Awaiting meters" && w.opens_seconds_left !== null) {
      const el = h("span", { role: "timer", "aria-label": "Opens in" });
      timerBox.append(el);
      timers.opens = countdown(el, w.opens_seconds_left, windowGroup);
    }
  }

  function setError(text) {
    state.error = text;
    renderBanners();
  }

  function renderBanners() {
    const w = state.window;
    const wanted = [];
    if (state.error) wanted.push(["error", state.error]);
    if (w) {
      if (w.state === "Returned" && w.returned_reason === TIMED_OUT) wanted.push(["timeout", TIMED_OUT]);
      if (w.registry_reachable === false && w.lines_open > 0) wanted.push(["registry", `REGISTRY IS DOWN. WAITING ON ${w.lines_open} LINES.`]);
      if (w.residual_emissions_g === null) wanted.push(["grid", "GRID FACTORS ARE LATE. SCORES DID NOT CHANGE."]);
      if (w.state === "Signed" && HELD_COPY[w.seal_status]) wanted.push(["seal", HELD_COPY[w.seal_status]]);
    }
    const keys = new Set(wanted.map(([key, text]) => `${key}:${text}`));
    for (const [key, text] of wanted) {
      if (!state.shown.has(`${key}:${text}`)) shell.alert(text);
    }
    state.shown = keys;
    bannerBox.replaceChildren(...wanted.map(([, text]) => h("p", { class: "banner field-orange", text })));
  }

  // ---- live refresh ----------------------------------------------------------------------------------------
  function gone() {
    state.gone = true;
    loop?.stop();
    container.replaceChildren(h("section", { class: "panel field-orange" }, h("p", { class: "figure", text: "THAT PAGE DOES NOT EXIST." })));
  }

  async function refreshWindow() {
    let w;
    try {
      w = await get(`/api/windows/${id}`, { background: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) { gone(); return; }
      throw error;
    }
    if (state.pending || state.gone) return;
    const previous = state.window;
    if (w.last_write_revision !== null && w.last_write_revision > state.known && w.last_writer_name !== user.name) {
      shell.status(`${w.last_writer_name} changed this window. Hour score ${pct(w.scores.hour_bp)} percent.`);
    }
    if (previous && previous.state === "Cancelling" && w.lines_confirmed !== previous.lines_confirmed) {
      shell.status(`Registry confirmed ${w.lines_confirmed} of ${w.lines_total} lines.`);
    }
    if (previous && ["In review", "Cancelling"].includes(previous.state) && w.state === "Reconciling") {
      shell.alert("The registry rejected a line — back to reconciling.");
    }
    state.known = Math.max(state.known, w.revision);
    seen.bump(w.revision);
    applyWindow(w);
    const shape = figureShape(w);
    if (shape !== state.shapeSeen) {
      state.shapeSeen = shape;
      await panel.refresh();
      await hourDialog?.refresh();
    }
  }

  // ---- hour panel ------------------------------------------------------------------------------------------
  const urlWith = (changes) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value); }
    const text = next.toString();
    return location.pathname + (text ? `?${text}` : "");
  };

  async function openHour(key, { opener, push }) {
    if (hourDialog) return;
    let detail;
    try {
      detail = await get(`/api/windows/${id}/hours/${key}`);
    } catch (error) {
      if (error instanceof ApiError) { history.replaceState(null, "", urlWith({ hour: null })); return; }
      if (error instanceof SessionCancelled) return;
      throw error;
    }
    if (push) history.pushState(null, "", urlWith({ hour: key }));
    hourDialog = buildHourDialog(key, detail, opener || wall.cellFor(key) || panel.slider);
  }

  function buildHourDialog(key, detail, opener) {
    const w = state.window;
    const canSave = isAnalyst && w.state === "Reconciling" && ["Missing", "Estimated"].includes(detail.quality);
    let revision = w.revision;
    const list = problems();
    const info = h("div", { class: "hour-info" });
    const lines = h("ul", { class: "hour-lines" });
    const heading = h("h2", { class: "dialog-title" });
    const reasonText = h("p", { class: "reason-text", hidden: true });
    const value = canSave ? h("input", { id: "sub-value", type: "text", inputmode: "numeric", autocomplete: "off" }) : null;
    const reason = canSave ? h("textarea", { id: "sub-reason", rows: "3" }) : null;
    const save = canSave ? h("button", { type: "button", text: "Save substitution" }) : null;
    const retry = canSave ? h("button", { type: "button", text: "Retry on latest", hidden: true }) : null;
    const close = h("button", { type: "button", text: "Close" });
    const dialog = h("dialog", { class: "panel field-pink hour-dialog", "aria-label": "Hour detail" },
      h("div", { class: "stack" }, heading, info, reasonText, lines,
        canSave ? [h("label", { for: "sub-value", text: "Substitution value in watt-hours" }), value,
          h("label", { for: "sub-reason", text: "Reason" }), reason] : null,
        list.el, h("div", { class: "row" }, save, retry, close)));
    const paint = (d) => {
      heading.textContent = `${d.local_label}. ${d.quality.toUpperCase()}.`;
      info.replaceChildren(
        h("p", { text: `UTC hour ${d.hour_utc}` }), h("p", { text: `Local hour ${d.local_label}` }),
        h("p", { text: d.quality === "Missing" ? "Consumed none" : `Consumed ${commas(d.consumed_wh)} Wh` }),
        h("p", { text: `Matched ${commas(d.matched_wh)} Wh` }), h("p", { text: `Quality ${d.quality}` }));
      reasonText.hidden = d.substitution_reason === null;
      reasonText.textContent = d.substitution_reason === null ? "" : d.substitution_reason;
      lines.replaceChildren(...d.lines.map(lineItem));
    };
    paint(detail);
    let closingByHistory = false;
    const handle = openDialog(dialog, {
      opener, initial: value || close,
      onClose: () => {
        hourDialog = null;
        if (!closingByHistory) history.replaceState(null, "", urlWith({ hour: null }));
      },
    });
    const fieldMap = canSave ? { value_wh: value, reason } : {};
    const send = async () => {
      if (!DIGITS.test(value.value)) {
        list.show("", [{ message: "Enter a whole number of watt-hours.", target: value }]);
        return false;
      }
      try {
        const reply = await put(`/api/windows/${id}/hours/${key}/substitution`, {
          revision, value_wh: wholeNumber(value.value), reason: reason.value });
        list.clear();
        handle.close();
        await adopt(reply);
        shell.status(allocationLine(reply));
        return true;
      } catch (error) {
        if (error instanceof SessionCancelled) return false;
        if (!(error instanceof ApiError)) throw error;
        retry.hidden = error.code !== "STALE_REVISION";
        list.fromError(error, fieldMap);
        return false;
      }
    };
    const guarded = async (fn) => {
      if (state.pending) return;
      await busy(save, fn);
    };
    if (canSave) {
      save.addEventListener("click", () => { if (save.getAttribute("aria-disabled") !== "true") guarded(send); });
      retry.addEventListener("click", () => guarded(async () => {
        try { const latest = await get(`/api/windows/${id}`); revision = latest.revision; seen.bump(latest.revision); } catch (e) { if (!(e instanceof ApiError)) throw e; }
        await send();
      }));
    }
    close.addEventListener("click", () => handle.close());
    return {
      async refresh() { try { paint(await get(`/api/windows/${id}/hours/${key}`, { background: true })); } catch { /* keep the last figures */ } },
      closeByHistory() { closingByHistory = true; handle.close(); },
    };
  }

  // ---- spread ----------------------------------------------------------------------------------------------
  async function openSpread() {
    const opener = buttons.spread;
    const roving = wall.rovingCell();
    const keys = wall.selectionKeys();
    const list = problems();
    const total = h("input", { id: "spread-total", type: "text", inputmode: "numeric", autocomplete: "off" });
    const reason = h("textarea", { id: "spread-reason", rows: "3" });
    const send = h("button", { type: "button", text: "Spread" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const dialog = h("dialog", { class: "panel field-pink", "aria-label": "Spread a total" },
      h("div", { class: "stack" }, h("label", { for: "spread-total", text: "Total in watt-hours" }), total,
        h("label", { for: "spread-reason", text: "Reason" }), reason, list.el, h("div", { class: "row" }, send, cancel)));
    await new Promise((resolve) => {
      const handle = openDialog(dialog, { opener, initial: total, onClose: resolve });
      cancel.addEventListener("click", () => handle.close());
      send.addEventListener("click", async () => {
        if (send.getAttribute("aria-disabled") === "true") return;
        if (!DIGITS.test(total.value)) { list.show("", [{ message: "Enter a whole number of watt-hours.", target: total }]); return; }
        if (state.pending) return;
        try {
          await busy(send, async () => {
            const reply = await post(`/api/windows/${id}/hours/spread`, revisionBody({ hours: keys, total_wh: wholeNumber(total.value), reason: reason.value }));
            wall.clearSelection();
            handle.close({ restore: false });
            await adopt(reply);
            shell.status(`Spread done. ${keys.length} hours filled. ${allocationLine(reply)}`);
            roving?.focus({ preventScroll: true });
          });
        } catch (error) {
          if (error instanceof SessionCancelled) return;
          if (!(error instanceof ApiError)) throw error;
          list.fromError(error, { total_wh: total, reason, hours: total });
        }
      });
    });
  }

  // ---- assembly --------------------------------------------------------------------------------------------
  function writeGrain(index) {
    history.replaceState(null, "", urlWith({ grain: GRAINS[index] }));
  }

  function onSettled(index, reply) {
    writeGrain(index);
    const points = state.window.scores.month_bp - reply.score_bp;
    gradeAnnounce(`${grainName(index)} grain. ${pct(reply.score_bp)} percent matched. ${pct(points)} points gone since month.`);
  }

  function gradeAnnounce(text) {
    gradeStatus.textContent = "";
    queueMicrotask(() => { gradeStatus.textContent = text; });
  }

  async function start() {
    let w;
    try {
      w = await get(`/api/windows/${id}`);
    } catch (error) {
      if (error instanceof ApiError) { gone(); return; }
      if (error instanceof SessionCancelled) return;
      throw error;
    }
    state.window = w;
    state.known = w.revision;
    seen.bump(w.revision);
    wall = createWall({
      timeZone: w.site.time_zone,
      onOpen: (key, cell) => openHour(key, { opener: cell, push: true }),
      onSelection: (count) => { state.selection = count; renderActions(); },
      onMessage: (text) => shell.status(text),
    });
    panel = createScorePanel({ windowId: id, seen, wall, initial: grainIndex(query.get("grain")), onSettled });
    try { await panel.load(); } catch (error) { if (!(error instanceof ApiError || error instanceof SessionCancelled)) throw error; }
    region.replaceChildren(bannerBox,
      h("div", { class: "desk-grid" },
        h("div", { class: "desk-main" }, h("header", { class: "desk-head" }, title, stateWord, targetLine, returned),
          panel.panel, h("div", { class: "slider-wrap" }, panel.slider), gradeStatus, panel.view),
        side));
    container.replaceChildren(h("section", { class: "page field-yellow" }, region));
    applyWindow(w);
    state.shapeSeen = figureShape(w);
    if (query.get("hour")) openHour(query.get("hour"), { opener: wall.cellFor(query.get("hour")) || panel.slider, push: false });
    loop = poll(refreshWindow, 2000);
  }

  region.addEventListener("keydown", (event) => {
    if (event.key !== "a" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (!isAnalyst || state.window?.state !== "Reconciling" || state.pending) return;
    if (event.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    runAction(buttons.rerun, () => rerun());
  });

  container.replaceChildren(h("section", { class: "page field-yellow" }, h("p", { class: "figure", text: "COUNTING" })));
  start();
  return {
    unmount() { loop?.stop(); panel?.destroy(); for (const t of Object.values(timers)) t?.stop(); },
    onUrl(next) {
      const hour = next.get("hour");
      if (!hour && hourDialog) hourDialog.closeByHistory();
      else if (hour && !hourDialog && panel && wall) openHour(hour, { opener: wall.cellFor(hour) || panel.slider, push: false });
    },
  };
}
