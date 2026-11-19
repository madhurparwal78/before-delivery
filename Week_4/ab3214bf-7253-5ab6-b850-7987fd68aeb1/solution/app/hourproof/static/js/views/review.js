// The verifier's review of one window: the 25 drawn hours, their evidence, and returning, completing or signing.
import { h, commas, localLabel, lineItem, loadingFigure } from "../dom.js";
import { get, post, put, ApiError, SessionCancelled } from "../api.js";
import { countdown } from "../clock.js";
import { openDialog } from "../dialog.js";
import { problems } from "../problems.js";
import { announce } from "../announce.js";
import { poll } from "../poll.js";

const TIMED_OUT = "REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.";
const HELD_COPY = { held_press: "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE.", held_store: "THE STORE IS DOWN. YOUR SIGNATURE IS SAFE." };
const wide = matchMedia("(min-width: 768px)");
const WORDS = { agree: "Agree", exception: "Exception" };

export function mount({ container, params, user, shell, navigate }) {
  const [id] = params;
  const state = { window: null, hours: [], chosen: null, evidenceOpen: false, sampling: false, error: null, sawSigned: false, busy: false };
  let loop = null;
  let timer = null;
  const group = { async ask() { await refresh(); } };

  const title = h("h1", { class: "review-title" });
  const stateP = h("p", { class: "state-word" });
  const digestP = h("p", { class: "digest" });
  const recordedP = h("p");
  const opinionP = h("p");
  const timerSlot = h("p", { class: "timer-slot" });
  const actions = h("div", { class: "row" });
  const summary = h("section", { role: "region", "aria-label": "Review summary", class: "review-summary field-white" },
    stateP, digestP, recordedP, opinionP, timerSlot, actions);
  const list = h("ul", { role: "list", "aria-label": "Sampled hours", class: "sampled" });
  const evidenceBody = h("div", { class: "evidence-body" });
  const evidence = h("section", { role: "region", "aria-label": "Hour evidence", class: "evidence field-white", "data-motion-ms": "200" },
    h("h2", { text: "Hour evidence" }), evidenceBody);
  const sealStatus = h("div", { role: "status", "aria-label": "Seal status", "aria-live": "polite", class: "sr-only" });
  const bannerBox = h("div", { class: "banners" });
  const complete = h("button", { type: "button", text: "Complete review", hidden: true });
  const giveBack = h("button", { type: "button", text: "Return window", hidden: true });
  const sign = h("button", { type: "button", text: "Sign attestation", hidden: true });
  const hide = h("button", { type: "button", text: "Hide evidence", hidden: true });
  actions.append(complete, giveBack, sign);
  evidence.append(hide);
  const loading = loadingFigure();
  const grid = h("div", { class: "review-grid", hidden: true }, summary, list, evidence);
  container.replaceChildren(h("section", { class: "page field-cyan" }, title, bannerBox, sealStatus, loading, grid));

  const recorded = () => state.hours.filter((x) => x.result).length;
  const writable = () => state.window?.state === "In review";

  // ---- rendering -------------------------------------------------------------------------------------------
  function renderSummary() {
    const w = state.window;
    stateP.textContent = w.state;
    digestP.textContent = `Allocation digest ${w.allocation_digest}`;
    recordedP.textContent = `${recorded()} of 25 recorded`;
    recordedP.className = "figure small";
    opinionP.textContent = `Opinion ${w.opinion}`;
    const counting = w.state === "In review" && w.review_seconds_left !== null;
    if (counting && timer) {
      timer.set(w.review_seconds_left);
    } else if (counting) {
      const el = h("span", { role: "timer", "aria-label": "Review time left" });
      timerSlot.replaceChildren(el);
      timer = countdown(el, w.review_seconds_left, group);
    } else if (timer) {
      timer.stop();
      timer = null;
      timerSlot.replaceChildren();
    }
    complete.hidden = !writable();
    giveBack.hidden = !writable();
    sign.hidden = w.state !== "Cancelled";
  }

  function renderBanners() {
    const w = state.window;
    const texts = [];
    if (state.error) texts.push(state.error);
    if (w.state === "Returned" && w.returned_reason === TIMED_OUT) texts.push(TIMED_OUT);
    if (w.state === "Signed" && HELD_COPY[w.seal_status]) texts.push(HELD_COPY[w.seal_status]);
    bannerBox.replaceChildren(...texts.map((text) => h("p", { class: "banner field-orange", text })));
  }

  const itemFor = new Map();
  function renderList() {
    const ordered = [...state.hours].sort((a, b) => a.hour_utc.localeCompare(b.hour_utc));
    const order = ordered.map((entry) => {
      let li = itemFor.get(entry.hour_utc);
      if (!li) {
        const agree = h("button", { type: "button", text: "Agree", "data-control": "Agree" });
        const exception = h("button", { type: "button", text: "Exception", "data-control": "Exception" });
        const show = h("button", { type: "button", text: "Evidence", "data-control": "Evidence" });
        li = h("li", { class: "sample-item", "data-hour": entry.hour_utc }, h("p", { class: "sample-text" }, h("span", { class: "sample-hour" }), " ", h("span", { class: "sample-result" })),
          h("div", { class: "row" }, agree, exception, show));
        agree.addEventListener("click", () => recordAgree(entry.hour_utc));
        exception.addEventListener("click", () => openException(entry.hour_utc, exception));
        show.addEventListener("click", () => chooseEvidence(entry.hour_utc, show));
        itemFor.set(entry.hour_utc, li);
      }
      li.firstChild.firstChild.textContent = entry.hour_utc;
      li.firstChild.lastChild.textContent = entry.result ? WORDS[entry.result] : "Not recorded";
      const [agree, exception] = li.querySelectorAll("button");
      agree.setAttribute("aria-pressed", String(entry.result === "agree"));
      exception.setAttribute("aria-pressed", String(entry.result === "exception"));
      for (const button of li.querySelectorAll("button")) {
        if (state.sampling || !writable()) button.setAttribute("aria-disabled", "true"); else button.removeAttribute("aria-disabled");
      }
      return li;
    });
    if (order.some((li, i) => list.children[i] !== li) || list.children.length !== order.length) list.replaceChildren(...order);
  }

  function renderEvidence() {
    const entry = state.hours.find((x) => x.hour_utc === state.chosen) || [...state.hours].sort((a, b) => a.hour_utc.localeCompare(b.hour_utc))[0];
    const show = wide.matches || state.evidenceOpen;
    evidence.hidden = !show;
    hide.hidden = wide.matches;
    evidence.dataset.motionMs = document.documentElement.dataset.motion === "reduced" ? "0" : "200";
    if (!entry) { evidenceBody.replaceChildren(); return; }
    evidenceBody.replaceChildren(
      h("p", { text: `UTC hour ${entry.hour_utc}` }), h("p", { text: `Local hour ${localLabel(entry.hour_utc, state.window.site.time_zone)}` }),
      h("p", { text: `Consumed ${commas(entry.consumed_wh)} Wh` }), h("p", { text: `Matched ${commas(entry.matched_wh)} Wh` }),
      h("p", { text: `Quality ${entry.quality}` }),
      h("ul", { class: "hour-lines" }, entry.lines.map(lineItem)));
  }

  function renderAll() {
    loading.remove();
    grid.hidden = false;
    title.textContent = `${state.window.site.name} ${state.window.month}`;
    renderSummary();
    renderBanners();
    renderList();
    renderEvidence();
  }

  function chooseEvidence(hour, opener) {
    state.chosen = hour;
    state.evidenceOpen = true;
    renderEvidence();
    state.lastOpener = opener;
    if (!wide.matches) hide.focus({ preventScroll: true });
  }
  hide.addEventListener("click", () => {
    state.evidenceOpen = false;
    renderEvidence();
    (state.lastOpener || list.querySelector('[data-control="Evidence"]'))?.focus({ preventScroll: true });
  });

  const onWide = () => {
    const inside = evidence.contains(document.activeElement);
    const hour = state.chosen || [...state.hours].sort((a, b) => a.hour_utc.localeCompare(b.hour_utc))[0]?.hour_utc;
    const target = itemFor.get(hour)?.querySelector('[data-control="Evidence"]');
    if (!wide.matches) state.evidenceOpen = false;
    renderEvidence();
    if (inside) target?.focus({ preventScroll: true });
  };
  wide.addEventListener("change", onWide);

  // ---- recording -------------------------------------------------------------------------------------------
  function announceCount() {
    const n = recorded();
    shell.status(n >= 25 ? "All 25 hours recorded." : `${n} of 25 recorded.`);
  }

  async function send(hour, body) {
    const reply = await put(`/api/windows/${id}/sample/${hour}`, body);
    const entry = state.hours.find((x) => x.hour_utc === hour);
    entry.result = reply.result;
    entry.note = reply.note;
    renderSummary();
    renderList();
    announceCount();
  }

  function nextWithoutResult(hour) {
    const ordered = [...state.hours].sort((a, b) => a.hour_utc.localeCompare(b.hour_utc));
    const start = ordered.findIndex((x) => x.hour_utc === hour);
    for (let step = 1; step <= ordered.length; step++) {
      const entry = ordered[(start + step) % ordered.length];
      if (!entry.result) return entry.hour_utc;
    }
    return null;
  }

  async function recordAgree(hour, { moveFocus = false } = {}) {
    if (state.sampling || !writable()) return;
    state.sampling = true;
    state.error = null;
    renderList();
    try {
      await send(hour, { result: "agree" });
      if (moveFocus) {
        const next = nextWithoutResult(hour);
        const target = next ? itemFor.get(next)?.querySelector('[data-control="Agree"]') : complete;
        target?.focus();
      }
    } catch (error) {
      if (error instanceof SessionCancelled) { /* nothing was sent */ }
      else if (error instanceof ApiError) { state.error = error.message; shell.alert(error.message); renderBanners(); await refresh(); }
      else throw error;
    } finally {
      state.sampling = false;
      renderList();
    }
  }

  function openException(hour, opener) {
    if (!writable()) return;
    const list2 = problems();
    const note = h("textarea", { id: "exception-note", rows: "4" });
    const save = h("button", { type: "button", text: "Save exception" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const dialog = h("dialog", { class: "panel field-cyan", "aria-label": "Record exception" },
      h("div", { class: "stack" }, h("label", { for: "exception-note", text: "Exception note" }), note, list2.el,
        h("div", { class: "row" }, save, cancel)));
    const handle = openDialog(dialog, { opener, initial: note });
    cancel.addEventListener("click", () => handle.close());
    save.addEventListener("click", async () => {
      if (state.sampling || save.getAttribute("aria-disabled") === "true") return;
      state.sampling = true;
      save.setAttribute("aria-disabled", "true");
      try {
        await send(hour, { result: "exception", note: note.value });
        handle.close();
      } catch (error) {
        if (error instanceof SessionCancelled) return;
        if (!(error instanceof ApiError)) throw error;
        list2.fromError(error, { note });
      } finally {
        state.sampling = false;
        save.removeAttribute("aria-disabled");
      }
    });
  }

  list.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const li = event.target.closest("li");
    if (!li || !["y", "x", "n", "p"].includes(event.key)) return;
    event.preventDefault();
    const hour = li.dataset.hour;
    if (event.key === "y") recordAgree(hour, { moveFocus: true });
    else if (event.key === "x") openException(hour, document.activeElement);
    else {
      const sibling = event.key === "n" ? li.nextElementSibling : li.previousElementSibling;
      const control = event.target.closest("button")?.dataset.control;
      sibling?.querySelector(`[data-control="${control}"]`)?.focus();
    }
  });

  // ---- returning, completing, signing ----------------------------------------------------------------------
  giveBack.addEventListener("click", () => {
    const list2 = problems();
    const reason = h("textarea", { id: "return-reason", rows: "4" });
    const send2 = h("button", { type: "button", text: "Send back" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const dialog = h("dialog", { class: "panel field-cyan", "aria-label": "Return window" },
      h("div", { class: "stack" }, h("label", { for: "return-reason", text: "Reason" }), reason, list2.el,
        h("div", { class: "row" }, send2, cancel)));
    const handle = openDialog(dialog, { opener: giveBack, initial: reason });
    cancel.addEventListener("click", () => handle.close());
    send2.addEventListener("click", async () => {
      if (send2.getAttribute("aria-disabled") === "true") return;
      send2.setAttribute("aria-disabled", "true");
      try {
        state.window = await post(`/api/windows/${id}/review/return`, { reason: reason.value });
        handle.close({ restore: false });
        renderAll();
        await refresh();
      } catch (error) {
        if (error instanceof SessionCancelled) return;
        if (!(error instanceof ApiError)) throw error;
        list2.fromError(error, { reason });
      } finally {
        send2.removeAttribute("aria-disabled");
      }
    });
  });

  complete.addEventListener("click", async () => {
    if (complete.getAttribute("aria-disabled") === "true") return;
    complete.setAttribute("aria-disabled", "true");
    state.error = null;
    try {
      state.window = await post(`/api/windows/${id}/review/complete`, {});
      await refresh();
    } catch (error) {
      if (error instanceof SessionCancelled) return;
      if (!(error instanceof ApiError)) throw error;
      state.error = error.message;
      shell.alert(error.message);
      renderBanners();
    } finally {
      complete.removeAttribute("aria-disabled");
    }
  });

  sign.addEventListener("click", () => {
    const list2 = problems();
    const name = h("input", { id: "typed-name", type: "text", autocomplete: "off" });
    const confirm = h("button", { type: "button", text: "Sign" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const dialog = h("dialog", { class: "panel field-cyan", "aria-label": "Sign attestation" },
      h("div", { class: "stack" }, h("label", { for: "typed-name", text: "Type your full name" }), name, list2.el,
        h("div", { class: "row" }, confirm, cancel)));
    const handle = openDialog(dialog, { opener: sign, initial: name });
    cancel.addEventListener("click", () => handle.close());
    confirm.addEventListener("click", async () => {
      if (confirm.getAttribute("aria-disabled") === "true") return;
      confirm.setAttribute("aria-disabled", "true");
      try {
        const reply = await post(`/api/windows/${id}/sign`, { typed_name: name.value });
        handle.close({ restore: false });
        state.window = reply.window;
        if (reply.window.state === "Sealed") {
          sessionStorage.setItem("sealed", reply.statement_code);
          navigate(`/check/${reply.statement_code}`);
          return;
        }
        state.sawSigned = true;
        announce(sealStatus, reply.message);
        renderAll();
      } catch (error) {
        if (error instanceof SessionCancelled) return;
        if (!(error instanceof ApiError)) throw error;
        list2.fromError(error, { typed_name: name });
      } finally {
        confirm.removeAttribute("aria-disabled");
      }
    });
  });

  // ---- live refresh ----------------------------------------------------------------------------------------
  async function refresh() {
    let w;
    let sample = null;
    try {
      w = await get(`/api/windows/${id}`, { background: true });
      try {
        sample = await get(`/api/windows/${id}/sample`, { background: true });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        loop?.stop();
        container.replaceChildren(h("section", { class: "panel field-orange" }, h("p", { class: "figure", text: "THAT PAGE DOES NOT EXIST." })));
        return;
      }
      throw error;
    }
    const previous = state.window;
    state.window = w;
    state.hours = sample ? sample.hours : [];
    if (previous && previous.state === "Signed" && w.state === "Sealed" && w.statement_code) {
      sessionStorage.setItem("sealed", w.statement_code);
      navigate(`/check/${w.statement_code}`);
      return;
    }
    if (w.state === "Signed") state.sawSigned = true;
    if (w.state === "Signed" && HELD_COPY[w.seal_status] && !state.announcedHold) {
      state.announcedHold = true;
      announce(sealStatus, HELD_COPY[w.seal_status]);
    }
    renderAll();
  }

  refresh();
  loop = poll(refresh, 2000);
  return {
    unmount() { loop?.stop(); timer?.stop(); wide.removeEventListener("change", onWide); },
  };
}
