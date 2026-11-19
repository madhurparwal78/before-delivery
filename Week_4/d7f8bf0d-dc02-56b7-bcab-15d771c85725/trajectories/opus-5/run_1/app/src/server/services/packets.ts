import type pg from 'pg';
import type { CrewPacket, PacketState } from '../../shared/protocol.js';
import { fastClockLabel } from '../../shared/units.js';
import { pool, tx } from '../db/pool.js';
import { canonicalHash } from '../domain/hash.js';
import { snapshotBlocks, type SessionRecord } from '../domain/session.js';
import { renderPdf } from './gotenberg.js';
import { commitSession, lockSessionById } from './sessionStore.js';
import { ensureProbed } from './valkey.js';

export interface PacketContent {
  session_name: string;
  layout_version_number: number;
  timetable: { time: string; train: string; station: string }[];
  train_orders: string[];
  blocks: { number: number; name: string; kind: string; length_mm: number }[];
  diagram: { number: number; name: string; length_mm: number; state: string }[];
}

/** Packet content is built at render time from the session version and current names. */
export function buildPacketContent(record: SessionRecord): PacketContent {
  const state = record.state;
  const stationName = (id: string): string =>
    state.content.stations.find((station) => station.id === id)?.name ?? id;

  const timetable = [...state.content.timetable.entries]
    .sort((a, b) => a.depart_fast_seconds - b.depart_fast_seconds)
    .map((entry) => ({
      time: fastClockLabel(entry.depart_fast_seconds),
      train: state.trains.find((train) => train.id === entry.train_id)?.number ?? entry.train_id,
      station: stationName(entry.station_id),
    }));

  const trainOrders = state.trains.map((train) => {
    const stops = state.content.timetable.entries
      .filter((entry) => entry.train_id === train.id)
      .sort((a, b) => a.depart_fast_seconds - b.depart_fast_seconds);
    const first = stops[0];
    const last = stops[stops.length - 1];
    return `Train ${train.number} ${train.name}: run ${train.direction} from ${
      first ? stationName(first.station_id) : '—'
    } to ${last ? stationName(last.station_id) : '—'}, departing ${
      first ? fastClockLabel(first.depart_fast_seconds) : '00:00:00'
    }.`;
  });

  const blocks = snapshotBlocks(state);
  return {
    session_name: record.name,
    layout_version_number: record.layout_version_number,
    timetable,
    train_orders: trainOrders,
    blocks: blocks.map((block) => ({
      number: block.number,
      name: block.name,
      kind: block.kind,
      length_mm: block.length_mm,
    })),
    diagram: blocks.map((block) => ({
      number: block.number,
      name: block.name,
      length_mm: block.length_mm,
      state: block.state,
    })),
  };
}

export function packetContentHash(sessionVersion: number, content: PacketContent): string {
  return canonicalHash({ session_version: sessionVersion, content });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function diagramSvg(content: PacketContent): string {
  const total = content.diagram.reduce((sum, block) => sum + block.length_mm, 0) || 1;
  const width = 680;
  let x = 0;
  const parts: string[] = [];
  for (const block of content.diagram) {
    const span = Math.max(24, (block.length_mm / total) * width);
    parts.push(
      `<rect x="${x.toFixed(1)}" y="26" width="${span.toFixed(1)}" height="26" fill="#eef1fb" stroke="#1b3a94" stroke-width="2"/>` +
        `<text x="${(x + span / 2).toFixed(1)}" y="44" text-anchor="middle" font-size="11" fill="#17204a">${block.number}</text>` +
        `<text x="${(x + span / 2).toFixed(1)}" y="68" text-anchor="middle" font-size="9" fill="#17204a">${escapeHtml(
          block.name,
        )}</text>`,
    );
    x += span;
  }
  return `<svg width="${width}" height="84" viewBox="0 0 ${width} 84" xmlns="http://www.w3.org/2000/svg">
    <line x1="0" y1="39" x2="${width}" y2="39" stroke="#1b3a94" stroke-width="3"/>
    ${parts.join('')}
  </svg>`;
}

export function packetHtml(
  content: PacketContent,
  sessionVersion: number,
  contentHash: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Crew packet</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #17204a; font-size: 11pt; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 2px solid #1b3a94; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #b9c2e2; padding: 3pt 6pt; text-align: left; font-size: 10pt; }
  th { background: #eef1fb; }
  ul { margin: 0; padding-left: 14pt; }
  li { margin-bottom: 3pt; }
</style></head><body>
<h1>${escapeHtml(content.session_name)}</h1>
<p>Layout version ${content.layout_version_number} &middot; Session version ${sessionVersion}</p>
<h2>Timetable</h2>
<table><thead><tr><th>Time</th><th>Train</th><th>Station</th></tr></thead><tbody>
${content.timetable
  .map(
    (row) =>
      `<tr><td>${row.time}</td><td>${escapeHtml(row.train)}</td><td>${escapeHtml(row.station)}</td></tr>`,
  )
  .join('')}
</tbody></table>
<h2>Train orders</h2>
<ul>${content.train_orders.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
<h2>Block table</h2>
<table><thead><tr><th>Number</th><th>Name</th><th>Kind</th><th>Length (mm)</th></tr></thead><tbody>
${content.blocks
  .map(
    (block) =>
      `<tr><td>${block.number}</td><td>${escapeHtml(block.name)}</td><td>${escapeHtml(
        block.kind,
      )}</td><td>${block.length_mm}</td></tr>`,
  )
  .join('')}
</tbody></table>
<h2>Track diagram</h2>
${diagramSvg(content)}
<p style="font-size:9pt">Session version ${sessionVersion} | Content hash ${contentHash}</p>
</body></html>`;
}

export function packetFooterHtml(sessionVersion: number, contentHash: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 8pt; color: #17204a; margin: 0; }
  .line { text-align: center; width: 100%; }
</style></head><body>
<div class="line">Session version ${sessionVersion} | Content hash ${contentHash}</div>
</body></html>`;
}

interface PacketRow {
  id: string;
  state: PacketState;
  session_version: number;
  content_hash: string | null;
  failure: string | null;
  issued_by: string;
  issued_at: Date;
  ready_at: Date | null;
  byte_length: string | null;
}

const PACKET_COLUMNS = `id, state, session_version, content_hash, failure, issued_by, issued_at,
  ready_at, octet_length(pdf_bytes)::text as byte_length`;

function toPacket(row: PacketRow): CrewPacket {
  return {
    id: row.id,
    state: row.state,
    session_version: row.session_version,
    content_hash: row.content_hash,
    failure: row.failure as CrewPacket['failure'],
    issued_by: row.issued_by,
    issued_at: row.issued_at.toISOString(),
    ready_at: row.ready_at ? row.ready_at.toISOString() : null,
    byte_length: row.byte_length === null ? null : Number(row.byte_length),
  };
}

export async function listPackets(sessionId: string): Promise<CrewPacket[]> {
  const { rows } = await pool.query<PacketRow>(
    `select ${PACKET_COLUMNS} from crew_packets where session_id = $1 order by issued_at desc`,
    [sessionId],
  );
  return rows.map(toPacket);
}

export async function findPacket(
  sessionId: string,
  packetId: string,
): Promise<CrewPacket | null> {
  const { rows } = await pool.query<PacketRow>(
    `select ${PACKET_COLUMNS} from crew_packets where session_id = $1 and id = $2`,
    [sessionId, packetId],
  );
  return rows[0] ? toPacket(rows[0]) : null;
}

export async function packetBytes(
  sessionId: string,
  packetId: string,
): Promise<Buffer | null> {
  const { rows } = await pool.query<{ pdf_bytes: Buffer | null }>(
    `select pdf_bytes from crew_packets where session_id = $1 and id = $2`,
    [sessionId, packetId],
  );
  return rows[0]?.pdf_bytes ?? null;
}

async function setPacketState(
  sessionId: string,
  packetId: string,
  state: PacketState,
  failure: string | null,
): Promise<void> {
  await tx(async (client) => {
    await client.query(`update crew_packets set state = $2, failure = $3 where id = $1`, [
      packetId,
      state,
      failure,
    ]);
    const record = await lockSessionById(client, sessionId);
    if (!record) return;
    await commitSession(client, record, 'packet.changed', { packet_id: packetId, state, failure });
  });
}

/** Renders one packet: Rendering, then Ready with bytes, or Failed with none. */
async function renderPacket(sessionId: string, packetId: string): Promise<void> {
  await setPacketState(sessionId, packetId, 'Rendering', null);

  const prepared = await pool.query<{ session_version: number }>(
    `select session_version from crew_packets where id = $1`,
    [packetId],
  );
  const sessionVersion = prepared.rows[0]?.session_version ?? 1;

  let bytes: Buffer;
  let contentHash: string;
  try {
    const record = await tx(async (client) => lockSessionById(client, sessionId));
    if (!record) return;
    const content = buildPacketContent(record);
    contentHash = packetContentHash(sessionVersion, content);
    bytes = await renderPdf(
      packetHtml(content, sessionVersion, contentHash),
      packetFooterHtml(sessionVersion, contentHash),
    );
  } catch {
    await setPacketState(sessionId, packetId, 'Failed', 'gotenberg_unreachable');
    return;
  }

  if (!(await ensureProbed(0))) {
    await setPacketState(sessionId, packetId, 'Failed', 'valkey_unreachable');
    return;
  }

  await tx(async (client) => {
    await client.query(
      `update crew_packets set state = 'Ready', content_hash = $2, pdf_bytes = $3,
              ready_at = now(), failure = null
       where id = $1 and state = 'Rendering'`,
      [packetId, contentHash, bytes],
    );
    const record = await lockSessionById(client, sessionId);
    if (!record) return;
    await commitSession(client, record, 'packet.changed', {
      packet_id: packetId,
      state: 'Ready',
      content_hash: contentHash,
    });
  });
}

export async function issuePacket(
  client: pg.PoolClient,
  record: SessionRecord,
  packetId: string,
  issuedBy: string,
): Promise<CrewPacket> {
  await client.query(
    `insert into crew_packets (id, session_id, state, session_version, issued_by)
     values ($1, $2, 'Queued', $3, $4)`,
    [packetId, record.id, record.session_version, issuedBy],
  );
  await commitSession(client, record, 'packet.changed', { packet_id: packetId, state: 'Queued' });
  const { rows } = await client.query<PacketRow>(
    `select ${PACKET_COLUMNS} from crew_packets where id = $1`,
    [packetId],
  );
  return toPacket(rows[0]);
}

export function startRender(sessionId: string, packetId: string): void {
  void renderPacket(sessionId, packetId).catch(() => {
    void setPacketState(sessionId, packetId, 'Failed', 'gotenberg_unreachable');
  });
}
