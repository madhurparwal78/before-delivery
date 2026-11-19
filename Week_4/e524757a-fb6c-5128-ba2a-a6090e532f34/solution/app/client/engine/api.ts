/** The contract between the pages and the three.js scenes. Pages own time, input and the `data-*` hooks;
 *  scenes only draw. Every scene is driven by the page: it calls `frame(now)` from its own animation-frame loop
 *  with `performance.now()` and the scene tweens on that clock (never on its own timers), so a paused page clock holds it still.
 *  Under reduced motion (`reducedMotion()` from ../lib/dom) a scene draws only when something it shows changes. */
import type { Graphics } from '../../shared/types'
import type { Heading, Tile } from '../../shared/island'

export type Gait = 'idle' | 'walk' | 'run' | 'jump'

export interface SceneCreature { id: string; x: number; y: number; heading: Heading }

export interface Environment {
  /** World hour 0..23 and minute 0..59: the sun and sky follow them. */
  hour: number
  minute: number
  weather: 'clear' | 'rain'
  dusk: boolean
  lighthouse: 'open' | 'closed'
  preset: Graphics
}

/** The simulated explorer, set on every 100 ms step. The scene moves the figure between tiles smoothly. */
export interface ExplorerPose {
  tile: Tile
  heading: Heading
  gait: Gait
  /** 0 when not jumping, else 1..4: the jump step just taken. */
  jumpStep: number
}

export interface View {
  mode: 'explore' | 'photo'
  /** Camera yaw in whole degrees; 0 looks north, 90 east. In photo mode it equals the heading's angle. */
  yaw: number
  /** Explore 1..4 (2 default): distance of the orbit camera. Photo 1, 2 or 4: the lens. */
  zoom: number
  /** Photo only: 2, 4, 8 or 16 tiles; the depth-of-field blur follows it (not on `light`). */
  focus: number
}

export interface WorldScene {
  readonly canvas: HTMLCanvasElement
  setIsland(island: number): void
  setEnvironment(environment: Environment): void
  /** Present creatures of the current island, at the tick the server last sent. */
  setCreatures(creatures: readonly SceneCreature[]): void
  setExplorer(pose: ExplorerPose): void
  /** Ask for a camera. Unless `cut`, the camera glides there over 320 ms of page time (entering or leaving photo mode). */
  setView(view: View, options?: { cut?: boolean }): void
  /** Render if anything changed (or something is animating) and return the camera as
   *  `data-camera`: position then look target, six numbers with two decimals, comma separated. Cheap when idle. */
  frame(now: number): string
  /** The land tile under a client point, or null (water, rock, lighthouse, sky). */
  pick(clientX: number, clientY: number): Tile | null
  /** Render one frame now and encode the canvas at no more than `maxWidth` px wide, as JPEG. */
  capture(maxWidth: number): Promise<Blob>
  resize(width: number, height: number): void
  dispose(): void
}

export interface WorldSceneOptions { canvas: HTMLCanvasElement; island: number; environment: Environment }

/** Wump on the title page: a moss-backed tide-newt. */
export interface GuideView {
  /** Whole degrees 0..345. */
  spin: number
  /** 0.50..2.00. */
  zoom: number
  /** 0..1: the body stretches while pulled. */
  stretch: number
  /** 0..1: one hop (Space), 0 at rest. */
  hop: number
  /** 2, 4, 8 or 16: the depth-of-field focus of the demo fragment (the reel). Absent: sharp. */
  focus?: number
}

export interface GuideScene {
  readonly canvas: HTMLCanvasElement
  set(view: GuideView): void
  /** Idle breath every 3 to 5 seconds, drawn on page time; still under reduced motion. */
  frame(now: number): void
  resize(width: number, height: number): void
  dispose(): void
}

export interface HallFrameImage { url: string; caption: string; creatureName: string }

/** The hall: a room of 6 by 14 tiles (x 0..5, y 0..13) with the hung photos on its walls and a visitor walking in it. */
export interface HallScene {
  readonly canvas: HTMLCanvasElement
  setFrames(frames: readonly HallFrameImage[]): void
  setVisitor(pose: { tile: Tile; heading: Heading; gait: Gait }): void
  setPreset(preset: Graphics): void
  frame(now: number): void
  resize(width: number, height: number): void
  dispose(): void
}
