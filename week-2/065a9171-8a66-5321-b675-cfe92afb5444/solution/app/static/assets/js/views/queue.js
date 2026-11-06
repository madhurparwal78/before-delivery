// The approval queue: filters and counts, the request listbox, and the selected request with its strip.
// Home, status, week and the selected request live in the address.
import { ApiError, get, post, query } from "../api.js";
import { dialog } from "../dialog.js";
import { field, h, say, status } from "../dom.js";
import { STATUS_LABELS, TYPE_LABELS, addDays, isoWeek, mondayOf, shiftLabel, span } from "../format.js";
import { createStrip } from "../strip.js";
import { empty } from "./common.js";

const FILTERS = { Open: "open", Submitted: "submitted", Escalated: "escalated", "Cover pending": "cover_pending",
  Approved: "approved", Declined: "declined", Withdrawn: "withdrawn", Cancelled: "cancelled" };
const COUNTS = [["submitted", "Submitted"], ["escalated", "Escalated"], ["cover_pending", "Cover pending"],
  ["approved", "Approved"], ["declined", "Declined"]];
const REFRESH_MS = 5000;
const OVERRIDE_HINT = "Cover every gap or approve with override";

function optionName(r) {
  return `${r.requester.display_name}, ${TYPE_LABELS[r.type]}, ${span(r)}, ${STATUS_LABELS[r.status]}`;
}

function announcement(pv) {
  const n = pv.uncovered_breaches;
  if (n === 0) return "Approving keeps every shift at or above its floor.";
  return `Approving would leave ${n} ${n === 1 ? "shift" : "shifts"} below floor: ${pv.breach_labels.join(", ")}`;
}

export function queue(work, { me, boot }) {
  const state = { home: "", status: "open", week: "", request: "" };
  const homeSelect = h("select", {}, boot.homes.map((home) => h("option", { value: home.id, text: home.name })));
  const statusSelect = h("select", {}, Object.keys(FILTERS).map((label) => h("option", { value: label, text: label })));
  const weekSelect = h("select", {});
  const filters = h("div", { role: "group", "aria-label": "Queue filters", class: "filters" },
    field("Home", homeSelect, "q-home"), field("Status", statusSelect, "q-status"), field("Week", weekSelect, "q-week"));
  const counts = h("section", { "aria-label": "Queue counts", class: "counts" });
  const listbox = h("div", { role: "listbox", "aria-label": "Requests", tabindex: "0", class: "requests", "aria-busy": "true" });
  // The empty copy sits beside the listbox, never inside it: a listbox holds only options.
  const listEmpty = h("div", { class: "requests-empty", hidden: true }, empty("No requests match these filters."));
  const listColumn = h("div", { class: "queue-list" }, filters, counts, listbox, listEmpty);

  const back = h("a", { href: "#", class: "back-link" }, "← Back to queue");
  const facts = h("div", { class: "request-facts" });
  const previewButton = h("button", { type: "button", class: "toggle", "aria-pressed": "false", disabled: true, text: "Preview approval" });
  const strip = createStrip({ onPostCover: postCover });
  const announcer = status("Strip announcements");
  const previous = h("button", { type: "button", class: "secondary", text: "Previous 7 days", "aria-disabled": "true" });
  const nextWeek = h("button", { type: "button", class: "secondary", text: "Next 7 days", "aria-disabled": "true" });
  const hint = h("p", { id: "approve-hint", class: "meta hint", text: OVERRIDE_HINT });
  const approve = h("button", { type: "button", class: "primary", text: "Approve", disabled: true });
  const override = h("button", { type: "button", class: "secondary", text: "Approve with override", disabled: true });
  const decline = h("button", { type: "button", class: "danger-quiet", text: "Decline", disabled: true });
  const queueStatus = status("Queue status");
  const detail = h("section", { "aria-label": "Request detail", class: "queue-detail" },
    back, facts, h("div", { class: "preview-row" }, previewButton), strip.wrap, announcer,
    h("div", { class: "action-row" }, h("div", {}, previous, nextWeek), h("div", {}, approve, override, decline)), hint, queueStatus);
  const layout = h("div", { class: "queue" }, listColumn, detail);
  work.append(h("section", { class: "screen queue-screen" }, h("header", { class: "screen-head" }, h("h1", { text: "Queue" })), layout));

  let items = [];
  let selected = null;
  let preview = null;
  let previewOn = false;
  let pageFrom = null;
  let timer = null;

  const overrideReason = h("textarea", { rows: 3, maxlength: 500 });
  const breachList = h("ul", { class: "breach-list" });
  const confirmOverride = h("button", { type: "submit", class: "primary", text: "Confirm approval" });
  const overrideForm = h("form", { novalidate: true, class: "stack" }, h("p", { text: "These shifts would be below floor:" }),
    breachList, field("Override reason", overrideReason, "override-reason"), confirmOverride);
  const overrideBox = dialog("Approve with override", overrideForm);
  const declineReason = h("textarea", { rows: 3, maxlength: 500 });
  const confirmDecline = h("button", { type: "submit", class: "primary", text: "Confirm decline" });
  const declineForm = h("form", { novalidate: true, class: "stack" }, field("Reason", declineReason, "decline-reason"), confirmDecline);
  const declineBox = dialog("Decline request", declineForm);

  function readAddress() {
    const p = new URLSearchParams(location.search);
    state.home = boot.homes.some((home) => home.id === p.get("home")) ? p.get("home") : (me.home_id ?? boot.homes[0].id);
    state.status = Object.values(FILTERS).includes(p.get("status")) ? p.get("status") : "open";
    state.week = p.get("week") ?? "";
    state.request = p.get("request") ?? "";
  }

  function address() {
    return `/queue?home=${encodeURIComponent(state.home)}&status=${state.status}&week=${encodeURIComponent(state.week)}&request=${encodeURIComponent(state.request)}`;
  }

  function push() {
    history.pushState(null, "", address());
  }

  function fillWeeks() {
    const monday = mondayOf(boot.today);
    const weeks = new Set(Array.from({ length: 36 }, (_, i) => isoWeek(addDays(monday, (i - 5) * 7))));
    if (state.week) weeks.add(state.week);
    weekSelect.replaceChildren(h("option", { value: "", text: "All weeks" }),
      ...[...weeks].sort().map((w) => h("option", { value: w, text: w })));
  }

  function paintFilters() {
    homeSelect.value = state.home;
    statusSelect.value = Object.keys(FILTERS).find((k) => FILTERS[k] === state.status);
    weekSelect.value = state.week;
    layout.classList.toggle("show-detail", Boolean(state.request));
  }

  async function loadList() {
    const body = await get(`/api/queue?${query({ home: state.home, status: state.status, week: state.week || undefined })}`);
    items = body.items;
    counts.replaceChildren(...COUNTS.map(([key, label]) => h("p", { class: "count" },
      h("span", { class: "count-label", text: label }), " ", h("span", { class: "count-value", text: String(body.counts[key]) }))));
    listbox.replaceChildren(...(items.length ? items.map((r) => h("div", {
      role: "option", id: `req-${r.id}`, "aria-selected": String(r.id === state.request), "aria-label": optionName(r),
      class: "request", onclick: () => choose(r.id),
    }, h("span", { class: "request-name", text: r.requester.display_name }),
    h("span", { class: "request-dates", text: `${TYPE_LABELS[r.type]} · ${span(r)}` }),
    r.short_notice ? h("span", { class: "tag", text: "Short notice" }) : null,
    h("span", { class: `badge status-${r.status}`, text: STATUS_LABELS[r.status] }))) : []));
    listbox.removeAttribute("aria-busy");
    listbox.hidden = !items.length;
    listEmpty.hidden = Boolean(items.length);
    markSelected();
  }

  function markSelected() {
    for (const option of listbox.querySelectorAll("[role=option]")) {
      option.setAttribute("aria-selected", String(option.id === `req-${state.request}`));
    }
    if (listbox.querySelector(`#req-${CSS.escape(state.request)}`)) listbox.setAttribute("aria-activedescendant", `req-${state.request}`);
    else listbox.removeAttribute("aria-activedescendant");
  }

  function choose(id) {
    if (id === state.request) return;
    state.request = id;
    push();
    paintFilters();
    markSelected();
    pageFrom = null;
    loadDetail("select").catch((error) => say(queueStatus, error.message, "error"));
  }

  listbox.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) return;
    event.preventDefault();
    const at = items.findIndex((r) => r.id === state.request);
    const last = items.length - 1;
    const next = { ArrowDown: at < 0 ? 0 : Math.min(last, at + 1), ArrowUp: at < 0 ? 0 : Math.max(0, at - 1), Home: 0, End: last }[event.key];
    choose(items[next].id);
    listbox.querySelector(`#req-${CSS.escape(items[next].id)}`).scrollIntoView({ block: "nearest" });
  });

  function paintFacts(r) {
    facts.replaceChildren(
      h("h2", { class: "requester", text: r.requester.display_name }),
      h("dl", { class: "facts" },
        h("dt", { text: "Type" }), h("dd", { text: TYPE_LABELS[r.type] }),
        h("dt", { text: "Dates" }), h("dd", { text: span(r) }),
        h("dt", { text: "Hours" }), h("dd", { class: "num hours", text: `${r.hours} h` }),
        h("dt", { text: "Status" }), h("dd", {}, h("span", { class: `badge status-${r.status}`, text: STATUS_LABELS[r.status] }),
          r.short_notice ? h("span", { class: "tag", text: "Short notice" }) : null),
        r.note ? [h("dt", { text: "Note" }), h("dd", { class: "note", text: r.note })] : null));
  }

  function paintActions() {
    const can = Boolean(preview?.approvable);
    approve.disabled = !can;
    if (can) approve.removeAttribute("aria-describedby");
    else approve.setAttribute("aria-describedby", "approve-hint");
    hint.hidden = can || !selected;
    override.disabled = !preview || preview.uncovered_breaches === 0;
    decline.disabled = !selected;
    const start = selected?.start_date;
    previous.setAttribute("aria-disabled", String(!pageFrom || pageFrom <= start));
    nextWeek.setAttribute("aria-disabled", String(!pageFrom || addDays(pageFrom, 7) > (selected?.end_date ?? "")));
  }

  async function fetchPreview() {
    return get(`/api/leave-requests/${selected.id}/preview${pageFrom ? `?${query({ from: pageFrom })}` : ""}`);
  }

  function paintStrip(motion) {
    if (!preview.unit_id) {
      previewOn = false;
      previewButton.setAttribute("aria-pressed", "false");
      previewButton.disabled = true;
      strip.clear(`${selected.requester.display_name} isn't on a unit rota, so approving changes no shift.`);
      return;
    }
    previewButton.disabled = false;
    strip.update(preview, previewOn, motion);
  }

  async function loadDetail(motion) {
    stopRefresh();
    const id = state.request;
    selected = preview = null;
    paintActions();
    if (!id) {
      facts.replaceChildren(h("p", { class: "meta", text: "Select a request to see what approving it does to each shift." }));
      strip.clear("");
      previewButton.disabled = true;
      return;
    }
    previewButton.disabled = false;
    facts.replaceChildren(h("p", { class: "meta", text: "Loading…" }));
    let request;
    let next;
    try {
      request = await get(`/api/leave-requests/${id}`);
      next = await get(`/api/leave-requests/${id}/preview${pageFrom ? `?${query({ from: pageFrom })}` : ""}`);
    } catch (error) {
      if (state.request !== id) return;
      facts.replaceChildren(h("p", { class: "meta", text: error instanceof ApiError && error.code === "not_found" ? "That request isn't in your queue." : error.message }));
      strip.clear("");
      return;
    }
    if (state.request !== id) return;
    selected = request;
    preview = next;
    pageFrom = preview.from;
    paintFacts(selected);
    paintStrip(motion);
    paintActions();
    if (previewOn && preview.unit_id) say(announcer, announcement(preview));
    timer = setInterval(refresh, REFRESH_MS);
  }

  function stopRefresh() {
    clearInterval(timer);
    timer = null;
  }

  async function refresh() {
    if (!selected) return;
    const id = selected.id;
    const [request, next] = await Promise.all([get(`/api/leave-requests/${id}`), fetchPreview()]).catch(() => [null, null]);
    if (!next || selected?.id !== id) return;
    const before = preview;
    selected = request;
    preview = next;
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      paintFacts(selected);
      paintStrip("refresh");
      if (previewOn && announcement(before) !== announcement(next)) say(announcer, announcement(next));
    }
    paintActions();
  }

  previewButton.addEventListener("click", () => {
    previewOn = !previewOn;
    previewButton.setAttribute("aria-pressed", String(previewOn));
    if (!preview?.unit_id) return;
    strip.update(preview, previewOn, previewOn ? "on" : "off");
    if (previewOn) say(announcer, announcement(preview));
  });

  async function page(step) {
    if (!selected || !pageFrom) return;
    const target = addDays(pageFrom, step);
    if (target < selected.start_date || target > selected.end_date) return;
    pageFrom = target;
    preview = await fetchPreview();
    paintStrip("select");
    paintActions();
  }
  previous.addEventListener("click", () => page(-7).catch((error) => say(queueStatus, error.message, "error")));
  nextWeek.addEventListener("click", () => page(7).catch((error) => say(queueStatus, error.message, "error")));

  async function decided(message) {
    say(queueStatus, message, "success");
    await loadList();
    await refresh();
  }

  approve.addEventListener("click", async () => {
    approve.disabled = true;
    say(queueStatus, "Approving…", "pending");
    try {
      await post(`/api/leave-requests/${selected.id}/approve`);
      await decided(`Approved. ${selected.requester.display_name} will be emailed the decision.`);
    } catch (error) {
      say(queueStatus, `Can't approve: ${error.message}`, "error");
      await refresh();
    }
  });

  override.addEventListener("click", () => {
    breachList.replaceChildren(...preview.breach_labels.map((label) => h("li", { text: label })));
    overrideReason.value = "";
    overrideBox.open(override, overrideReason);
  });
  overrideForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    confirmOverride.disabled = true;
    say(queueStatus, "Approving…", "pending");
    try {
      await post(`/api/leave-requests/${selected.id}/approve`, { override_reason: overrideReason.value });
      await overrideBox.close();
      await decided(`Approved. ${selected.requester.display_name} will be emailed the decision.`);
    } catch (error) {
      say(queueStatus, error.body?.errors ? error.fieldMessages() : `Can't approve: ${error.message}`, "error");
    } finally {
      confirmOverride.disabled = false;
    }
  });

  decline.addEventListener("click", () => {
    declineReason.value = "";
    declineBox.open(decline, declineReason);
  });
  declineForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    confirmDecline.disabled = true;
    say(queueStatus, "Declining…", "pending");
    try {
      await post(`/api/leave-requests/${selected.id}/decline`, { reason: declineReason.value });
      await declineBox.close();
      await decided(`Declined. ${selected.requester.display_name} will be emailed the decision.`);
    } catch (error) {
      say(queueStatus, error.body?.errors ? error.fieldMessages() : error.message, "error");
    } finally {
      confirmDecline.disabled = false;
    }
  });

  async function postCover(shift, skill) {
    say(queueStatus, "Posting cover…", "pending");
    try {
      await post(`/api/leave-requests/${selected.id}/covers`, { date: shift.date, shift: shift.shift, skill });
      say(queueStatus, `Cover posted for ${shiftLabel(shift.date, shift.shift)}. Eligible bank carers will be emailed.`, "success");
      await refresh();
      await loadList();
    } catch (error) {
      say(queueStatus, error.message, "error");
    }
  }

  function onFilter(apply) {
    apply();
    push();
    paintFilters();
    loadList().catch((error) => say(queueStatus, error.message, "error"));
  }
  homeSelect.addEventListener("change", () => onFilter(() => { state.home = homeSelect.value; }));
  statusSelect.addEventListener("change", () => onFilter(() => { state.status = FILTERS[statusSelect.value]; }));
  weekSelect.addEventListener("change", () => onFilter(() => { state.week = weekSelect.value; }));
  back.addEventListener("click", (event) => {
    event.preventDefault();
    choose("");
    listbox.focus();
  });

  readAddress();
  history.replaceState(null, "", address());
  fillWeeks();
  paintFilters();
  loadList().catch((error) => say(queueStatus, error.message, "error"));
  loadDetail("select");

  return {
    popstate() {
      const before = state.request;
      readAddress();
      fillWeeks();
      paintFilters();
      loadList().catch((error) => say(queueStatus, error.message, "error"));
      if (before !== state.request) {
        pageFrom = null;
        loadDetail("select");
      }
    },
    leave: stopRefresh,
  };
}
