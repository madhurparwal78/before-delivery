import type { BlockState, Direction, LayoutContent } from '../../../shared/domain'

// What the React shell and the stage (WebGL scene or SVG schematic) say to each other. The shell owns every
// discrete decision (ribbon steps, presented block states, selection); the stage draws them and animates the
// smooth parts (glide, camera, flag, piece slide) on its own requestAnimationFrame clock.

export interface SceneTrain {
  id: string
  number: string
  name: string
  direction: Direction
  length_mm: number
  head_block_id: string
  head_offset_mm: number
  trail_block_ids: string[]
}

export interface SceneRibbon {
  id: string
  // Block numbers drawn, in route order. The stage animates a block in or out over 180 ms when this list changes.
  blocks: number[]
}

export interface StageSelection {
  piece_id: string | null
  open_end_id: string | null
  train_number: string | null
  block_number: number | null
  // The module holding the selected piece or open end: its fascia is tinted.
  module_id: string | null
}

export interface StageInputs {
  mode: 'build' | 'operate'
  // Geometry to draw: the working copy in Build mode, the session's pinned version in Operate mode.
  content: LayoutContent
  block_names: Record<string, string>
  station_names: Record<string, string>
  // Presented block states by block number (the shell reveals reservations block by block).
  block_states: Record<number, BlockState>
  trains: SceneTrain[]
  // Where `trains` comes from: the session open in Operate, or the layout's parked stock. A new source cuts, never glides.
  trains_source: string
  ribbons: SceneRibbon[]
  limit_flag_block: number | null
  // Block hatched orange while a refusal plays.
  conflict_block: number | null
  preview_blocks: number[]
  selection: StageSelection
  // Piece whose arrival slides in over 300 ms and eases the camera over 400 ms.
  newest_piece_id: string | null
  // Width covered on the right by the route panel and schematic: the layout is framed in the width that is left.
  inset_right_px: number
  reduced_motion: boolean
}

export interface StageReport {
  heading: number
  zoom: number
  pan: [number, number]
  animating: boolean
  // Block number -> on-screen [x, y] in CSS pixels (viewport coordinates) of the block's track centre.
  block_points: Record<number, [number, number]>
}

export type StagePick =
  | { kind: 'piece'; id: string }
  | { kind: 'open_end'; id: string }
  | { kind: 'train'; number: string }
  | { kind: 'block'; number: number }

export type StageCallbacks = {
  onReport: (report: StageReport) => void
  onPick: (pick: StagePick) => void
  // Real build progress, 0..1, reported synchronously as each part of the scene is built.
  onProgress: (fraction: number) => void
  onContextLost: () => void
  onContextRestored: () => void
}

export interface StageController {
  update(inputs: StageInputs): void
  // Dial, Q and E: animates over 400 ms (a cut under reduced motion).
  turnHeading(deltaDeg: number): void
  setHeading(deg: number): void
  panBy(dxPx: number, dyPx: number): void
  zoomBy(factor: number): void
  resetView(): void
  dispose(): void
}
