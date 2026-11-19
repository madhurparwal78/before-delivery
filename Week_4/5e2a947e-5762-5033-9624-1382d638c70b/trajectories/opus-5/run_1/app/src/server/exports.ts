import { boundingBox, layoutMap, wrapTitle, ROOT_WRAP, TOPIC_WRAP } from '../shared/layout.js';
import { escapeHtml } from '../shared/notes.js';
import { outlineFromMap, serializeOutline } from '../shared/outline.js';
import { colourHex, derivedColour, derivedShape, derivedTextColour } from '../shared/style.js';
import { hiddenSet, visibleTopics } from '../shared/tree.js';
import { nextExportProgress } from '../shared/states.js';
import type { ExportFormat, ExportState, Role } from '../shared/types.js';
import { publish } from './bus.js';
import { now, nowMs } from './clock.js';
import { db } from './db.js';
import { loadMap, type MapRow } from './mapstore.js';
import { putObject, objectExists, storageKeys, StorageError } from './storage.js';
import { settings } from './settings.js';
import { can } from '../shared/permissions.js';

export interface ExportRow {
  id: string;
  map_id: string;
  actor: string;
  format: ExportFormat;
  topic_id: string | null;
  state: ExportState;
  progress: number;
}

export function exportJson(row: ExportRow, ready: boolean): Record<string, unknown> {
  return {
    id: row.id,
    state: row.state,
    progress: row.progress,
    format: row.format,
    download_url: ready ? `/api/exports/${row.id}/download` : null,
  };
}

export function buildSprig(map: MapRow, role: Role, topicId: string | null): string {
  const view = {
    doc: map.doc,
    collapsed: new Set<string>(),
    hidden: hiddenSet(map.doc, can(role, 'see_restricted')),
  };
  return serializeOutline(outlineFromMap(view, topicId));
}

export function buildSvg(map: MapRow, role: Role, topicId: string | null): string {
  const hidden = hiddenSet(map.doc, can(role, 'see_restricted'));
  const view = { doc: map.doc, collapsed: new Set<string>(), hidden };
  const layout = layoutMap(view, map.doc.layout);
  const wanted = new Set(
    topicId === null
      ? visibleTopics(view)
      : visibleTopics(view).filter(
          (id) => id === topicId || isUnder(map, id, topicId),
        ),
  );
  const boxes = [...layout.values()].filter((laid) => wanted.has(laid.id));
  const bounds = boundingBox(new Map(boxes.map((box) => [box.id, box] as const))) ?? {
    x: 0,
    y: 0,
    w: 100,
    h: 100,
  };
  const pad = 24;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(bounds.w + pad * 2)}" height="${Math.round(bounds.h + pad * 2)}" viewBox="${Math.round(bounds.x - pad)} ${Math.round(bounds.y - pad)} ${Math.round(bounds.w + pad * 2)} ${Math.round(bounds.h + pad * 2)}">`,
  );
  parts.push('<rect x="-100000" y="-100000" width="200000" height="200000" fill="#ffffff"/>');
  for (const box of boxes) {
    const topic = map.doc.topics[box.id];
    const parent = topic.parent_id;
    if (parent === null || !wanted.has(parent)) continue;
    const from = layout.get(parent);
    if (!from) continue;
    const colour = colourHex(derivedColour(map.doc, box.id));
    parts.push(
      `<path d="M ${from.x} ${from.y} L ${box.x} ${box.y}" fill="none" stroke="${colour}" stroke-width="3"/>`,
    );
  }
  for (const box of boxes) {
    const topic = map.doc.topics[box.id];
    const colourName = derivedColour(map.doc, box.id);
    const shape = derivedShape(map.doc, box.id, map.doc.theme);
    const colour = colourHex(colourName);
    const textColour = derivedTextColour(colourName, shape) === 'white' ? '#ffffff' : '#1a1526';
    const filled = shape === 'filled' || shape === 'rounded';
    const left = box.x - box.w / 2;
    const top = box.y - box.h / 2;
    parts.push(
      `<g data-topic-id="${escapeHtml(box.id)}" data-x="${box.x}" data-y="${box.y}" data-w="${box.w}" data-h="${box.h}">`,
    );
    parts.push(
      `<rect x="${left}" y="${top}" width="${box.w}" height="${box.h}" rx="10" fill="${filled ? colour : '#ffffff'}" stroke="${colour}" stroke-width="3"/>`,
    );
    const lines = wrapTitle(topic.title, box.id === map.doc.root ? ROOT_WRAP : TOPIC_WRAP);
    lines.forEach((line, index) => {
      const y = top + box.h / 2 - ((lines.length - 1) * 20) / 2 + index * 20 + 5;
      parts.push(
        `<text x="${box.x}" y="${y}" text-anchor="middle" font-family="Figtree, sans-serif" font-size="14" fill="${filled ? textColour : '#1a1526'}">${escapeHtml(line)}</text>`,
      );
    });
    parts.push('</g>');
  }
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

function isUnder(map: MapRow, id: string, ancestor: string): boolean {
  let current = map.doc.topics[id]?.parent_id ?? null;
  while (current !== null) {
    if (current === ancestor) return true;
    current = map.doc.topics[current]?.parent_id ?? null;
  }
  return false;
}

export async function writeExport(row: ExportRow): Promise<void> {
  const map = await loadMap(db, row.map_id);
  if (!map) throw new StorageError('that map is gone');
  const role = await roleOfActor(row.map_id, row.actor);
  const body =
    row.format === 'sprig'
      ? buildSprig(map, role, row.topic_id)
      : buildSvg(map, role, row.topic_id);
  const key = storageKeys.exportObject(row.map_id, row.id, row.format);
  await putObject(
    key,
    Buffer.from(body, 'utf8'),
    row.format === 'sprig' ? 'text/plain; charset=utf-8' : 'image/svg+xml',
  );
  if (!(await objectExists(key))) throw new StorageError('the export was not stored');
}

async function roleOfActor(mapId: string, actorKey: string): Promise<Role> {
  const owner = await db.query<{ owner: string }>(
    'select u.username as owner from maps m join users u on u.id = m.owner_id where m.id = $1',
    [mapId],
  );
  if (owner.rows[0]?.owner === actorKey) return 'owner';
  const member = await db.query<{ role: Role }>(
    'select role from members where map_id = $1 and username = $2',
    [mapId, actorKey],
  );
  if (member.rows[0]) return member.rows[0].role;
  const guest = await db.query<{ role: Role }>(
    'select role from guests where $2 = concat(\'g:\', id) and map_id = $1',
    [mapId, actorKey],
  );
  return guest.rows[0]?.role ?? 'viewer';
}

/** Advances every export job whose next step has arrived on server time. */
export async function advanceExports(): Promise<void> {
  const due = await db.query<ExportRow & { next_step_at: Date }>(
    `select id, map_id, actor, format, topic_id, state, progress, next_step_at
       from export_jobs
      where state in ('queued', 'running') and next_step_at is not null and next_step_at <= $1`,
    [now()],
  );
  for (const row of due.rows) {
    // Every step whose instant has passed applies at once.
    let progress = row.progress;
    let stepAt = row.next_step_at.getTime();
    while (nextExportProgress(progress) < 100 && stepAt <= nowMs()) {
      progress = nextExportProgress(progress);
      stepAt += settings.exportStepMs;
      await db.query(
        "update export_jobs set state = 'running', progress = $2, next_step_at = $3 where id = $1",
        [row.id, progress, new Date(stepAt)],
      );
      await publishExport({ ...row, state: 'running', progress }, false);
    }
    if (nextExportProgress(progress) < 100 || stepAt > nowMs()) continue;
    try {
      await writeExport(row);
      await db.query(
        "update export_jobs set state = 'ready', progress = 100, next_step_at = null where id = $1",
        [row.id],
      );
      await publishExport({ ...row, state: 'ready', progress: 100 }, true);
    } catch {
      await db.query(
        "update export_jobs set state = 'failed', progress = 80, next_step_at = null where id = $1",
        [row.id],
      );
      await publishExport({ ...row, state: 'failed', progress: 80 }, false);
    }
  }
}

export async function publishExport(row: ExportRow, ready: boolean): Promise<void> {
  await publish(row.map_id, {
    type: 'export',
    recipient: row.actor,
    payload: { export: exportJson(row, ready) },
  });
}
