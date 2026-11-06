import { CREW, DEPARTMENTS, SHOW_TITLE, THEATRE_NAME } from '../../shared/domain.js';
import type { Production } from '../../shared/types.js';
import { currentCycleKey, loadCycles, openingNight } from '../cycles.js';
import { pool } from '../db/pool.js';
import { config } from '../env.js';
import { json, type Reply } from '../http/reply.js';
import { serviceStatus } from '../services/monitor.js';
import { daysBetween, localDate } from '../time.js';

let ready = false;

export function markReady(): void {
  ready = true;
}

export function healthReply(): Reply {
  return ready ? json(200, { status: 'ok' }) : json(503, { status: 'starting' });
}

export function statusReply(): Reply {
  return json(200, serviceStatus());
}

export async function productionReply(): Promise<Reply> {
  const now = new Date();
  const today = localDate(config.timeZone, now);
  const opening = await openingNight(pool);
  const cycles = await loadCycles(pool);
  const body: Production = {
    theatre: THEATRE_NAME,
    show: SHOW_TITLE,
    time_zone: config.timeZone,
    today,
    opening_night: opening,
    days_to_opening: daysBetween(today, opening),
    current_cycle: currentCycleKey(cycles, now),
    departments: DEPARTMENTS.map((department) => ({
      key: department.key,
      name: department.name,
      labels: department.labels.map((label) => ({ key: label.key, name: label.name })),
    })),
    crew: CREW.map((member) => ({
      handle: member.handle,
      name: member.name,
      role: member.role,
      department: member.department,
    })),
  };
  return json(200, body);
}
