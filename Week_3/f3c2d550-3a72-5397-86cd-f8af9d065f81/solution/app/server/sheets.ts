import type { Paper, Sheet, SheetStop } from "../shared/api.js";
import { sizeText, type SizeUnit } from "../shared/sizes.js";
import { isoSeconds, now } from "./clock.js";
import { query } from "./db.js";
import { ApiError, validationError } from "./errors.js";
import { PrintingFailed, PrintingUnavailable, renderPdf } from "./printing.js";
import { displayKey, newId } from "./references.js";
import { findReel } from "./reels.js";
import { isUp, setService } from "./services.js";
import { StorageUnavailable, getObject, putObject, sha256Hex, storedAs } from "./storage.js";
import { footerHtml, paperLayout, sheetHtml } from "./sheetHtml.js";

const LEASE_MS = 2 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 3;

interface SheetRow {
  id: string;
  reel_id: string;
  reel_name: string;
  state: Sheet["state"];
  paper: Paper;
  unit: SizeUnit;
  requested_at: Date;
  ready_at: Date | null;
  pdf_bytes: number | null;
  pdf_sha256: string | null;
  stops: SheetStop[];
  failed_attempts: number;
}

const pdfKey = (id: string): string => `sheets/${id}.pdf`;

function toSheet(row: SheetRow): Sheet {
  return {
    id: row.id,
    reel_id: row.reel_id,
    state: row.state,
    paper: row.paper,
    unit: row.unit,
    requested_at: isoSeconds(row.requested_at),
    ready_at: row.ready_at ? isoSeconds(row.ready_at) : null,
    pdf_url: row.state === "ready" ? `/api/sheets/${row.id}/pdf` : null,
    pdf_bytes: row.pdf_bytes,
    pdf_sha256: row.pdf_sha256,
    stops: row.stops,
  };
}

async function findSheet(id: string): Promise<SheetRow> {
  const [row] = await query<SheetRow>("SELECT * FROM contact_sheet WHERE id = $1", [id]);
  if (!row) throw new ApiError("not_found");
  return row;
}

export async function readSheet(id: string): Promise<Sheet> {
  return toSheet(await findSheet(id));
}

export async function listSheets(reelId: string): Promise<Sheet[]> {
  await findReel(reelId);
  const rows = await query<SheetRow>("SELECT * FROM contact_sheet WHERE reel_id = $1 ORDER BY seq DESC", [reelId]);
  return rows.map(toSheet);
}

interface SnapshotRow {
  id: string;
  title: string;
  maker: string | null;
  year: number | null;
  swatch: string;
  width_tenths: number;
  height_tenths: number;
  depth_tenths: number;
}

/** The sheet snapshots the reel's playable stops as they are when requested. */
export async function requestSheet(reelId: string, rawPaper: unknown, rawUnit: unknown): Promise<Sheet> {
  const reel = await findReel(reelId);
  const playable = await query<SnapshotRow>(
    `SELECT d.id, d.title, d.maker, d.year, d.swatch, d.width_tenths, d.height_tenths, d.depth_tenths
     FROM reel_stop rs JOIN deck_reference d ON d.id = rs.reference_id
     WHERE rs.reel_id = $1 AND d.state = 'stored' ORDER BY rs.position`,
    [reelId],
  );
  if (playable.length === 0) throw new ApiError("reel_empty");
  const errors: Record<string, string> = {};
  if (rawPaper !== "a4" && rawPaper !== "letter") errors.paper = "Choose A4 or US Letter.";
  if (rawUnit !== "mm" && rawUnit !== "in") errors.unit = "Choose millimetres or inches.";
  if (Object.keys(errors).length > 0) throw validationError(errors);
  const unit = rawUnit as SizeUnit;
  const stops: SheetStop[] = playable.map((row, index) => ({
    position: index + 1,
    reference_id: row.id,
    title: row.title,
    maker: row.maker,
    year: row.year,
    size_text: sizeText({ width: row.width_tenths, height: row.height_tenths, depth: row.depth_tenths }, unit),
    swatch: row.swatch,
  }));
  const id = newId("sheet");
  await query(
    `INSERT INTO contact_sheet (id, reel_id, reel_name, state, paper, unit, requested_at, stops)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7)`,
    [id, reelId, reel.name, rawPaper, unit, now(), JSON.stringify(stops)],
  );
  return readSheet(id);
}

/** failed → queued; of simultaneous retries exactly one wins. */
export async function retrySheet(id: string): Promise<Sheet> {
  const retried = await query<{ id: string }>(
    "UPDATE contact_sheet SET state = 'queued', failed_attempts = 0, lease_until = NULL WHERE id = $1 AND state = 'failed' RETURNING id",
    [id],
  );
  if (retried.length === 0) {
    await findSheet(id);
    throw new ApiError("sheet_not_failed");
  }
  return readSheet(id);
}

export async function readSheetPdf(id: string): Promise<Buffer> {
  const sheet = await findSheet(id);
  if (sheet.state !== "ready") throw new ApiError("sheet_not_ready");
  let bytes: Buffer | null;
  try {
    bytes = await getObject(pdfKey(id));
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable");
    throw error;
  }
  if (!bytes) throw new ApiError("storage_unavailable");
  return bytes;
}

async function claimNext(): Promise<SheetRow | undefined> {
  const [row] = await query<SheetRow>(
    `UPDATE contact_sheet SET state = 'rendering', lease_until = $1
     WHERE id = (
       SELECT id FROM contact_sheet
       WHERE state = 'queued' OR (state = 'rendering' AND lease_until < $2)
       ORDER BY seq FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [new Date(Date.now() + LEASE_MS), new Date()],
  );
  return row;
}

async function giveBack(id: string, failed: boolean, attempts: number): Promise<void> {
  const exhausted = failed && attempts + 1 >= MAX_FAILED_ATTEMPTS;
  await query(
    "UPDATE contact_sheet SET state = $2, failed_attempts = $3, lease_until = NULL WHERE id = $1 AND state = 'rendering'",
    [id, exhausted ? "failed" : "queued", failed ? attempts + 1 : attempts],
  );
}

async function render(row: SheetRow): Promise<void> {
  const layout = paperLayout(row.paper);
  const stops = await Promise.all(
    row.stops.map(async (stop) => ({ stop, photo: await getObject(displayKey(stop.reference_id)) })),
  );
  const pdf = await renderPdf(sheetHtml(row.reel_name, stops, layout), footerHtml(row.reel_name), layout.size, layout.margins);
  await putObject(pdfKey(row.id), pdf, "application/pdf");
  if (!(await storedAs(pdfKey(row.id), pdf))) throw new PrintingFailed("the stored PDF did not read back as written");
  await query(
    "UPDATE contact_sheet SET state = 'ready', ready_at = $2, pdf_bytes = $3, pdf_sha256 = $4, lease_until = NULL WHERE id = $1 AND state = 'rendering'",
    [row.id, now(), pdf.length, sha256Hex(pdf)],
  );
}

/** Renders the queued sheets one after another; a sheet is rendered by one app copy at a time. */
export async function renderQueued(): Promise<void> {
  while (isUp("printing") && isUp("storage")) {
    const row = await claimNext();
    if (!row) return;
    try {
      await render(row);
    } catch (error) {
      if (error instanceof PrintingUnavailable) {
        setService("printing", "down");
        await giveBack(row.id, false, row.failed_attempts);
      } else if (error instanceof StorageUnavailable) {
        setService("storage", "down");
        await giveBack(row.id, false, row.failed_attempts);
      } else if (error instanceof PrintingFailed) {
        await giveBack(row.id, true, row.failed_attempts);
      } else {
        throw error;
      }
    }
  }
}

