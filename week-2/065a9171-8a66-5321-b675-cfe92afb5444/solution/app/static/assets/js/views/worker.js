// Screens for care workers and bank carers: My shifts, leave, sickness, open cover, holiday accrual.
import { ApiError, OFFLINE, get, patch, post, request } from "../api.js";
import { dialog } from "../dialog.js";
import { field, h, say, showFieldErrors, status } from "../dom.js";
import {
  SICKNESS_LABELS, SKILL_LABELS, STATUS_LABELS, TYPE_LABELS, fmtDate, hm, shiftLabel, span, twoPlaces,
} from "../format.js";
import { downloadSigned, empty, panel, screen, table } from "./common.js";

const LEAVE_FIELDS = { type: "leave-type", start_date: "first-day", end_date: "last-day", note: "note" };

function holidayLine(holiday) {
  return `${holiday.remaining_hours} of ${holiday.entitlement_hours} hours left this leave year`;
}

function homeName(boot, homeId) {
  return boot.homes.find((home) => home.id === homeId)?.name ?? "";
}

function idempotencyKey() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function upcoming(entries) {
  return h("ul", { class: "rows", "aria-label": "Upcoming shifts" }, entries.map((e) =>
    h("li", { class: e.status === "away" ? "row away" : "row" },
      h("span", { class: "row-main", text: `${shiftLabel(e.date, e.shift)} · ${hm(e.starts_at)}–${hm(e.ends_at)} · ${e.hours} h` }),
      e.status === "away" ? h("span", { class: "tag", text: "away" }) : null)));
}

const SHIFTS_REFRESH_MS = 60000;
const RETRIES = 3;

// One keyed write: a fresh key per press, reused by every retry after a network failure.
async function keyedPost(path, body) {
  const key = idempotencyKey();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request("POST", path, { body, headers: { "Idempotency-Key": key } });
    } catch (error) {
      if (error.code !== "offline" || attempt === RETRIES) throw error;
    }
  }
}

export function shifts(work, { me }) {
  const region = status("Clock status");
  const button = h("button", { type: "button", class: "primary clock", disabled: true, text: "Clock in" });
  const openLine = h("p", { class: "meta open-line" });
  const list = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  const holidayText = h("p", { text: me.holiday ? holidayLine(me.holiday) : "" });
  const holiday = me.holiday && h("section", { class: "holiday", "aria-label": "Holiday" }, holidayText);
  let open = null;
  let pending = false;

  function show() {
    button.textContent = open ? "Clock out" : "Clock in";
    openLine.textContent = open ? `Clocked in at ${hm(open.clock_in_at)} for ${shiftLabel(open.date, open.shift)}.` : "No clock-in open.";
  }

  async function load() {
    const [body, mine] = await Promise.all([get("/api/me/shifts"), me.holiday ? get("/api/me") : null]);
    if (pending) return;
    open = body.open_attendance;
    show();
    button.disabled = false;
    if (mine?.holiday) holidayText.textContent = holidayLine(mine.holiday);
    list.replaceChildren(body.assignments.length ? upcoming(body.assignments)
      : empty("No rostered shifts in the next 14 days."));
  }

  button.addEventListener("click", async () => {
    if (pending) return;
    pending = true;
    button.disabled = true;
    const kind = open ? "out" : "in";
    say(region, kind === "in" ? "Clocking in…" : "Clocking out…", "pending");
    try {
      const { attendance } = await keyedPost("/api/punches", { kind });
      if (kind === "in") {
        const minutes = Math.floor((new Date(attendance.clock_in_at) - new Date(attendance.rostered_start)) / 60000);
        say(region, attendance.late
          ? `Clocked in at ${hm(attendance.clock_in_at)}, ${minutes} minutes late. Your manager will be asked to acknowledge it.`
          : `Clocked in at ${hm(attendance.clock_in_at)} for ${shiftLabel(attendance.date, attendance.shift)}.`, "success");
        open = attendance;
      } else {
        say(region, `Clocked out at ${hm(attendance.clock_out_at)}. You worked ${attendance.worked_hours} hours.`, "success");
        open = null;
      }
    } catch (error) {
      say(region, error.message, "error");
    } finally {
      show();
      pending = false;
      button.disabled = false;
    }
    load().catch(() => {});
  });

  work.append(screen("My shifts",
    panel("Clock", h("div", { class: "clock-row" }, button, openLine), region),
    holiday || null,
    panel("Next 14 days", list)));

  load().catch((error) => say(region, error.message, "error"));
  const timer = setInterval(() => load().catch(() => {}), SHIFTS_REFRESH_MS);
  return { leave: () => clearInterval(timer) };
}

function leaveBody(form) {
  const label = form.querySelector("#leave-type").value;
  return {
    type: Object.keys(TYPE_LABELS).find((k) => TYPE_LABELS[k] === label),
    start_date: form.querySelector("#first-day").value || null,
    end_date: form.querySelector("#last-day").value || null,
    note: form.querySelector("#note").value || null,
  };
}

export function leaveForm(work, { me, boot }) {
  const region = status("Leave status");
  const type = h("select", {}, Object.values(TYPE_LABELS).map((label) => h("option", { value: label, text: label })));
  const save = h("button", { type: "button", class: "secondary", text: "Save draft" });
  const submit = h("button", { type: "submit", class: "primary", text: "Submit request" });
  const form = h("form", { "aria-label": "Request leave", novalidate: true, class: "stack" },
    field("Leave type", type, "leave-type"),
    h("div", { class: "field-pair" },
      field("First day", h("input", { type: "date" }), "first-day"),
      field("Last day", h("input", { type: "date" }), "last-day")),
    field("Note", h("textarea", { rows: 3, maxlength: 500 }), "note"),
    h("div", { class: "actions" }, save, submit), region);
  let draftId = null;

  async function run(button, pendingText, action) {
    save.disabled = submit.disabled = true;
    say(region, pendingText, "pending");
    try {
      showFieldErrors(form, {}, LEAVE_FIELDS);
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.body.errors) {
        showFieldErrors(form, error.body.errors, LEAVE_FIELDS);
        say(region, error.fieldMessages(), "error");
      } else say(region, error.message, "error");
    } finally {
      save.disabled = submit.disabled = false;
    }
  }

  save.addEventListener("click", () => run(save, "Saving draft…", async () => {
    const body = leaveBody(form);
    const saved = draftId ? await patch(`/api/leave-requests/${draftId}`, body)
      : await post("/api/leave-requests", { ...body, submit: false });
    draftId = saved.id;
    say(region, "Draft saved.", "success");
  }));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(submit, "Submitting…", async () => {
      const body = leaveBody(form);
      let sent;
      if (draftId) {
        await patch(`/api/leave-requests/${draftId}`, body);
        sent = await post(`/api/leave-requests/${draftId}/submit`);
      } else sent = await post("/api/leave-requests", { ...body, submit: true });
      draftId = null;
      const home = homeName(boot, sent.home_id);
      say(region, sent.short_notice
        ? `Request sent to ${home}. It's inside the notice period, so it's marked short notice.`
        : `Request sent to ${home}.`, "success");
    });
  });

  work.append(screen("Request leave",
    me.holiday ? h("section", { class: "holiday", "aria-label": "Holiday" }, h("p", { text: holidayLine(me.holiday) })) : null,
    panel("", form)));
}

export function leaveList(work, { me }) {
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  work.append(screen("My requests",
    me.holiday ? h("section", { class: "holiday", "aria-label": "Holiday" }, h("p", { text: holidayLine(me.holiday) })) : null,
    panel("", holder)));
  get("/api/me/leave-requests").then(({ items }) => {
    holder.replaceChildren(items.length ? h("ul", { class: "rows", "aria-label": "My requests" }, items.map((r) => {
      const name = `${TYPE_LABELS[r.type]}, ${span(r)}, ${STATUS_LABELS[r.status]}`;
      return h("li", { class: "row" },
        h("a", { href: `/leave/${r.id}`, "data-link": true, "aria-label": name, class: "row-main" },
          h("span", { class: "row-title", text: `${TYPE_LABELS[r.type]}, ${span(r)}` }),
          h("span", { class: "meta", text: `${r.hours} h` })),
        r.short_notice ? h("span", { class: "tag", text: "Short notice" }) : null,
        h("span", { class: `badge status-${r.status}`, text: STATUS_LABELS[r.status] }));
    })) : empty("No leave requests yet."));
  }, (error) => holder.replaceChildren(h("p", { class: "status", text: error.message })));
}

export function leaveDetail(work, { me, id }) {
  const region = status("Leave status");
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  work.append(screen("Leave request", panel("", holder, region)));

  function render(r) {
    const facts = h("dl", { class: "facts" },
      h("dt", { text: "Type" }), h("dd", { text: TYPE_LABELS[r.type] }),
      h("dt", { text: "Dates" }), h("dd", { text: span(r) }),
      h("dt", { text: "Hours" }), h("dd", {}, h("span", { class: "num", text: `${r.hours} hours booked` }),
        Number(r.sickness_hours) > 0 ? h("span", { class: "meta sick-hours", text: `${r.sickness_hours} hours returned for sick days` }) : null),
      h("dt", { text: "Status" }), h("dd", {}, h("span", { class: `badge status-${r.status}`, text: STATUS_LABELS[r.status] }),
        r.short_notice ? h("span", { class: "tag", text: "Short notice" }) : null),
      r.note ? [h("dt", { text: "Note" }), h("dd", { text: r.note })] : null,
      r.decision_reason ? [h("dt", { text: "Reason" }), h("dd", { text: r.decision_reason })] : null);
    const actions = h("div", { class: "actions" });
    if (r.requester.id === me.id) {
      const withdraw = h("button", { type: "button", class: "secondary", text: "Withdraw request" });
      withdraw.addEventListener("click", async () => {
        withdraw.disabled = true;
        say(region, "Withdrawing…", "pending");
        try {
          render(await post(`/api/leave-requests/${r.id}/withdraw`));
          say(region, "Request withdrawn.", "success");
        } catch (error) {
          say(region, error.message, "error");
          withdraw.disabled = false;
        }
      });
      actions.append(withdraw);
    }
    if (me.role === "hr_admin") actions.append(cancelButton(r));
    holder.replaceChildren(h("h2", { class: "requester", text: r.requester.display_name }), facts, actions);
  }

  function cancelButton(r) {
    const reason = h("textarea", { rows: 3, maxlength: 500 });
    const confirm = h("button", { type: "submit", class: "primary", text: "Confirm cancellation" });
    const form = h("form", { novalidate: true, class: "stack" }, field("Reason", reason, "cancel-reason"), confirm);
    const box = dialog("Cancel approved leave", form);
    const open = h("button", { type: "button", class: "danger-quiet", text: "Cancel leave", onclick: () => box.open(open, reason) });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      confirm.disabled = true;
      say(region, "Cancelling…", "pending");
      try {
        const cancelled = await post(`/api/leave-requests/${r.id}/cancel`, { reason: reason.value });
        await box.close();
        render(cancelled);
        say(region, `Leave cancelled. ${r.requester.display_name} will be emailed.`, "success");
      } catch (error) {
        showFieldErrors(form, error.body?.errors, { reason: "cancel-reason" });
        say(region, error.body?.errors ? error.fieldMessages() : error.message, "error");
      } finally {
        confirm.disabled = false;
      }
    });
    return open;
  }

  get(`/api/leave-requests/${id}`).then(render, (error) => say(region, error.message, "error"));
}

export function sicknessList(work) {
  const region = status("Sickness status");
  const first = h("input", { type: "date" });
  const reason = h("textarea", { rows: 2, maxlength: 500 });
  const button = h("button", { type: "submit", class: "primary", text: "Report sickness" });
  const form = h("form", { "aria-label": "Report sickness", novalidate: true, class: "stack" },
    field("First day off sick", first, "first-sick"), field("Reason", reason, "sick-reason"),
    h("p", { class: "meta", text: "Your manager sees only that you are away, never the reason." }), button, region);
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));

  async function load() {
    const { items } = await get("/api/me/sickness");
    holder.replaceChildren(items.length ? h("ul", { class: "rows", "aria-label": "Sickness records" }, items.map((s) =>
      h("li", { class: "row" },
        h("a", { href: `/sickness/${s.id}`, "data-link": true, class: "row-main" },
          h("span", { class: "row-title", text: `From ${fmtDate(s.start_date)}${s.last_sick_date ? ` to ${fmtDate(s.last_sick_date)}` : ""}` }),
          h("span", { class: "meta", text: `${s.days} days` })),
        h("span", { class: `badge sick-${s.status}`, text: SICKNESS_LABELS[s.status] })))) : empty("No sickness records."));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    say(region, "Reporting…", "pending");
    try {
      showFieldErrors(form, {}, {});
      const record = await post("/api/sickness", { start_date: first.value || null, reason: reason.value });
      say(region, record.status === "fit_note_required"
        ? "Sickness reported. Please upload a fit note — you've been off more than 7 days."
        : "Sickness reported. Get well soon.", "success");
      form.reset();
      await load();
    } catch (error) {
      showFieldErrors(form, error.body?.errors, { start_date: "first-sick", reason: "sick-reason" });
      say(region, error.body?.errors ? error.fieldMessages() : error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  work.append(screen("Sickness", panel("Report sickness", form), panel("Your sickness records", holder)));
  load().catch((error) => holder.replaceChildren(h("p", { class: "status", text: error.message })));
}

export function sicknessDetail(work, { id }) {
  const region = status("Sickness status");
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  work.append(screen("Sickness record", panel("", holder, region)));

  function render(s) {
    const file = h("input", { type: "file", accept: "application/pdf,image/jpeg,image/png" });
    const upload = h("button", { type: "submit", class: "primary", text: "Upload fit note" });
    const uploadForm = h("form", { novalidate: true, class: "stack" }, field("Fit note file", file, "fit-note-file"), upload);
    const last = h("input", { type: "date" });
    const back = h("button", { type: "submit", class: "secondary", text: "I'm back at work" });
    const returnForm = h("form", { novalidate: true, class: "stack" }, field("Last day off sick", last, "last-sick"), back);
    const link = s.fit_note && h("a", { href: `/sickness/${s.id}`, class: "file-link", text: "Open fit note" });
    link?.addEventListener("click", (event) => {
      event.preventDefault();
      downloadSigned(`/api/sickness/${s.id}/fit-note`, region);
    });

    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const chosen = file.files[0];
      if (!chosen) return say(region, "Choose a fit note file first.", "error");
      if (chosen.size > 5000000) return say(region, "Fit notes can be up to 5,000,000 bytes.", "error");
      upload.disabled = true;
      say(region, "Uploading fit note…", "pending");
      const form = new FormData();
      form.append("file", chosen);
      try {
        const updated = await request("POST", `/api/sickness/${s.id}/fit-note`, { form });
        render(updated);
        say(region, "Fit note received. It is being stored securely.", "success");
      } catch (error) {
        say(region, error.code === "too_large" ? "Fit notes can be up to 5,000,000 bytes." : error.message, "error");
        upload.disabled = false;
      }
    });
    returnForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      back.disabled = true;
      say(region, "Saving…", "pending");
      try {
        render(await post(`/api/sickness/${s.id}/return`, { last_sick_date: last.value || null }));
        say(region, "Welcome back. Sickness record closed.", "success");
      } catch (error) {
        say(region, error.body?.errors ? error.fieldMessages() : error.message, "error");
        back.disabled = false;
      }
    });

    holder.replaceChildren(
      h("dl", { class: "facts" },
        h("dt", { text: "Status" }), h("dd", {}, h("span", { class: `badge sick-${s.status}`, text: SICKNESS_LABELS[s.status] })),
        h("dt", { text: "First day" }), h("dd", { text: fmtDate(s.start_date) }),
        s.last_sick_date ? [h("dt", { text: "Last day" }), h("dd", { text: fmtDate(s.last_sick_date) })] : null,
        h("dt", { text: "Days" }), h("dd", { class: "num", text: String(s.days) }),
        h("dt", { text: "Reason" }), h("dd", { text: s.reason }),
        h("dt", { text: "Fit note" }), h("dd", {}, s.fit_note
          ? [link, h("span", { class: "meta", text: ` ${s.fit_note.file_name}${s.fit_note.storage === "pending" ? " · storing" : ""}` })]
          : "None yet")),
      h("div", { class: "split" }, uploadForm, returnForm));
  }

  get(`/api/sickness/${id}`).then(render, (error) => say(region, error.message, "error"));
}

export function cover(work) {
  const region = status("Cover status");
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  work.append(screen("Open cover", panel("", holder, region)));

  function item(c) {
    const label = shiftLabel(c.date, c.shift);
    const claim = h("button", { type: "button", class: "primary", "aria-label": `Claim ${label} at ${c.home.name}`, text: "Claim" });
    const li = h("li", { class: "row cover-item" },
      h("div", { class: "row-main" },
        h("span", { class: "row-title", text: `${label}` }),
        h("span", { class: "meta", text: `${c.home.name} · ${c.unit.name} · ${hm(c.starts_at)}–${hm(c.ends_at)} · ${c.hours} h` })),
      h("span", { class: `badge skill-${c.skill}`, text: SKILL_LABELS[c.skill] }), claim);
    claim.addEventListener("click", async () => {
      claim.disabled = true;
      say(region, "Claiming…", "pending");
      try {
        await keyedPost(`/api/cover-shifts/${c.id}/claim`, {});
        say(region, `Shift claimed: ${label} at ${c.home.name}.`, "success");
        li.remove();
      } catch (error) {
        say(region, error.message, "error");
        if (["already_taken", "cover_closed"].includes(error.code)) li.remove();
        else claim.disabled = false;
      }
    });
    return li;
  }

  get("/api/cover-shifts").then(({ items }) => {
    holder.replaceChildren(items.length ? h("ul", { class: "rows", "aria-label": "Open cover shifts" }, items.map(item))
      : empty("No open cover shifts right now."));
  }, (error) => say(region, error.message, "error"));
}

export function accrual(work) {
  const region = h("section", { class: "panel", "aria-label": "Holiday accrual" }, h("p", { class: "meta", text: "Loading…" }));
  work.append(screen("Holiday accrual", region));
  get("/api/me/accrual").then((body) => {
    const op = body.open_period;
    region.replaceChildren(
      h("h2", { class: "panel-title", text: "This period" }),
      h("p", { class: "accrual-line", text: `Pending this period: ${op.pending_accrual_hours} hours from ${twoPlaces(op.worked_hours)} worked` }),
      h("p", { class: "accrual-total", text: `Total accrued: ${body.ledger_total_hours} hours` }),
      h("h2", { class: "panel-title", text: "Ledger" }),
      body.entries.length ? table("Accrual ledger", ["Period", "Kind", "Worked hours", "Accrued hours"],
        body.entries.map((e) => [e.period, e.kind === "period" ? "Period" : "Adjustment", e.worked_hours, e.accrued_hours]))
        : empty("No closed pay periods yet."));
  }, (error) => region.replaceChildren(h("p", { class: "status", role: "status", text: error.message || OFFLINE })));
}
