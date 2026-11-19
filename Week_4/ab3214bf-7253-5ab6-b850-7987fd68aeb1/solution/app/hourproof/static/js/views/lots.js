// Lots and merit order: rank lots by keyboard, touch or pointer; the order changes only on the server's reply.
import { h, commas, pct, link, allocationLine, loadingFigure } from "../dom.js";
import { get, put, ApiError, SessionCancelled } from "../api.js";
import { countdown } from "../clock.js";
import { openDialog } from "../dialog.js";
import { announce } from "../announce.js";
import { poll } from "../poll.js";

export function mount({ container, params, user, shell }) {
  const [id] = params;
  const state = { window: null, lots: [], pending: false, known: 0, error: null, drawer: null };
  const group = { async ask() { await refresh(); } };
  let loop = null;
  const merit = h("ul", { role: "list", "aria-label": "Merit order", class: "merit" });
  const lotList = h("section", { role: "region", "aria-label": "Lot list", class: "lot-list" });
  const meritStatus = h("div", { role: "status", "aria-label": "Merit order status", "aria-live": "polite", class: "sr-only" });
  const bannerBox = h("div", { class: "banners" });
  const empty = h("p", { class: "figure", hidden: true, text: "NO LOTS HERE." });
  const dropLine = h("div", { class: "drop-line", hidden: true });
  const loading = loadingFigure();
  const content = h("div", { class: "split", hidden: true },
    h("div", { class: "merit-column" }, h("h2", { text: "MERIT ORDER" }), h("div", { class: "merit-wrap" }, merit, dropLine)), lotList);
  container.replaceChildren(h("section", { class: "page field-white" },
    h("h1", { text: "RANK YOUR LOTS." }), link(`/windows/${id}`, "Back to the window"), bannerBox, meritStatus, loading, empty, content));

  const rowsByLot = new Map();

  function setError(text) {
    state.error = text;
    bannerBox.replaceChildren(...(text ? [h("p", { class: "banner field-orange", text })] : []));
    if (text) shell.alert(text);
  }

  function focusedControl() {
    const active = document.activeElement;
    const li = active?.closest?.("li[data-lot]");
    return li && merit.contains(li) ? { lot: li.dataset.lot, control: active.dataset.control } : null;
  }

  function restoreFocus(saved, opposite) {
    if (!saved || !saved.control) return;
    const li = rowsByLot.get(saved.lot);
    if (!li) return;
    let control = saved.control;
    if (opposite) control = control === "up" ? "down" : "up";
    li.querySelector(`[data-control="${control}"]`)?.focus({ preventScroll: true });
  }

  function buildItem(lot) {
    const up = h("button", { type: "button", text: "Move up", "data-control": "up" });
    const down = h("button", { type: "button", text: "Move down", "data-control": "down" });
    const details = h("button", { type: "button", text: "Details", "data-control": "details" });
    const li = h("li", { class: "merit-item", "data-lot": lot.id }, h("div", { class: "merit-text" }), h("div", { class: "row" }, up, down, details));
    up.addEventListener("click", () => move(lot.id, -1));
    down.addEventListener("click", () => move(lot.id, 1));
    details.addEventListener("click", () => openDrawer(lot.id, details));
    li.addEventListener("pointerdown", (event) => startDrag(event, li));
    return li;
  }

  function render() {
    const lots = state.lots;
    const saved = focusedControl();
    const order = [];
    lots.forEach((lot, index) => {
      let li = rowsByLot.get(lot.id);
      if (!li) { li = buildItem(lot); rowsByLot.set(lot.id, li); }
      li.firstChild.replaceChildren(
        h("span", { class: "merit-name", text: lot.name }), " ",
        h("span", { text: `rank ${lot.rank}` }), " ",
        h("span", { class: "state-word", text: lot.status }), " ",
        h("span", { class: "merit-opening nowrap", text: `${commas(lot.opening_wh)} Wh` }));
      const up = li.querySelector('[data-control="up"]');
      const down = li.querySelector('[data-control="down"]');
      up.setAttribute("aria-disabled", String(state.pending || index === 0));
      down.setAttribute("aria-disabled", String(state.pending || index === lots.length - 1));
      order.push(li);
    });
    for (const [lotId, li] of rowsByLot) if (!lots.some((lot) => lot.id === lotId)) { li.remove(); rowsByLot.delete(lotId); }
    if (order.some((li, i) => merit.children[i] !== li) || merit.children.length !== order.length) merit.replaceChildren(...order);
    restoreFocus(saved, false);
    empty.hidden = lots.length > 0;
    lotList.replaceChildren(h("h2", { text: "LOT LIST" }), ...lots.map((lot) => h("article", { class: "lot" },
      h("h3", { text: lot.name }),
      h("p", { text: `${lot.technology} · zone ${lot.zone} · ${lot.status}` }),
      h("p", {}, "Cancel by ", h("span", { class: "nowrap", text: lot.cancel_by })),
      h("p", { text: `${lot.bundle_count} bundles` }),
      h("p", { text: `Confirmed ${lot.lines_confirmed} of ${lot.lines_total} lines` }))));
    loading.remove();
    content.hidden = false;
    renderDrawer();
  }

  async function apply(window, lots) {
    state.window = window;
    state.known = Math.max(state.known, window.revision);
    if (lots) state.lots = lots;
    render();
  }

  // ---- reordering ------------------------------------------------------------------------------------------
  async function reorder(ids, moved, delta) {
    if (state.pending) return;
    state.pending = true;
    setError(null);
    const saved = focusedControl();
    render();
    try {
      const reply = await put(`/api/windows/${id}/merit-order`, { revision: state.window.revision, lot_ids: ids });
      state.pending = false;
      await apply(reply.window, reply.lots);
      const lot = reply.lots.find((candidate) => candidate.id === moved);
      announce(meritStatus, `${lot.name} is now rank ${lot.rank} of ${reply.lots.length}.`);
      shell.status(allocationLine(reply.window));
      const atEnd = delta !== null && (lot.rank === 1 || lot.rank === reply.lots.length) && saved?.control === (delta < 0 ? "up" : "down");
      restoreFocus(saved, atEnd);
    } catch (error) {
      state.pending = false;
      if (error instanceof SessionCancelled) { render(); return; }
      if (!(error instanceof ApiError)) throw error;
      setError(error.message);
      await refresh();
    }
  }

  function move(lotId, delta) {
    if (state.pending) return;
    const ids = state.lots.map((lot) => lot.id);
    const from = ids.indexOf(lotId);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorder(ids, lotId, delta);
  }

  let drag = null;
  function dropIndex(y) {
    const others = [...merit.children].filter((li) => li !== drag.li);
    return others.filter((li) => { const r = li.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
  }

  let suppress = null;
  function startDrag(event, li) {
    if (suppress) { suppress.li.removeEventListener("click", suppress.fn, true); suppress = null; }
    if (state.pending || (event.pointerType === "mouse" && event.button !== 0)) return;
    const fromButton = Boolean(event.target.closest("button"));
    drag = { li, pointer: event.pointerId, startY: event.clientY, moved: false, fromButton };
    if (!fromButton) li.setPointerCapture(event.pointerId);
  }

  merit.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) > 4) {
      drag.moved = true;
      if (drag.fromButton) drag.li.setPointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    const index = dropIndex(event.clientY);
    const others = [...merit.children].filter((li) => li !== drag.li);
    const base = merit.parentElement.getBoundingClientRect();
    const target = index < others.length ? others[index].getBoundingClientRect().top : others[others.length - 1].getBoundingClientRect().bottom;
    drag.li.classList.add("is-dragged");
    dropLine.hidden = false;
    dropLine.style.top = `${target - base.top}px`;
  });
  const endDrag = (event, commit) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { li, moved, fromButton } = drag;
    if (moved && fromButton) {
      const fn = (e) => e.stopPropagation();
      li.addEventListener("click", fn, { capture: true, once: true });
      suppress = { li, fn };
    }
    const index = commit && moved ? dropIndex(event.clientY) : null;
    li.classList.remove("is-dragged");
    dropLine.hidden = true;
    drag = null;
    if (index === null) return;
    const ids = state.lots.map((lot) => lot.id);
    const lotId = li.dataset.lot;
    ids.splice(ids.indexOf(lotId), 1);
    ids.splice(index, 0, lotId);
    if (ids.join() !== state.lots.map((lot) => lot.id).join()) reorder(ids, lotId, null);
  };
  merit.addEventListener("pointerup", (event) => endDrag(event, true));
  merit.addEventListener("pointercancel", (event) => endDrag(event, false));

  // ---- lot drawer ------------------------------------------------------------------------------------------
  function openDrawer(lotId, opener) {
    if (state.drawer) return;
    const body = h("div", { class: "stack" });
    const close = h("button", { type: "button", text: "Close" });
    const dialog = h("dialog", { class: "sheet field-white", "aria-label": "Lot drawer" }, body, h("div", { class: "row drawer-actions" }, close));
    const handle = openDialog(dialog, { opener, onClose: () => { state.drawer = null; } });
    close.addEventListener("click", () => handle.close());
    state.drawer = { lotId, body, dialog, actions: dialog.querySelector(".drawer-actions"), close, timer: null, handle };
    renderDrawer();
    const toggle = state.drawer.actions.querySelector("[data-control='toggle']");
    (toggle || close).focus({ preventScroll: true });
  }

  function renderDrawer() {
    const d = state.drawer;
    if (!d) return;
    const lot = state.lots.find((candidate) => candidate.id === d.lotId);
    if (!lot) { d.handle.close(); return; }
    const hadToggleFocus = document.activeElement?.dataset?.control === "toggle";
    d.timer?.stop();
    d.body.replaceChildren(h("h2", { text: lot.name }), h("p", { text: `${lot.technology} · zone ${lot.zone} · ${lot.status}` }),
      h("p", {}, "Cancel by ", h("span", { class: "nowrap", text: lot.cancel_by })), h("p", { text: `Opening ${commas(lot.opening_wh)} Wh in ${lot.bundle_count} bundles` }),
      h("p", { text: `Confirmed ${lot.lines_confirmed} of ${lot.lines_total} lines` }));
    if (lot.cancel_seconds_left !== null) {
      const el = h("span", { role: "timer", "aria-label": "Cancel-by time left" });
      d.body.append(el);
      d.timer = countdown(el, lot.cancel_seconds_left, { async ask() { await refresh(); } });
    }
    d.actions.querySelector("[data-control='toggle']")?.remove();
    const toggle = h("button", { type: "button", text: lot.excluded ? "Include lot" : "Exclude lot", "data-control": "toggle" });
    toggle.addEventListener("click", () => setExcluded(lot.id, !lot.excluded, toggle));
    d.actions.prepend(toggle);
    if (hadToggleFocus) toggle.focus({ preventScroll: true });
  }

  async function setExcluded(lotId, excluded, button) {
    if (state.pending) return;
    state.pending = true;
    button.setAttribute("aria-disabled", "true");
    setError(null);
    try {
      const reply = await put(`/api/windows/${id}/lots/${lotId}/exclusion`, { revision: state.window.revision, excluded });
      state.pending = false;
      state.window = reply.window;
      state.known = Math.max(state.known, reply.window.revision);
      const lots = await get(`/api/windows/${id}/lots`);
      state.lots = lots.lots;
      render();
      shell.status(allocationLine(reply.window));
    } catch (error) {
      state.pending = false;
      if (error instanceof SessionCancelled) { button.removeAttribute("aria-disabled"); return; }
      if (!(error instanceof ApiError)) throw error;
      state.drawer?.body && setError(error.message);
      await refresh();
    }
  }

  // ---- live refresh ----------------------------------------------------------------------------------------
  async function refresh() {
    let window;
    let lots;
    try {
      window = await get(`/api/windows/${id}`, { background: true });
      lots = (await get(`/api/windows/${id}/lots`, { background: true })).lots;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        loop?.stop();
        container.replaceChildren(h("section", { class: "panel field-orange" }, h("p", { class: "figure", text: "THAT PAGE DOES NOT EXIST." })));
        return;
      }
      throw error;
    }
    if (state.pending) return;
    if (state.window && window.last_write_revision !== null && window.last_write_revision > state.known && window.last_writer_name !== user.name) {
      shell.status(`${window.last_writer_name} changed this window. Hour score ${pct(window.scores.hour_bp)} percent.`);
    }
    await apply(window, lots);
  }

  refresh();
  loop = poll(refresh, 2000);
  return { unmount() { loop?.stop(); state.drawer?.timer?.stop(); } };
}
