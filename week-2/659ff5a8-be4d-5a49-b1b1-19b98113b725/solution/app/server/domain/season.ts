import type { Season, SeasonRow } from "../../shared/api.js";
import { formatMs, seasonPointsMs } from "../../shared/rules.js";
import { localDate } from "../../shared/time.js";
import type { ClubAuth } from "../auth.js";
import { csvText } from "../csv.js";
import { pool, rows } from "../db.js";
import { validationError } from "../errors.js";
import { loadEntries, rankEntries } from "./standings.js";

interface Standing {
  driverId: number;
  driverName: string;
  carDescription: string;
  classCode: string;
  latest: string;
  events: number;
  points: number;
}

function yearOf(auth: ClubAuth, text: string | undefined): number {
  if (text === undefined) return Number(localDate(new Date(), auth.club.timeZone).slice(0, 4));
  if (!/^\d{4}$/.test(text)) throw validationError({ year: "Give the season year as four digits." });
  return Number(text);
}

export async function season(auth: ClubAuth, yearText: string | undefined): Promise<Season> {
  const year = yearOf(auth, yearText);
  const events = await rows<{ id: number; name: string; date: string }>(
    pool,
    `select id, name, date from events
      where club_id = $1 and status = 'published' and date >= $2 and date < $3 order by date, id`,
    [auth.club.id, `${year}-01-01`, `${year + 1}-01-01`],
  );
  const drivers = new Map<number, Standing>();
  for (const event of events) {
    const ranked = rankEntries(await loadEntries(pool, event.id));
    const fastest = Math.min(...ranked.flatMap((e) => (e.bestIndexedMs === null ? [] : [e.bestIndexedMs])));
    for (const entry of ranked) {
      const earned = seasonPointsMs(fastest, entry.bestIndexedMs);
      const known = drivers.get(entry.driverId);
      const counted = { events: (known?.events ?? 0) + 1, points: (known?.points ?? 0) + earned };
      const current = { carDescription: entry.carDescription, classCode: entry.classCode, latest: event.date };
      const car = known === undefined || event.date >= known.latest ? current : known;
      drivers.set(entry.driverId, {
        driverId: entry.driverId,
        driverName: entry.driverName,
        carDescription: car.carDescription,
        classCode: car.classCode,
        latest: car.latest,
        ...counted,
      });
    }
  }
  const ordered = [...drivers.values()].sort((a, b) => b.points - a.points || a.driverName.localeCompare(b.driverName, "en"));
  const seasonRows: SeasonRow[] = ordered.map((d, index) => ({
    position: index + 1,
    driverId: d.driverId,
    driverName: d.driverName,
    carDescription: d.carDescription,
    classCode: d.classCode,
    events: d.events,
    points: formatMs(d.points),
  }));
  return { year, events, rows: seasonRows };
}

export async function seasonCsv(auth: ClubAuth, yearText: string | undefined): Promise<{ year: number; text: string }> {
  const result = await season(auth, yearText);
  const header = ["Position", "Driver", "Car", "Class", "Events", "Points"];
  const body = result.rows.map((r) => [r.position, r.driverName, r.carDescription, r.classCode, r.events, r.points]);
  return { year: result.year, text: csvText([header, ...body]) };
}
