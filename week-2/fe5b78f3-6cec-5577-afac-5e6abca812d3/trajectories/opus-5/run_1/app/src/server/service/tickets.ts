import type { Database, Transaction } from '../db/pool';
import type { Quota, TravelClass } from '../domain/berths';
import { QUOTA_LABEL } from '../domain/berths';
import { formatMoney } from '../domain/money';
import type { Paise } from '../domain/money';
import type { PdfLine } from '../services/pdf';
import { renderPdf } from '../services/pdf';
import { TicketStorage } from '../services/storage';

export type TicketKind = 'booked' | 'cancellation' | 'chart';

export interface TicketPayload {
  readonly pnr: string;
  readonly train_number: string;
  readonly train_name: string;
  readonly run_date: string;
  readonly from: string;
  readonly to: string;
  readonly travel_class: TravelClass;
  readonly quota: Quota;
  readonly total_paise: Paise;
  readonly kind: TicketKind;
  readonly passengers: readonly {
    readonly number: number;
    readonly name: string;
    readonly age: number;
    readonly label: string;
  }[];
}

const KIND_TITLE: Readonly<Record<TicketKind, string>> = {
  booked: 'E-ticket — as booked',
  cancellation: 'E-ticket — after cancellation',
  chart: 'E-ticket — after chart',
};

export function ticketLines(payload: TicketPayload): PdfLine[] {
  const lines: PdfLine[] = [
    { text: 'Pakka Rail', bold: true },
    { text: KIND_TITLE[payload.kind], bold: true, gap: 6 },
    { text: `PNR ${payload.pnr}`, gap: 8 },
    { text: `Train ${payload.train_number} ${payload.train_name}` },
    { text: `Run date ${payload.run_date}` },
    { text: `From ${payload.from} to ${payload.to}` },
    { text: `Class ${payload.travel_class}` },
    { text: `Quota ${QUOTA_LABEL[payload.quota]} (${payload.quota})` },
    { text: `Total fare ${formatMoney(payload.total_paise)}`, gap: 8 },
    { text: 'Passengers', bold: true, gap: 8 },
  ];
  for (const passenger of payload.passengers) {
    lines.push({
      text: `Passenger ${passenger.number}: ${passenger.name}, age ${passenger.age}, ${passenger.label}`,
    });
  }
  return lines;
}

export function renderTicket(payload: TicketPayload): Buffer {
  return renderPdf(ticketLines(payload));
}

/** Versions are numbered per PNR in the order of their events, reserved when the event is recorded. */
export async function reserveTicketVersion(
  tx: Transaction,
  pnr: string,
  kind: TicketKind,
  createdAt: number,
  payload: TicketPayload,
): Promise<number> {
  const rows = await tx.query<{ next: number }>(
    'select coalesce(max(version), 0) + 1 as next from tickets where pnr = $1',
    [pnr],
  );
  const version = rows[0].next;
  await tx.query(
    `insert into tickets (pnr, version, kind, created_at, stored, object_key, payload)
     values ($1, $2, $3, to_timestamp($4 / 1000.0), false, $5, $6)`,
    [pnr, version, kind, createdAt, TicketStorage.objectKey(pnr, version, kind), JSON.stringify(payload)],
  );
  return version;
}

/** Stored versions stay byte-identical: a stored object is never written again. */
export async function storeReservedTicket(
  database: Database,
  storage: TicketStorage,
  pnr: string,
  version: number,
): Promise<boolean> {
  const rows = await database.query<{
    object_key: string;
    stored: boolean;
    payload: TicketPayload;
  }>('select object_key, stored, payload from tickets where pnr = $1 and version = $2', [pnr, version]);
  const ticket = rows[0];
  if (ticket === undefined || ticket.stored) return false;
  const { etag } = await storage.put(ticket.object_key, renderTicket(ticket.payload));
  const updated = await database.query<{ version: number }>(
    `update tickets set stored = true, etag = $3
     where pnr = $1 and version = $2 and stored = false
     returning version`,
    [pnr, version, etag],
  );
  return updated.length > 0;
}
