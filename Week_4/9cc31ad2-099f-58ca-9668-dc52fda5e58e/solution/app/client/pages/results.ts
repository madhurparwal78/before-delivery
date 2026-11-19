import { LAYOUTS, type Mode } from "../../shared/model";
import { get } from "../api";
import { h, prefersReducedMotion } from "../dom";
import { fmtCoins, fmtTime } from "../format";
import { live } from "../live";
import { easeOutCubic, frames } from "../motion";
import { finishAnswered } from "../race/finish";
import type { PageContext } from "../router";
import { renderShell } from "../shell";
import { outline } from "../track";
import type { RunSummary } from "../types";

const VERIFYING = "Verifying run…";
const HELD = "Held for verification";
const REJECTED: Record<string, string> = {
  did_not_finish: "Rejected: the replay did not reach the finish.",
  seed_mismatch: "Rejected: the run's seed did not match.",
  invalid_inputs: "Rejected: the inputs could not be read.",
};
const COUNT_MS = 800;
const POLL_MS = 1000;
const GUIDED_EVENT = "guided-first-race";
const MODE_NAMES: Record<Mode, string> = { practice: "Practice", circuit: "Circuit", drift: "Drift", "time-trial": "Time trial" };

function resultText(run: RunSummary): string {
  if (run.mode === "drift") return `${fmtCoins(run.driftScore ?? 0)} pts`;
  if (run.mode === "time-trial" && run.bestLapMs !== null) return fmtTime(run.bestLapMs);
  return fmtTime(run.raceMs ?? 0);
}

export async function resultsPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Run result";
  const runId = ctx.url.pathname.split("/").pop()!;
  const main = renderShell(true, ["Verify", "Laps", "Payout"]);
  const heading = h("h1", { tabindex: "-1" }, "Run result");
  const status = h("p", { role: "status", "aria-label": "Run result", class: "status-line" }, VERIFYING);
  const lapsSlot = h("div");
  const payoutSlot = h("div");
  const links = h("div", { class: "result-links" }, h("a", { href: "/garage", class: "button" }, "Back to garage"));
  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Stage 03 · Finish"), heading)),
    h("div", { class: "result-grid" },
      h("section", { class: "cell wide", "aria-label": "Verdict" }, status, lapsSlot),
      h("section", { class: "cell narrow", "aria-label": "Coins paid" }, payoutSlot)),
    links);
  heading.focus();

  let settled = false;
  let stopCount: (() => void) | null = null;
  let linked = false;

  function render(run: RunSummary): void {
    // Championship event runs link back to their ladder; the guided first race sits outside the leagues.
    if (run.eventId && run.eventId !== GUIDED_EVENT && !linked) {
      linked = true;
      links.append(h("a", { href: "/championship", class: "button", "data-state": JSON.stringify({ focusEvent: run.eventId }) },
        "Back to championship"));
    }
    if (run.status === "held") {
      status.textContent = HELD;
      return;
    }
    if (run.status === "rejected") {
      settled = true;
      status.textContent = REJECTED[run.reason ?? ""] ?? REJECTED.invalid_inputs;
      return;
    }
    if (run.status !== "verified") {
      status.textContent = VERIFYING;
      return;
    }
    settled = true;
    const payout = run.payout ?? 0;
    status.textContent = `Verified: ${resultText(run)}, +${fmtCoins(payout)} coins`;
    const rows = (run.lapResults ?? []).map((lap, i) => h("tr", null,
      h("th", { scope: "row" }, String(i + 1)),
      h("td", { class: "fig" }, fmtTime(lap.lapMs)),
      h("td", { class: lap.valid ? "" : "loss" }, lap.valid ? "Valid" : "Invalid")));
    if (run.mode === "drift") {
      rows.push(h("tr", null, h("th", { scope: "row" }, "Score"), h("td", { class: "fig" }, fmtCoins(run.driftScore ?? 0)), h("td")));
    }
    lapsSlot.replaceChildren(h("table", { "aria-label": "Laps" },
      h("thead", null, h("tr", null, h("th", { scope: "col" }, "Lap"), h("th", { scope: "col", class: "fig" }, "Time"),
        h("th", { scope: "col" }, "Status"))),
      h("tbody", null, ...rows)));
    const figure = h("span", { class: "fig payout-figure coins-figure" });
    payoutSlot.replaceChildren(h("figure", { class: "payout", "aria-label": "Payout" }, h("span", { class: "label" }, "Coins paid"), figure),
      h("div", { class: "result-map" }, h("p", { class: "label" }, `${LAYOUTS[run.layoutId].name} · ${MODE_NAMES[run.mode]}`),
        outline(run.layoutId, LAYOUTS[run.layoutId].name)));
    if (prefersReducedMotion()) {
      figure.textContent = `+${fmtCoins(payout)} coins`;
      return;
    }
    const start = performance.now();
    figure.textContent = "+0 coins";
    stopCount = frames((now) => {
      const k = Math.min(1, (now - start) / COUNT_MS);
      figure.textContent = `+${fmtCoins(Math.round(payout * easeOutCubic(k)))} coins`;
      return k < 1;
    });
  }

  async function refresh(): Promise<void> {
    if (settled || ctx.signal.aborted) return;
    const result = await get<RunSummary>(`/v1/runs/${runId}`, ctx.signal).catch(() => null);
    if (result?.status === 200 && !settled) render(result.data);
  }

  await finishAnswered(runId);
  if (ctx.signal.aborted) return;
  const stop = live.listen((push) => { if (push.type === "run" && push.runId === runId) void refresh(); });
  const poll = window.setInterval(() => void refresh(), POLL_MS);
  ctx.signal.addEventListener("abort", () => {
    stop();
    window.clearInterval(poll);
    stopCount?.();
  });
  await refresh();
}
