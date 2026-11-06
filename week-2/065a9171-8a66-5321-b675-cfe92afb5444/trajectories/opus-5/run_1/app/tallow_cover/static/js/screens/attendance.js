// "Attendance": one home and day, with Correct and Add attendance.

import { OFFLINE, api } from "../api.js";
import {
  clear,
  el,
  errorSlot,
  openDialog,
  say,
  select,
  showFieldErrors,
  statusRegion,
} from "../dom.js";
import { SHIFT_LABELS, clockTime, formatDate, shiftLabel } from "../format.js";
import { homesFor, unitsFor } from "../homes.js";

function failureText(error) {
  return error.status === 0 ? OFFLINE : error.message;
}

/** A local date and time sent with the Europe/London offset that applies then. */
function withOffset(localValue, sampleInstant) {
  if (!localValue) return null;
  const offset = sampleInstant.slice(19);
  return `${localValue.replace(" ", "T")}:00${offset}`;
}

export async function render({ me, query, navigate }) {
  const homes = homesFor(me);
  const homeId = query.get("home") || me.home_id || homes[0]?.id;
  const day = query.get("date") || new Date().toISOString().slice(0, 10);
  const status = statusRegion("Admin status");
  const body = el("tbody", {});
  let records = [];

  async function load() {
    const payload = await api.get(`/api/homes/${homeId}/attendance?date=${day}`);
    records = payload.items;
    clear(body);
    for (const record of records) {
      const label = shiftLabel(record.date, record.shift);
      body.append(
        el(
          "tr",
          {},
          el("td", { dataset: { label: "Who" }, text: record.person.display_name }),
          el("td", { dataset: { label: "Shift" }, text: SHIFT_LABELS[record.shift] }),
          el("td", { dataset: { label: "Clock in" }, text: clockTime(record.clock_in_at) }),
          el("td", {
            dataset: { label: "Clock out" },
            text: record.missed_clock_out
              ? "Missed clock-out"
              : record.clock_out_at
                ? clockTime(record.clock_out_at)
                : "",
          }),
          el("td", { dataset: { label: "Worked hours" }, text: record.worked_hours || "" }),
          el("td", { dataset: { label: "Late" }, text: record.late ? "yes" : "no" }),
          el(
            "td",
            { dataset: { label: "Correct" } },
            el("button", {
              class: "quiet",
              type: "button",
              "aria-label": `Correct ${record.person.display_name} ${label}`,
              text: "Correct",
              onclick: (event) => openCorrect(record, event.currentTarget),
            })
          )
        )
      );
    }
    await loadAddable();
  }

  const addRow = el("div", { class: "row" });

  async function loadAddable() {
    clear(addRow);
    const units = unitsFor(me).filter((unit) => unit.id.startsWith(homeId));
    for (const unit of units) {
      const rota = await api.get(`/api/units/${unit.id}/rota?from=${day}`);
      for (const entry of rota.entries.filter((candidate) => candidate.date === day)) {
        if (records.some((record) => record.assignment_id === entry.assignment_id)) continue;
        const label = shiftLabel(entry.date, entry.shift);
        addRow.append(
          el("button", {
            class: "quiet",
            type: "button",
            "aria-label": `Add attendance for ${entry.person.display_name} ${label}`,
            text: `Add ${entry.person.display_name} ${label}`,
            onclick: (event) => openAdd(entry, event.currentTarget),
          })
        );
      }
    }
  }

  function timeFields(record) {
    const clockIn = el("input", {
      type: "text",
      "aria-label": "Clock in",
      placeholder: "YYYY-MM-DDTHH:MM",
      value: record ? record.clock_in_at.slice(0, 16) : "",
    });
    const clockOut = el("input", {
      type: "text",
      "aria-label": "Clock out",
      placeholder: "YYYY-MM-DDTHH:MM",
      value: record && record.clock_out_at ? record.clock_out_at.slice(0, 16) : "",
    });
    const reason = el("input", { type: "text", "aria-label": "Reason" });
    return { clockIn, clockOut, reason };
  }

  function buildDialog(title, fields, confirmLabel, onConfirm, opener) {
    const slots = {
      clock_in_at: errorSlot("clock_in_at"),
      clock_out_at: errorSlot("clock_out_at"),
      reason: errorSlot("reason"),
    };
    const form = el(
      "div",
      {},
      el("label", {}, "Clock in", fields.clockIn),
      slots.clock_in_at,
      el("label", {}, "Clock out", fields.clockOut),
      slots.clock_out_at,
      el("label", {}, "Reason", fields.reason),
      slots.reason
    );
    const dialog = el(
      "dialog",
      { "aria-label": title },
      el("h2", { text: title }),
      form,
      el(
        "div",
        { class: "row" },
        el("button", {
          type: "button",
          text: confirmLabel,
          onclick: () => onConfirm(dialog, form),
        }),
        el("button", { class: "quiet", type: "button", text: "Close", onclick: () => dialog.close() })
      )
    );
    openDialog(dialog, fields.clockIn, opener);
    return dialog;
  }

  function openCorrect(record, opener) {
    const fields = timeFields(record);
    let version = record.version;
    buildDialog("Correct attendance", fields, "Save correction", async (dialog, form) => {
      showFieldErrors(form, {});
      say(status, "Saving correction…");
      try {
        await api.patch(
          `/api/attendance/${record.id}`,
          {
            clock_in_at: withOffset(fields.clockIn.value, record.clock_in_at),
            clock_out_at: withOffset(fields.clockOut.value, record.clock_in_at),
            reason: fields.reason.value,
          },
          { "If-Match": `"${version}"` }
        );
        dialog.close();
        say(status, "Attendance corrected.");
        await load();
      } catch (error) {
        showFieldErrors(form, error.errors || {});
        if (error.code === "stale_version" && error.body?.current) {
          const current = error.body.current;
          version = current.version;
          fields.clockIn.value = current.clock_in_at.slice(0, 16);
          fields.clockOut.value = current.clock_out_at ? current.clock_out_at.slice(0, 16) : "";
        }
        say(status, failureText(error));
      }
    }, opener);
  }

  function openAdd(entry, opener) {
    const fields = timeFields(null);
    fields.clockIn.value = entry.starts_at.slice(0, 16);
    buildDialog("Add attendance", fields, "Save correction", async (dialog, form) => {
      showFieldErrors(form, {});
      say(status, "Saving correction…");
      try {
        await api.post("/api/attendance", {
          assignment_id: entry.assignment_id,
          clock_in_at: withOffset(fields.clockIn.value, entry.starts_at),
          clock_out_at: withOffset(fields.clockOut.value, entry.starts_at),
          reason: fields.reason.value,
        });
        dialog.close();
        say(status, "Attendance added.");
        await load();
      } catch (error) {
        showFieldErrors(form, error.errors || {});
        say(status, failureText(error));
      }
    }, opener);
  }

  const homePicker =
    homes.length > 1
      ? select("Home", homes.map((home) => ({ value: home.id, label: home.name })), homeId)
      : null;
  const datePicker = el("input", {
    type: "text",
    "aria-label": "Date",
    placeholder: "YYYY-MM-DD",
    value: day,
  });
  datePicker.addEventListener("change", () =>
    navigate(`/attendance?home=${homeId}&date=${datePicker.value}`)
  );
  if (homePicker) {
    homePicker.addEventListener("change", () =>
      navigate(`/attendance?home=${homePicker.value}&date=${day}`)
    );
  }

  await load();
  return el(
    "div",
    {},
    el("h1", { text: "Attendance" }),
    el(
      "section",
      { class: "panel" },
      el(
        "div",
        { class: "row" },
        homePicker ? el("label", {}, "Home", homePicker) : null,
        el("label", {}, "Date", datePicker)
      ),
      el("p", { text: formatDate(day) }),
      status
    ),
    el(
      "section",
      { class: "panel" },
      el(
        "table",
        { class: "cards", "aria-label": "Attendance" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ["Who", "Shift", "Clock in", "Clock out", "Worked hours", "Late", "Correct"].map(
              (name) => el("th", { text: name })
            )
          )
        ),
        body
      )
    ),
    el("section", { class: "panel" }, el("h2", { text: "Add attendance" }), addRow)
  );
}
