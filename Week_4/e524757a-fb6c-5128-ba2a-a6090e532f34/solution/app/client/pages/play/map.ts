/** `application "Island map"`: the 24 by 24 grid fills a square; `data-tile-size` is whole px per tile and tile x,y covers
 *  x times that size to (x + 1) times it from the map's left edge, and the same from its top edge. */
import { GRID, HEADING_ANGLE, tileKind, type Heading, type Island, type Tile } from '../../../shared/island'
import type { Sighting } from '../../../shared/types'
import { h } from '../../lib/dom'

const FILL = { water: '#8fbcd0', land: '#a9c58a', rock: '#7d8288', lighthouse: '#f4f1e8' }
const TAP_PX = 6

interface IslandMap {
  el: HTMLElement
  setIsland(island: Island): void
  setExplorer(tile: Tile, heading: Heading): void
  setSightings(sightings: readonly Sighting[]): void
  /** Put the cursor on `tile` (the map opens with it on the explorer). */
  resetCursor(tile: Tile): void
  /** Size the grid to fit `width` px. */
  fit(width: number): void
}

export function islandMap(options: { onWalk(tile: Tile): void; onSighting(tile: Tile): void }): IslandMap {
  const canvas = h('canvas', { 'aria-hidden': 'true' })
  const el = h('div', { role: 'application', 'aria-label': 'Island map', tabindex: 0, class: 'island-map', 'data-cursor': '0,0', 'data-tile-size': '12' }, canvas)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  let island: Island
  let tileSize = 12
  let cursor: Tile = [0, 0]
  let explorer: { tile: Tile; heading: Heading } = { tile: [0, 0], heading: 'N' }
  let sightings: readonly Sighting[] = []
  let down: { x: number; y: number; id: number } | null = null

  const draw = (): void => {
    if (!island) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const scale = canvas.width / (GRID * tileSize)
    ctx.scale(scale, scale)
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        ctx.fillStyle = FILL[tileKind(island, x, y)]
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
      }
    }
    ctx.fillStyle = '#0b0b0c'
    for (const sighting of sightings) {
      if (sighting.island !== island.id) continue
      const cx = (sighting.x + 0.5) * tileSize
      const cy = (sighting.y + 0.5) * tileSize
      ctx.beginPath()
      ctx.moveTo(cx, cy - tileSize * 0.4)
      ctx.lineTo(cx + tileSize * 0.4, cy)
      ctx.lineTo(cx, cy + tileSize * 0.4)
      ctx.lineTo(cx - tileSize * 0.4, cy)
      ctx.closePath()
      ctx.fill()
    }
    const [ex, ey] = explorer.tile
    ctx.save()
    ctx.translate((ex + 0.5) * tileSize, (ey + 0.5) * tileSize)
    ctx.rotate((HEADING_ANGLE[explorer.heading] * Math.PI) / 180)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#0b0b0c'
    ctx.lineWidth = Math.max(1.5, tileSize * 0.15)
    ctx.beginPath()
    ctx.moveTo(0, -tileSize * 0.55)
    ctx.lineTo(tileSize * 0.42, tileSize * 0.4)
    ctx.lineTo(-tileSize * 0.42, tileSize * 0.4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = '#0b0b0c'
    ctx.lineWidth = Math.max(2, tileSize * 0.2)
    const inset = ctx.lineWidth / 2
    ctx.strokeRect(cursor[0] * tileSize + inset, cursor[1] * tileSize + inset, tileSize - ctx.lineWidth, tileSize - ctx.lineWidth)
  }

  const moveCursor = (tile: Tile): void => {
    cursor = tile
    el.dataset.cursor = `${tile[0]},${tile[1]}`
    draw()
  }

  const tileAt = (event: PointerEvent): Tile => {
    const box = el.getBoundingClientRect()
    const clamp = (v: number): number => Math.min(GRID - 1, Math.max(0, Math.floor(v / tileSize)))
    return [clamp(event.clientX - box.left), clamp(event.clientY - box.top)]
  }

  el.addEventListener('keydown', (event) => {
    const [x, y] = cursor
    const move: Record<string, Tile> = { ArrowLeft: [x - 1, y], ArrowRight: [x + 1, y], ArrowUp: [x, y - 1], ArrowDown: [x, y + 1] }
    const next = move[event.key]
    if (next) {
      event.preventDefault()
      moveCursor([Math.min(GRID - 1, Math.max(0, next[0])), Math.min(GRID - 1, Math.max(0, next[1]))])
    } else if (event.key === 'Enter') {
      event.preventDefault()
      options.onWalk(cursor)
    } else if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      options.onSighting(cursor)
    }
  })
  el.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY, id: event.pointerId }
    el.focus()
  })
  el.addEventListener('pointerup', (event) => {
    const start = down
    down = null
    if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= TAP_PX) return
    const tile = tileAt(event)
    moveCursor(tile)
    options.onWalk(tile)
  })
  el.addEventListener('pointercancel', () => { down = null })

  return {
    el,
    setIsland(next) { island = next; draw() },
    setExplorer(tile, heading) { explorer = { tile, heading }; draw() },
    setSightings(next) { sightings = next; draw() },
    resetCursor(tile) { moveCursor(tile) },
    fit(width) {
      const next = Math.max(8, Math.floor(width / GRID))
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      tileSize = next
      el.dataset.tileSize = String(next)
      el.style.width = el.style.height = `${GRID * next}px`
      canvas.width = canvas.height = GRID * next * ratio
      canvas.style.width = canvas.style.height = `${GRID * next}px`
      draw()
    },
  }
}
