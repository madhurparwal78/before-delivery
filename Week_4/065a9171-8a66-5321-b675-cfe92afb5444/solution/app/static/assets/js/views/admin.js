// Screens for unit managers and group HR admins: Today, Attendance, Floors and policy, Pay periods,
// Exports and the Audit log.
import { ApiError, get, patch, post, query } from "../api.js";
import { dialog } from "../dialog.js";
import { field, h, say, showFieldErrors, status } from "../dom.js";
import { SHIFT_NAMES, fmtDate, hm, londonInstant, londonLocal, monthLabel, shiftLabel } from "../format.js";
import { icon } from "../icons.js";
import { downloadSigned, empty, panel, screen, showAfter, table } from "./common.js";

const ACTION_LABELS = {
  attendance_corrected: "Attendance corrected", attendance_added: "Attendance added", floor_override: "Floor override",
  floor_version_added: "Floor version added", policy_version_added: "Leave policy added", leave_cancelled: "Leave cancelled",
};

function homeChooser(boot, current, onChange) {
  if (boot.homes.length < 2) return null;
  const select = h("select", {}, boot.homes.map((home) => h("option", { value: home.id, text: home.name })));
  select.value = current;
  select.addEventListener("change", () => onChange(select.value));
  return h("div", { class: "toolbar" }, field("Home", select, "home-choice"));
}

function homeFromAddress(boot, me) {
  const wanted = new URLSearchParams(location.search).get("home");
  return boot.homes.some((home) => home.id === wanted) ? wanted : (me.home_id ?? boot.homes[0].id);
}

function errorText(error) {
  return error instanceof ApiError && error.body.errors ? error.fieldMessages() : error.message;
}

function breachText(s) {
  const parts = [];
  if (s.shortfall > 0) parts.push(`-${s.shortfall} below floor`);
  if (s.senior_shortfall > 0) parts.push("no senior on shift");
  return parts.length ? parts.join(", ") : "At floor";
}

const TODAY_REFRESH_MS = 30000;

export function today(work, { me, boot, navigate }) {
  const homeId = homeFromAddress(boot, me);
  const region = status("Today status");
  const heading = h("h1", { text: "Today" });
  const summaryLine = h("p", { class: "summary-line" });
  const staffing = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  const late = h("div", {});
  const missed = h("div", {});
  const page = h("section", { class: "screen" }, h("header", { class: "screen-head" }, heading),
    homeChooser(boot, homeId, (id) => navigate(`/today?home=${id}`)),
    panel("On duty against floor", summaryLine, staffing),
    h("div", { class: "today-lists" }, panel("Late clock-ins", region, late), panel("Missed clock-outs", missed)));

  function lateItem(a) {
    const minutes = Math.floor((new Date(a.clock_in_at) - new Date(a.rostered_start)) / 60000);
    const ack = h("button", { type: "button", class: "secondary", "aria-label": `Acknowledge ${a.person.display_name}`, text: "Acknowledge" });
    ack.addEventListener("click", async () => {
      ack.disabled = true;
      say(region, "Saving…", "pending");
      try {
        await post(`/api/attendance/${a.id}/acknowledge`);
        say(region, "Acknowledged.", "success");
        await load();
      } catch (error) {
        say(region, error.message, "error");
        ack.disabled = false;
      }
    });
    return h("li", { class: "row" }, h("div", { class: "row-main" },
      h("span", { class: "row-title", text: a.person.display_name }),
      h("span", { class: "meta", text: `${shiftLabel(a.date, a.shift)} · in at ${hm(a.clock_in_at)} · ${minutes} minutes late` })), ack);
  }

  function missedItem(a) {
    const label = shiftLabel(a.date, a.shift);
    return h("li", { class: "row" }, h("div", { class: "row-main" },
      h("span", { class: "row-title", text: `${a.person.display_name}, ${label}` }),
      h("span", { class: "meta", text: `In at ${hm(a.clock_in_at)} · rostered to ${hm(a.rostered_end)} · no clock-out` })),
    h("a", { href: `/attendance?${query({ home: a.home_id, date: a.date })}`, "data-link": true, class: "button secondary",
      "aria-label": `Correct ${a.person.display_name} ${label}`, text: "Correct" }));
  }

  function list(name, items, render, emptyText) {
    return h("ul", { class: "rows", "aria-label": name },
      items.length ? items.map(render) : h("li", { class: "row meta" }, icon("check", 18), h("span", { text: emptyText })));
  }

  async function load() {
    const body = await get(`/api/homes/${homeId}/today`);
    heading.textContent = `Today, ${fmtDate(body.date)}`;
    summaryLine.textContent = `${body.totals.on_duty} on duty · ${body.totals.below_floor} shifts below floor`;
    const rows = body.units.flatMap((u) => u.shifts.map((s) => {
      const breached = s.shortfall > 0 || s.senior_shortfall > 0;
      return [u.name, SHIFT_NAMES[s.shift], String(s.on_duty), String(s.floor.min_staff),
        `${s.seniors_on_duty} of ${s.floor.min_seniors}`,
        h("span", { class: breached ? "state breach" : "state ok" }, breached ? h("span", { class: "hatch-swatch", "aria-hidden": "true" }) : icon("check", 16), breachText(s))];
    }));
    staffing.replaceChildren(table("Staffing today", ["Unit", "Shift", "On duty", "Floor", "Seniors", "Status"], rows));
    late.replaceChildren(list("Late clock-ins", body.late_clock_ins, lateItem, "No late clock-ins waiting."));
    missed.replaceChildren(list("Missed clock-outs", body.missed_clock_outs, missedItem, "No missed clock-outs in the last 7 days."));
  }
  showAfter(work, load().catch((error) => say(region, error.message, "error")), page);
  const timer = setInterval(() => load().catch(() => {}), TODAY_REFRESH_MS);
  return { leave: () => clearInterval(timer) };
}

export function attendance(work, { me, boot, navigate }) {
  const homeId = homeFromAddress(boot, me);
  const home = boot.homes.find((x) => x.id === homeId);
  const region = status("Admin status");
  const dateInput = h("input", { type: "date", value: new URLSearchParams(location.search).get("date") ?? boot.today });
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  const clockIn = h("input", { type: "datetime-local" });
  const clockOut = h("input", { type: "datetime-local" });
  const reason = h("textarea", { rows: 2, maxlength: 500 });
  const save = h("button", { type: "submit", class: "primary", text: "Save correction" });
  const subject = h("p", { class: "meta" });
  const form = h("form", { novalidate: true, class: "stack" }, subject,
    h("div", { class: "field-pair" }, field("Clock in", clockIn, "att-in"), field("Clock out", clockOut, "att-out")),
    field("Reason", reason, "att-reason"), save);
  const box = dialog("Correct attendance", form);
  let editing = null;

  function fill(record) {
    clockIn.value = londonLocal(record.clock_in_at);
    clockOut.value = record.clock_out_at ? londonLocal(record.clock_out_at) : "";
  }

  function openEditor(opener, entry, record) {
    editing = { entry, record };
    const title = record ? "Correct attendance" : "Add attendance";
    box.el.setAttribute("aria-label", title);
    box.el.querySelector(".dialog-title").textContent = title;
    subject.textContent = `${entry.person.display_name} · ${shiftLabel(entry.date, entry.shift)} · rostered ${hm(entry.starts_at)}–${hm(entry.ends_at)}`;
    if (record) fill(record);
    else {
      clockIn.value = londonLocal(entry.starts_at);
      clockOut.value = londonLocal(entry.ends_at);
    }
    reason.value = "";
    showFieldErrors(form, {}, {});
    box.open(opener, clockIn);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { entry, record } = editing;
    const body = { clock_in_at: clockIn.value ? londonInstant(clockIn.value) : null,
      clock_out_at: clockOut.value ? londonInstant(clockOut.value) : null, reason: reason.value };
    save.disabled = true;
    say(region, "Saving correction…", "pending");
    try {
      if (record) await patch(`/api/attendance/${record.id}`, body, { "If-Match": `"${record.version}"` });
      else await post("/api/attendance", { assignment_id: entry.assignment_id, ...body });
      await box.close();
      say(region, record ? "Attendance corrected." : "Attendance added.", "success");
      await load();
    } catch (error) {
      if (error.code === "stale_version") {
        editing = { entry, record: error.body.current };
        fill(error.body.current);
      }
      showFieldErrors(form, error.body?.errors, { clock_in_at: "att-in", clock_out_at: "att-out", reason: "att-reason" });
      say(region, errorText(error), "error");
    } finally {
      save.disabled = false;
    }
  });

  async function load() {
    const day = dateInput.value || boot.today;
    const [records, ...rotas] = await Promise.all([
      get(`/api/homes/${homeId}/attendance?${query({ date: day })}`),
      ...home.units.map((u) => get(`/api/units/${u.id}/rota?${query({ from: day })}`).then((r) => ({ unit: u, r }))),
    ]);
    const byAssignment = new Map(records.items.map((a) => [a.assignment_id, a]));
    const rows = rotas.flatMap(({ unit, r }) => r.entries.filter((e) => e.date === day).map((e) => {
      const a = byAssignment.get(e.assignment_id);
      const label = shiftLabel(e.date, e.shift);
      const action = h("button", { type: "button", class: "secondary",
        "aria-label": a ? `Correct ${e.person.display_name} ${label}` : `Add attendance for ${e.person.display_name} ${label}`,
        text: a ? "Correct" : "Add attendance", onclick: (event) => openEditor(event.currentTarget, e, a) });
      return [e.person.display_name, unit.name, SHIFT_NAMES[e.shift], `${hm(e.starts_at)}–${hm(e.ends_at)}`,
        a ? hm(a.clock_in_at) : "—", clockOutCell(a), a?.worked_hours ?? "—",
        a ? (a.late ? (a.late_acknowledged ? "Late, acknowledged" : "Late") : "On time") : "—", a?.correction_note || "—", action];
    }));
    holder.replaceChildren(rows.length ? table("Attendance", ["Name", "Unit", "Shift", "Rostered", "Clock in", "Clock out",
      "Worked", "Late", "Note", "Action"], rows) : empty("No rostered shifts on this day."));
  }

  dateInput.addEventListener("change", () => {
    history.replaceState(null, "", `/attendance?${query({ home: homeId, date: dateInput.value })}`);
    load().catch((error) => say(region, error.message, "error"));
  });
  work.append(screen("Attendance", homeChooser(boot, homeId, (id) => navigate(`/attendance?home=${id}`)),
    panel(home.name, h("div", { class: "toolbar" }, field("Day", dateInput, "att-day")), region, holder)));
  load().catch((error) => say(region, error.message, "error"));
}

function clockOutCell(a) {
  if (a?.missed_clock_out) return h("span", { class: "state breach" }, h("span", { class: "hatch-swatch", "aria-hidden": "true" }), "Missed clock-out");
  return a?.clock_out_at ? hm(a.clock_out_at) : "—";
}

function versionBy(v) {
  return v.created_by ? v.created_by.display_name : "Seeded";
}

export function floors(work, { me, boot }) {
  const region = status("Admin status");
  const hr = me.role === "hr_admin";
  const floorHolder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  const policyHolder = h("div", {});

  // One table of each kind across the caller's homes, so every version is listed beside the earlier ones.
  async function load() {
    const loaded = await Promise.all(boot.homes.map(async (home) => {
      const [f, p] = await Promise.all([get(`/api/homes/${home.id}/floors`), get(`/api/homes/${home.id}/leave-policy`)]);
      return { home, floors: f.versions, policies: p.versions };
    }));
    floorHolder.replaceChildren(table("Floor versions", ["Home", "Unit", "Shift", "Minimum staff", "Minimum seniors", "Effective from", "Added by"],
      loaded.flatMap(({ home, floors: versions }) => versions.map((v) => [home.name, home.units.find((u) => u.id === v.unit_id).name,
        SHIFT_NAMES[v.shift], String(v.min_staff), String(v.min_seniors), fmtDate(v.effective_from), versionBy(v)]))));
    policyHolder.replaceChildren(table("Leave policy versions", ["Home", "Notice multiplier", "Effective from", "Added by"],
      loaded.flatMap(({ home, policies }) => policies.map((v) => [home.name, String(v.notice_multiplier), fmtDate(v.effective_from), versionBy(v)]))));
  }

  function number(input) {
    return input.value === "" ? null : Number(input.value);
  }

  function floorForm(home, reload) {
    const unit = h("select", {}, home.units.map((u) => h("option", { value: u.name, text: u.name })));
    const shift = h("select", {}, Object.values(SHIFT_NAMES).map((s) => h("option", { value: s, text: s })));
    const staff = h("input", { type: "number", min: 0, max: 30, step: 1, inputmode: "numeric" });
    const seniors = h("input", { type: "number", min: 0, max: 30, step: 1, inputmode: "numeric" });
    const from = h("input", { type: "date" });
    const button = h("button", { type: "submit", class: "primary", text: "Save floor version" });
    const id = (name) => `${home.id}-floor-${name}`;
    const form = h("form", { "aria-label": "New floor version", novalidate: true, class: "grid-form" },
      field("Unit", unit, id("unit")), field("Shift", shift, id("shift")), field("Minimum staff", staff, id("staff")),
      field("Minimum seniors", seniors, id("seniors")), field("Effective from", from, id("from")), button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      say(region, "Saving…", "pending");
      try {
        const saved = await post(`/api/homes/${home.id}/floors`, {
          unit_id: home.units.find((u) => u.name === unit.value).id,
          shift: Object.keys(SHIFT_NAMES).find((k) => SHIFT_NAMES[k] === shift.value),
          min_staff: number(staff), min_seniors: number(seniors), effective_from: from.value || null,
        });
        showFieldErrors(form, {}, {});
        say(region, `Floor version saved. It applies from ${fmtDate(saved.effective_from)}.`, "success");
        await reload();
      } catch (error) {
        showFieldErrors(form, error.body?.errors, { unit_id: id("unit"), shift: id("shift"), min_staff: id("staff"),
          min_seniors: id("seniors"), effective_from: id("from") });
        say(region, errorText(error), "error");
      } finally {
        button.disabled = false;
      }
    });
    return h("div", { class: "form-block" }, h("h4", { class: "form-title", text: "New floor version" }), form);
  }

  function policyForm(home, reload) {
    const multiplier = h("input", { type: "number", min: 0, max: 6, step: 1, inputmode: "numeric" });
    const from = h("input", { type: "date" });
    const button = h("button", { type: "submit", class: "primary", text: "Save leave policy" });
    const id = (name) => `${home.id}-policy-${name}`;
    const form = h("form", { "aria-label": "New leave policy", novalidate: true, class: "grid-form" },
      field("Notice multiplier", multiplier, id("multiplier")), field("Effective from", from, id("from")), button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      say(region, "Saving…", "pending");
      try {
        const saved = await post(`/api/homes/${home.id}/leave-policy`, { notice_multiplier: number(multiplier), effective_from: from.value || null });
        showFieldErrors(form, {}, {});
        say(region, `Leave policy saved. It applies from ${fmtDate(saved.effective_from)}.`, "success");
        await reload();
      } catch (error) {
        showFieldErrors(form, error.body?.errors, { notice_multiplier: id("multiplier"), effective_from: id("from") });
        say(region, errorText(error), "error");
      } finally {
        button.disabled = false;
      }
    });
    return h("div", { class: "form-block" }, h("h4", { class: "form-title", text: "New leave policy" }), form);
  }

  const page = screen("Floors and policy",
    h("p", { class: "lede", text: hr ? "Each shift is judged by the floor in force on its date; each request by the policy in force when it is submitted."
      : "Floors and leave policy are set by Group HR. You can see every version here." }),
    region,
    panel("Floors", floorHolder),
    panel("Leave policy", policyHolder),
    hr ? boot.homes.map((home) => panel(`New versions for ${home.name}`,
      floorForm(home, load), policyForm(home, load))) : null);
  showAfter(work, load().catch((error) => say(region, error.message, "error")), page);
}

export function payPeriods(work, { boot }) {
  const region = status("Admin status");
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  const current = boot.today.slice(0, 7);

  async function load() {
    const { items } = await get("/api/pay-periods");
    holder.replaceChildren(h("ul", { class: "rows", "aria-label": "Pay periods" }, items.map((p) => {
      const label = monthLabel(p.period);
      const close = !p.closed_at && p.period < current ? h("button", { type: "button", class: "secondary", text: `Close ${label}` }) : null;
      close?.addEventListener("click", async () => {
        close.disabled = true;
        say(region, `Closing ${label}…`, "pending");
        try {
          const body = await post(`/api/pay-periods/${p.period}/close`);
          say(region, `${label} closed. ${body.entries.length} ledger entries added.`, "success");
          await load();
        } catch (error) {
          say(region, error.message, "error");
          close.disabled = false;
        }
      });
      return h("li", { class: "row" }, h("div", { class: "row-main" }, h("span", { class: "row-title", text: label }),
        h("span", { class: "meta", text: p.closed_at ? `Closed ${fmtDate(p.closed_at)}` : p.period >= current ? "Open, in progress" : "Open" })),
      close || null);
    })));
  }
  work.append(screen("Pay periods", panel("", region, holder)));
  load().catch((error) => say(region, error.message, "error"));
}

export function exportsView(work, { boot }) {
  const region = status("Admin status");
  const period = h("input", { type: "text", inputmode: "numeric", placeholder: "2026-09", autocomplete: "off" });
  const boxes = boot.homes.map((home) => h("input", { type: "checkbox", value: home.id, id: `export-${home.id}` }));
  const homes = h("fieldset", { class: "checks", id: "export-homes" }, h("legend", { text: "Homes" }),
    boot.homes.map((home, i) => h("label", { class: "check", for: `export-${home.id}` }, boxes[i], h("span", { text: home.name }))),
    h("p", { class: "field-error", id: "export-homes-error" }));
  const button = h("button", { type: "submit", class: "primary", text: "Export timesheets" });
  const form = h("form", { "aria-label": "Export timesheets", novalidate: true, class: "stack" },
    field("Pay period", period, "export-period"), homes, button);
  const holder = h("div", {});

  function showErrors(errors) {
    showFieldErrors(form, errors, { period: "export-period" });
    form.querySelector("#export-homes-error").textContent = errors?.home_ids ?? "";
  }

  async function load() {
    const { items } = await get("/api/exports");
    holder.replaceChildren(items.length ? h("ul", { class: "rows", "aria-label": "Exports" }, items.map((x) => {
      const download = h("button", { type: "button", class: "secondary", text: `Download ${monthLabel(x.period)} export`,
        onclick: () => downloadSigned(`/api/exports/${x.id}/download`, region) });
      const names = x.home_ids.map((id) => boot.homes.find((home) => home.id === id)?.name ?? id).join(", ");
      return h("li", { class: "row" }, h("div", { class: "row-main" },
        h("span", { class: "row-title", text: `${monthLabel(x.period)} · ${names}` }),
        h("span", { class: "meta", text: `${x.row_count} rows · ${x.storage === "stored" ? "stored" : "storing"} · ${fmtDate(x.created_at)} ${hm(x.created_at)}` })),
      download);
    })) : h("ul", { class: "rows", "aria-label": "Exports" }, h("li", { class: "row meta", text: "No exports yet." })));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    say(region, "Preparing export…", "pending");
    try {
      const made = await post("/api/exports/timesheets", { period: period.value, home_ids: boxes.filter((b) => b.checked).map((b) => b.value) });
      showErrors({});
      say(region, `Timesheet export created: ${made.row_count} rows.`, "success");
      await load();
    } catch (error) {
      showErrors(error.body?.errors);
      say(region, errorText(error), "error");
    } finally {
      button.disabled = false;
    }
  });
  work.append(screen("Exports", panel("New timesheet export", form, region), panel("Earlier exports", holder)));
  load().catch((error) => say(region, error.message, "error"));
}

function summary(value, keys) {
  if (!value) return "—";
  return keys.filter((k) => value[k] !== undefined && value[k] !== null && typeof value[k] !== "object")
    .map((k) => `${k.replaceAll("_", " ")}: ${/_at$/.test(k) ? `${fmtDate(value[k])} ${hm(value[k])}` : value[k]}`).join("; ") || "—";
}

export function audit(work, { me, boot, navigate }) {
  const homeId = homeFromAddress(boot, me);
  const holder = h("div", {}, h("p", { class: "meta", text: "Loading…" }));
  work.append(screen("Audit log", homeChooser(boot, homeId, (id) => navigate(`/audit?home=${id}`)), panel("", holder)));
  get(`/api/audit?${query({ home: homeId })}`).then(({ items }) => {
    holder.replaceChildren(items.length ? table("Audit log", ["When", "Who", "Action", "Target", "Before", "After", "Reason"],
      items.map((e) => {
        const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])]
          .filter((k) => !e.before || JSON.stringify(e.before[k]) !== JSON.stringify(e.after?.[k]));
        return [`${fmtDate(e.at)} ${hm(e.at)}`, e.actor.display_name, ACTION_LABELS[e.action], `${e.target.type.replaceAll("_", " ")} ${e.target.id}`,
          summary(e.before, keys), summary(e.after, keys), e.reason ?? "—"];
      })) : empty("No audited changes yet."));
  }, (error) => holder.replaceChildren(h("p", { class: "status", text: error.message })));
}
