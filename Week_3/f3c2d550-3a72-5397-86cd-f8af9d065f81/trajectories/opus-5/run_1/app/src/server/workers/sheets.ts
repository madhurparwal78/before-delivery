import { createHash } from 'node:crypto';
import { SHEET_FAILURE_LIMIT } from '../domain/states.js';
import {
  claimQueuedSheet,
  markSheetFailed,
  markSheetReady,
  releaseStaleRenders,
  requeueSheet,
  type SheetRow,
} from '../db/sheets.js';
import { PrintingRefused, PrintingUnreachable, renderPdf } from '../services/printing.js';
import { printingUsable, storageUsable } from '../services/status.js';
import { buildSheetFooter, buildSheetPage } from '../services/sheetHtml.js';
import { StorageUnreachable, displayKey, getObject, putObject, sheetKey } from '../services/storage.js';

/** Renders queued contact sheets. Each sheet is rendered by one app copy at a time. */

const POLL_INTERVAL_MS = 1_500;

async function renderOne(sheet: SheetRow): Promise<void> {
  const photos = new Map<string, Buffer | null>();
  for (const stop of sheet.snapshot) {
    // A reference purged before rendering leaves its slot without a photograph.
    photos.set(stop.reference_id, await getObject(displayKey(stop.reference_id)));
  }
  const page = buildSheetPage(sheet.reel_name, sheet.snapshot, photos);
  const footer = buildSheetFooter(sheet.reel_name);
  const pdf = await renderPdf(page, footer, sheet.paper);

  const key = sheetKey(sheet.id);
  await putObject(key, pdf, 'application/pdf');
  const readBack = await getObject(key);
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  if (
    !readBack ||
    readBack.length !== pdf.length ||
    createHash('sha256').update(readBack).digest('hex') !== sha256
  ) {
    throw new PrintingRefused('the stored contact sheet did not read back byte for byte');
  }
  await markSheetReady(sheet.id, pdf.length, sha256);
}

export async function renderNextSheet(): Promise<void> {
  await releaseStaleRenders();
  if (!printingUsable() || !storageUsable()) return;
  const sheet = await claimQueuedSheet();
  if (!sheet) return;
  try {
    await renderOne(sheet);
  } catch (error) {
    if (error instanceof PrintingUnreachable || error instanceof StorageUnreachable) {
      await requeueSheet(sheet.id, false);
      return;
    }
    if (sheet.failure_count + 1 >= SHEET_FAILURE_LIMIT) {
      await markSheetFailed(sheet.id);
      return;
    }
    await requeueSheet(sheet.id, true);
  }
}

export function startSheetWorker(): void {
  const tick = (): void => {
    void renderNextSheet().catch(() => undefined);
  };
  setInterval(tick, POLL_INTERVAL_MS).unref();
}
