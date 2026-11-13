import type { Step } from '../shared/types.js';

const PASSWORD = 'tempoline-demo';
const WEEKS = 12;

const steady = (duration_s: number, target_pct: number): Step => ({ kind: 'steady', duration_s, target_pct });
const FIVES_AT_110: Step[] = [
  { kind: 'warmup', duration_s: 600, target_pct: 60 },
  { kind: 'interval', repeat: 5, work: { duration_s: 240, target_pct: 110 }, recovery: { duration_s: 180, target_pct: 55 } },
  { kind: 'cooldown', duration_s: 600, target_pct: 50 }
];

const person = (key: string, role: 'coach' | 'athlete', name: string, email: string, tz: string, extra: Record<string, unknown>) => ({
  key,
  role,
  name,
  email,
  password: PASSWORD,
  tz,
  ...extra
});

const thresholds = (ftp: number, pace: number) => [
  { kind: 'ftp', value: ftp, effective_from: '2026-09-01' },
  { kind: 'pace', value: pace, effective_from: '2026-09-01' }
];

const athleteExtra = (ftp: number, pace: number) => ({ series_start: '2026-09-01', start_ctl: 0, start_atl: 0, thresholds: thresholds(ftp, pace) });

const planned = (key: string, athlete: string, date: string, start_local: string, sport: string, title: string, steps: Step[]) => ({
  key,
  athlete,
  kind: 'planned',
  date,
  start_local,
  sport,
  title,
  steps
});

const manual = (key: string, athlete: string, date: string, sport: string, title: string, entry: Record<string, number>) => ({
  key,
  athlete,
  kind: 'completed',
  date,
  sport,
  title,
  manual: entry
});

/** Each week of the template: Fives at 110 on day 2, an easy run on day 4 and a long ride on day 6. */
const entries = Array.from({ length: WEEKS }, (_, week) => {
  const base = 7 * week;
  return [
    { day: base + 2, start_local: '06:30', sport: 'bike', title: 'Fives at 110', steps: FIVES_AT_110 },
    { day: base + 4, start_local: '06:30', sport: 'run', title: 'Easy 45', steps: [steady(2700, 75)] },
    { day: base + 6, start_local: '07:00', sport: 'bike', title: 'Long ride', steps: [steady(7200, 70)] }
  ];
}).flat();

export const DEMO_SET = {
  users: [
    person('mara', 'coach', 'Mara Quill', 'mara@ottermere.test', 'Europe/London', { coach_code: 'MQ7K2P' }),
    person('idris', 'coach', 'Idris Fenn', 'idris@ottermere.test', 'Europe/Berlin', { coach_code: 'IF4R9T' }),
    person('tavi', 'athlete', 'Tavi Rennick', 'tavi@ottermere.test', 'Pacific/Auckland', athleteExtra(250, 300)),
    person('noor', 'athlete', 'Noor Halvorsen', 'noor@ottermere.test', 'Europe/London', athleteExtra(210, 330)),
    person('ezra', 'athlete', 'Ezra Blom', 'ezra@ottermere.test', 'Europe/Berlin', athleteExtra(280, 285))
  ],
  links: [
    { key: 'mara-tavi', coach: 'mara', athlete: 'tavi', status: 'accepted' },
    { key: 'mara-noor', coach: 'mara', athlete: 'noor', status: 'accepted' },
    { key: 'mara-ezra', coach: 'mara', athlete: 'ezra', status: 'requested' }
  ],
  library: [{ key: 'tavi-fives', owner: 'tavi', name: 'Fives at 110', sport: 'bike', steps: FIVES_AT_110 }],
  workouts: [
    planned('tavi-mon-plan', 'tavi', '2026-11-02', '06:30', 'bike', 'Endurance hour', [steady(3600, 80)]),
    manual('tavi-mon-done', 'tavi', '2026-11-02', 'bike', 'Endurance hour', { duration_s: 3600, avg_power_w: 200 }),
    planned('tavi-tue-plan', 'tavi', '2026-11-03', '06:30', 'run', 'Easy 45', [steady(2700, 75)]),
    manual('tavi-wed-done', 'tavi', '2026-11-04', 'run', 'Lunch run', { duration_s: 2700, avg_pace_s_per_km: 330 }),
    planned('tavi-thu-plan', 'tavi', '2026-11-05', '06:30', 'bike', 'Fives at 110', FIVES_AT_110),
    planned('tavi-sat-plan', 'tavi', '2026-11-07', '07:00', 'bike', 'Long ride', [steady(10_800, 70)]),
    planned('noor-mon-plan', 'noor', '2026-11-02', '06:30', 'bike', 'Tempo ride', [steady(2400, 88)])
  ],
  plans: [{ key: 'twelve-to-race-day', owner: 'mara', name: 'Twelve to race day', weeks: WEEKS, entries }],
  events: [{ athlete: 'tavi', name: 'Harbour Half', date: '2026-12-20' }]
};
