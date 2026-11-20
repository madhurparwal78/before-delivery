// The approval queue: filters and counts, the request list, the detail and the strip.

import { OFFLINE, api } from "../api.js";
import { append, clear, el, errorSlot, openDialog, say, select, statusRegion } from "../dom.js";
import { STATUS_LABELS, TYPE_LABELS, addDays, formatDate, isoWeekOf, mondayOf } from "../format.js";
import { homesFor } from "../homes.js";
import { Strip, announcement } from "../strip.js";

const REFRESH_MS = 5000;
const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "submitted", label: "Submitted" },
  { value: "escalated", label: "Escalated" },
  { value: "cover_pending", label: "Cover pending" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "cancelled", label: "Cancelled" },
];
const COUNT_LABELS = [
  ["submitted", "Submitted"],
  ["escalated", "Escalated"],
  ["cover_pending", "Cover pending"],
  ["approved", "Approved"],
  ["declined", "Declined"],
];

function failureText(error) {
  return error.status === 0 ? OFFLINE : error.message;
}

function weekOptions() {
  const options = [{ value: "", label: "All weeks" }];
  const monday = mondayOf(new Date().toISOString().slice(0, 10));
  for (let offset = -4; offset <= 12; offset += 1) {
    const week = isoWeekOf(addDays(monday, offset * 7));
    options.push({ value: week, label: week });
  }
  return options;
}

export async function render({ me, query, navigate }) {
  const homes = homesFor(me);
  const filters = {
    home: query.get("home") || me.home_id || homes[0]?.id || "",
    status: query.get("status") || "open",
    week: query.get("week") || "",
    request: query.get("request") || "",
  };
  const status = statusRegion("Queue status");
  const announce = statusRegion("Strip announcements");
  const counts = el("div", { class: "counts", role: "region", "aria-label": "Queue counts" });
  const listbox = el("div", { role: "listbox", "aria-label": "Requests", tabindex: "0" });
  const emptyNote = el("p", { text: "No requests match these filters." });
  const detail = el("div", { class: "queue-detail", role: "region", "aria-label": "Request detail" });
  let items = [];
  let selected = null;
  let preview = null;
  let previewOn = false;
  let lastAnnouncement = "";

  const homePicker = select(
    "Home",
    homes.map((home) => ({ value: home.id, label: home.name })),
    filters.home
  );
  const statusPicker = select("Status", STATUS_OPTIONS, filters.status);
  const weekPicker = select("Week", weekOptions(), filters.week);
  for (const [picker, name] of [
    [homePicker, "home"],
    [statusPicker, "status"],
    [weekPicker, "week"],
  ]) {
    picker.addEventListener("change", () => {
      filters[name] = picker.value;
      filters.request = "";
      pushView();
    });
  }

  function pushView() {
    navigate(
      `/queue?home=${filters.home}&status=${filters.status}&week=${filters.week}&request=${filters.request}`
    );
  }

  const strip = new Strip({ onPostCover: postCover });

  const previewButton = el("button", {
    class: "quiet",
    type: "button",
    text: "Preview approval",
    "aria-pressed": "false",
    onclick: () => togglePreview(),
  });
  const chip = el("button", { class: "chip", type: "button", text: "Cover", draggable: "true" });
  chip.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", "cover");
    chip.classList.add("chip-dragging");
  });
  chip.addEventListener("dragend", () => chip.classList.remove("chip-dragging"));
  const previousPage = el("button", { class: "quiet", type: "button", text: "Previous 7 days" });
  const nextPage = el("button", { class: "quiet", type: "button", text: "Next 7 days" });
  const approveHint = el("span", {
    class: "visually-hidden",
    id: "approve-hint",
    text: "Cover every gap or approve with override",
  });
  const approve = el("button", {
    type: "button",
    text: "Approve",
    "aria-describedby": "approve-hint",
  });
  const override = el("button", { class: "quiet", type: "button", text: "Approve with override" });
  const decline = el("button", { class: "quiet", type: "button", text: "Decline" });
  const summary = el("div", { class: "requester" });
  const backLink = el("a", {
    class: "back-to-queue",
    href: "#",
    text: "Back to queue",
    onclick: (event) => {
      event.preventDefault();
      filters.request = "";
      pushView();
    },
  });
  const facts = el("div", {});
  let pageFrom = null;

  function togglePreview() {
    previewOn = previewButton.getAttribute("aria-pressed") !== "true";
    previewButton.setAttribute("aria-pressed", previewOn ? "true" : "false");
    strip.setPreviewOn(previewOn);
    if (previewOn && preview) {
      lastAnnouncement = announcement(preview);
      say(announce, lastAnnouncement);
    } else if (!previewOn) {
      lastAnnouncement = "";
      say(announce, "");
    }
  }

  async function loadQueue() {
    const search = new URLSearchParams({ home: filters.home, status: filters.status });
    if (filters.week) search.set("week", filters.week);
    const payload = await api.get(`/api/queue?${search.toString()}`);
    items = payload.items;
    clear(counts);
    for (const [key, label] of COUNT_LABELS) {
      counts.append(el("span", { text: `${label} ${payload.counts[key]}` }));
    }
    clear(listbox);
    emptyNote.hidden = items.length > 0;
    items.forEach((item, index) => {
      const option = el("div", {
        role: "option",
        id: `request-${item.id}`,
        "aria-selected": item.id === filters.request ? "true" : "false",
        "aria-label": `${item.requester.display_name}, ${TYPE_LABELS[item.type]}, ${formatDate(
          item.start_date
        )} to ${formatDate(item.end_date)}, ${STATUS_LABELS[item.status]}`,
        text: `${item.requester.display_name} · ${TYPE_LABELS[item.type]} · ${formatDate(
          item.start_date
        )} to ${formatDate(item.end_date)} · ${STATUS_LABELS[item.status]}`,
        onclick: () => choose(index),
      });
      listbox.append(option);
    });
    node.classList.toggle("has-selection", items.some((item) => item.id === filters.request));
    const index = items.findIndex((item) => item.id === filters.request);
    if (index >= 0) {
      listbox.setAttribute("aria-activedescendant", `request-${filters.request}`);
      await showRequest(items[index]);
    } else {
      selected = null;
      preview = null;
      clear(detail);
      detail.append(el("p", { text: "Select a request to see its staffing." }));
    }
  }

  function choose(index) {
    filters.request = items[index].id;
    pushView();
  }

  listbox.addEventListener("keydown", (event) => {
    if (!items.length) return;
    const current = items.findIndex((item) => item.id === filters.request);
    const moves = {
      ArrowDown: Math.min(items.length - 1, current + 1),
      ArrowUp: Math.max(0, current - 1),
      Home: 0,
      End: items.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
  });

  async function showRequest(item) {
    selected = item;
    pageFrom = pageFrom && withinRequest(pageFrom, item) ? pageFrom : item.start_date;
    clear(detail);
    summary.textContent = item.requester.display_name;
    clear(facts);
    append(
      facts,
      el("p", {
        text: `${TYPE_LABELS[item.type]} · ${formatDate(item.start_date)} to ${formatDate(
          item.end_date
        )} · ${item.hours} hours`,
      }),
      el("p", { text: STATUS_LABELS[item.status] }),
      item.short_notice ? el("span", { class: "tag", text: "Short notice" }) : null,
      item.note ? el("p", { text: item.note }) : null
    );
    detail.append(
      backLink,
      summary,
      facts,
      previewButton,
      strip.node,
      chip,
      el("div", { class: "row" }, previousPage, nextPage, approve, override, decline),
      approveHint
    );
    await loadPreview();
  }

  function withinRequest(day, item) {
    return day >= item.start_date && day <= item.end_date;
  }

  async function loadPreview() {
    if (!selected) return;
    const payload = await api.get(
      `/api/leave-requests/${selected.id}/preview?from=${pageFrom || selected.start_date}`
    );
    preview = payload;
    pageFrom = payload.from;
    strip.setPreview(payload, selected.requester.display_name);
    previewButton.disabled = payload.shifts.length === 0;
    approve.disabled = !payload.approvable;
    override.disabled = payload.uncovered_breaches === 0;
    if (previewOn) {
      const next = announcement(payload);
      if (next !== lastAnnouncement) {
        lastAnnouncement = next;
        say(announce, next);
      }
    }
  }

  previousPage.addEventListener("click", () => movePage(-7));
  nextPage.addEventListener("click", () => movePage(7));

  async function movePage(days) {
    if (!selected) return;
    const wanted = addDays(pageFrom, days);
    pageFrom = wanted < selected.start_date ? selected.start_date : wanted;
    if (pageFrom > selected.end_date) pageFrom = selected.end_date;
    await loadPreview();
  }

  async function postCover(entry, skill) {
    say(status, "Posting cover…");
    try {
      await api.post(`/api/leave-requests/${selected.id}/covers`, {
        date: entry.date,
        shift: entry.shift,
        skill,
      });
      say(status, `Cover posted for ${entry.label}. Eligible bank carers will be emailed.`);
      await loadQueue();
    } catch (error) {
      say(status, failureText(error));
    }
  }

  approve.addEventListener("click", async () => {
    say(status, "Approving…");
    try {
      await api.post(`/api/leave-requests/${selected.id}/approve`, {});
      say(status, `Approved. ${selected.requester.display_name} will be emailed the decision.`);
      await loadQueue();
    } catch (error) {
      say(status, `Can't approve: ${failureText(error)}`);
      await loadPreview();
    }
  });

  override.addEventListener("click", () => {
    const reason = el("input", { type: "text", "aria-label": "Override reason" });
    const slot = errorSlot("override_reason");
    const dialog = el(
      "dialog",
      { "aria-label": "Approve with override" },
      el("h2", { text: "Approve with override" }),
      el("p", { text: `Below floor: ${preview.breach_labels.join(", ")}` }),
      el("label", {}, "Override reason", reason),
      slot,
      el(
        "div",
        { class: "row" },
        el("button", {
          type: "button",
          text: "Confirm approval",
          onclick: async () => {
            say(status, "Approving…");
            try {
              await api.post(`/api/leave-requests/${selected.id}/approve`, {
                override_reason: reason.value,
              });
              dialog.close();
              say(
                status,
                `Approved. ${selected.requester.display_name} will be emailed the decision.`
              );
              await loadQueue();
            } catch (error) {
              slot.textContent = error.errors?.override_reason || failureText(error);
            }
          },
        }),
        el("button", { class: "quiet", type: "button", text: "Close", onclick: () => dialog.close() })
      )
    );
    openDialog(dialog, reason, override);
  });

  decline.addEventListener("click", () => {
    const reason = el("input", { type: "text", "aria-label": "Reason" });
    const slot = errorSlot("reason");
    const dialog = el(
      "dialog",
      { "aria-label": "Decline request" },
      el("h2", { text: "Decline request" }),
      el("label", {}, "Reason", reason),
      slot,
      el(
        "div",
        { class: "row" },
        el("button", {
          type: "button",
          text: "Confirm decline",
          onclick: async () => {
            say(status, "Declining…");
            try {
              await api.post(`/api/leave-requests/${selected.id}/decline`, { reason: reason.value });
              dialog.close();
              say(
                status,
                `Declined. ${selected.requester.display_name} will be emailed the decision.`
              );
              await loadQueue();
            } catch (error) {
              slot.textContent = error.errors?.reason || failureText(error);
            }
          },
        }),
        el("button", { class: "quiet", type: "button", text: "Close", onclick: () => dialog.close() })
      )
    );
    openDialog(dialog, reason, decline);
  });

  const node = el(
    "div",
    { class: "queue" },
    el(
      "section",
      { class: "queue-list" },
      el("h1", { text: "Queue" }),
      el(
        "div",
        { role: "group", "aria-label": "Queue filters", class: "row" },
        el("label", {}, "Home", homePicker),
        el("label", {}, "Status", statusPicker),
        el("label", {}, "Week", weekPicker)
      ),
      counts,
      listbox,
      emptyNote
    ),
    el("section", { class: "queue-detail-wrap" }, detail, status, announce)
  );

  // The published tab order: strip, then the Cover chip, then the ghost slots.
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    if (document.querySelector("dialog[open]")) return;
    const stops = [
      homePicker,
      statusPicker,
      weekPicker,
      listbox,
      previewButton,
      strip.stripCell(),
      chip,
      ...strip.ghostButtons(),
      previousPage,
      nextPage,
      approve,
      override,
      decline,
    ].filter((stop) => stop && !stop.disabled);
    const index = stops.indexOf(document.activeElement);
    if (index === -1) return;
    const next = index + (event.shiftKey ? -1 : 1);
    if (next < 0 || next >= stops.length) return;
    event.preventDefault();
    stops[next].focus();
  });

  await loadQueue();
  const timer = window.setInterval(() => {
    loadPreview().catch(() => say(status, OFFLINE));
  }, REFRESH_MS);
  return { node, stop: () => window.clearInterval(timer) };
}
