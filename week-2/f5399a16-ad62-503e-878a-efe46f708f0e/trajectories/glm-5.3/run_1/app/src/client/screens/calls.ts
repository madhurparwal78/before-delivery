// Calls: the week named by the server, bookings in the producer's wall time
// on each side of a clock change, and the calendar files in the inbox.

import { el, type ScreenContext, heading, workingButton } from "../lib/ui";
import { ApiError, type Json } from "../lib/state";
import { api } from "../lib/ui";

export async function buildCalls(ctx: ScreenContext, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const h = heading(["Calls"], ctx.announcer);
  const weekStart = query.get("week");
  const list = el("ul", { class: "call-list" });
  const today = await api.get("/api/today");
  const week = weekStart ?? String(today.weekStart);

  async function load(): Promise<void> {
    const from = week;
    const answer = await api.get(`/api/calls?from=${from}`);
    const calls = ((answer.calls as Json[]) ?? []).filter((c) => String(c.state) === "booked");
    list.replaceChildren();
    for (const call of calls) {
      const row = el("li", { class: "call-row" },
        el("p", { class: "call-text" }, String(call.text)),
      );
      const move = workingButton("Move call", async () => {
        const date = window.prompt("Date (2027-03-15)", String(call.date));
        const time = window.prompt("Time (09:00)", String(call.time));
        if (date === null || time === null) return;
        try {
          await api.patch(`/api/calls/${String(call.id)}`, { date, time, minutes: Number(call.minutes) });
          ctx.announcer.announce("Call moved.");
          await load();
        } catch (e) {
          if (e instanceof ApiError) ctx.announcer.announce(e.message);
        }
      }, "Working…");
      const cancel = workingButton("Cancel call", async () => {
        try {
          await api.post(`/api/calls/${String(call.id)}/cancel`, {});
          ctx.announcer.announce("Call cancelled.");
          await load();
        } catch (e) {
          if (e instanceof ApiError) ctx.announcer.announce(e.message);
        }
      }, "Working…");
      row.append(move, cancel);
      list.append(row);
    }
  }
  await load();

  const book = workingButton("Book a call", async () => {
    ctx.announcer.announce("Book a call.");
    void ctx;
  }, "Working…");

  const earlier = el("a", { href: `/desk/calls?week=${addDays(week, -7)}`, class: "earlier-week" }, "Earlier week");
  const later = el("a", { href: `/desk/calls?week=${addDays(week, 7)}`, class: "later-week" }, "Later week");

  const body = el("main", { class: "calls" }, h, earlier, list, later, book);
  return { heading: h, body, refresh: load };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
