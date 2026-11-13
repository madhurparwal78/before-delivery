/** Faint contour lines, generated once in the browser from smooth noise; they never move. */
const LATTICE = 260
const CELL = 12
const LEVELS = 9

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

function field(x: number, y: number): number {
  const sample = (scale: number): number => {
    const gx = x / scale
    const gy = y / scale
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const tx = smooth(gx - x0)
    const ty = smooth(gy - y0)
    const top = hash(x0, y0) * (1 - tx) + hash(x0 + 1, y0) * tx
    const bottom = hash(x0, y0 + 1) * (1 - tx) + hash(x0 + 1, y0 + 1) * tx
    return top * (1 - ty) + bottom * ty
  }
  return sample(LATTICE) * 0.7 + sample(LATTICE / 2.3) * 0.3
}

type Edge = 0 | 1 | 2 | 3
const SEGMENTS: Record<number, [Edge, Edge][]> = {
  1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 3], [2, 1]], 6: [[0, 2]], 7: [[0, 3]],
  8: [[0, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
}

export function paintContours(): void {
  const canvas = document.createElement('canvas')
  canvas.className = 'contours'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.prepend(canvas)
  const draw = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = width * scale
    canvas.height = height * scale
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(scale, scale)
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--contour').trim() || '#d8d0ba'
    context.lineWidth = 1
    const columns = Math.ceil(width / CELL) + 1
    const rows = Math.ceil(height / CELL) + 1
    const values: number[][] = Array.from({ length: rows + 1 }, (_, r) => Array.from({ length: columns + 1 }, (_, c) => field(c * CELL, r * CELL)))
    context.beginPath()
    for (let level = 1; level <= LEVELS; level++) {
      const threshold = 0.2 + (level / (LEVELS + 1)) * 0.6
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const tl = values[r]?.[c] ?? 0
          const tr = values[r]?.[c + 1] ?? 0
          const br = values[r + 1]?.[c + 1] ?? 0
          const bl = values[r + 1]?.[c] ?? 0
          const index = (tl >= threshold ? 8 : 0) | (tr >= threshold ? 4 : 0) | (br >= threshold ? 2 : 0) | (bl >= threshold ? 1 : 0)
          const x = c * CELL
          const y = r * CELL
          const at = (edge: Edge): [number, number] => {
            if (edge === 0) return [x + (CELL * (threshold - tl)) / (tr - tl), y]
            if (edge === 1) return [x + CELL, y + (CELL * (threshold - tr)) / (br - tr)]
            if (edge === 2) return [x + (CELL * (threshold - bl)) / (br - bl), y + CELL]
            return [x, y + (CELL * (threshold - tl)) / (bl - tl)]
          }
          for (const [from, to] of SEGMENTS[index] ?? []) {
            const [x1, y1] = at(from)
            const [x2, y2] = at(to)
            context.moveTo(x1, y1)
            context.lineTo(x2, y2)
          }
        }
      }
    }
    context.stroke()
  }
  draw()
  window.addEventListener('resize', draw)
}
