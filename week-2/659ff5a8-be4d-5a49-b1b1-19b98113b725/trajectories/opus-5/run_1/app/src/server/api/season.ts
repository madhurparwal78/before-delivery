import type { SeasonResponse, SeasonRow } from '../../shared/api';
import { currentYearIn } from '../domain/clubTime';
import { csvDocument } from '../domain/csv';
import { eventPointsThousandths, formatPoints } from '../domain/seasonPoints';
import { apiError } from '../http/errors';
import { json, memberRoute, type Route } from '../http/router';
import { eventStandings, fastestIndexedMs } from './standingsService';
import { clubOf, listClubEvents } from './support';
import type { ClubRow } from '../auth';

interface DriverSeason {
  driverId: string;
  driverName: string;
  carDescription: string;
  classCode: string;
  events: number;
  pointsThousandths: number;
  latestDate: string;
}

async function seasonStandings(club: ClubRow, year: number): Promise<SeasonResponse> {
  const events = (await listClubEvents(club.id)).filter(
    (event) => event.status === 'published' && event.event_date.startsWith(`${year}-`),
  );
  const drivers = new Map<string, DriverSeason>();

  for (const event of events) {
    const standings = await eventStandings(event.id);
    const fastest = fastestIndexedMs(standings);
    for (const entry of standings.entries) {
      const points = eventPointsThousandths(fastest, entry.ranked.bestIndexedMs);
      const existing = drivers.get(entry.registration.driver_id);
      if (existing) {
        existing.events += 1;
        existing.pointsThousandths += points;
        if (event.event_date >= existing.latestDate) {
          existing.latestDate = event.event_date;
          existing.carDescription = entry.registration.car_description;
          existing.classCode = entry.registration.class_code;
        }
      } else {
        drivers.set(entry.registration.driver_id, {
          driverId: entry.registration.driver_id,
          driverName: entry.registration.driver_name,
          carDescription: entry.registration.car_description,
          classCode: entry.registration.class_code,
          events: 1,
          pointsThousandths: points,
          latestDate: event.event_date,
        });
      }
    }
  }

  const ordered = [...drivers.values()].sort((a, b) => {
    if (a.pointsThousandths !== b.pointsThousandths) {
      return b.pointsThousandths - a.pointsThousandths;
    }
    return a.driverName.localeCompare(b.driverName);
  });
  const rows: SeasonRow[] = ordered.map((driver, index) => ({
    position: index + 1,
    driverId: driver.driverId,
    driverName: driver.driverName,
    carDescription: driver.carDescription,
    classCode: driver.classCode,
    events: driver.events,
    points: formatPoints(driver.pointsThousandths),
  }));
  return {
    year,
    events: events.map((event) => ({ id: event.id, name: event.name, date: event.event_date })),
    rows,
  };
}

function readYear(value: string | null, club: ClubRow, now: Date): number {
  if (value === null) return currentYearIn(club.time_zone, now);
  if (!/^\d{4}$/.test(value)) {
    throw apiError.validation({ year: 'Year must be four digits.' });
  }
  return Number.parseInt(value, 10);
}

export const seasonRoutes: Route[] = [
  memberRoute('GET', '/api/season', async (ctx) => {
    const club = clubOf(ctx.actor);
    const year = readYear(ctx.searchParams.get('year'), club, ctx.now);
    return json(200, await seasonStandings(club, year));
  }),

  memberRoute('GET', '/api/season.csv', async (ctx) => {
    const club = clubOf(ctx.actor);
    const year = readYear(ctx.searchParams.get('year'), club, ctx.now);
    const standings = await seasonStandings(club, year);
    const csv = csvDocument(
      ['Position', 'Driver', 'Car', 'Class', 'Events', 'Points'],
      standings.rows.map((row) => [
        String(row.position),
        row.driverName,
        row.carDescription,
        row.classCode,
        String(row.events),
        row.points,
      ]),
    );
    return {
      status: 200,
      body: Buffer.from(csv, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      headers: [
        [
          'Content-Disposition',
          `attachment; filename="season-standings-${year}.csv"`,
        ] as [string, string],
      ],
    };
  }),
];
