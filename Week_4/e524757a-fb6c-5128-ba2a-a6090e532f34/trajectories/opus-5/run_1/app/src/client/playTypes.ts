import type { Settings } from './settingsTypes.js';
import type { Heading } from '../shared/islands.js';

export type AlbumPage = {
  creature: string;
  creature_name: string;
  filled: boolean;
  photo_id: string | null;
  total: number | null;
};

export type Album = {
  island: number;
  island_name: string;
  pages: AlbumPage[];
  pages_filled: number;
  stamp: boolean;
};

export type WorldCreature = {
  id: string;
  name: string;
  island: number;
  size: number;
  x: number;
  y: number;
  heading: Heading;
};

export type WorldSnapshot = {
  id: string;
  tick: number;
  hour: number;
  minute: number;
  time: string;
  weather: 'clear' | 'rain';
  dusk: boolean;
  creatures: WorldCreature[];
};

export type Sighting = { island: number; x: number; y: number; by: string };

export type SafariSnapshot = {
  code: string;
  status: string;
  host: string;
  guest: string | null;
  role: 'host' | 'guest';
  sightings: Sighting[];
};

export type PlayBootstrap = {
  page: 'play';
  player: { id: string; name: string; handle: string };
  position: { island: number; tile: [number, number]; heading: Heading };
  film: number;
  stamps: number;
  lighthouse: 'open' | 'closed';
  albums: Album[];
  settings: Settings;
  preset: Settings['graphics'];
  world: WorldSnapshot;
  notice: string | null;
  safari: SafariSnapshot | null;
};
