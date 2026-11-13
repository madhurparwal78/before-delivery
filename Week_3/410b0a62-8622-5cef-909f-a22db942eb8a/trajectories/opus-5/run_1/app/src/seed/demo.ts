import type { Step } from '../domain/types.js';
import type { PlanEntry } from '../domain/types.js';
import type { SeedBody } from './engine.js';

const FIVES_AT_110: Step[] = [
  { kind: 'warmup', duration_s: 600, target_pct: 60 },
  {
    kind: 'interval',
    repeat: 5,
    work: { duration_s: 240, target_pct: 110 },
    recovery: { duration_s: 180, target_pct: 55 },
  },
  { kind: 'cooldown', duration_s: 600, target_pct: 50 },
];

function twelveToRaceDay(): PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (let week = 1; week <= 12; week += 1) {
    const base = 7 * (week - 1);
    entries.push({
      day: base + 2,
      start_local: '06:30',
      sport: 'bike',
      title: 'Fives at 110',
      steps: FIVES_AT_110,
      duration_s: 0,
    });
    entries.push({
      day: base + 4,
      start_local: '06:30',
      sport: 'run',
      title: 'Easy 45',
      steps: [{ kind: 'steady', duration_s: 2700, target_pct: 75 }],
      duration_s: 0,
    });
    entries.push({
      day: base + 6,
      start_local: '07:00',
      sport: 'bike',
      title: 'Long ride',
      steps: [{ kind: 'steady', duration_s: 7200, target_pct: 70 }],
      duration_s: 0,
    });
  }
  return entries;
}

export const DEMO_KEY_PREFIX = 'demo:';

export const DEMO_SET: SeedBody = {
  users: [
    {
      key: 'mara',
      role: 'coach',
      name: 'Mara Quill',
      email: 'mara@ottermere.test',
      password: 'tempoline-demo',
      tz: 'Europe/London',
      coach_code: 'MQ7K2P',
    },
    {
      key: 'idris',
      role: 'coach',
      name: 'Idris Fenn',
      email: 'idris@ottermere.test',
      password: 'tempoline-demo',
      tz: 'Europe/Berlin',
      coach_code: 'IF4R9T',
    },
    {
      key: 'tavi',
      role: 'athlete',
      name: 'Tavi Rennick',
      email: 'tavi@ottermere.test',
      password: 'tempoline-demo',
      tz: 'Pacific/Auckland',
      series_start: '2026-09-01',
      start_ctl: 0,
      start_atl: 0,
      thresholds: [
        { kind: 'ftp', value: 250, effective_from: '2026-09-01' },
        { kind: 'pace', value: 300, effective_from: '2026-09-01' },
      ],
    },
    {
      key: 'noor',
      role: 'athlete',
      name: 'Noor Halvorsen',
      email: 'noor@ottermere.test',
      password: 'tempoline-demo',
      tz: 'Europe/London',
      thresholds: [
        { kind: 'ftp', value: 210, effective_from: '2026-09-01' },
        { kind: 'pace', value: 330, effective_from: '2026-09-01' },
      ],
    },
    {
      key: 'ezra',
      role: 'athlete',
      name: 'Ezra Blom',
      email: 'ezra@ottermere.test',
      password: 'tempoline-demo',
      tz: 'Europe/Berlin',
      thresholds: [
        { kind: 'ftp', value: 280, effective_from: '2026-09-01' },
        { kind: 'pace', value: 285, effective_from: '2026-09-01' },
      ],
    },
  ],
  links: [
    { key: 'link-tavi', coach: 'mara', athlete: 'tavi', status: 'accepted' },
    { key: 'link-noor', coach: 'mara', athlete: 'noor', status: 'accepted' },
    { key: 'link-ezra', coach: 'mara', athlete: 'ezra', status: 'requested' },
  ],
  library: [
    { key: 'lib-fives', owner: 'tavi', name: 'Fives at 110', sport: 'bike', steps: FIVES_AT_110 },
  ],
  workouts: [
    {
      key: 'tavi-mon-planned',
      athlete: 'tavi',
      kind: 'planned',
      date: '2026-11-02',
      start_local: '06:30',
      sport: 'bike',
      title: 'Endurance hour',
      steps: [{ kind: 'steady', duration_s: 3600, target_pct: 80 }],
    },
    {
      key: 'tavi-mon-done',
      athlete: 'tavi',
      kind: 'completed',
      date: '2026-11-02',
      sport: 'bike',
      title: 'Endurance hour',
      manual: { duration_s: 3600, avg_power_w: 200 },
    },
    {
      key: 'tavi-tue-planned',
      athlete: 'tavi',
      kind: 'planned',
      date: '2026-11-03',
      start_local: '06:30',
      sport: 'run',
      title: 'Easy 45',
      steps: [{ kind: 'steady', duration_s: 2700, target_pct: 75 }],
    },
    {
      key: 'tavi-wed-done',
      athlete: 'tavi',
      kind: 'completed',
      date: '2026-11-04',
      sport: 'run',
      title: 'Lunch run',
      manual: { duration_s: 2700, avg_pace_s_per_km: 330 },
    },
    {
      key: 'tavi-thu-planned',
      athlete: 'tavi',
      kind: 'planned',
      date: '2026-11-05',
      start_local: '06:30',
      sport: 'bike',
      title: 'Fives at 110',
      steps: FIVES_AT_110,
    },
    {
      key: 'tavi-sat-planned',
      athlete: 'tavi',
      kind: 'planned',
      date: '2026-11-07',
      start_local: '07:00',
      sport: 'bike',
      title: 'Long ride',
      steps: [{ kind: 'steady', duration_s: 10800, target_pct: 70 }],
    },
    {
      key: 'noor-mon-planned',
      athlete: 'noor',
      kind: 'planned',
      date: '2026-11-02',
      start_local: '06:30',
      sport: 'bike',
      title: 'Tempo ride',
      steps: [{ kind: 'steady', duration_s: 2400, target_pct: 88 }],
    },
  ],
  plans: [
    {
      key: 'plan-twelve',
      owner: 'mara',
      name: 'Twelve to race day',
      weeks: 12,
      entries: twelveToRaceDay(),
    },
  ],
  events: [{ athlete: 'tavi', name: 'Harbour Half', date: '2026-12-20' }],
};
