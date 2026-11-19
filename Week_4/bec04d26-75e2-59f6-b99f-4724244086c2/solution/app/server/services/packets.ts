import { type Db, pool, query, transaction } from "../db";
import { PACKET_WAITING, moveStatus } from "../domain/status";
import { loadView, lockReturn } from "../store/returns";
import type { ReturnView } from "../../shared/types";
import { renderPdf } from "./gotenberg";
import { publish } from "./hub";
import { PACKET_FONTS, packetHtml } from "./packet-html";
import { markReachable } from "./status";

type Stored = "stored" | "stale" | "skipped";

/** The packet PDF for a return's current state, or `null` while Gotenberg cannot be reached. */
async function render(view: ReturnView): Promise<Buffer | null> {
  try {
    const pdf = await renderPdf(packetHtml(view, view.packet_revisions + 1), PACKET_FONTS);
    markReachable("pdf", true);
    return pdf;
  } catch {
    markReachable("pdf", false);
    return null;
  }
}

/**
 * Stores the rendered revision and moves the return to packeted, only if the return still matches what was
 * rendered (an amendment may have landed while Gotenberg worked). `bump` adds one to the version: a fixture's
 * seeded packet does not.
 */
async function store(db: Db, view: ReturnView, pdf: Buffer, bump: boolean): Promise<Stored> {
  const row = await lockReturn(db, view.id);
  const next = moveStatus("packet_ready", row.status);
  const [{ count }] = await query<{ count: number }>(db, "SELECT count(*)::int FROM amendments WHERE return_id = $1", [view.id]);
  if (!next) return "skipped";
  if (count !== view.amendments.length) return "stale";
  await db.query("INSERT INTO packet_revisions (return_id, revision, pdf) VALUES ($1, $2, $3)", [view.id, view.packet_revisions + 1, pdf]);
  await db.query("UPDATE returns SET status = $2, version = version + $3 WHERE id = $1", [view.id, next, bump ? 1 : 0]);
  return "stored";
}

/** Renders a seeded filed return inside the fixture's own transaction; if Gotenberg fails it simply stays filed. */
export async function renderSeeded(db: Db, returnId: string): Promise<void> {
  const view = await loadView(db, returnId);
  const pdf = await render(view);
  if (pdf) await store(db, view, pdf, false);
}

/** Renders one filed or amended return and tells the open screens when its packet is ready. */
async function renderWaiting(returnId: string): Promise<Stored | "failed"> {
  const view = await loadView(pool, returnId);
  const pdf = await render(view);
  if (!pdf) return "failed";
  const stored = await transaction((db) => store(db, view, pdf, true));
  if (stored === "stored") {
    const done = await loadView(pool, returnId);
    const [{ practice_id }] = await query<{ practice_id: string }>(pool, "SELECT practice_id FROM returns WHERE id = $1", [returnId]);
    publish(practice_id, { type: "return", change: "packet", by: done.changed_by, return: done }, { clientId: done.client.id });
  }
  return stored;
}

let running = false;
let again = false;

/** Renders every return still waiting for a packet; stops while Gotenberg is unreachable. */
export async function renderWaitingPackets(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const waiting = await query<{ id: string }>(pool, "SELECT id FROM returns WHERE status = ANY($1) ORDER BY id", [[...PACKET_WAITING]]);
      for (const { id } of waiting) {
        const outcome = await renderWaiting(id);
        if (outcome === "failed") return;
        if (outcome === "stale") again = true;
      }
    } while (again);
  } finally {
    running = false;
  }
}
