import { q, one } from './db.js';
import { settings } from './settings.js';
import { clockNow } from './clock.js';
import * as bus from './live.js';
import { processReminders } from './reminders.js';
import { stockPayload } from './routes/stock.js';
import { boardBeacons, boardTreatments } from './routes/ward.js';

// One tick: evaluates every server-clock-dependent state and pushes changes.
// After a grading-clock jump this runs before the route answers.
let lastTick: number = 0;
const lastBeacons = new Map<string, any>();

export async function runTick(force = false): Promise<void> {
  const nowMs = clockNow().getTime();
  if (!force && nowMs - lastTick < 1000) return;
  lastTick = nowMs;

  await processReminders();

  const clinics = await q(`select id from clinics`);
  for (const clinic of clinics.rows) {
    const clinicId = clinic.id;
    const beacons = await boardBeacons(clinicId);
    const prev = lastBeacons.get(clinicId);
    if (force || JSON.stringify(prev) !== JSON.stringify(beacons)) {
      lastBeacons.set(clinicId, beacons);
      bus.pushClinic(clinicId, 'beacons', { beacons });
      // An overdue crossing is announced in every open window showing a beacon.
      if (prev && beacons.overdue > prev.overdue) {
        const doses = await boardOverdueDoses(clinicId);
        if (doses.length > 0) {
          const earliest = doses[0];
          bus.pushClinic(clinicId, 'announcement', {
            text: `Overdue now ${beacons.overdue}. ${earliest.patientName}, ${earliest.name} due ${earliest.time}.`,
          });
        }
      }
    }
    await checkLowStock(clinicId);
  }
}

async function boardOverdueDoses(clinicId: string): Promise<{ patientName: string; name: string; time: string }[]> {
  const doses = await boardTreatments(clinicId);
  return doses
    .filter((d: any) => d.status === 'overdue')
    .map((d: any) => ({
      patientName: d.patientName,
      name: d.name,
      time: clinicTime(new Date(d.scheduledAt)),
    }));
}

function clinicTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace('24:', '00:');
}

// The low alert fires once per crossing from above to at or below.
async function checkLowStock(clinicId: string): Promise<void> {
  const items = await stockPayload(clinicId);
  for (const item of items) {
    const row = await one(`select low_alerted from stock_items where id = $1`, [item.id]);
    if (!row) continue;
    if (item.usable <= item.reorderPoint && !row.low_alerted) {
      await q(`update stock_items set low_alerted = true where id = $1`, [item.id]);
      bus.pushClinic(clinicId, 'announcement', { text: `${item.name} is low: ${item.usable} left.`, managersOnly: true });
    } else if (item.usable > item.reorderPoint && row.low_alerted) {
      await q(`update stock_items set low_alerted = false where id = $1`, [item.id]);
    }
  }
}

export function startLoop(): void {
  setInterval(() => {
    runTick().catch((e) => console.error('tick failed', e));
  }, 1000);
  setInterval(() => {
    import('./mail.js').then((m) => m.flushMail()).catch(() => {});
  }, 5000);
}
