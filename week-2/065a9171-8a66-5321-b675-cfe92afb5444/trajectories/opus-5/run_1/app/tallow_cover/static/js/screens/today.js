// "Today": the summary line, staffing against floor, late clock-ins, missed clock-outs.

import { OFFLINE, api } from "../api.js";
import { clear, el, say, select, statusRegion } from "../dom.js";
import { SHIFT_LABELS, formatDate, shiftLabel } from "../format.js";
import { homesFor } from "../homes.js";
import { breachLabels } from "../strip.js";

const REFRESH_MS = 30000;

function statusText(shift) {
  const labels = breachLabels(shift.shortfall, shift.senior_shortfall);
  return labels.length ? labels.join(", ") : "At floor";
}

export async function render({ me, query, navigate }) {
  const homes = homesFor(me);
  const homeId = query.get("home") || me.home_id || homes[0]?.id;
  const status = statusRegion("Today status");
  const heading = el("h1", {});
  const summary = el("p", { class: "summary" });
  const table = el("table", { class: "cards", "aria-label": "Staffing today" });
  const lateList = el("ul", { class: "plain", "aria-label": "Late clock-ins" });
  const lateEmpty = el("p", { text: "No late clock-ins waiting." });
  const missedList = el("ul", { class: "plain", "aria-label": "Missed clock-outs" });
  const missedEmpty = el("p", { text: "No missed clock-outs in the last 7 days." });

  async function load() {
    const payload = await api.get(`/api/homes/${homeId}/today`);
    heading.textContent = `Today, ${formatDate(payload.date)}`;
    summary.textContent = `${payload.totals.on_duty} on duty · ${payload.totals.below_floor} shifts below floor`;
    clear(table);
    table.append(
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          ["Unit", "Shift", "On duty", "Floor", "Seniors", "Status"].map((name) =>
            el("th", { text: name })
          )
        )
      )
    );
    const body = el("tbody", {});
    for (const unit of payload.units) {
      for (const shift of unit.shifts) {
        const breached = shift.shortfall > 0 || shift.senior_shortfall > 0;
        body.append(
          el(
            "tr",
            { class: breached ? "breach-row" : null },
            el("td", { dataset: { label: "Unit" }, text: unit.name }),
            el("td", { dataset: { label: "Shift" }, text: SHIFT_LABELS[shift.shift] }),
            el("td", { dataset: { label: "On duty" }, text: String(shift.on_duty) }),
            el("td", {
              dataset: { label: "Floor" },
              text: `${shift.floor.min_staff}/${shift.floor.min_seniors}`,
            }),
            el("td", { dataset: { label: "Seniors" }, text: String(shift.seniors_on_duty) }),
            el("td", { dataset: { label: "Status" }, text: statusText(shift) })
          )
        );
      }
    }
    table.append(body);

    clear(lateList);
    lateEmpty.hidden = payload.late_clock_ins.length > 0;
    for (const record of payload.late_clock_ins) {
      lateList.append(
        el(
          "li",
          {},
          el("span", {
            text: `${record.person.display_name}, ${shiftLabel(record.date, record.shift)}`,
          }),
          el("button", {
            type: "button",
            "aria-label": `Acknowledge ${record.person.display_name}`,
            text: "Acknowledge",
            onclick: async () => {
              say(status, "Saving…");
              try {
                await api.post(`/api/attendance/${record.id}/acknowledge`, {});
                say(status, "Acknowledged.");
                await load();
              } catch (error) {
                say(status, error.status === 0 ? OFFLINE : error.message);
              }
            },
          })
        )
      );
    }

    clear(missedList);
    missedEmpty.hidden = payload.missed_clock_outs.length > 0;
    for (const record of payload.missed_clock_outs) {
      const label = shiftLabel(record.date, record.shift);
      missedList.append(
        el(
          "li",
          {},
          el("span", { text: `${record.person.display_name}, ${label}` }),
          el("a", {
            href: `/attendance?home=${record.home_id}&date=${record.date}`,
            "aria-label": `Correct ${record.person.display_name} ${label}`,
            text: "Correct",
          })
        )
      );
    }
  }

  const homePicker =
    homes.length > 1
      ? select("Home", homes.map((home) => ({ value: home.id, label: home.name })), homeId)
      : null;
  if (homePicker) {
    homePicker.addEventListener("change", () => navigate(`/today?home=${homePicker.value}`));
  }

  await load();
  const timer = window.setInterval(() => load().catch(() => say(status, OFFLINE)), REFRESH_MS);
  const node = el(
    "div",
    {},
    heading,
    homePicker ? el("div", { class: "row" }, el("label", {}, "Home", homePicker)) : null,
    el("section", { class: "panel" }, summary, table, status),
    el(
      "div",
      { class: "today-lists" },
      el("section", { class: "panel" }, el("h2", { text: "Late clock-ins" }), lateList, lateEmpty),
      el(
        "section",
        { class: "panel" },
        el("h2", { text: "Missed clock-outs" }),
        missedList,
        missedEmpty
      )
    )
  );
  return { node, stop: () => window.clearInterval(timer) };
}
