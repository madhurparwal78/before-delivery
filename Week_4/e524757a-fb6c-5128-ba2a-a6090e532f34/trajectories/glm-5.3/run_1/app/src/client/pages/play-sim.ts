// Hooks, camera, frame guide and simulation for the play page.

import { qs, announce, api } from "../ui/core";
import { stepOf, walkPath, Explorer } from "../../shared/movement";
import { isLand, Heading, HEADING_ANGLE, GRID } from "../../shared/world";
import { creaturesInFrame, Pose } from "../../shared/frame";
import { Game, currentScene } from "./play-state";

export const STEP_MS = 100;

export interface KeyRecord { down: number; up: number | null }

export function keyHeld(keys: Map<string, KeyRecord>, name: string, at: number): boolean {
  const rec = keys.get(name);
  if (!rec) return false;
  return rec.down <= at && (rec.up === null || rec.up > at);
}

/** The joystick's held direction, set by the touch module. */
let joystickDir: Heading | null = null;
export function setJoystickDir(dir: Heading | null): void { joystickDir = dir; }
export function getJoystickDir(): Heading | null { return joystickDir; }

/** One fixed step of the simulation, at this step's own moment. */
export function simulate(game: Game, keys: Map<string, KeyRecord>, at: number): void {
  const view = qs<HTMLElement>("#world-view");
  if (!view) return;
  const stepIndex = Number(view.dataset.step || "0");

  let direction: Heading | null = null;
  if (game.mode === "explore") {
    if (keyHeld(keys, "w", at) || keyHeld(keys, "ArrowUp", at) || joystickDir === "N") direction = "N";
    else if (keyHeld(keys, "a", at) || keyHeld(keys, "ArrowLeft", at) || joystickDir === "W") direction = "W";
    else if (keyHeld(keys, "s", at) || keyHeld(keys, "ArrowDown", at) || joystickDir === "S") direction = "S";
    else if (keyHeld(keys, "d", at) || keyHeld(keys, "ArrowRight", at) || joystickDir === "E") direction = "E";
    if (direction !== null) {
      game.walkGoal = null;
      game.walkPath = [];
    } else if (game.walkGoal && game.walkPath.length > 0) {
      const next = game.walkPath[0];
      const dx = next[0] - game.tile[0];
      const dy = next[1] - game.tile[1];
      direction = dx === 1 ? "E" : dx === -1 ? "W" : dy === 1 ? "S" : "N";
    } else if (game.walkGoal) {
      game.walkGoal = null;
    }
  }

  const running = game.running || keyHeld(keys, "Shift", at);
  const jumpQueued = game.jumpQueued && game.jumpSteps === 0;

  const explorer: Explorer = { tile: [...game.tile] as [number, number], heading: game.heading, gait: game.gait };
  const res = stepOf(explorer, game.island, { direction, running, jumpQueued }, isLand, game.walkCounter, game.jumpSteps);
  game.jumpQueued = false;
  game.jumpSteps = res.jumpSteps;
  // Held steps count every step a direction is held, so walk parity never freezes when blocked.
  if (direction !== null && game.mode === "explore") game.walkCounter++;
  else if (direction === null) game.walkCounter = 0;
  if (res.moved && game.walkPath.length > 0 && game.walkPath[0][0] === res.tile[0] && game.walkPath[0][1] === res.tile[1]) {
    game.walkPath.shift();
    if (game.walkPath.length === 0) game.walkGoal = null;
  }
  const movedTile = res.tile[0] !== game.tile[0] || res.tile[1] !== game.tile[1];
  game.tile = [...res.tile] as [number, number];
  game.heading = res.heading;
  game.gait = res.gait;
  if (movedTile) {
    void api("PUT", "/api/me/position", { island: game.island, tile: game.tile, heading: game.heading }).catch(() => undefined);
    currentScene()?.setExplorer(game.tile[0], game.tile[1], game.heading);
  }
  view.dataset.step = String(stepIndex + 1);
  updateHooks(game);
  updateCameraHook();
  spotAnnouncements(game);
}

function spotAnnouncements(game: Game): void {
  for (const c of game.creatures) {
    if (c.island !== game.island) continue;
    if (game.seenCreatures.has(c.id)) continue;
    const dx = Math.abs(c.x - game.tile[0]);
    const dy = Math.abs(c.y - game.tile[1]);
    if (dx <= 6 && dy <= 6) {
      game.seenCreatures.add(c.id);
      announce("World status", `You spot a ${c.name}.`);
    }
  }
}

export function updateHooks(game: Game): void {
  const view = qs<HTMLElement>("#world-view");
  if (!view) return;
  view.dataset.tile = `${game.tile[0]},${game.tile[1]}`;
  view.dataset.heading = game.heading;
  view.dataset.gait = game.gait;
  view.dataset.mode = game.mode;
  view.dataset.island = String(game.island);
  view.dataset.yaw = String(normYaw(game.yaw));
  view.dataset.zoom = String(game.mode === "photo" ? game.zoom : game.exploreZoom);
  view.dataset.focus = game.mode === "photo" ? String(game.focus) : "";
  view.dataset.tick = String(game.tick);
  view.dataset.worldHour = String(game.hour);
  view.dataset.weather = game.weather;
  view.dataset.lighthouse = game.lighthouse;
  view.dataset.inView = game.mode === "photo" ? frameIds(game).join(",") : "";
  view.dataset.creatures = game.creatures
    .filter(c => c.island === game.island)
    .map(c => `${c.id}@${c.x},${c.y},${c.heading}`)
    .join(";");
}

export function updateCameraHook(): void {
  const view = qs("#world-view");
  const scene = currentScene();
  if (!view || !scene) return;
  view.dataset.camera = scene.cameraHook();
}

export function frameIds(game: Game): string[] {
  const pose: Pose = {
    island: game.island, tile: game.tile, camera: game.tile,
    heading: game.heading, zoom: game.zoom, focus: game.focus, tick: game.tick
  };
  return creaturesInFrame(pose, game.creatures.filter(c => c.island === game.island)).map(c => c.id);
}

export function updateFrameGuide(game: Game, quiet = false): void {
  const guide = qs("#frame-guide");
  const label = qs("#frame-label");
  if (!guide || !label) return;
  const visible = game.mode === "photo";
  guide.style.display = visible ? "block" : "none";
  const ids = frameIds(game);
  const first = ids[0];
  if (first) {
    guide.classList.add("red");
    const c = game.creatures.find(x => x.id === first);
    const name = c?.name ?? first;
    label.textContent = `${name} in frame`;
    if (!quiet) announce("Frame guide", `${name} in frame`);
  } else {
    guide.classList.remove("red");
    label.textContent = "No creature in frame";
    if (visible && !quiet) announce("Frame guide", "No creature in frame");
  }
}

export function normYaw(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

export function walkTo(game: Game, target: [number, number]): boolean {
  const path = walkPath(game.island, game.tile, target, isLand);
  if (!path) {
    announce("World status", "No path to that spot.");
    return false;
  }
  game.walkGoal = [...target] as [number, number];
  game.walkPath = path;
  return true;
}

/** Project a screen click to a tile ahead of the camera. */
export function tileFromClick(game: Game, clientX: number, clientY: number): [number, number] | null {
  const view = qs<HTMLElement>("#world-view");
  if (!view) return null;
  const rect = view.getBoundingClientRect();
  const relX = (clientX - rect.left) / rect.width - 0.5;
  const relY = (clientY - rect.top) / rect.height - 0.5;
  const yawRad = (game.yaw * Math.PI) / 180;
  const wx = Math.sin(yawRad) * 6 * (relX * 2);
  const wy = Math.cos(yawRad) * 6 * (relY * 2);
  const tx = Math.round(game.tile[0] + wx);
  const ty = Math.round(game.tile[1] + wy);
  if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return null;
  return [tx, ty];
}

export function headingAngle(h: Heading): number {
  return HEADING_ANGLE[h];
}
