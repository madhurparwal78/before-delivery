import { hashPassword } from '../domain/passwords.ts';
import { instantFromToronto, torontoParts, addCalendarDays } from '../domain/time.ts';
import { type Tx } from './pool.ts';

type SeedScreening = {
  film: string;
  format: string;
  auditorium: string;
  dayOffset: number;
  hour: number;
  minute: number;
  notesEn: string;
  notesFr: string;
};

type SeedSeason = {
  slug: string;
  titleEn: string;
  titleFr: string;
  saleOffset: number;
  state: 'draft' | 'scheduled';
  screenings: SeedScreening[];
};

const SEASONS: SeedSeason[] = [
  {
    slug: 'nitrate-nights',
    titleEn: 'Nitrate Nights',
    titleFr: 'Nuits nitrate',
    saleOffset: -10,
    state: 'scheduled',
    screenings: [
      {
        film: 'La Chambre ambre',
        format: '35mm',
        auditorium: 'MH2',
        dayOffset: 2,
        hour: 19,
        minute: 0,
        notesEn: 'A lacquered chamber drama printed on nitrate stock and projected from a single surviving reel.',
        notesFr: 'Un huis clos laqué tiré sur pellicule nitrate et projeté depuis la seule bobine survivante.',
      },
      {
        film: 'The Lantern Keeper',
        format: '35mm',
        auditorium: 'MH2',
        dayOffset: 4,
        hour: 21,
        minute: 0,
        notesEn: 'Hand-tinted seascapes from a studio that burned down twice.',
        notesFr: 'Des marines teintées à la main par un studio incendié deux fois.',
      },
      {
        film: "Sel d'argent",
        format: '35mm',
        auditorium: 'MH1',
        dayOffset: 6,
        hour: 19,
        minute: 0,
        notesEn: 'Silver halide crystals photographed at the grain, then blown up to the full frame.',
        notesFr: "Des cristaux d'halogénure d'argent filmés au grain, puis agrandis plein cadre.",
      },
    ],
  },
  {
    slug: 'cinema-direct',
    titleEn: 'Direct Cinema Québec',
    titleFr: 'Cinéma direct québécois',
    saleOffset: 2,
    state: 'scheduled',
    screenings: [
      {
        film: 'Rue des Érables, 1963',
        format: '16mm',
        auditorium: 'AC1',
        dayOffset: 3,
        hour: 18,
        minute: 30,
        notesEn: 'A winter street, a borrowed Nagra and twelve neighbours who agreed to be filmed.',
        notesFr: "Une rue d'hiver, un Nagra emprunté et douze voisins qui ont accepté d'être filmés.",
      },
      {
        film: 'Les Glaneurs du fleuve',
        format: '16mm',
        auditorium: 'AC1',
        dayOffset: 5,
        hour: 20,
        minute: 0,
        notesEn: 'Eel fishers of the lower river, recorded over one open-water season.',
        notesFr: "Pêcheurs d'anguilles du fleuve, enregistrés sur une saison d'eau libre.",
      },
    ],
  },
  {
    slug: 'winter-retrospective',
    titleEn: 'Winter Retrospective',
    titleFr: "Rétrospective d'hiver",
    saleOffset: 30,
    state: 'scheduled',
    screenings: [
      {
        film: 'Neige sur Verdun',
        format: 'DCP',
        auditorium: 'MH1',
        dayOffset: 40,
        hour: 19,
        minute: 0,
        notesEn: 'A borough under snow, scanned from the original negative at 4K.',
        notesFr: 'Un arrondissement sous la neige, numérisé en 4K depuis le négatif original.',
      },
      {
        film: 'The Long Thaw',
        format: 'DCP',
        auditorium: 'MH1',
        dayOffset: 47,
        hour: 19,
        minute: 0,
        notesEn: 'Six weeks of melt, one fixed camera and a soundtrack of running water.',
        notesFr: 'Six semaines de fonte, une caméra fixe et une trame sonore d\u2019eau courante.',
      },
    ],
  },
  {
    slug: 'spring-workshop',
    titleEn: 'Spring Workshop',
    titleFr: 'Atelier du printemps',
    saleOffset: 80,
    state: 'draft',
    screenings: [
      {
        film: 'Atelier lumière',
        format: 'DCP',
        auditorium: 'AC1',
        dayOffset: 90,
        hour: 19,
        minute: 0,
        notesEn: 'A workshop print, shown once to its makers and once to the public.',
        notesFr: 'Une copie de travail, montrée une fois à ses auteurs et une fois au public.',
      },
    ],
  },
];

const ACCOUNTS: Array<{ email: string; password: string; name: string; role: string; number: string | null; locale: string }> = [
  { email: 'finance@halide.example', password: 'Reel-Finance-2026!', name: 'Noor Haddad', role: 'finance', number: null, locale: 'fr' },
  { email: 'door@halide.example', password: 'Reel-Door-2026!', name: 'Théo Gagnon', role: 'door', number: null, locale: 'fr' },
  { email: 'programmer@halide.example', password: 'Reel-Programme-2026!', name: 'Ines Laurin', role: 'programmer', number: null, locale: 'en' },
  { email: 'elise@patrons.example', password: 'Patron-Elise-2026!', name: 'Élise Tremblay', role: 'patron', number: 'A-100001', locale: 'fr' },
  { email: 'marcus@patrons.example', password: 'Patron-Marcus-2026!', name: 'Marcus Bell', role: 'patron', number: 'A-100002', locale: 'en' },
];

export async function seedIfEmpty(tx: Tx): Promise<boolean> {
  const existing = await tx.one<{ count: number }>('select count(*)::int as count from seasons');
  if (existing !== null && existing.count > 0) return false;

  const venues = [
    { name: 'Maison Halide', address: '1450 rue de la Pellicule, Montréal' },
    { name: 'Annexe Clark', address: '62 rue Argentique, Montréal' },
  ];
  const venueIds: number[] = [];
  for (const venue of venues) {
    const row = await tx.one<{ id: number }>('insert into venues(name, address) values($1,$2) returning id', [
      venue.name,
      venue.address,
    ]);
    venueIds.push(row!.id);
  }

  const auditoriums = [
    { code: 'MH1', name: 'Salle Lumière', venue: 0, rows: 'ABCDEFGHIJ', seats: 14 },
    { code: 'MH2', name: 'Salle Nitrate', venue: 0, rows: 'ABCD', seats: 6 },
    { code: 'AC1', name: 'Studio Clark', venue: 1, rows: 'ABCDEF', seats: 8 },
  ];
  for (const auditorium of auditoriums) {
    await tx.query(
      'insert into auditoriums(code, name, venue_id, row_letters, seats_per_row, capacity) values($1,$2,$3,$4,$5,$6)',
      [
        auditorium.code,
        auditorium.name,
        venueIds[auditorium.venue],
        auditorium.rows,
        auditorium.seats,
        auditorium.rows.length * auditorium.seats,
      ],
    );
  }

  const nowRow = await tx.one<{ now: Date }>('select now() as now');
  const today = torontoParts(nowRow!.now);
  const base = `${String(today.year).padStart(4, '0')}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;

  for (const season of SEASONS) {
    await tx.query(
      'insert into seasons(slug, title_en, title_fr, public_sale_date, stored_state) values($1,$2,$3,$4,$5)',
      [season.slug, season.titleEn, season.titleFr, addCalendarDays(base, season.saleOffset), season.state],
    );
    let sequence = 0;
    for (const screening of season.screenings) {
      sequence += 1;
      const date = addCalendarDays(base, screening.dayOffset);
      const [year, month, day] = date.split('-').map(Number);
      const startsAt = instantFromToronto(year, month, day, screening.hour, screening.minute);
      await tx.query(
        `insert into screenings(id, season_slug, sequence, film_title, film_notes_en, film_notes_fr, format, auditorium_code, starts_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          `${season.slug}-${sequence}`,
          season.slug,
          sequence,
          screening.film,
          screening.notesEn,
          screening.notesFr,
          screening.format,
          screening.auditorium,
          startsAt.toISOString(),
        ],
      );
    }
  }

  for (const account of ACCOUNTS) {
    await tx.query(
      'insert into accounts(number, name, email, password_hash, role, locale) values($1,$2,$3,$4,$5,$6)',
      [account.number, account.name, account.email, hashPassword(account.password), account.role, account.locale],
    );
  }
  await tx.query('insert into counters(name, value) values($1,$2) on conflict (name) do nothing', [
    'account_number',
    100002,
  ]);
  return true;
}
