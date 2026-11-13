// Channel capacity tables: revisions, conflicting saves settling to the lower cap, restores, and
// creating windows (which adds a revision holding the new window's cap).
import type { User } from "./auth.ts";
import { tx, type Db } from "./db.ts";
import { CAP_MAX, formatMl, lower, parseMl, type Milli } from "./decimal.ts";
import { ApiError, FieldErrors, asRecord, notFound } from "./http.ts";
import { capVolumeOf, loadWindow, loadWindows, windowRecord, type WindowFigures } from "./records.ts";
import { nextNumber } from "./schema.ts";
import { HOUR, isoInstant, parseInstant } from "./time.ts";

const capError = "Enter a cap above 0 and at most 10000.000 ML/day, with up to three decimals.";

async function currentRevision(db: Db, channelId: string): Promise<number | null> {
  const found = await db.query<{ capacity_revision: number }>("SELECT capacity_revision FROM channel WHERE id = $1", [channelId]);
  return found.rows[0]?.capacity_revision ?? null;
}

async function channelWindows(db: Db, channelId: string): Promise<WindowFigures[]> {
  return loadWindows(db, "WHERE w.channel_id = $1", [channelId]);
}

function cellsOf(windows: WindowFigures[]) {
  return windows.map((w) => ({ window_id: w.id, cap_ml_day: formatMl(w.table_cap_milli) }));
}

/** Stores the next revision holding every window's current table cap. */
async function recordRevision(db: Db, channelId: string, savedBy: string, restoredFrom: number | null): Promise<number> {
  const bumped = await db.query<{ capacity_revision: number }>(
    "UPDATE channel SET capacity_revision = capacity_revision + 1 WHERE id = $1 RETURNING capacity_revision",
    [channelId],
  );
  const revision = bumped.rows[0]!.capacity_revision;
  await db.query(
    "INSERT INTO capacity_revision (channel_id, revision, saved_at, saved_by, restored_from) VALUES ($1, $2, now(), $3, $4)",
    [channelId, revision, savedBy, restoredFrom],
  );
  await db.query(
    `INSERT INTO capacity_cell (channel_id, revision, window_id, cap_milli)
     SELECT channel_id, $2, id, table_cap_milli FROM delivery_window WHERE channel_id = $1`,
    [channelId, revision],
  );
  return revision;
}

/** A table cap may not cut a window's cap volume below what it has already committed. */
function coversCommitted(w: WindowFigures, tableCap: Milli): boolean {
  return capVolumeOf(w, tableCap) >= w.committed_milli;
}

async function setTableCap(db: Db, windowId: string, cap: Milli): Promise<void> {
  await db.query("UPDATE delivery_window SET table_cap_milli = $2 WHERE id = $1", [windowId, cap]);
}

export async function getCapacity(db: Db, channelId: string) {
  const revision = await currentRevision(db, channelId);
  if (revision === null) throw notFound();
  const revisions = await db.query<{ revision: number; saved_at: Date; saved_by: string; restored_from: number | null }>(
    "SELECT revision, saved_at, saved_by, restored_from FROM capacity_revision WHERE channel_id = $1 ORDER BY revision DESC",
    [channelId],
  );
  return {
    revision,
    cells: cellsOf(await channelWindows(db, channelId)),
    revisions: revisions.rows.map((r) => ({ ...r, saved_at: isoInstant(r.saved_at) })),
  };
}

export async function saveCapacity(user: User, channelId: string, body: unknown) {
  const input = asRecord(body);
  const outcome = await tx(async (db) => {
    const current = await currentRevision(db, channelId);
    if (current === null) throw notFound();
    const windows = new Map((await channelWindows(db, channelId)).map((w) => [w.id, w]));
    const errors = new FieldErrors();
    if (!Number.isInteger(input.base_revision)) errors.add("base_revision", "Give the revision you edited.");
    if (!Array.isArray(input.cells)) errors.add("cells", "Give the cells you changed.");
    const submitted = new Map<string, Milli>();
    for (const cell of Array.isArray(input.cells) ? input.cells : []) {
      const { window_id: id, cap_ml_day: value } = asRecord(cell);
      const field = `cells.${String(id)}`;
      const w = typeof id === "string" ? windows.get(id) : undefined;
      const cap = parseMl(value);
      if (!w) errors.add(field, "This window is not on this channel.");
      else if (w.status === "closed") errors.add(field, "Closed windows keep their cap.");
      else if (cap === null || cap <= 0n || cap > CAP_MAX) errors.add(field, capError);
      else if (!coversCommitted(w, cap)) errors.add(field, `Below the ${formatMl(w.committed_milli)} ML already committed.`);
      else submitted.set(w.id, cap);
    }
    errors.throwIfAny();

    const conflict = input.base_revision !== current;
    for (const [id, cap] of submitted) {
      await setTableCap(db, id, conflict ? lower(windows.get(id)!.table_cap_milli, cap) : cap);
    }
    const revision = await recordRevision(db, channelId, user.name, null);
    return { conflict, revision, cells: cellsOf(await channelWindows(db, channelId)), submitted };
  });
  if (!outcome.conflict) return { revision: outcome.revision, cells: outcome.cells };
  throw new ApiError(409, "revision_conflict", "Another dispatcher saved first. Each cap settled to the lower value.", {
    revision: outcome.revision,
    cells: outcome.cells,
    submitted: [...outcome.submitted].map(([id, cap]) => ({ window_id: id, cap_ml_day: formatMl(cap) })),
  });
}

export async function restoreRevision(user: User, channelId: string, revision: number) {
  return tx(async (db) => {
    if ((await currentRevision(db, channelId)) === null) throw notFound();
    const old = await db.query<{ window_id: string; cap_milli: Milli }>(
      "SELECT window_id, cap_milli FROM capacity_cell WHERE channel_id = $1 AND revision = $2",
      [channelId, revision],
    );
    if (!old.rowCount) throw notFound();
    const windows = new Map((await channelWindows(db, channelId)).map((w) => [w.id, w]));
    const restored = old.rows.filter((cell) => windows.get(cell.window_id)!.status !== "closed");
    const below = restored.filter((cell) => !coversCommitted(windows.get(cell.window_id)!, cell.cap_milli)).map((c) => c.window_id);
    if (below.length) {
      throw new ApiError(409, "restore_below_committed",
        `Restoring revision ${revision} would cut below what is already committed.`, { windows: below });
    }
    for (const cell of restored) await setTableCap(db, cell.window_id, cell.cap_milli);
    const next = await recordRevision(db, channelId, user.name, revision);
    return { revision: next, restored_from: revision, cells: cellsOf(await channelWindows(db, channelId)) };
  });
}

export async function createWindow(user: User, channelId: string, body: unknown) {
  const input = asRecord(body);
  return tx(async (db) => {
    if ((await currentRevision(db, channelId)) === null) throw notFound();
    const errors = new FieldErrors();
    const opensAt = parseInstant(input.opens_at);
    const closesAt = parseInstant(input.closes_at);
    if (!opensAt) errors.add("opens_at", "Give the opening instant as ISO 8601 UTC.");
    if (!closesAt) errors.add("closes_at", "Give the closing instant as ISO 8601 UTC.");
    const hours = opensAt && closesAt ? (closesAt.getTime() - opensAt.getTime()) / HOUR : 0;
    if (opensAt && closesAt) {
      if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
        errors.add("closes_at", "A window lasts a whole number of hours from 1 to 72.");
      } else {
        const overlap = await db.query(
          "SELECT 1 FROM delivery_window WHERE channel_id = $1 AND opens_at < $3 AND $2 < closes_at",
          [channelId, opensAt, closesAt],
        );
        if (overlap.rowCount) errors.add("closes_at", "This window overlaps another window on the channel.");
      }
    }
    const cap = parseMl(input.cap_ml_day);
    if (cap === null || cap <= 0n || cap > CAP_MAX) errors.add("cap_ml_day", capError);
    const rostered = await db.query(
      "SELECT 1 FROM person WHERE operator_code = $1 AND operator_kind = 'district' AND NOT erased",
      [typeof input.rostered_operator === "string" ? input.rostered_operator : null],
    );
    if (!rostered.rowCount) {
      errors.add("rostered_operator", "Choose a district operator.");
    }
    errors.throwIfAny();
    const id = `W-${channelId.replace(/^C-/, "")}-${String(await nextNumber(db, "window")).padStart(4, "0")}`;
    await db.query(
      `INSERT INTO delivery_window (id, channel_id, opens_at, closes_at, hours, table_cap_milli, rostered_operator)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, channelId, opensAt, closesAt, hours, cap, input.rostered_operator],
    );
    const capacityRevision = await recordRevision(db, channelId, user.name, null);
    return { window: windowRecord((await loadWindow(db, id))!), capacity_revision: capacityRevision };
  });
}
