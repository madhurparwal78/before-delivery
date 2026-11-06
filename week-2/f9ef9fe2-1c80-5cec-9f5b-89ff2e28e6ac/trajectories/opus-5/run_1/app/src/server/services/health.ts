import type { PausedAction, ServiceHealth, ServiceName, StatusView } from '../../shared/types.js';
import { DOCUMENT_LABELS, type DocumentType } from '../../shared/types.js';
import { pool, query } from '../db/pool.js';
import { onePagePdf } from '../db/pdf.js';
import { probeBilling } from './killbill.js';
import { probeMail } from './smtp.js';
import { probeStorage, putDocumentFile } from './storage.js';

const PAUSED_BY_SERVICE: Record<ServiceName, PausedAction[]> = {
  billing: ['confirm_booking', 'create_series', 'cancel_booking', 'buy_pack'],
  files: ['upload_document', 'view_document'],
  mail: ['confirm_booking', 'create_series', 'cancel_booking'],
};

const ACTION_ORDER: PausedAction[] = [
  'confirm_booking',
  'create_series',
  'cancel_booking',
  'buy_pack',
  'upload_document',
  'view_document',
];

const state: Record<ServiceName, ServiceHealth> = { billing: 'up', files: 'up', mail: 'up' };

export function serviceHealth(service: ServiceName): ServiceHealth {
  return state[service];
}

export function markService(service: ServiceName, health: ServiceHealth): void {
  state[service] = health;
}

export function statusView(): StatusView {
  const paused = new Set<PausedAction>();
  for (const service of Object.keys(state) as ServiceName[]) {
    if (state[service] === 'down') {
      for (const action of PAUSED_BY_SERVICE[service]) paused.add(action);
    }
  }
  return {
    services: { ...state },
    paused: ACTION_ORDER.filter((action) => paused.has(action)),
  };
}

/** Runs a real service call, keeping the health state honest either way. */
export async function withService<T>(service: ServiceName, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    markService(service, 'up');
    return result;
  } catch (error) {
    markService(service, 'down');
    throw error;
  }
}

async function probe(service: ServiceName, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    const wasDown = state[service] === 'down';
    markService(service, 'up');
    if (service === 'files' && wasDown) await writeSeededFiles();
  } catch {
    markService(service, 'down');
  }
}

/** Seeded documents get their generated file the first time storage is reachable. */
export async function writeSeededFiles(): Promise<void> {
  const pending = await query<{
    id: string;
    storage_key: string;
    type: DocumentType;
    business: string;
  }>(
    pool,
    `SELECT d.id, d.storage_key, d.type, m.business
       FROM documents d JOIN members m ON m.id = d.member_id
      WHERE d.file_stored = false`,
  );
  for (const document of pending) {
    const bytes = onePagePdf(DOCUMENT_LABELS[document.type], `${document.business} — Pilotlight`);
    await putDocumentFile(document.storage_key, bytes, 'application/pdf');
    await pool.query('UPDATE documents SET file_stored = true WHERE id = $1', [document.id]);
  }
}

async function sweep(): Promise<void> {
  await Promise.all([
    probe('billing', probeBilling),
    probe('files', probeStorage),
    probe('mail', probeMail),
  ]);
}

export function startHealthMonitor(): void {
  void sweep().then(() => writeSeededFiles().catch(() => undefined));
  setInterval(() => {
    void sweep();
  }, 10000).unref();
}
