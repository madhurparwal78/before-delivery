/** The three.js scenes: the island world, Wump on the title page, and the gallery hall. */
import type { GuideScene, HallScene, WorldScene, WorldSceneOptions } from './api'
import { GuideView3D } from './guide'
import { HallView } from './hall'
import { WorldView } from './world'

export { webglAvailable } from './common'

export function createWorldScene(options: WorldSceneOptions): WorldScene {
  return new WorldView(options)
}

export function createGuideScene(canvas: HTMLCanvasElement): GuideScene {
  return new GuideView3D(canvas)
}

export function createHallScene(canvas: HTMLCanvasElement): HallScene {
  return new HallView(canvas)
}
