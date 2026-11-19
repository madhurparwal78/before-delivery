import { useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutContent } from '../../../shared/domain'
import { moduleOfSelection, selectBlock, selectOpenEnd, selectPiece, selectTrain, setHeading } from '../actions'
import { COPY } from '../copy'
import { usePresented } from '../presenter'
import { useRoute } from '../route'
import { createSvgStage, createWebglStage } from '../scene'
import type { SceneTrain, StageController, StageInputs, StagePick, StageReport } from '../scene/contract'
import { stageContent, store, useAppState, type AppState } from '../state'
import { readUrl } from '../url'
import { StageItems } from './StageItems'

const EMPTY: LayoutContent = { modules: [], blocks: [], stations: [], turnouts: [], trains: [], timetable: { version: 0, entries: [] } }

// The one handle the controls use to turn, pan, zoom and reset the camera.
const stage: { controller: StageController | null } = { controller: null }

// What stands on the right edge: the schematic dock from tablet width up and, on desktop, an open sheet. The stage
// frames the layout in what is left, and the top and bottom overlays keep clear of it.
export function rightInsets(state: AppState): { stage: number; bar: number; bottom: number } {
  const wide = window.innerWidth >= 1200
  const dockWidth = wide ? 356 : window.innerWidth >= 768 ? 316 : 0
  const dock = state.mode === 'operate' && state.session !== null ? dockWidth : 0
  const sheet = wide && state.sheet !== null ? 452 : 0
  return { stage: Math.max(dock, sheet), bar: wide ? Math.max(dock, sheet) : 0, bottom: sheet }
}

// Outside a session the layout's stock stands parked at its start blocks, so the hall always shows its trains.
function parkedTrains(content: LayoutContent): SceneTrain[] {
  const laid = new Set(content.modules.flatMap(module => module.pieces.map(piece => piece.block_id)))
  return content.trains.filter(train => laid.has(train.start_block_id)).map(train => ({
    id: train.id,
    number: train.number,
    name: train.name,
    direction: train.direction,
    length_mm: train.length_mm,
    head_block_id: train.start_block_id,
    head_offset_mm: train.head_offset_mm,
    trail_block_ids: [train.start_block_id],
  }))
}

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function onPick(pick: StagePick): void {
  const { mode } = store.get()
  if (pick.kind === 'piece' && mode === 'build') selectPiece(pick.id)
  else if (pick.kind === 'open_end' && mode === 'build') selectOpenEnd(pick.id)
  else if (pick.kind === 'train' && mode === 'operate') selectTrain(pick.number)
  else if (pick.kind === 'block' && mode === 'operate') selectBlock(pick.number)
}

export function Stage() {
  const state = useAppState()
  const presented = usePresented()
  const route = useRoute()
  const host = useRef<HTMLDivElement>(null)
  const [report, setReport] = useState<StageReport | null>(null)
  const [sceneProgress, setSceneProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const element = host.current as HTMLDivElement
    const callbacks = {
      onReport: (next: StageReport) => setReport(next),
      onPick,
      onProgress: (fraction: number) => setSceneProgress(previous => Math.max(previous, fraction)),
      onContextLost: () => setPaused(true),
      onContextRestored: () => setPaused(false),
    }
    const webgl = createWebglStage(element, callbacks)
    const controller = webgl ?? createSvgStage(element, callbacks)
    setFallback(webgl === null)
    controller.setHeading(readUrl().heading)
    stage.controller = controller
    return () => {
      controller.dispose()
      stage.controller = null
    }
  }, [])

  useEffect(() => {
    store.set(current => ({ sceneMode: paused ? 'paused' : current.mode }))
  }, [paused, state.mode])

  // A heading the scene itself moved (a rotate gesture, the end of a dial turn) is written back for the URL.
  const reported = useRef(0)
  useEffect(() => {
    if (report === null) return
    const moved = Math.abs(report.heading - reported.current) > 0.01
    reported.current = report.heading
    if (moved && !report.animating) setHeading(report.heading)
  }, [report])

  const content = stageContent(state) ?? EMPTY
  const names = useMemo(() => {
    const blocks: Record<string, string> = {}
    for (const block of content.blocks) blocks[block.id] = block.name
    for (const block of state.mode === 'operate' ? state.session?.blocks ?? [] : []) blocks[block.id] = block.name
    const stations: Record<string, string> = {}
    for (const station of content.stations) stations[station.id] = station.name
    for (const station of state.layout?.content.stations ?? []) stations[station.id] = station.name
    return { blocks, stations }
  }, [content, state.layout, state.session, state.mode])

  const operate = state.mode === 'operate' && state.session !== null
  const parked = useMemo(() => parkedTrains(content), [content])
  const inputs: StageInputs = {
    mode: state.mode,
    content,
    block_names: names.blocks,
    station_names: names.stations,
    block_states: operate ? presented.blockStates : {},
    trains: operate ? (state.session?.trains ?? []) : parked,
    trains_source: operate ? `session:${state.session?.id}` : 'layout',
    ribbons: operate ? presented.ribbons : [],
    limit_flag_block: operate ? presented.limitFlagBlock : null,
    conflict_block: operate ? presented.conflictBlock : null,
    preview_blocks: operate ? route.previewBlocks : [],
    selection: {
      piece_id: state.selection.pieceId, open_end_id: state.selection.endId, train_number: state.selection.trainNumber, block_number: state.selection.blockNumber,
      module_id: state.mode === 'build' ? moduleOfSelection(state.layout, state.selection)?.id ?? null : null,
    },
    newest_piece_id: state.newestPieceId,
    inset_right_px: rightInsets(state).stage,
    reduced_motion: reduced(),
  }
  useEffect(() => {
    stage.controller?.update(inputs)
  })

  useEffect(() => {
    store.set({ sceneProgress })
  }, [sceneProgress])

  const revision = operate ? state.session?.revision ?? 0 : state.layout?.revision ?? 0
  const ribbonBlocks = presented.ribbons.flatMap(ribbon => ribbon.blocks).join(',')

  function onKeyDown(event: React.KeyboardEvent): void {
    const controller = stage.controller
    if (controller === null || event.target !== event.currentTarget) return
    const step = 80
    const handlers: Record<string, () => void> = {
      ArrowLeft: () => controller.panBy(step, 0),
      ArrowRight: () => controller.panBy(-step, 0),
      ArrowUp: () => controller.panBy(0, step),
      ArrowDown: () => controller.panBy(0, -step),
      q: () => turn(-45),
      Q: () => turn(-45),
      e: () => turn(45),
      E: () => turn(45),
      '+': () => controller.zoomBy(1.25),
      '=': () => controller.zoomBy(1.25),
      '-': () => controller.zoomBy(0.8),
      _: () => controller.zoomBy(0.8),
    }
    const handler = handlers[event.key]
    if (handler === undefined) return
    event.preventDefault()
    handler()
  }

  return (
    <>
      <div
        role="application"
        aria-label="Club-hall layout stage"
        data-testid="stage"
        className="stage"
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-scene-revision={revision}
        data-scene-tick={state.session?.tick ?? 0}
        data-scene-mode={state.sceneMode}
        data-scene-heading={report === null ? state.heading : report.heading}
        data-scene-zoom={report?.zoom ?? 1}
        data-scene-pan={report === null ? '0,0' : `${report.pan[0]},${report.pan[1]}`}
        data-scene-animating={String((report?.animating ?? false) || presented.animating)}
        data-ribbon-blocks={ribbonBlocks}
        data-preview-blocks={operate ? route.previewBlocks.join(',') : ''}
        data-limit-flag-block={operate && presented.limitFlagBlock !== null ? presented.limitFlagBlock : ''}
        data-block-points={JSON.stringify(report?.block_points ?? {})}
        data-fallback={fallback || undefined}
      >
        <div ref={host} className="stage-host" />
        {paused ? <p className="paused-copy">{COPY.pausedView}</p> : null}
      </div>
      <StageItems />
    </>
  )
}

export function turn(delta: number): void {
  stage.controller?.turnHeading(delta)
  setHeading(store.get().heading + delta)
}

export function resetCamera(): void {
  stage.controller?.resetView()
  setHeading(0)
}
