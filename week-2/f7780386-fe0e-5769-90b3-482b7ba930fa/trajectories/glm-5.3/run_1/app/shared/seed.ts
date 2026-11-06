import type { Station } from './types.js';

export const STATIONS: Station[] = [
  { id: 'oven-1', name: 'Convection Oven 1', hourly_rate: '28.00', cleaning_minutes: 30 },
  { id: 'oven-2', name: 'Deck Oven', hourly_rate: '26.00', cleaning_minutes: 30 },
  { id: 'kettle-1', name: 'Steam Kettle', hourly_rate: '32.00', cleaning_minutes: 45 },
  { id: 'prep-a', name: 'Prep Station A', hourly_rate: '18.00', cleaning_minutes: 15 },
  { id: 'prep-b', name: 'Prep Station B', hourly_rate: '18.00', cleaning_minutes: 15 },
  { id: 'cold-1', name: 'Walk-in Shelf 1', hourly_rate: '6.00', cleaning_minutes: 0 },
];

export const PACKS = [
  { id: 'pack-10', name: '10-hour pack', minutes: 600, price: '230.00' },
  { id: 'pack-25', name: '25-hour pack', minutes: 1500, price: '525.00' },
] as const;

export const KITCHEN_NAME = 'Halsted Street Kitchen';
export const KITCHEN_TIME_ZONE = 'America/Chicago';
export const SEED_PASSWORD = 'prep-shift-2026';
