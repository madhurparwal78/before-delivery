// The play page game state, shared by its modules.

import { Heading } from "../../shared/world";
import { CreatureState } from "../../shared/creatures";
import { IslandScene } from "../three/island";

export interface Game {
  island: number;
  tile: [number, number];
  heading: Heading;
  gait: "idle" | "walk" | "run" | "jump";
  mode: "explore" | "photo";
  yaw: number;
  exploreYaw: number;
  exploreZoom: number;
  zoom: number;
  focus: number;
  tick: number;
  hour: number;
  minute: number;
  weather: "clear" | "rain";
  dusk: boolean;
  lighthouse: "open" | "closed";
  creatures: CreatureState[];
  preset: "full" | "balanced" | "light";
  running: boolean;
  jumpQueued: boolean;
  jumpSteps: number;
  walkCounter: number;
  walkGoal: [number, number] | null;
  walkPath: [number, number][];
  seenCreatures: Set<string>;
  scoring: boolean;
  playerId: string;
}

export interface WorldAnswer {
  world: string; tick: number; hour: number; minute: number; time: string;
  weather: "clear" | "rain"; dusk: boolean; lighthouse: "open" | "closed";
  creatures: { id: string; name: string; island: number; size: number; x: number; y: number; heading: Heading }[];
}

export interface MeAnswer {
  player: { id: string; name: string; handle: string };
  position: { island: number; tile: [number, number]; heading: Heading };
  film: number; stamps: number; lighthouse: "open" | "closed";
  settings: { music: number; effects: number; graphics: "full" | "balanced" | "light" };
}

export interface AlbumsAnswer {
  albums: { island: number; island_name: string; pages: { creature: string; creature_name: string; filled: boolean; photo_id: string | null; total: number }[]; pages_filled: number; stamp: boolean }[];
  stamps: number; lighthouse: "open" | "closed"; film: number;
}

const holder: { scene: IslandScene | null } = { scene: null };

export function setSceneRef(s: IslandScene | null): void {
  holder.scene = s;
}

export function currentScene(): IslandScene | null {
  return holder.scene;
}
