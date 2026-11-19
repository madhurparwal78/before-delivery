import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { COLORS } from './constants'

// Every texture is drawn here with the canvas API; no image or model file is loaded.

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const context = element.getContext('2d')
  if (context === null) throw new Error('2d canvas unavailable')
  return [element, context]
}

function texture(element: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const result = new CanvasTexture(element)
  result.colorSpace = SRGBColorSpace
  if (repeat) {
    result.wrapS = RepeatWrapping
    result.wrapT = RepeatWrapping
  }
  result.anisotropy = 4
  return result
}

// u runs across the strip, v along it (up the canvas). One bold chevron per repeat, so it reads at fit-all zoom.
export function chevronTexture(background: string, foreground: string): CanvasTexture {
  const [element, g] = canvas(128, 128)
  g.fillStyle = background
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = foreground
  g.lineWidth = 26
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(22, 104)
  g.lineTo(64, 40)
  g.lineTo(106, 104)
  g.stroke()
  return texture(element, true)
}

export function hatchTexture(background: string, line: string): CanvasTexture {
  const size = 64
  const stripes = 3
  const [element, g] = canvas(size, size)
  g.fillStyle = background
  g.fillRect(0, 0, size, size)
  g.strokeStyle = line
  g.lineWidth = 7
  g.beginPath()
  for (let i = -stripes; i <= stripes; i += 1) {
    const offset = (i * size) / stripes
    g.moveTo(offset, size)
    g.lineTo(offset + size, 0)
  }
  g.stroke()
  return texture(element, true)
}

// A freight engine in side view, turned to lie along the strip: one down each side of the rails, repeated along
// the whole band, so an occupied block carries the glyph wherever the train itself stands.
export function trainGlyphTexture(): CanvasTexture {
  const [element, g] = canvas(256, 192)
  g.fillStyle = COLORS.action
  g.fillRect(0, 0, 256, 192)
  for (const across of [40, 216]) {
    g.save()
    g.translate(across, 96)
    g.rotate(-Math.PI / 2)
    g.scale(1.45, 1.45)
    g.lineJoin = 'round'
    g.strokeStyle = COLORS.ground
    g.lineWidth = 5
    g.fillStyle = COLORS.ink
    const body = new Path2D()
    body.rect(-29, -12, 58, 22)
    body.rect(-29, -22, 18, 12)
    body.rect(13, -21, 9, 10)
    g.stroke(body)
    g.fill(body)
    g.fillStyle = COLORS.ground
    g.fillRect(-25, -18, 10, 5)
    g.fillStyle = COLORS.ink
    g.lineWidth = 3
    for (const x of [-17, 0, 17]) {
      g.beginPath()
      g.arc(x, 12, 7, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    g.restore()
  }
  return texture(element, true)
}

// Large hall floor tiles with a fine joint: the field green stays the colour, the joints only give it scale.
export function floorTexture(): CanvasTexture {
  const [element, g] = canvas(256, 256)
  g.fillStyle = COLORS.field
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = 'rgba(255,255,255,0.1)'
  g.fillRect(0, 0, 256, 3)
  g.fillRect(0, 0, 3, 256)
  return texture(element, true)
}

// One bay of hall wall from the floor up: a skirting, a pale wall rising into the roof lining, and a column.
export function hallTexture(): CanvasTexture {
  const [element, g] = canvas(128, 1024)
  const gradient = g.createLinearGradient(0, 0, 0, 1024)
  gradient.addColorStop(0, COLORS.hall)
  gradient.addColorStop(0.72, COLORS.hall)
  gradient.addColorStop(0.97, '#FFFFFF')
  g.fillStyle = gradient
  g.fillRect(0, 0, 128, 1024)
  g.fillStyle = COLORS.surface
  g.fillRect(0, 0, 8, 1024)
  g.fillRect(120, 0, 8, 1024)
  g.fillRect(0, 1003, 128, 7)
  g.fillStyle = COLORS.lip
  g.fillRect(0, 1010, 128, 14)
  return texture(element, true)
}

export function boardTexture(name: string): CanvasTexture {
  const [element, g] = canvas(512, 128)
  g.fillStyle = COLORS.ground
  g.fillRect(0, 0, 512, 128)
  g.strokeStyle = COLORS.accentDeep
  g.lineWidth = 12
  g.strokeRect(6, 6, 500, 116)
  g.fillStyle = COLORS.ink
  let size = 56
  do {
    g.font = `600 ${size}px Fredoka, "Trebuchet MS", sans-serif`
    size -= 2
  } while (g.measureText(name).width > 450 && size > 20)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(name, 256, 66, 460)
  return texture(element, false)
}
