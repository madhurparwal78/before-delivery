// "My shifts": the clock button, the open clock-in, the next 14 days, the balance.

import { OFFLINE, api, newKey } from "../api.js";
import { clear, el, say, statusRegion } from "../dom.js";
import { clockTime, shiftLabel } from "../format.js";

const REFRESH_MS = 60000;

export async function render({ me }) {
  const status = statusRegion("Clock status");
  const clockButton = el("button", { type: "button", text: "Clock in" });
  const openLine = el("p", {});
  const list = el("ul", { class: "plain", "aria-label": "Upcoming shifts" });
  const holiday = el("section", { class: "panel", "aria-label": "Holiday" });
  let pendingKey = null;

  async function load() {
    const payload = await api.get("/api/me/shifts");
    const open = payload.open_attendance;
    clockButton.textContent = open ? "Clock out" : "Clock in";
    openLine.textContent = open
      ? `Clocked in at ${clockTime(open.clock_in_at)} for ${shiftLabel(open.date, open.shift)}.`
      : "";
    clear(list);
    for (const assignment of payload.assignments) {
      list.append(
        el("li", {}, [
          el("span", {
            text: `${shiftLabel(assignment.date, assignment.shift)} · ${clockTime(
              assignment.starts_at
            )}–${clockTime(assignment.ends_at)} · ${assignment.hours} h`,
          }),
          assignment.status === "away" ? el("span", { class: "tag", text: "away" }) : null,
        ])
      );
    }
    clear(holiday);
    if (payload.holiday) {
      holiday.append(
        el("h2", { text: "Holiday" }),
        el("p", {
          text: `${payload.holiday.remaining_hours} of ${payload.holiday.entitlement_hours} hours left this leave year`,
        })
      );
    }
    return payload;
  }

  clockButton.addEventListener("click", async () => {
    if (clockButton.disabled) return;
    const kind = clockButton.textContent === "Clock out" ? "out" : "in";
    clockButton.disabled = true;
    say(status, kind === "in" ? "Clocking in…" : "Clocking out…");
    pendingKey = pendingKey || newKey();
    try {
      const payload = await api.post("/api/punches", { kind }, { "Idempotency-Key": pendingKey });
      const record = payload.attendance;
      if (kind === "in") {
        const minutes = record.late
          ? Math.floor(
              (Date.parse(record.clock_in_at) - Date.parse(record.rostered_start)) / 60000
            )
          : 0;
        say(
          status,
          record.late
            ? `Clocked in at ${clockTime(record.clock_in_at)}, ${minutes} minutes late. Your manager will be asked to acknowledge it.`
            : `Clocked in at ${clockTime(record.clock_in_at)} for ${shiftLabel(record.date, record.shift)}.`
        );
      } else {
        say(
          status,
          `Clocked out at ${clockTime(record.clock_out_at)}. You worked ${record.worked_hours} hours.`
        );
      }
      pendingKey = null;
    } catch (error) {
      say(status, error.status === 0 ? OFFLINE : error.message);
      if (error.status !== 0) pendingKey = null;
    }
    await load();
    clockButton.disabled = false;
  });

  await load();
  const timer = window.setInterval(load, REFRESH_MS);
  const node = el(
    "div",
    {},
    el("h1", { text: "My shifts" }),
    el("section", { class: "panel" }, clockButton, status, openLine),
    el("section", { class: "panel" }, el("h2", { text: "Next 14 days" }), list),
    me.holiday ? holiday : null
  );
  return { node, stop: () => window.clearInterval(timer) };
}
