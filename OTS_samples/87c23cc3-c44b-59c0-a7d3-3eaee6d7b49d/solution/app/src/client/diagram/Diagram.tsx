import { Minus, Plus } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_ENTITY_COLOR, DEFAULT_GROUP_COLOR, GRID_MAX, GRID_PX, SHIFT_STEPS, type ColorName, type Layout } from '../../shared/domain.ts'
import { COPY } from '../../shared/copy.ts'
import { columnLabel, columnMarkers, entityLabel, groupOf, linkKey, outlineItems, type KeyMarker } from '../../shared/diagram.ts'
import { typeToString, type Column, type ColumnRef, type Entity, type Link, type Model } from '../../shared/mortise.ts'
import { glideConnector, playDraw, playEntrance, playGlide } from './animations.ts'
import { ENTITY_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, clamp, connector, entityBox, groupBox, type Box } from './geometry.ts'
import type { LayoutCause } from '../project/store.ts'

const ZOOM_MIN = 25
const ZOOM_MAX = 200
const ZOOM_STEP = 25
const TAP_SLOP = 4
const MARGIN_PX = 24

interface View {
  x: number
  y: number
  zoom: number
}

interface Preview {
  from: ColumnRef
  start: { x: number; y: number }
  end: { x: number; y: number }
}

interface LinkMode {
  from: ColumnRef
}

export interface DiagramActions {
  move: (name: string, x: number, y: number) => void
  drawLink: (from: ColumnRef, to: ColumnRef) => void
  openDetails: (name: string) => void
  openRename: (name: string) => void
  openGroup: () => void
  say: (text: string) => void
}

interface DiagramProps {
  label: string
  /** Start zoomed out so every entity shows (the landing sample); the editor starts at 100 percent. */
  fit?: boolean
  model: Model | null
  layout: Layout
  canEdit: boolean
  layoutCause: { stamp: number; cause: LayoutCause }
  selection: readonly string[]
  onSelection: (next: string[]) => void
  onFocusEntity: (name: string | null) => void
  actions: DiagramActions
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; view: View; moved: boolean; tapped: string | null }
  | { kind: 'entity'; name: string; startX: number; startY: number; at: { x: number; y: number }; view: View; drag: boolean; moved: boolean; shift: boolean }
  | { kind: 'link'; from: ColumnRef }

interface ColumnView {
  column: Column
  label: string
  markers: KeyMarker[]
}

interface EntityView {
  entity: Entity
  label: string
  columns: ColumnView[]
}

function firstTwo(pointers: Map<number, { x: number; y: number }>): [{ x: number; y: number }, { x: number; y: number }] {
  const [first, second] = [...pointers.values()]
  return [first as { x: number; y: number }, second as { x: number; y: number }]
}

const refKey = (ref: ColumnRef): string => `${ref.entity}.${ref.column}`
const selector = (attribute: string, value: string): string => `[${attribute}="${value.replace(/"/g, '\\"')}"]`
const zoomPercent = (zoom: number): number => Math.round(zoom * 100)

function nextStep(percent: number, direction: 1 | -1): number {
  const stepped = direction === 1 ? (Math.floor(percent / ZOOM_STEP) + 1) * ZOOM_STEP : (Math.ceil(percent / ZOOM_STEP) - 1) * ZOOM_STEP
  return clamp(stepped, ZOOM_MIN, ZOOM_MAX)
}

interface NodeProps {
  view: EntityView
  x: number
  y: number
  color: ColorName
  group: string | null
  selected: boolean
  editable: boolean
}

const EntityNode = memo(function EntityNode({ view, x, y, color, group, selected, editable }: NodeProps) {
  const { entity } = view
  const box = entityBox(x, y, entity.columns.length)
  const title = entity.name.length > 24 ? `${entity.name.slice(0, 23)}…` : entity.name
  return (
    <g
      data-entity={entity.name}
      data-x={x}
      data-y={y}
      data-group={group ?? ''}
      data-color={color}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label={view.label}
      tabIndex={0}
      transform={`translate(${box.x} ${box.y})`}
      className="entity"
    >
      <g className="node">
        <rect className="card" width={ENTITY_WIDTH} height={box.height} rx={6} />
        <path className="header" d={`M0 ${HEADER_HEIGHT} V6 a6 6 0 0 1 6 -6 H${ENTITY_WIDTH - 6} a6 6 0 0 1 6 6 V${HEADER_HEIGHT} Z`} data-header="" />
        <text className="title" x={12} y={21}>
          {title}
        </text>
        <g role="list" aria-label={`Columns of ${entity.name}`}>
          {view.columns.map((item, row) => {
            const ref = `${entity.name}.${item.column.name}`
            const top = HEADER_HEIGHT + row * ROW_HEIGHT
            const name = item.column.name.length > 16 ? `${item.column.name.slice(0, 15)}…` : item.column.name
            const type = typeToString(item.column.type)
            return (
              <g
                key={item.column.name}
                data-column={ref}
                data-type={typeToString(item.column.type)}
                data-key={item.markers.join(' ')}
                role="listitem"
                aria-label={item.label}
                tabIndex={-1}
                transform={`translate(0 ${top})`}
                className="row"
              >
                <rect className="row-bg" width={ENTITY_WIDTH} height={ROW_HEIGHT} />
                <rect className="row-flash" width={ENTITY_WIDTH} height={ROW_HEIGHT} />
                {item.markers.map((marker, i) => (
                  <MarkerGlyph key={marker} marker={marker} x={14 + i * 12} />
                ))}
                <text className="col-name" x={44} y={16}>
                  {name}
                </text>
                <text className="col-type" x={ENTITY_WIDTH - 12} y={16} textAnchor="end">
                  {type.length > 14 ? `${type.slice(0, 13)}…` : type}
                </text>
                <circle className="handle-dot" cx={ENTITY_WIDTH} cy={ROW_HEIGHT / 2} r={4} />
                <circle className={`handle${editable ? '' : ' handle-off'}`} data-handle={ref} cx={ENTITY_WIDTH} cy={ROW_HEIGHT / 2} r={11} />
              </g>
            )
          })}
        </g>
      </g>
    </g>
  )
})

function MarkerGlyph({ marker, x }: { marker: KeyMarker; x: number }) {
  if (marker === 'primary') return <path className="marker marker-primary" d={`M${x - 4} 12 a3 3 0 1 1 1 -2 L${x + 4} 3 M${x + 2} 5 l2 2`} />
  if (marker === 'unique') return <path className="marker marker-unique" d={`M${x} 6 l4 4 l-4 4 l-4 -4 Z`} />
  return <path className="marker marker-foreign" d={`M${x - 4} 12 L${x + 4} 6 M${x + 1} 5 L${x + 4} 6 L${x + 3} 9`} />
}

export function Diagram({ label, fit = false, model, layout, canEdit, layoutCause, selection, onSelection, onFocusEntity, actions }: DiagramProps) {
  const region = useRef<HTMLDivElement>(null)
  const canvas = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: MARGIN_PX, y: MARGIN_PX, zoom: 1 })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [linkMode, setLinkMode] = useState<LinkMode | null>(null)
  const [dragging, setDragging] = useState<{ name: string; x: number; y: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>())
  const gesture = useRef<Gesture | null>(null)
  const pinch = useRef<{ distance: number; zoom: number; view: View } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const outline = useMemo(() => (model ? outlineItems(model) : []), [model])

  const entityViews = useMemo<EntityView[]>(() => {
    if (!model) return []
    return model.entities.map((entity) => ({
      entity,
      label: entityLabel(model, entity),
      columns: entity.columns.map((column) => {
        const markers = columnMarkers(model, entity, column)
        return { column, markers, label: columnLabel(column, markers) }
      }),
    }))
  }, [model])

  const positionOf = useCallback(
    (name: string): { x: number; y: number } => {
      if (dragging?.name === name) return dragging
      const known = layout.entities[name]
      return known ? { x: known.x, y: known.y } : { x: 0, y: 0 }
    },
    [layout, dragging],
  )

  const boxes = useMemo(() => {
    const map = new Map<string, Box>()
    for (const item of entityViews) {
      const at = positionOf(item.entity.name)
      map.set(item.entity.name, entityBox(at.x, at.y, item.entity.columns.length))
    }
    return map
  }, [entityViews, positionOf])

  // The first view puts the top-left of everything (group strips included) inside the canvas margin.
  const placed = useRef(false)
  const touched = useRef(false)
  useLayoutEffect(() => {
    if (touched.current || (placed.current && !fit) || !model || !region.current) return
    placed.current = true
    const all = [...boxes.values(), ...(model.groups.flatMap((group) => {
      const members = group.entities.flatMap((name) => boxes.get(name) ?? [])
      return members.length ? [groupBox(members)] : []
    }))]
    if (!all.length) return
    const left = Math.min(...all.map((box) => box.x))
    const top = Math.min(...all.map((box) => box.y))
    const right = Math.max(...all.map((box) => box.x + box.width))
    const width = region.current.clientWidth
    const zoom = fit ? clamp(Math.floor((100 * (width - 2 * MARGIN_PX)) / (right - left)), 50, 100) / 100 : 1
    setView({ zoom, x: MARGIN_PX - left * zoom, y: MARGIN_PX - top * zoom })
  }, [model, boxes, fit])

  const adjust: typeof setView = (change) => {
    touched.current = true
    setView(change)
  }

  const rowIndex = useCallback(
    (ref: ColumnRef): number => model?.entities.find((entity) => entity.name === ref.entity)?.columns.findIndex((column) => column.name === ref.column) ?? 0,
    [model],
  )

  const links = useMemo(
    () =>
      (model?.links ?? []).map((link) => {
        const from = boxes.get(link.from.entity)
        const to = boxes.get(link.to.entity)
        if (!from || !to) return null
        return { link, key: linkKey(link), d: connector({ box: from, row: rowIndex(link.from) }, { box: to, row: rowIndex(link.to) }) }
      }),
    [model, boxes, rowIndex],
  )

  /* ------------------------------------------------------------ motion */

  const known = useRef<{ entities: Set<string>; links: Set<string>; positions: Map<string, { x: number; y: number }>; connectors: Map<string, string>; stamp: number } | null>(null)

  useLayoutEffect(() => {
    const root = canvas.current
    if (!root) return
    const entityNames = new Set((model?.entities ?? []).map((entity) => entity.name))
    const linkKeys = new Set((model?.links ?? []).map(linkKey))
    const positions = new Map([...entityNames].map((name) => [name, positionOf(name)]))
    const connectors = new Map(links.flatMap((item) => (item ? [[item.key, item.d] as const] : [])))
    const before = known.current
    known.current = { entities: entityNames, links: linkKeys, positions, connectors, stamp: layoutCause.stamp }
    if (!before) return
    const entityEl = (name: string): SVGGElement | null => root.querySelector<SVGGElement>(selector('data-entity', name))
    for (const name of entityNames) {
      const added = before.entities.has(name) ? null : entityEl(name)
      if (added) playEntrance(added)
    }
    if (layoutCause.cause === 'arrange' && layoutCause.stamp !== before.stamp) {
      for (const [name, at] of positions) {
        const old = before.positions.get(name)
        const element = entityEl(name)
        if (old && element && (old.x !== at.x || old.y !== at.y)) playGlide(element, { x: old.x * GRID_PX, y: old.y * GRID_PX }, { x: at.x * GRID_PX, y: at.y * GRID_PX })
      }
      for (const [key, d] of connectors) {
        const path = root.querySelector<SVGPathElement>(`${selector('data-link', key)} path`)
        const old = before.connectors.get(key)
        if (path && old && old !== d) glideConnector(path, old, d)
      }
    }
    for (const key of linkKeys) {
      if (before.links.has(key)) continue
      const element = root.querySelector<SVGGElement>(selector('data-link', key))
      const link = model?.links.find((candidate) => linkKey(candidate) === key)
      if (!element || !link) continue
      const rows = [link.from, link.to].flatMap((ref) => root.querySelector(selector('data-column', refKey(ref))) ?? [])
      playDraw(element, rows)
    }
  }, [model, layoutCause, links, positionOf])

  /* -------------------------------------------------------------- zoom */

  const zoomTo = useCallback((percent: number, around?: { x: number; y: number }) => {
    const next = clamp(percent, ZOOM_MIN, ZOOM_MAX) / 100
    adjust((current) => {
      const box = region.current?.getBoundingClientRect()
      const focus = around ?? { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 }
      const scale = next / current.zoom
      return { zoom: next, x: focus.x - (focus.x - current.x) * scale, y: focus.y - (focus.y - current.y) * scale }
    })
  }, [])

  useEffect(() => {
    const element = region.current
    if (!element) return
    const wheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const box = element.getBoundingClientRect()
      zoomTo(zoomPercent(viewRef.current.zoom * Math.exp(-event.deltaY * 0.01)), { x: event.clientX - box.left, y: event.clientY - box.top })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [zoomTo])

  const percent = zoomPercent(view.zoom)

  /* ------------------------------------------------------------- pointer */

  const local = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = (region.current as HTMLDivElement).getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  const toCanvas = (point: { x: number; y: number }): { x: number; y: number } => ({
    x: (point.x - viewRef.current.x) / viewRef.current.zoom,
    y: (point.y - viewRef.current.y) / viewRef.current.zoom,
  })

  const columnAt = (event: { clientX: number; clientY: number }): ColumnRef | null => {
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-column]')
    const ref = hit?.getAttribute('data-column')
    if (!ref) return null
    const cut = ref.lastIndexOf('.')
    return { entity: ref.slice(0, cut), column: ref.slice(cut + 1) }
  }

  const select = (name: string, additive: boolean): void => {
    const current = selectionRef.current
    if (additive && current.includes(name)) {
      const next = current.filter((entry) => entry !== name)
      onSelection(next)
      actions.say(`Deselected ${name}. ${next.length} selected.`)
    } else {
      const next = additive ? [...current, name] : [name]
      onSelection(next)
      actions.say(`Selected ${name}. ${next.length} selected.`)
    }
  }

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.target as Element
    if (target.closest('.zoom-pill')) return
    const point = local(event)
    pointers.current.set(event.pointerId, { ...point, type: event.pointerType })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size === 2) {
      const [first, second] = firstTwo(pointers.current)
      pinch.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), zoom: viewRef.current.zoom, view: viewRef.current }
      gesture.current = null
      return
    }
    const handle = target.closest('[data-handle]')
    if (handle && canEdit) {
      const ref = handle.getAttribute('data-handle') as string
      const cut = ref.lastIndexOf('.')
      const from = { entity: ref.slice(0, cut), column: ref.slice(cut + 1) }
      gesture.current = { kind: 'link', from }
      const start = toCanvas(point)
      setPreview({ from, start, end: start })
      return
    }
    const entityTarget = target.closest('[data-entity]')
    const name = entityTarget?.getAttribute('data-entity') ?? null
    if (name && event.pointerType === 'mouse') {
      const drag = canEdit && target.closest('[data-header]') !== null
      gesture.current = { kind: 'entity', name, startX: point.x, startY: point.y, at: positionOf(name), view: viewRef.current, drag, moved: false, shift: event.shiftKey }
      return
    }
    gesture.current = { kind: 'pan', startX: point.x, startY: point.y, view: viewRef.current, moved: false, tapped: name }
  }

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const tracked = pointers.current.get(event.pointerId)
    if (!tracked) return
    const point = local(event)
    pointers.current.set(event.pointerId, { ...point, type: tracked.type })
    if (pinch.current && pointers.current.size >= 2) {
      const [first, second] = firstTwo(pointers.current)
      const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const start = pinch.current
      const zoom = clamp(zoomPercent((start.zoom * Math.hypot(first.x - second.x, first.y - second.y)) / start.distance), ZOOM_MIN, ZOOM_MAX) / 100
      const anchor = { x: (mid.x - start.view.x) / start.view.zoom, y: (mid.y - start.view.y) / start.view.zoom }
      adjust({ zoom, x: mid.x - anchor.x * zoom, y: mid.y - anchor.y * zoom })
      return
    }
    const current = gesture.current
    if (!current) return
    if (current.kind === 'pan') {
      const dx = point.x - current.startX
      const dy = point.y - current.startY
      if (Math.hypot(dx, dy) > TAP_SLOP) current.moved = true
      if (current.moved) adjust({ ...current.view, x: current.view.x + dx, y: current.view.y + dy })
    } else if (current.kind === 'entity') {
      const dx = point.x - current.startX
      const dy = point.y - current.startY
      if (Math.hypot(dx, dy) > TAP_SLOP) current.moved = true
      if (current.moved && current.drag) {
        const step = GRID_PX * viewRef.current.zoom
        setDragging({ name: current.name, x: clamp(Math.round(current.at.x + dx / step), 0, GRID_MAX), y: clamp(Math.round(current.at.y + dy / step), 0, GRID_MAX) })
      } else if (current.moved) adjust({ ...current.view, x: current.view.x + dx, y: current.view.y + dy })
    } else {
      setPreview((existing) => (existing ? { ...existing, end: toCanvas(point) } : existing))
    }
  }

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.delete(event.pointerId)) return
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      if (pointers.current.size === 0) gesture.current = null
      return
    }
    const current = gesture.current
    gesture.current = null
    if (!current) return
    if (current.kind === 'pan') {
      if (current.moved) return
      if (current.tapped) actions.openDetails(current.tapped)
      else if (selectionRef.current.length) {
        onSelection([])
        actions.say('Selection cleared.')
      }
    } else if (current.kind === 'entity') {
      setDragging(null)
      if (current.moved && dragging) {
        actions.move(dragging.name, dragging.x, dragging.y)
        actions.say(`Moved ${dragging.name} to ${dragging.x}, ${dragging.y}.`)
      } else if (!current.moved) select(current.name, event.shiftKey || current.shift)
    } else {
      setPreview(null)
      const target = columnAt(event)
      if (!target) actions.say('Link cancelled.')
      else actions.drawLink(current.from, target)
    }
  }

  const pointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId)
    pinch.current = null
    gesture.current = null
    setPreview(null)
    setDragging(null)
  }

  /* ------------------------------------------------------------ keyboard */

  const entityEl = (name: string): SVGGElement | null => canvas.current?.querySelector<SVGGElement>(selector('data-entity', name)) ?? null
  const columnEl = (ref: ColumnRef): SVGGElement | null => canvas.current?.querySelector<SVGGElement>(selector('data-column', refKey(ref))) ?? null

  const focusTarget = (ref: ColumnRef): void => {
    columnEl(ref)?.focus()
    actions.say(`Target ${refKey(ref)}.`)
  }

  const linkKeys = (event: KeyboardEvent<HTMLDivElement>, from: ColumnRef, current: ColumnRef): void => {
    const entities = model?.entities ?? []
    const at = entities.findIndex((entity) => entity.name === current.entity)
    const entity = entities[at]
    if (!entity) return
    const row = entity.columns.findIndex((column) => column.name === current.column)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = entity.columns[clamp(row + (event.key === 'ArrowDown' ? 1 : -1), 0, entity.columns.length - 1)]
      if (next) focusTarget({ entity: entity.name, column: next.name })
    } else if (event.key === 'Tab') {
      const other = entities[(at + (event.shiftKey ? -1 : 1) + entities.length) % entities.length]
      const first = other?.columns[0]
      if (other && first) focusTarget({ entity: other.name, column: first.name })
    } else if (event.key === 'Enter') {
      if (current.entity === from.entity && current.column === from.column) actions.say(COPY.sameColumn)
      else {
        setLinkMode(null)
        actions.drawLink(from, current)
      }
    } else if (event.key === 'Escape') {
      setLinkMode(null)
      actions.say('Link cancelled.')
    } else return
    event.preventDefault()
    event.stopPropagation()
  }

  const moveEntityBy = (name: string, dx: number, dy: number): void => {
    const at = positionOf(name)
    const next = { x: clamp(at.x + dx, 0, GRID_MAX), y: clamp(at.y + dy, 0, GRID_MAX) }
    if (canEdit && (next.x !== at.x || next.y !== at.y)) actions.move(name, next.x, next.y)
    actions.say(`Moved ${name} to ${next.x}, ${next.y}.`)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as Element
    const columnTarget = target.closest('[data-column]')
    const entityTarget = target.closest('[data-entity]')
    if (columnTarget && linkMode) {
      const ref = columnTarget.getAttribute('data-column') as string
      const cut = ref.lastIndexOf('.')
      linkKeys(event, linkMode.from, { entity: ref.slice(0, cut), column: ref.slice(cut + 1) })
      if (event.isPropagationStopped()) return
    }
    if (event.key === '+' || event.key === '=') {
      zoomTo(nextStep(percent, 1))
    } else if (event.key === '-' || event.key === '−') {
      zoomTo(nextStep(percent, -1))
    } else if (event.key === '0') {
      zoomTo(100)
    } else if (event.key === 'g' || event.key === 'G') {
      actions.openGroup()
    } else if (columnTarget) {
      const ref = columnTarget.getAttribute('data-column') as string
      const entity = entityTarget?.getAttribute('data-entity') as string
      const rows = [...(entityTarget?.querySelectorAll<SVGGElement>('[data-column]') ?? [])]
      const row = rows.indexOf(columnTarget as SVGGElement)
      if (event.key === 'ArrowDown') rows[Math.min(rows.length - 1, row + 1)]?.focus()
      else if (event.key === 'ArrowUp') rows[Math.max(0, row - 1)]?.focus()
      else if (event.key === 'Escape') entityEl(entity)?.focus()
      else if ((event.key === 'l' || event.key === 'L') && canEdit) {
        const cut = ref.lastIndexOf('.')
        const from = { entity: ref.slice(0, cut), column: ref.slice(cut + 1) }
        setLinkMode({ from })
        actions.say(`Linking from ${ref}. Choose a target column.`)
      } else return
    } else if (entityTarget && target === entityTarget) {
      const name = entityTarget.getAttribute('data-entity') as string
      const step = event.shiftKey ? SHIFT_STEPS : 1
      if (event.key === 'ArrowRight') moveEntityBy(name, step, 0)
      else if (event.key === 'ArrowLeft') moveEntityBy(name, -step, 0)
      else if (event.key === 'ArrowDown') moveEntityBy(name, 0, step)
      else if (event.key === 'ArrowUp') moveEntityBy(name, 0, -step)
      else if (event.key === ' ') select(name, true)
      else if (event.key === 'Enter') entityTarget.querySelector<SVGGElement>('[data-column]')?.focus()
      else if (event.key === 'i' || event.key === 'I') actions.openDetails(name)
      else if ((event.key === 'r' || event.key === 'R') && canEdit) actions.openRename(name)
      else if (event.key === 'Escape' && selectionRef.current.length) {
        onSelection([])
        actions.say('Selection cleared.')
      } else return
    } else if (target === region.current) {
      const pan = 2 * GRID_PX * view.zoom
      if (event.key === 'ArrowRight') adjust((current) => ({ ...current, x: current.x - pan }))
      else if (event.key === 'ArrowLeft') adjust((current) => ({ ...current, x: current.x + pan }))
      else if (event.key === 'ArrowDown') adjust((current) => ({ ...current, y: current.y - pan }))
      else if (event.key === 'ArrowUp') adjust((current) => ({ ...current, y: current.y + pan }))
      else return
    } else return
    event.preventDefault()
  }

  const focusIn = (event: React.FocusEvent<HTMLDivElement>): void => {
    onFocusEntity((event.target as Element).closest('[data-entity]')?.getAttribute('data-entity') ?? null)
  }

  const focusOut = (event: React.FocusEvent<HTMLDivElement>): void => {
    if (linkMode && !event.currentTarget.contains(event.relatedTarget as Node | null)) setLinkMode(null)
  }

  /* -------------------------------------------------------------- render */

  const groups = useMemo(
    () =>
      (model?.groups ?? []).flatMap((group) => {
        const members = group.entities.flatMap((name) => boxes.get(name) ?? [])
        return members.length ? [{ name: group.name, box: groupBox(members), color: layout.groups[group.name]?.color ?? DEFAULT_GROUP_COLOR }] : []
      }),
    [model, boxes, layout.groups],
  )

  const previewPath = preview
    ? `M ${preview.start.x} ${preview.start.y} H ${(preview.start.x + preview.end.x) / 2} V ${preview.end.y} H ${preview.end.x}`
    : null
  const dots = Math.max(8, GRID_PX * view.zoom)

  return (
    <div
      ref={region}
      className="diagram"
      role="region"
      aria-label={label}
      tabIndex={0}
      style={{ backgroundSize: `${dots}px ${dots}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerCancel}
      onKeyDown={keyDown}
      onFocus={focusIn}
      onBlur={focusOut}
    >
      <svg ref={canvas} className="canvas" width="100%" height="100%" focusable="false">
        <defs>
          <marker id="end-many" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 6 L12 0 M0 6 L12 6 M0 6 L12 12" className="link-end" />
          </marker>
          <marker id="end-one" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M7 0 V12 M7 6 H12" className="link-end" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <g className="group-layer">
            {groups.map((group) => (
              <g key={group.name} className="group-region" data-group-region={group.name} data-color={group.color}>
                <rect className="group-fill" x={group.box.x} y={group.box.y} width={group.box.width} height={group.box.height} rx={10} />
                <path
                  className="group-strip"
                  d={`M${group.box.x} ${group.box.y + 28} V${group.box.y + 10} a10 10 0 0 1 10 -10 H${group.box.x + group.box.width - 10} a10 10 0 0 1 10 10 V${group.box.y + 28} Z`}
                />
                <text className="group-title" x={group.box.x + 12} y={group.box.y + 19}>
                  {group.name}
                </text>
              </g>
            ))}
          </g>
          <g className="link-layer">
            {links.map((item) => {
              if (!item) return null
              const { link, key, d } = item
              const markerStart = endMarker(link, 'from')
              const markerEnd = endMarker(link, 'to')
              return (
                <g key={key} data-link={key} data-cardinality={link.cardinality} className="link">
                  <path d={d} className="link-line" markerStart={`url(#${markerStart})`} markerEnd={`url(#${markerEnd})`} />
                </g>
              )
            })}
            {previewPath ? <path className="link-preview" data-preview="true" d={previewPath} /> : null}
          </g>
          <g className="entity-layer">
            {entityViews.map((item) => {
              const name = item.entity.name
              const at = positionOf(name)
              return (
                <EntityNode
                  key={name}
                  view={item}
                  x={at.x}
                  y={at.y}
                  color={layout.entities[name]?.color ?? DEFAULT_ENTITY_COLOR}
                  group={model ? groupOf(model, name) : null}
                  selected={selection.includes(name)}
                  editable={canEdit}
                />
              )
            })}
          </g>
        </g>
      </svg>
      <ul aria-label="Diagram outline" className="sr-only">
        {outline.map((item, index) => (
          <li key={`${index}:${item}`}>{item}</li>
        ))}
      </ul>
      <div className="zoom-pill">
        <button type="button" className="zoom-button" aria-label="Zoom out" disabled={percent <= ZOOM_MIN} onClick={() => zoomTo(nextStep(percent, -1))}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <div className="zoom-track" aria-hidden="true">
          <span className="zoom-knob" style={{ left: `${((percent - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%` }} />
        </div>
        <span role="status" aria-label="Zoom" className="zoom-readout">
          Zoom {percent}%
        </span>
        <button type="button" className="zoom-button" aria-label="Zoom in" disabled={percent >= ZOOM_MAX} onClick={() => zoomTo(nextStep(percent, 1))}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/** The end marker for one side of a link: the foreign-key side of a many-to-one is the "many" end. */
function endMarker(link: Link, side: 'from' | 'to'): string {
  const token = link.token
  const many = token === '>-<' || (token === '>-' && side === 'from') || (token === '-<' && side === 'to')
  return many ? 'end-many' : 'end-one'
}

