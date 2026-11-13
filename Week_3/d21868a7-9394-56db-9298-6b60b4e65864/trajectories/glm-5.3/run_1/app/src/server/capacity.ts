// Capacity table revisions: saving, conflicting saves settling to the lower
// cap, and restoring an earlier revision.
import pg from "pg";
import { decCmp, decParse } from "../shared/decimal.ts";
import { capVolumeMl } from "../shared/domain.ts";
import { ApiError, fieldErrors } from "./errors.ts";
import { Store } from "./store.ts";

export type CapacityCells = Array<{ window_id: string; cap_ml_day: string }>;

export async function readCapacity(
  store: Store,
  channelId: string,
): Promise<{
  revision: number;
  cells: CapacityCells;
  revisions: Array<{ revision: number; saved_at: string; saved_by: string; restored_from: number | null }>;
}> {
  const win = await store.query<{ id: string; hours: number; opens_at: number }>(
    `SELECT id, hours, opens_at FROM windows WHERE channel_id = $1 ORDER BY opens_at`,
    [channelId],
  );
  const current = await currentRevision(store, channelId);
  const cellsRaw = await store.query<{ window_id: string; cap_ml_day: string }>(
    `SELECT cc.window_id, cc.cap_ml_day FROM capacity_cells cc
     JOIN capacity_revisions r ON r.id = cc.revision_id
     WHERE r.channel_id = $1 AND r.revision = $2`,
    [channelId, current],
  );
  const cells = new Map(cellsRaw.rows.map((r) => [r.window_id, r.cap_ml_day]));
  const list = await store.query<{ revision: number; saved_at: Date; saved_by: string; restored_from: number | null }>(
    `SELECT revision, saved_at, name AS saved_by, restored_from FROM capacity_revisions r
     JOIN people p ON p.id = r.saved_by WHERE r.channel_id = $1 ORDER BY revision DESC`,
    [channelId],
  );
  return {
    revision: current,
    cells: win.rows.map((w) => ({ window_id: w.id, cap_ml_day: cells.get(w.id) ?? "0.000" })),
    revisions: list.rows.map((r) => ({
      revision: r.revision,
      saved_at: new Date(r.saved_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      saved_by: r.saved_by,
      restored_from: r.restored_from,
    })),
  };
}

async function currentRevision(store: Store, channelId: string): Promise<number> {
  const res = await store.query<{ rev: number }>(
    "SELECT COALESCE(MAX(revision), 0)::int AS rev FROM capacity_revisions WHERE channel_id = $1",
    [channelId],
  );
  return res.rows[0]!.rev;
}

export type SaveResult =
  | { ok: true; revision: number; cells: CapacityCells }
  | { ok: false; revision: number; settled: CapacityCells; submitted: CapacityCells };

export async function saveCapacity(
  store: Store,
  channelId: string,
  savedBy: number,
  baseRevision: number,
  submitted: CapacityCells,
  now: number,
): Promise<SaveResult> {
  return store.transaction(async (client) => {
    // channel must exist
    const ch = await client.query<{ id: string }>("SELECT id FROM channels WHERE id = $1", [channelId]);
    if (!ch.rows[0]) throw new ApiError(404, "not_found", "There is no such record.");
    await client.query(`SELECT id FROM capacity_revisions WHERE channel_id = $1 FOR UPDATE`, [channelId]);
    const current = await currentRevisionInTx(client, channelId);
    const currentCaps = await capsAtRevision(client, channelId, current);

    // validate submitted cells against windows of this channel
    const channelWindows = await client.query<{ id: string; status_closed: boolean; hours: number; opens_at: Date; closes_at: Date; restriction_cap: string | null; restriction_eff: Date | null; committed_ml: string }>(
      `SELECT w.id, w.opens_at, w.closes_at, w.hours, w.restriction_cap_ml_day AS restriction_cap,
              w.restriction_effective_at AS restriction_eff, w.committed_ml,
              (now() >= w.closes_at) AS status_closed
       FROM windows w WHERE w.channel_id = $1`,
      [channelId],
    );
    const byId = new Map(channelWindows.rows.map((w) => [w.id, w]));
    const seen = new Set<string>();
    const errors: Record<string, string> = {};
    for (const cell of submitted) {
      const w = byId.get(cell.window_id);
      if (!w || seen.has(cell.window_id)) {
        errors[`cells.${cell.window_id}`] = "Choose a window of this channel.";
        continue;
      }
      seen.add(cell.window_id);
      const d = decParse(cell.cap_ml_day);
      if (d === null || decCmp(d, decParse("0.000")!) <= 0 || decCmp(d, decParse("10000.000")!) > 0 || (cell.cap_ml_day.split(".")[1] ?? "").length > 3) {
        errors[`cells.${cell.window_id}`] = "Cap must be greater than 0 and at most 10000.000 ML/day.";
        continue;
      }
      if (w.status_closed) {
        errors[`cells.${cell.window_id}`] = "This window has closed.";
        continue;
      }
      // recomputed cap volume must cover committed volume
      const newCapVolume = capVolumeMl(cell.cap_ml_day, w.restriction_cap, w.restriction_eff?.getTime() ?? null, w.opens_at.getTime(), w.hours);
      if (decCmp(decParse(newCapVolume)!, decParse(w.committed_ml)!) < 0) {
        errors[`cells.${cell.window_id}`] = "The cap would fall below the volume already committed to this window.";
      }
    }
    if (Object.keys(errors).length > 0) throw fieldErrors(errors);

    const nextRev = current + 1;
    const conflict = baseRevision !== current;

    // cells to store: submitted (settled when conflicting) plus untouched current caps
    const finalCaps = new Map<string, string>(currentCaps);
    const settled: CapacityCells = [];
    for (const cell of submitted) {
      let cap = cell.cap_ml_day;
      if (conflict) {
        const cur = currentCaps.get(cell.window_id) ?? "0.000";
        cap = decCmp(decParse(cur)!, decParse(cell.cap_ml_day)!) <= 0 ? cur : cell.cap_ml_day;
      }
      finalCaps.set(cell.window_id, cap);
      settled.push({ window_id: cell.window_id, cap_ml_day: cap });
    }

    // validation of settled cells against committed volume (conflict path may
    // keep the current cap, which is by definition valid)
    const rev = await client.query<{ id: number }>(
      `INSERT INTO capacity_revisions (channel_id, revision, saved_at, saved_by, restored_from)
       VALUES ($1,$2,$3,$4,null) RETURNING id`,
      [channelId, nextRev, new Date(now), savedBy],
    );
    for (const [windowId, cap] of finalCaps) {
      await client.query("INSERT INTO capacity_cells (revision_id, window_id, cap_ml_day) VALUES ($1,$2,$3)", [rev.rows[0]!.id, windowId, cap]);
    }
    // recompute cap volumes for all windows of the channel
    for (const w of channelWindows.rows) {
      const cap = finalCaps.get(w.id) ?? currentCaps.get(w.id) ?? "0.000";
      const vol = capVolumeMl(cap, w.restriction_cap, w.restriction_eff?.getTime() ?? null, w.opens_at.getTime(), w.hours);
      await client.query("UPDATE windows SET cap_volume_ml = $1 WHERE id = $2", [vol, w.id]);
    }

    if (conflict) {
      return { ok: false, revision: nextRev, settled, submitted };
    }
    const cellsOut: CapacityCells = [...finalCaps].map(([window_id, cap_ml_day]) => ({ window_id, cap_ml_day }));
    return { ok: true, revision: nextRev, cells: cellsOut };
  });
}

export async function restoreRevision(
  store: Store,
  channelId: string,
  savedBy: number,
  revision: number,
  now: number,
): Promise<{ revision: number; restored_from: number; cells: CapacityCells }> {
  return store.transaction(async (client) => {
    const ch = await client.query<{ id: string }>("SELECT id FROM channels WHERE id = $1", [channelId]);
    if (!ch.rows[0]) throw new ApiError(404, "not_found", "There is no such record.");
    const source = await client.query<{ revision: number }>(
      "SELECT revision FROM capacity_revisions WHERE channel_id = $1 AND revision = $2 FOR SHARE",
      [channelId, revision],
    );
    if (!source.rows[0]) throw new ApiError(404, "not_found", "There is no such record.");
    await client.query(`SELECT id FROM capacity_revisions WHERE channel_id = $1 FOR UPDATE`, [channelId]);
    const current = await currentRevisionInTx(client, channelId);
    const currentCaps = await capsAtRevision(client, channelId, current);
    const sourceCaps = await capsAtRevision(client, channelId, revision);

    const channelWindows = await client.query<{ id: string; status_closed: boolean; hours: number; opens_at: Date; restriction_cap: string | null; restriction_eff: Date | null; committed_ml: string }>(
      `SELECT w.id, w.opens_at, w.hours, w.restriction_cap_ml_day AS restriction_cap,
              w.restriction_effective_at AS restriction_eff, w.committed_ml, (now() >= w.closes_at) AS status_closed
       FROM windows w WHERE w.channel_id = $1`,
      [channelId],
    );
    // windows created after the source revision keep their current caps;
    // closed windows keep their current caps
    const sourceCreated = await client.query<{ window_id: string }>(
      `SELECT DISTINCT cc.window_id FROM capacity_cells cc
       JOIN capacity_revisions r ON r.id = cc.revision_id WHERE r.channel_id = $1 AND r.revision = $2`,
      [channelId, revision],
    );
    const existedAtSource = new Set(sourceCreated.rows.map((r) => r.window_id));

    const finalCaps = new Map<string, string>();
    for (const w of channelWindows.rows) {
      const inSource = existedAtSource.has(w.id) && sourceCaps.has(w.id);
      if (inSource && !w.status_closed) {
        finalCaps.set(w.id, sourceCaps.get(w.id)!);
      } else {
        finalCaps.set(w.id, currentCaps.get(w.id) ?? "0.000");
      }
    }
    // check committed volume
    const below: string[] = [];
    for (const w of channelWindows.rows) {
      const cap = finalCaps.get(w.id)!;
      const vol = capVolumeMl(cap, w.restriction_cap, w.restriction_eff?.getTime() ?? null, w.opens_at.getTime(), w.hours);
      if (decCmp(decParse(vol)!, decParse(w.committed_ml)!) < 0) below.push(w.id);
    }
    if (below.length > 0) {
      throw new ApiError(409, "restore_below_committed", "Restoring revision <revision> would cut below what is already committed.", { windows: below });
    }

    const nextRev = current + 1;
    const rev = await client.query<{ id: number }>(
      `INSERT INTO capacity_revisions (channel_id, revision, saved_at, saved_by, restored_from)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [channelId, nextRev, new Date(now), savedBy, revision],
    );
    for (const [windowId, cap] of finalCaps) {
      await client.query("INSERT INTO capacity_cells (revision_id, window_id, cap_ml_day) VALUES ($1,$2,$3)", [rev.rows[0]!.id, windowId, cap]);
    }
    for (const w of channelWindows.rows) {
      const cap = finalCaps.get(w.id)!;
      const vol = capVolumeMl(cap, w.restriction_cap, w.restriction_eff?.getTime() ?? null, w.opens_at.getTime(), w.hours);
      await client.query("UPDATE windows SET cap_volume_ml = $1 WHERE id = $2", [vol, w.id]);
    }
    return { revision: nextRev, restored_from: revision, cells: [...finalCaps].map(([window_id, cap_ml_day]) => ({ window_id, cap_ml_day })) };
  });
}

async function currentRevisionInTx(client: pg.PoolClient, channelId: string): Promise<number> {
  const res = await client.query<{ rev: number }>("SELECT COALESCE(MAX(revision), 0)::int AS rev FROM capacity_revisions WHERE channel_id = $1", [channelId]);
  return res.rows[0]!.rev;
}

async function capsAtRevision(client: pg.PoolClient, channelId: string, revision: number): Promise<Map<string, string>> {
  const res = await client.query<{ window_id: string; cap_ml_day: string }>(
    `SELECT cc.window_id, cc.cap_ml_day FROM capacity_cells cc
     JOIN capacity_revisions r ON r.id = cc.revision_id
     WHERE r.channel_id = $1 AND r.revision = $2`,
    [channelId, revision],
  );
  return new Map(res.rows.map((r) => [r.window_id, r.cap_ml_day]));
}

// Creating a window adds the next revision holding the window's cap.
export async function createWindow(
  store: Store,
  channelId: string,
  savedBy: number,
  input: { opens_at: number; closes_at: number; capMlDay: string; rosteredOperator: string },
  now: number,
): Promise<{ windowId: string; revision: number }> {
  return store.transaction(async (client) => {
    const ch = await client.query<{ id: string }>("SELECT id FROM channels WHERE id = $1", [channelId]);
    if (!ch.rows[0]) throw new ApiError(404, "not_found", "There is no such record.");
    const errors: Record<string, string> = {};
    const cap = decParse(input.capMlDay);
    if (cap === null || decCmp(cap, decParse("0.000")!) <= 0 || decCmp(cap, decParse("10000.000")!) > 0 || (input.capMlDay.split(".")[1] ?? "").length > 3) {
      errors.cap_ml_day = "Cap must be greater than 0 and at most 10000.000 ML/day.";
    }
    const op = await client.query<{ erased: boolean; kind: string }>(
      "SELECT erased, operator_kind AS kind FROM people WHERE role = 'operator' AND operator_code = $1",
      [input.rosteredOperator],
    );
    if (!op.rows[0] || op.rows[0].erased || op.rows[0].kind !== "district") {
      errors.rostered_operator = "The rostered operator must be a district operator who has not been erased.";
    }
    const hours = (input.closes_at - input.opens_at) / 3600000;
    const overlap = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM windows WHERE channel_id = $1 AND opens_at < $2 AND closes_at > $3`,
      [channelId, new Date(input.closes_at), new Date(input.opens_at)],
    );
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
      errors.closes_at = "A window lasts a whole number of hours from 1 to 72.";
    } else if (overlap.rows[0]!.n > 0) {
      errors.closes_at = "Windows on one channel never overlap.";
    }
    if (Object.keys(errors).length > 0) throw fieldErrors(errors);

    const id = await nextWindowId(client, channelId);
    const capVol = capVolumeMl(input.capMlDay, null, null, input.opens_at, Math.round(hours));
    await client.query(
      `INSERT INTO windows (id, channel_id, opens_at, closes_at, hours, rostered_operator, cap_volume_ml, committed_ml, delivered_ml)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'0.000','0.000')`,
      [id, channelId, new Date(input.opens_at), new Date(input.closes_at), Math.round(hours), input.rosteredOperator, capVol],
    );
    // new revision holding the window's cap
    const current = await currentRevisionInTx(client, channelId);
    const currentCaps = await capsAtRevision(client, channelId, current);
    const nextRev = current + 1;
    const rev = await client.query<{ id: number }>(
      `INSERT INTO capacity_revisions (channel_id, revision, saved_at, saved_by, restored_from)
       VALUES ($1,$2,$3,$4,null) RETURNING id`,
      [channelId, nextRev, new Date(now), savedBy],
    );
    for (const [windowId, c] of currentCaps) {
      await client.query("INSERT INTO capacity_cells (revision_id, window_id, cap_ml_day) VALUES ($1,$2,$3)", [rev.rows[0]!.id, windowId, c]);
    }
    await client.query("INSERT INTO capacity_cells (revision_id, window_id, cap_ml_day) VALUES ($1,$2,$3)", [rev.rows[0]!.id, id, input.capMlDay]);
    return { windowId: id, revision: nextRev };
  });
}

async function nextWindowId(client: pg.PoolClient, channelId: string): Promise<string> {
  const prefix = channelId.replace(/^C-/, "W") + "-";
  const res = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM windows WHERE id LIKE $1",
    [`${prefix}%`],
  );
  return `${prefix}${String.fromCharCode(65 + res.rows[0]!.n)}`;
}
