// Port Ansell route and the seeded standard day.

export interface WaypointSeed {
  id: string;
  name: string;
  distance_nm: number;
  sounded_depth_mm: number;
  confined: boolean;
  time_offset_minutes: number;
  height_offset_mm: number;
  speed_limit_kn: number | null;
}

export const ROUTE: readonly WaypointSeed[] = [
  { id: 'W1', name: 'Outer Bar', distance_nm: 3.0, sounded_depth_mm: 6200, confined: false, time_offset_minutes: 0, height_offset_mm: 0, speed_limit_kn: null },
  { id: 'W2', name: 'Gannet Shoal', distance_nm: 7.5, sounded_depth_mm: 5400, confined: false, time_offset_minutes: 10, height_offset_mm: -100, speed_limit_kn: null },
  { id: 'W3', name: 'Narrows Sill', distance_nm: 12.0, sounded_depth_mm: 5100, confined: true, time_offset_minutes: 25, height_offset_mm: -200, speed_limit_kn: 8 },
  { id: 'W4', name: 'Mid Reach', distance_nm: 16.0, sounded_depth_mm: 6800, confined: false, time_offset_minutes: 35, height_offset_mm: -300, speed_limit_kn: null },
  { id: 'W5', name: 'Kettle Bend', distance_nm: 19.5, sounded_depth_mm: 5700, confined: true, time_offset_minutes: 45, height_offset_mm: -400, speed_limit_kn: 7 },
  { id: 'W6', name: 'Inner Sill', distance_nm: 22.0, sounded_depth_mm: 5300, confined: true, time_offset_minutes: 55, height_offset_mm: -500, speed_limit_kn: 7 },
];

export const ROUTE_LENGTH_NM = 23.0;

export interface TideEvent {
  at: string; // "HH:MM" port-local
  type: 'high' | 'low';
  height_mm: number;
}

// The seeded standard day, used for any date with no published revision.
export const STANDARD_DAY: readonly TideEvent[] = [
  { at: '00:45', type: 'low', height_mm: 1600 },
  { at: '06:55', type: 'high', height_mm: 9600 },
  { at: '13:05', type: 'low', height_mm: 1400 },
  { at: '19:15', type: 'high', height_mm: 9400 },
];

export const INITIAL_TIDE_VERSION = 1;
