// Turns the server's standalone system SVGs into canvases the GL scene can upload as textures.
// An SVG loaded through an <img> cannot see document fonts, so the fonts are embedded as base64 @font-face.

const PAPER_COLOUR = '#f6f1e7'
const SVG_NS = 'http://www.w3.org/2000/svg'

interface StaffBand {
  id: string
  top: number
  height: number
}

export interface SvgInfo {
  width: number
  height: number
  staves: StaffBand[]
}

interface FontFace {
  family: string
  url: string
  style: 'normal' | 'italic'
}

const FONT_FACES: readonly FontFace[] = [
  { family: 'Bravura', url: '/fonts/Bravura.woff2', style: 'normal' },
  { family: 'IBM Plex Sans', url: '/fonts/ibm-plex-sans-latin-400-normal.woff2', style: 'normal' },
  { family: 'IBM Plex Sans', url: '/fonts/ibm-plex-sans-latin-400-italic.woff2', style: 'italic' },
  { family: 'IBM Plex Mono', url: '/fonts/ibm-plex-mono-latin-400-normal.woff2', style: 'normal' },
]

let fontStyle: Promise<string> | null = null

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

async function loadFontFace(face: FontFace): Promise<string> {
  try {
    const response = await fetch(face.url)
    if (!response.ok) return ''
    const data = toBase64(new Uint8Array(await response.arrayBuffer()))
    return `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:400;src:url(data:font/woff2;base64,${data}) format("woff2");}`
  } catch {
    return ''
  }
}

/** The embedded @font-face rules, fetched once and cached. */
function embeddedFontStyle(): Promise<string> {
  fontStyle ??= Promise.all(FONT_FACES.map(loadFontFace)).then((rules) => rules.join(''))
  return fontStyle
}

function ensureNamespace(svg: string): string {
  return /<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/<svg\b/, `<svg xmlns="${SVG_NS}"`)
}

function parseViewBox(root: Element): { width: number; height: number } {
  const parts = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const width = parts[2]
  const height = parts[3]
  if (width !== undefined && height !== undefined && width > 0 && height > 0) return { width, height }
  return { width: Number(root.getAttribute('width')) || 1000, height: Number(root.getAttribute('height')) || 300 }
}

function parseDocument(svg: string): Document | null {
  const doc = new DOMParser().parseFromString(ensureNamespace(svg), 'image/svg+xml')
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc
}

/** The viewBox size and the staff bands (in viewBox units) the server drew into a system. */
export function readSvgInfo(svg: string): SvgInfo {
  const doc = parseDocument(svg)
  if (!doc) return { width: 1000, height: 300, staves: [] }
  const root = doc.documentElement
  const { width, height } = parseViewBox(root)
  const staves: StaffBand[] = []
  for (const group of Array.from(root.querySelectorAll('[data-staff-id]'))) {
    const id = group.getAttribute('data-staff-id')
    const top = Number(group.getAttribute('data-staff-top'))
    const bandHeight = Number(group.getAttribute('data-staff-height'))
    if (id && Number.isFinite(top) && Number.isFinite(bandHeight) && bandHeight > 0) staves.push({ id, top, height: bandHeight })
  }
  staves.sort((a, b) => a.top - b.top)
  return { width, height, staves }
}

/** The SVG with fonts embedded and a pixel size, ready to be loaded as an image. */
function prepareMarkup(svg: string, pixelWidth: number, pixelHeight: number, style: string): string {
  const doc = parseDocument(svg)
  if (!doc) return ensureNamespace(svg)
  const root = doc.documentElement
  root.setAttribute('width', String(pixelWidth))
  root.setAttribute('height', String(pixelHeight))
  const rules = doc.createElementNS(SVG_NS, 'style')
  rules.textContent = style
  root.insertBefore(rules, root.firstChild)
  return new XMLSerializer().serializeToString(root)
}

async function loadImage(markup: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function paperCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  // A CPU-backed canvas: the SVG is rasterised here, once, and uploaded as a texture, so the GPU stays free for drawing frames.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D canvas unavailable')
  context.fillStyle = PAPER_COLOUR
  context.fillRect(0, 0, width, height)
  return { canvas, context }
}

/** Draws one system SVG onto paper at the given pixel size. */
export async function rasteriseSystem(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const style = await embeddedFontStyle()
  const image = await loadImage(prepareMarkup(svg, width, height, style))
  const { canvas, context } = paperCanvas(width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas
}

export interface SheetPlacement {
  svg: string
  x: number
  y: number
  width: number
  height: number
}

/** Draws several SVGs onto one sheet of paper at pixel rectangles. */
export async function rasteriseSheet(width: number, height: number, placements: readonly SheetPlacement[]): Promise<HTMLCanvasElement> {
  const style = await embeddedFontStyle()
  const images = await Promise.all(
    placements.map((p) => loadImage(prepareMarkup(p.svg, Math.round(p.width), Math.round(p.height), style))),
  )
  const { canvas, context } = paperCanvas(width, height)
  placements.forEach((p, i) => {
    const image = images[i]
    if (image) context.drawImage(image, p.x, p.y, p.width, p.height)
  })
  return canvas
}
