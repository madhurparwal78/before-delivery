import { DateTime } from 'luxon';
import { query } from '../services/database';
import { schemaSql } from './schema';
import { seedSql } from './seed-static';
import { hashPassword } from '../domain/ids';
import { torontoTz } from '../time';

interface SeedScreening {
  suffix: string;
  film: string;
  format: string;
  auditorium: string;
  dayOffset: number;
  localTime: string;
}

interface SeedSeason {
  slug: string;
  titleEn: string;
  titleFr: string;
  saleDayOffset: number;
  /** stored state; scheduled seasons derive their live state from time */
  storedState: 'scheduled' | 'draft';
  screenings: SeedScreening[];
}

interface SeedAccount {
  email: string;
  password: string;
  name: string;
  role: string;
  locale: string;
  number: string | null;
}

export async function applySchema(): Promise<void> {
  await query(schemaSql);
}

export async function applySeed(): Promise<void> {
  await query(seedSql);

  const accountCount = await query<{ count: string }>('SELECT count(*)::text AS count FROM accounts');
  if (Number(accountCount.rows[0].count) === 0) {
    const accounts: SeedAccount[] = [
      { email: 'finance@halide.example', password: 'Reel-Finance-2026!', name: 'Noor Haddad', role: 'finance', locale: 'fr', number: null },
      { email: 'door@halide.example', password: 'Reel-Door-2026!', name: 'Théo Gagnon', role: 'door', locale: 'fr', number: null },
      { email: 'programmer@halide.example', password: 'Reel-Programme-2026!', name: 'Ines Laurin', role: 'programmer', locale: 'en', number: null },
      { email: 'elise@patrons.example', password: 'Patron-Elise-2026!', name: 'Élise Tremblay', role: 'patron', locale: 'fr', number: 'A-100001' },
      { email: 'marcus@patrons.example', password: 'Patron-Marcus-2026!', name: 'Marcus Bell', role: 'patron', locale: 'en', number: 'A-100002' },
    ];
    for (const acc of accounts) {
      await query(
        `INSERT INTO accounts (number, email, password_hash, name, locale, role) VALUES ($1,$2,$3,$4,$5,$6)`,
        [acc.number, acc.email, hashPassword(acc.password), acc.name, acc.locale, acc.role],
      );
    }
  }

  const seasonCount = await query<{ count: string }>('SELECT count(*)::text AS count FROM seasons');
  if (Number(seasonCount.rows[0].count) === 0) {
    const today = DateTime.now().setZone(torontoTz).startOf('day');
    const seasons: SeedSeason[] = [
      {
        slug: 'nitrate-nights', titleEn: 'Nitrate Nights', titleFr: 'Nuits nitrate',
        saleDayOffset: -10, storedState: 'scheduled',
        screenings: [
          { suffix: '1', film: 'La Chambre ambre', format: '35mm', auditorium: 'MH2', dayOffset: 2, localTime: '19:00' },
          { suffix: '2', film: 'The Lantern Keeper', format: '35mm', auditorium: 'MH2', dayOffset: 4, localTime: '21:00' },
          { suffix: '3', film: "Sel d'argent", format: '35mm', auditorium: 'MH1', dayOffset: 6, localTime: '19:00' },
        ],
      },
      {
        slug: 'cinema-direct', titleEn: 'Direct Cinema Québec', titleFr: 'Cinéma direct québécois',
        saleDayOffset: 2, storedState: 'scheduled',
        screenings: [
          { suffix: '1', film: 'Rue des Érables, 1963', format: '16mm', auditorium: 'AC1', dayOffset: 3, localTime: '18:30' },
          { suffix: '2', film: 'Les Glaneurs du fleuve', format: '16mm', auditorium: 'AC1', dayOffset: 5, localTime: '20:00' },
        ],
      },
      {
        slug: 'winter-retrospective', titleEn: 'Winter Retrospective', titleFr: "Rétrospective d'hiver",
        saleDayOffset: 30, storedState: 'scheduled',
        screenings: [
          { suffix: '1', film: 'Neige sur Verdun', format: 'DCP', auditorium: 'MH1', dayOffset: 40, localTime: '19:00' },
          { suffix: '2', film: 'The Long Thaw', format: 'DCP', auditorium: 'MH1', dayOffset: 47, localTime: '19:00' },
        ],
      },
      {
        slug: 'spring-workshop', titleEn: 'Spring Workshop', titleFr: 'Atelier du printemps',
        saleDayOffset: 80, storedState: 'draft',
        screenings: [
          { suffix: '1', film: 'Atelier lumière', format: 'DCP', auditorium: 'AC1', dayOffset: 90, localTime: '19:00' },
        ],
      },
    ];

    for (const season of seasons) {
      const saleDate = today.plus({ days: season.saleDayOffset }).toISODate() as string;
      await query(
        `INSERT INTO seasons (slug, title_en, title_fr, public_sale_date, state) VALUES ($1,$2,$3,$4,$5)`,
        [season.slug, season.titleEn, season.titleFr, saleDate, season.storedState],
      );
      for (let i = 0; i < season.screenings.length; i++) {
        const s = season.screenings[i];
        const localDate = today.plus({ days: s.dayOffset }).toISODate() as string;
        const startsLocal = `${localDate}T${s.localTime}`;
        const startsAt = DateTime.fromISO(startsLocal, { zone: torontoTz });
        await query(
          `INSERT INTO screenings (id, season_slug, film_title, format, auditorium, starts_at, starts_local, ordinal, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'')`,
          [`${season.slug}-${s.suffix}`, season.slug, s.film, s.format, s.auditorium, startsAt.toUTC().toISO(), startsLocal, i + 1],
        );
      }
    }
  }
}
