import { ClassCode, TrainSeed } from './types.js';
import { toIst, fromIst, addDays, startOfIstDay } from './time.js';

// Train seed data, and the chart-time and booking-window rules.

export const STATIONS: { code: string; name: string }[] = [
  { code: 'MMCT', name: 'Mumbai Central' },
  { code: 'ST', name: 'Surat' },
  { code: 'BRC', name: 'Vadodara Jn' },
  { code: 'RTM', name: 'Ratlam Jn' },
  { code: 'KOTA', name: 'Kota Jn' },
  { code: 'NDLS', name: 'New Delhi' },
  { code: 'SBC', name: 'KSR Bengaluru' },
  { code: 'BWT', name: 'Bangarapet' },
  { code: 'KPD', name: 'Katpadi Jn' },
  { code: 'MAS', name: 'Chennai Central' },
  { code: 'HYB', name: 'Hyderabad Deccan' },
  { code: 'KZJ', name: 'Kazipet Jn' },
  { code: 'BZA', name: 'Vijayawada Jn' },
  { code: 'RJY', name: 'Rajahmundry' },
  { code: 'VSKP', name: 'Visakhapatnam' },
  { code: 'JP', name: 'Jaipur Jn' },
  { code: 'AII', name: 'Ajmer Jn' },
  { code: 'MJ', name: 'Marwar Jn' },
  { code: 'JU', name: 'Jodhpur Jn' },
  { code: 'LKO', name: 'Lucknow' },
  { code: 'RBL', name: 'Rae Bareli Jn' },
  { code: 'PBH', name: 'Pratapgarh Jn' },
  { code: 'BSB', name: 'Varanasi Jn' },
  { code: 'PUNE', name: 'Pune Jn' },
  { code: 'DD', name: 'Daund Jn' },
  { code: 'MMR', name: 'Manmad Jn' },
  { code: 'BSL', name: 'Bhusaval Jn' },
  { code: 'NGP', name: 'Nagpur Jn' },
  { code: 'HWH', name: 'Howrah Jn' },
  { code: 'BWN', name: 'Barddhaman Jn' },
  { code: 'ASN', name: 'Asansol Jn' },
  { code: 'JAJ', name: 'Jhajha' },
  { code: 'PNBE', name: 'Patna Jn' },
  { code: 'ERS', name: 'Ernakulam Jn' },
  { code: 'TCR', name: 'Thrissur' },
  { code: 'SRR', name: 'Shoranur Jn' },
  { code: 'CLT', name: 'Kozhikode' },
  { code: 'MAQ', name: 'Mangaluru Central' },
];

function s(code: string, name: string, km: number, time: string, rl = false) {
  return { code, name, km, time, rl };
}

export const TRAINS: TrainSeed[] = [
  {
    number: '12951', name: 'Kesar Night Mail',
    stops: [
      s('MMCT', 'Mumbai Central', 0, '17:10'),
      s('ST', 'Surat', 263, '19:55'),
      s('BRC', 'Vadodara Jn', 392, '21:20', true),
      s('RTM', 'Ratlam Jn', 653, '00:45+1'),
      s('KOTA', 'Kota Jn', 918, '04:10+1'),
      s('NDLS', 'New Delhi', 1384, '08:35+1'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'S2', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '07:10',
  },
  {
    number: '12627', name: 'Kaveri Dawn Express',
    stops: [
      s('SBC', 'KSR Bengaluru', 0, '05:00'),
      s('BWT', 'Bangarapet', 70, '06:05'),
      s('KPD', 'Katpadi Jn', 229, '08:10', true),
      s('MAS', 'Chennai Central', 362, '10:20'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '19:00 previous day',
  },
  {
    number: '17031', name: 'Godavari Link',
    stops: [
      s('HYB', 'Hyderabad Deccan', 0, '05:01'),
      s('KZJ', 'Kazipet Jn', 132, '07:05'),
      s('BZA', 'Vijayawada Jn', 351, '10:30', true),
      s('RJY', 'Rajahmundry', 501, '13:00'),
      s('VSKP', 'Visakhapatnam', 701, '16:40'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '21:01 previous day',
  },
  {
    number: '22477', name: 'Thar Afternoon Express',
    stops: [
      s('JP', 'Jaipur Jn', 0, '14:00'),
      s('AII', 'Ajmer Jn', 135, '15:50', true),
      s('MJ', 'Marwar Jn', 255, '17:40'),
      s('JU', 'Jodhpur Jn', 326, '19:05'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '06:00',
  },
  {
    number: '14231', name: 'Doab Express',
    stops: [
      s('LKO', 'Lucknow', 0, '14:01'),
      s('RBL', 'Rae Bareli Jn', 80, '15:30'),
      s('PBH', 'Pratapgarh Jn', 160, '17:00', true),
      s('BSB', 'Varanasi Jn', 301, '20:05'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '04:01',
  },
  {
    number: '11025', name: 'Kumbhar Link',
    stops: [
      s('PUNE', 'Pune Jn', 0, '21:30'),
      s('DD', 'Daund Jn', 76, '22:55'),
      s('MMR', 'Manmad Jn', 330, '03:10+1', true),
      s('BSL', 'Bhusaval Jn', 490, '05:40+1'),
      s('NGP', 'Nagpur Jn', 890, '12:20+1'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '11:30',
  },
  {
    number: '12489', name: 'Hooghly Midnight Express',
    stops: [
      s('HWH', 'Howrah Jn', 0, '23:45'),
      s('BWN', 'Barddhaman Jn', 107, '01:00+1'),
      s('ASN', 'Asansol Jn', 214, '02:20+1', true),
      s('JAJ', 'Jhajha', 339, '04:15+1'),
      s('PNBE', 'Patna Jn', 532, '07:50+1'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'S2', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '13:45',
  },
  {
    number: '16341', name: 'Malabar Morning Express',
    stops: [
      s('ERS', 'Ernakulam Jn', 0, '09:30'),
      s('TCR', 'Thrissur', 74, '10:45'),
      s('SRR', 'Shoranur Jn', 107, '11:35', true),
      s('CLT', 'Kozhikode', 193, '13:15'),
      s('MAQ', 'Mangaluru Central', 414, '17:35'),
    ],
    coaches: [{ code: 'S1', cls: 'SL' }, { code: 'B1', cls: '3A' }],
    chart: '01:30',
  },
];

/** Departure epoch of a stop. `time` is `HH:MM` or `HH:MM+1`; the final stop is an arrival. */
export function stopEpoch(originDateMs: number, time: string): number {
  const plus = time.endsWith('+1');
  const hhmm = plus ? time.slice(0, -2) : time;
  const [h, m] = hhmm.split(':').map(Number);
  const t = toIst(originDateMs);
  return fromIst(t.y, t.mo, t.d, h, m, 0) + (plus ? 86_400_000 : 0);
}

/** Chart time, decided in exactly one place: 10 hours before a 14:01-05:00 departure, else 8. */
export function chartEpoch(originDateMs: number, depHHMM: string): number {
  const [h, m] = depHHMM.split(':').map(Number);
  const minutes = h * 60 + m;
  const overnight = minutes >= 14 * 60 + 1 || minutes <= 5 * 60; // 14:01 through 05:00 inclusive
  const lead = overnight ? 10 : 8;
  return stopEpoch(originDateMs, depHHMM) - lead * 3_600_000;
}

/** Parse a chart column like `07:10` or `19:00 previous day` relative to a run date (origin departure date). */
export function chartEpochFromSeed(originDateMs: number, chartCol: string): number {
  const prev = chartCol.endsWith(' previous day');
  const hhmm = prev ? chartCol.slice(0, -' previous day'.length) : chartCol;
  return stopEpoch(prev ? addDays(originDateMs, -1) : originDateMs, hhmm);
}

/** Advance-window opening for GN, LD and SS: 00:00 IST 60 days before the run date. */
export function advanceOpening(runDateMs: number): number {
  return startOfIstDay(addDays(runDateMs, -60));
}

/** Tatkal opening: day before the run date, 10:00 for 3A and 11:00 for SL. */
export function tatkalOpening(runDateMs: number, cls: ClassCode): number {
  const h = cls === '3A' ? 10 : 11;
  return addDays(startOfIstDay(runDateMs), -1) + h * 3_600_000;
}

export function stationName(code: string): string {
  return STATIONS.find((x) => x.code === code)?.name ?? code;
}

export interface RunContext {
  train: TrainSeed;
  /** epoch ms of the run date (origin departure date) at 00:00 IST */
  runDateMs: number;
  originDepMs: number;
  chartMs: number;
  stops: {
    code: string; name: string; km: number; depMs: number; rl: boolean;
    depHHMM: string; plusDay: boolean; isTerminal: boolean;
  }[];
}

export function runContext(number: string, runDateMs: number): RunContext | null {
  const train = TRAINS.find((t) => t.number === number);
  if (!train) return null;
  const originDepMs = stopEpoch(runDateMs, train.stops[0].time);
  const chartMs = chartEpochFromSeed(runDateMs, train.chart);
  const stops = train.stops.map((st, i) => {
    const depHHMM = st.time.endsWith('+1') ? st.time.slice(0, -2) : st.time;
    return {
      code: st.code, name: st.name, km: st.km, rl: st.rl, depHHMM,
      depMs: stopEpoch(runDateMs, st.time),
      plusDay: st.time.endsWith('+1'),
      isTerminal: i === train.stops.length - 1,
    };
  });
  return { train, runDateMs, originDepMs, chartMs, stops };
}

/** The waiting-list type a General booking joins, by From stop. */
export function wlTypeForStop(train: TrainSeed, fromCode: string): 'GNWL' | 'RLWL' | 'PQWL' {
  const idx = train.stops.findIndex((st) => st.code === fromCode);
  if (idx <= 0) return 'GNWL';
  return train.stops[idx].rl ? 'RLWL' : 'PQWL';
}
