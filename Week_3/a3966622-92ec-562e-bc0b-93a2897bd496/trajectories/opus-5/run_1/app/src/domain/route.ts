export type Waypoint = {
  id: string;
  name: string;
  distance_nm: number;
  sounded_depth_mm: number;
  confined: boolean;
  time_offset_minutes: number;
  height_offset_mm: number;
  speed_limit_kn: number | null;
};

export const BOARDING_GROUND_NM = 0;
export const BERTH_NM = 23.0;

export const ROUTE: readonly Waypoint[] = [
  {
    id: 'W1',
    name: 'Outer Bar',
    distance_nm: 3.0,
    sounded_depth_mm: 6200,
    confined: false,
    time_offset_minutes: 0,
    height_offset_mm: 0,
    speed_limit_kn: null,
  },
  {
    id: 'W2',
    name: 'Gannet Shoal',
    distance_nm: 7.5,
    sounded_depth_mm: 5400,
    confined: false,
    time_offset_minutes: 10,
    height_offset_mm: -100,
    speed_limit_kn: null,
  },
  {
    id: 'W3',
    name: 'Narrows Sill',
    distance_nm: 12.0,
    sounded_depth_mm: 5100,
    confined: true,
    time_offset_minutes: 25,
    height_offset_mm: -200,
    speed_limit_kn: 8,
  },
  {
    id: 'W4',
    name: 'Mid Reach',
    distance_nm: 16.0,
    sounded_depth_mm: 6800,
    confined: false,
    time_offset_minutes: 35,
    height_offset_mm: -300,
    speed_limit_kn: null,
  },
  {
    id: 'W5',
    name: 'Kettle Bend',
    distance_nm: 19.5,
    sounded_depth_mm: 5700,
    confined: true,
    time_offset_minutes: 45,
    height_offset_mm: -400,
    speed_limit_kn: 7,
  },
  {
    id: 'W6',
    name: 'Inner Sill',
    distance_nm: 22.0,
    sounded_depth_mm: 5300,
    confined: true,
    time_offset_minutes: 55,
    height_offset_mm: -500,
    speed_limit_kn: 7,
  },
];

export function waypointById(id: string): Waypoint | undefined {
  return ROUTE.find((waypoint) => waypoint.id === id);
}
