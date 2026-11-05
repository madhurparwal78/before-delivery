// Pledges, withdrawals, resolutions at cutoff, unit shares and pledges by day.
import { clubDate } from "./clubtime.js";
import { creditOf, unitHoldCents } from "./credit.js";
import { acceptingPledges, effectiveStatus, visibleCycle } from "./cycles.js";
import { all, nowSeconds, run } from "./db.js";
import { conflict, invalid, notFound, type Reply } from "./errors.js";
import { bumpLine, lineJson, linePledges, lineRow, type LineRow, settledStatus, unitsToGo } from "./lines.js";
import { allow, type Viewer } from "./session.js";
import { shareSummary } from "./shares.js";

function visibleLine(viewer: Viewer, cycleId: string, productId: string) {
  const cycle = visibleCycle(cycleId, viewer);
  const line = lineRow(cycleId, productId);
  if (!line) throw notFound("No such case in this cycle.");
  return { cycle, line };
}

const cutoffPassed = () => conflict("cutoff_passed", "Cutoff has passed. Pledges are closed.");

/** Every accepted pledge change counts on the club-local date the server accepted it. */
export function countPledgeChange(cycleId: string, delta: number, at = nowSeconds()): void {
  if (delta === 0) return;
  run(
    `INSERT INTO pledge_days (cycle_id, date, units_pledged, units_withdrawn) VALUES (?, ?, ?, ?)
     ON CONFLICT (cycle_id, date) DO UPDATE SET units_pledged = units_pledged + excluded.units_pledged,
       units_withdrawn = units_withdrawn + excluded.units_withdrawn`,
    cycleId, clubDate(at), Math.max(delta, 0), Math.max(-delta, 0),
  );
}

function pledgeReply(line: LineRow, viewer: Viewer): Reply {
  const fresh = lineRow(line.cycle_id, line.product_id)!;
  return { status: 200, body: { line: lineJson(fresh, viewer), credit: creditOf(viewer.household_code!) } };
}

/** PUT: sets the household's whole pledge on the case. Checked and written in one transaction. */
export function setPledge(viewer: Viewer, cycleId: string, productId: string, body: Record<string, unknown>): Reply {
  const { cycle, line } = visibleLine(viewer, cycleId, productId);
  allow(viewer, "member");
  if (!acceptingPledges(cycle)) throw cutoffPassed();
  const units = body.units;
  if (!Number.isInteger(units) || (units as number) < 1 || (units as number) > line.pack) {
    throw invalid("units", `Choose 1 to ${line.pack} units.`);
  }
  const wanted = units as number;
  const household = viewer.household_code!;
  const pledges = linePledges(cycleId, productId);
  const mine = pledges.find((p) => p.pledger === household);
  const others = line.pack - unitsToGo(line.pack, pledges) - (mine?.units ?? 0);
  if (others + wanted > line.pack) {
    throw conflict("not_enough_units", `Only ${line.pack - others - (mine?.units ?? 0)} units are left on ${line.case_name}.`);
  }
  const hold = unitHoldCents(line.price_cents, line.pack);
  if (creditOf(household).spendable_cents + (mine?.units ?? 0) * hold - wanted * hold < 0) {
    throw conflict("insufficient_credit", `Not enough credit for ${line.case_name}.`);
  }
  if (mine) run("UPDATE pledges SET units = ? WHERE id = ?", wanted, mine.id);
  else run("INSERT INTO pledges (cycle_id, product_id, pledger, units) VALUES (?, ?, ?, ?)", cycleId, productId, household, wanted);
  countPledgeChange(cycleId, wanted - (mine?.units ?? 0));
  bumpLine(cycleId, productId, settledStatus(line.status, unitsToGo(line.pack, linePledges(cycleId, productId))));
  return pledgeReply(line, viewer);
}

/** DELETE: withdraws the household's pledge, releasing its hold. */
export function withdrawPledge(viewer: Viewer, cycleId: string, productId: string): Reply {
  const { cycle, line } = visibleLine(viewer, cycleId, productId);
  allow(viewer, "member");
  const mine = linePledges(cycleId, productId).find((p) => p.pledger === viewer.household_code);
  if (!mine) throw notFound("You have no pledge on this case.");
  if (!acceptingPledges(cycle)) throw cutoffPassed();
  run("DELETE FROM pledges WHERE id = ?", mine.id);
  countPledgeChange(cycleId, -mine.units);
  bumpLine(cycleId, productId, settledStatus(line.status, unitsToGo(line.pack, linePledges(cycleId, productId))));
  return pledgeReply(line, viewer);
}

/** Drops or takes up a filling case while sealing; the first resolution to commit wins. */
export function resolveLine(viewer: Viewer, cycleId: string, productId: string, body: Record<string, unknown>): Reply {
  const { cycle, line } = visibleLine(viewer, cycleId, productId);
  allow(viewer, "coordinator");
  if (effectiveStatus(cycle) !== "sealing") throw conflict("wrong_cycle_state", "Cases are resolved only at cutoff.");
  if (line.status === "sealed") throw conflict("line_already_full", `${line.case_name} is already full.`);
  if (line.status === "dropped" || line.status === "taken_up") {
    throw conflict("line_already_resolved", `${line.case_name} was already ${line.status === "dropped" ? "dropped" : "taken up"}.`);
  }
  if (body.action !== "drop" && body.action !== "take_up") throw invalid("action", "Choose drop or take_up.");
  if (body.action === "take_up") {
    run(
      "INSERT INTO pledges (cycle_id, product_id, pledger, units) VALUES (?, ?, 'club', ?)",
      cycleId, productId, unitsToGo(line.pack, linePledges(cycleId, productId)),
    );
  }
  bumpLine(cycleId, productId, body.action === "drop" ? "dropped" : "taken_up");
  return { status: 200, body: lineJson(lineRow(cycleId, productId)!, viewer) };
}

export function lineShares(viewer: Viewer, cycleId: string, productId: string): Reply {
  const { line } = visibleLine(viewer, cycleId, productId);
  allow(viewer, "coordinator", "member");
  if (line.status !== "sealed" && line.status !== "taken_up") {
    throw conflict("line_not_sealed", `${line.case_name} is not sealed.`);
  }
  return { status: 200, body: shareSummary(linePledges(cycleId, productId), line.price_cents, line.pack) };
}

export function pledgesByDay(viewer: Viewer, cycleId: string, timeZone: string): Reply {
  visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  const days = all<{ date: string; units_pledged: number; units_withdrawn: number }>(
    "SELECT date, units_pledged, units_withdrawn FROM pledge_days WHERE cycle_id = ? ORDER BY date",
    cycleId,
  );
  return { status: 200, body: { time_zone: timeZone, days } };
}

