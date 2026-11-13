/** The Long Table grid shape (black squares as #), drawn as a still one-bit picture. Letters are decoration. */
const LONG_TABLE_SHAPE = [
  '#.....#...##...',
  '#.....#...##...',
  '......#....#...',
  '.....#...#...##',
  '...#...##.....#',
  '#...#.....#....',
  '###...#....#...',
  '.....#...#.....',
  '...#....#...###',
  '....#.....#...#',
  '#.....##...#...',
  '##...#...#.....',
  '...#....#......',
  '...##...#.....#',
  '...##...#.....#',
]

const DOT = 3
const DARK = 27
const LIGHT = 236
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]
const LETTERS = 'EEEEAAAIIIOONNRRTTLLSSDUCMHGPBFYKWVXJQZ'

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function picture(width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas is unavailable')
  const random = seeded(15)
  const square = Math.max(width, height) / 9
  context.fillStyle = '#7d7d7d'
  context.fillRect(0, 0, width, height)
  context.save()
  context.translate(width / 2, height / 2)
  context.rotate(-0.16)
  const size = LONG_TABLE_SHAPE.length
  context.translate(-(size * square) / 2 - square * 0.6, -(size * square) / 2 - square * 0.3)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `700 ${square * 0.62}px "Albert Sans", sans-serif`
  LONG_TABLE_SHAPE.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const x = c * square
      const y = r * square
      context.fillStyle = row[c] === '#' ? '#161616' : '#f1f1f1'
      context.fillRect(x + 1, y + 1, square - 2, square - 2)
      if (row[c] !== '#') {
        context.fillStyle = '#1c1c1c'
        context.fillText(LETTERS[Math.floor(random() * LETTERS.length)], x + square / 2, y + square / 2 + square * 0.04)
        if (random() < 0.28) {
          context.font = `600 ${square * 0.2}px "Albert Sans", sans-serif`
          context.textAlign = 'left'
          context.fillText(String(1 + Math.floor(random() * 60)), x + square * 0.1, y + square * 0.18)
          context.textAlign = 'center'
          context.font = `700 ${square * 0.62}px "Albert Sans", sans-serif`
        }
      }
    }
  })
  context.restore()
  const light = context.createRadialGradient(width * 0.5, height * 0.45, Math.min(width, height) * 0.1, width * 0.5, height * 0.5, Math.max(width, height) * 0.75)
  light.addColorStop(0, 'rgba(255,255,255,0.28)')
  light.addColorStop(1, 'rgba(0,0,0,0.38)')
  context.fillStyle = light
  context.fillRect(0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

function dither(source: ImageData, left: number, top: number, canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas is unavailable')
  const out = context.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const from = ((top + y) * source.width + left + x) * 4
      const value = source.data[from] / 255 > (BAYER[y % 4][x % 4] + 0.5) / 16 ? LIGHT : DARK
      const to = (y * canvas.width + x) * 4
      out.data.set([value, value, value, 255], to)
    }
  }
  context.putImageData(out, 0, 0)
}

/** One photograph of the grid continues across the diagonal tiles: top-right shows its upper right, bottom-left its lower left. */
export async function drawHero(topRight: HTMLCanvasElement, bottomLeft: HTMLCanvasElement): Promise<void> {
  await document.fonts.load('700 20px "Albert Sans"')
  const sizes = [topRight, bottomLeft].map((canvas) => ({ canvas, width: Math.max(8, Math.round(canvas.clientWidth / DOT)), height: Math.max(8, Math.round(canvas.clientHeight / DOT)) }))
  for (const { canvas, width, height } of sizes) {
    canvas.width = width
    canvas.height = height
  }
  const [a, b] = sizes
  const gap = Math.round(8 / DOT)
  const whole = picture(a.width + b.width + gap, a.height + b.height + gap)
  dither(whole, b.width + gap, 0, a.canvas)
  dither(whole, 0, a.height + gap, b.canvas)
}
