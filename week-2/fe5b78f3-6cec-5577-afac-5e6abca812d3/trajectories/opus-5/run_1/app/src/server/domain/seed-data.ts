import type { TravelClass } from './berths';

export interface SeedStop {
  readonly code: string;
  readonly name: string;
  readonly km: number;
  readonly time: string;
  readonly dayOffset: number;
  readonly remote: boolean;
}

export interface SeedCoach {
  readonly code: string;
  readonly travelClass: TravelClass;
}

export interface SeedTrain {
  readonly number: string;
  readonly name: string;
  readonly stops: readonly SeedStop[];
  readonly coaches: readonly SeedCoach[];
}

function stop(
  code: string,
  name: string,
  km: number,
  time: string,
  dayOffset = 0,
  remote = false,
): SeedStop {
  return { code, name, km, time, dayOffset, remote };
}

const SL = (code: string): SeedCoach => ({ code, travelClass: 'SL' });
const AC3 = (code: string): SeedCoach => ({ code, travelClass: '3A' });

export const SEED_TRAINS: readonly SeedTrain[] = [
  {
    number: '12951',
    name: 'Kesar Night Mail',
    stops: [
      stop('MMCT', 'Mumbai Central', 0, '17:10'),
      stop('ST', 'Surat', 263, '19:55'),
      stop('BRC', 'Vadodara Jn', 392, '21:20', 0, true),
      stop('RTM', 'Ratlam Jn', 653, '00:45', 1),
      stop('KOTA', 'Kota Jn', 918, '04:10', 1),
      stop('NDLS', 'New Delhi', 1384, '08:35', 1),
    ],
    coaches: [SL('S1'), SL('S2'), AC3('B1')],
  },
  {
    number: '12627',
    name: 'Kaveri Dawn Express',
    stops: [
      stop('SBC', 'KSR Bengaluru', 0, '05:00'),
      stop('BWT', 'Bangarapet', 70, '06:05'),
      stop('KPD', 'Katpadi Jn', 229, '08:10', 0, true),
      stop('MAS', 'Chennai Central', 362, '10:20'),
    ],
    coaches: [SL('S1'), AC3('B1')],
  },
  {
    number: '17031',
    name: 'Godavari Link',
    stops: [
      stop('HYB', 'Hyderabad Deccan', 0, '05:01'),
      stop('KZJ', 'Kazipet Jn', 132, '07:05'),
      stop('BZA', 'Vijayawada Jn', 351, '10:30', 0, true),
      stop('RJY', 'Rajahmundry', 501, '13:00'),
      stop('VSKP', 'Visakhapatnam', 701, '16:40'),
    ],
    coaches: [SL('S1'), AC3('B1')],
  },
  {
    number: '22477',
    name: 'Thar Afternoon Express',
    stops: [
      stop('JP', 'Jaipur Jn', 0, '14:00'),
      stop('AII', 'Ajmer Jn', 135, '15:50', 0, true),
      stop('MJ', 'Marwar Jn', 255, '17:40'),
      stop('JU', 'Jodhpur Jn', 326, '19:05'),
    ],
    coaches: [SL('S1'), AC3('B1')],
  },
  {
    number: '14231',
    name: 'Doab Express',
    stops: [
      stop('LKO', 'Lucknow', 0, '14:01'),
      stop('RBL', 'Rae Bareli Jn', 80, '15:30'),
      stop('PBH', 'Pratapgarh Jn', 160, '17:00', 0, true),
      stop('BSB', 'Varanasi Jn', 301, '20:05'),
    ],
    coaches: [SL('S1'), AC3('B1')],
  },
  {
    number: '11025',
    name: 'Kumbhar Link',
    stops: [
      stop('PUNE', 'Pune Jn', 0, '21:30'),
      stop('DD', 'Daund Jn', 76, '22:55'),
      stop('MMR', 'Manmad Jn', 330, '03:10', 1, true),
      stop('BSL', 'Bhusaval Jn', 490, '05:40', 1),
      stop('NGP', 'Nagpur Jn', 890, '12:20', 1),
    ],
    coaches: [SL('S1'), AC3('B1')],
  },
  {
    number: '12489',
    name: 'Hooghly Midnight Express',
    stops: [
      stop('HWH', 'Howrah Jn', 0, '23:45'),
      stop('BWN', 'Barddhaman Jn', 107, '01:00', 1),
      stop('ASN', 'Asansol Jn', 214, '02:20', 1, true),
      stop('JAJ', 'Jhajha', 339, '04:15', 1),
      stop('PNBE', 'Patna Jn', 532, '07:50', 1),
    ],
    coaches: [SL('S1'), SL('S2'), AC3('B1')],
  },
  {
    number: '16341',
    name: 'Malabar Morning Express',
    stops: [
      stop('ERS', 'Ernakulam Jn', 0, '09:30'),
      stop('TCR', 'Thrissur', 74, '10:45'),
      stop('SRR', 'Shoranur Jn', 107, '11:35', 0, true),
      stop('CLT', 'Kozhikode', 193, '13:15'),
      stop('MAQ', 'Mangaluru Central', 414, '17:35'),
    ],
    coaches: [SL('S1'), AC3('B1')],
  },
];

export interface SeedAccount {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly phone: string;
}

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    name: 'Meera Iyer',
    email: 'meera.iyer@example.test',
    password: 'chart-paper-01',
    phone: '+919800000001',
  },
  {
    name: 'Rohan Bhat',
    email: 'rohan.bhat@example.test',
    password: 'chart-paper-02',
    phone: '+919800000002',
  },
];

/** Stations in the order they first appear in the seed train table. */
export function seedStations(): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const train of SEED_TRAINS) {
    for (const s of train.stops) {
      if (!seen.has(s.code)) seen.set(s.code, s.name);
    }
  }
  return [...seen].map(([code, name]) => ({ code, name }));
}
