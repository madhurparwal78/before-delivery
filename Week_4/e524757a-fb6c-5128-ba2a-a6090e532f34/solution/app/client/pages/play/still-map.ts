/** The island drawn from its tile data: coast, pond, rocks and the lighthouse. Used by the still fallback. */
import { GRID, SPOTS, tileKind, type Island } from '../../../shared/island'
import { svg } from '../../lib/dom'

const COLOURS = { water: '#8fbcd0', land: '#a9c58a', rock: '#7d8288', lighthouse: '#f4f1e8' }

export function stillMap(island: Island): SVGElement {
  const cells: SVGElement[] = []
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const kind = tileKind(island, x, y)
      if (kind === 'water') continue
      cells.push(svg('rect', { x, y, width: 1.02, height: 1.02, fill: COLOURS[kind], rx: kind === 'rock' ? 0.3 : 0 }))
    }
  }
  const spots = SPOTS.map(({ tile: [x, y] }) => svg('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.28, fill: '#0b0b0c' }))
  return svg('svg', {
    role: 'img', 'aria-label': `Still map of ${island.name}`, viewBox: `0 0 ${GRID} ${GRID}`, class: 'still-map',
  }, svg('rect', { width: GRID, height: GRID, fill: COLOURS.water }), ...cells, ...spots)
}
