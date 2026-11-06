// The credit meter, the ledger and its CSV, and top-ups.

import { randomBytes } from "node:crypto";
import { allow, authenticate, teamVisible, type Caller } from "../auth";
import { csvText } from "../csv";
import { one, pool, rows, single } from "../db";
import { capState, lastAttemptRefused, periodSpend, softCapMicro, hardCapMicro } from "../domain/budget";
import { balances, type Account, type MovementKind } from "../domain/ledger";
import { budgetPeriod } from "../domain/period";
import { currentPolicy, teamPolicy } from "../domain/policy";
import { completeTopup, loadTopups, projectTopup } from "../domain/topups";
import { unitsText, type Unit } from "../../shared/units";
import { fail, invalid } from "../errors";
import { json, route } from "../http";

async function visibleTeam(caller: Caller, teamId: string): Promise<{ id: string; name: string }> {
  const team = await one<{ id: string; name: string }>(pool, "SELECT id, name FROM teams WHERE id = $1", [teamId]);
  if (!team || !teamVisible(caller, team.id)) fail("not_found");
  return team;
}

route("GET", "/api/teams/{id}/meter", "none", async (req) => {
  const caller = await authenticate(req);
  const team = await visibleTeam(caller, req.params.id);
  const now = new Date();
  const policy = await currentPolicy(pool);
  const settings = teamPolicy(policy, team.id);
  const period = budgetPeriod(now, policy.timezone);
  const book = await balances(pool, team.id);
  const spend = await periodSpend(pool, team.id, period);
  const inFlight = await rows<{ job_id: string; status: string; reserved_micro: bigint; estimated_units_micro: bigint; unit: Unit }>(pool,
    `SELECT id AS job_id, status, reserved_micro, estimated_units_micro, unit FROM jobs
     WHERE team_id = $1 AND status IN ('queued', 'leased', 'running') ORDER BY submitted_at, number`, [team.id]);
  const replays = await rows<{ job_id: string; at: Date }>(pool,
    `SELECT r.job_id, r.at FROM replays r JOIN jobs j ON j.id = r.job_id
     WHERE j.team_id = $1 AND r.at > now() - interval '10 seconds' ORDER BY r.at`, [team.id]);
  return json(200, {
    team_id: team.id,
    ...book,
    in_flight: inFlight.map((j) => ({
      job_id: j.job_id, status: j.status, reserved_micro: j.reserved_micro,
      estimated_units: unitsText(j.estimated_units_micro), unit: j.unit,
    })),
    recent_replays: replays.map((r) => ({ job_id: r.job_id, at: r.at.toISOString() })),
    period: {
      label: period.label,
      starts_at: period.startsAt.toISOString(),
      ends_at: period.endsAt.toISOString(),
      spend_micro: spend,
      soft_cap_micro: softCapMicro(settings),
      hard_cap_micro: hardCapMicro(settings),
      soft_cap_offset_micro: book.settled_micro + book.reserved_micro - spend + softCapMicro(settings),
    },
    cap_state: capState(spend, settings, await lastAttemptRefused(pool, team.id, period)),
  });
});

interface MovementRow {
  number: bigint;
  id: string;
  kind: MovementKind;
  created_at: Date;
  job_id: string | null;
  topup_id: string | null;
  kb_invoice_id: string | null;
  account: Account;
  amount_micro: bigint;
}

async function ledgerRows(teamId: string): Promise<MovementRow[]> {
  return rows<MovementRow>(pool,
    `SELECT m.number, m.id, m.kind, m.created_at, m.job_id, m.topup_id, m.kb_invoice_id, e.account, e.amount_micro
     FROM movements m JOIN entries e ON e.movement_number = m.number
     WHERE m.team_id = $1 ORDER BY m.number, e.amount_micro`, [teamId]);
}

route("GET", "/api/teams/{id}/ledger", "none", async (req) => {
  const caller = await authenticate(req);
  const team = await visibleTeam(caller, req.params.id);
  allow(caller, "finance", "admin");
  const movements: Array<Omit<MovementRow, "number" | "account" | "amount_micro" | "created_at"> & { created_at: string; entries: Array<{ account: Account; amount_micro: bigint }> }> = [];
  for (const row of await ledgerRows(team.id)) {
    const last = movements[movements.length - 1];
    if (last?.id === row.id) {
      last.entries.push({ account: row.account, amount_micro: row.amount_micro });
      continue;
    }
    movements.push({
      id: row.id, kind: row.kind, created_at: row.created_at.toISOString(), job_id: row.job_id, topup_id: row.topup_id,
      kb_invoice_id: row.kb_invoice_id, entries: [{ account: row.account, amount_micro: row.amount_micro }],
    });
  }
  return json(200, { balances: await balances(pool, team.id), movements });
});

route("GET", "/api/teams/{id}/ledger.csv", "none", async (req) => {
  const caller = await authenticate(req);
  const team = await visibleTeam(caller, req.params.id);
  allow(caller, "finance", "admin");
  const header = ["movement_id", "kind", "created_at", "job_id", "topup_id", "kb_invoice_id", "account", "amount_micro"];
  const lines = (await ledgerRows(team.id)).map((r) => [
    r.id, r.kind, r.created_at.toISOString(), r.job_id, r.topup_id, r.kb_invoice_id, r.account, r.amount_micro,
  ]);
  return {
    status: 200,
    text: csvText([header, ...lines]),
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ledger-${team.id}.csv"` },
  };
});

route("POST", "/api/topups", "json", async (req) => {
  const caller = await authenticate(req);
  allow(caller, "finance");
  const body = (req.json ?? {}) as { team_id?: unknown; credits?: unknown };
  const errors: Record<string, string> = {};
  const team = typeof body.team_id === "string"
    ? await one<{ id: string }>(pool, "SELECT id FROM teams WHERE id = $1", [body.team_id])
    : undefined;
  if (!team) errors.team_id = "Choose a team.";
  const credits = body.credits;
  if (typeof credits !== "number" || !Number.isInteger(credits) || credits < 100 || credits > 100_000 || credits % 100 !== 0) {
    errors.credits = "Enter whole credits from 100 to 100,000 in multiples of 100.";
  }
  if (Object.keys(errors).length || !team) invalid(errors);
  const { id } = await single<{ id: string }>(pool,
    `INSERT INTO topups (number, id, team_id, credits, status, created_by, created_at)
     SELECT n, $4, $1, $2, 'pending', $3, now() FROM nextval('topup_number') AS n RETURNING id`,
    [team.id, credits, caller.id, `tu_${randomBytes(8).toString("hex")}`]);
  const topup = await completeTopup(id);
  if (topup.status === "failed") fail("billing_rejected");
  return json(topup.status === "paid" ? 201 : 202, { topup: projectTopup(topup) });
});

route("GET", "/api/topups", "none", async (req) => {
  const caller = await authenticate(req);
  const team = req.query.get("team");
  if (team !== null) await visibleTeam(caller, team);
  allow(caller, "finance", "admin");
  const found = await loadTopups("($1::text IS NULL OR t.team_id = $1)", [team], "ORDER BY t.number DESC");
  return json(200, { topups: found.map(projectTopup) });
});
