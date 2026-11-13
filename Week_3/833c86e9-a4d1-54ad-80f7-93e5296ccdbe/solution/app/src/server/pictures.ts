import { createHash } from 'node:crypto'

const INK = '#000000'
const GROUND = '#FFFFFF'
const SURFACE = '#F2F2F2'
const ORANGE = '#F25C05'
const SAGE = '#CDE3C8'
const ACID = '#E4FF1A'

function rng(seed: string): () => number {
  const bytes = createHash('sha256').update(seed).digest()
  let i = 0
  return () => bytes[i++ % bytes.length] / 255
}

const frame = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">${inner}</svg>`

function harbour(rand: () => number): string {
  const houses = Array.from({ length: 9 }, (_, i) => {
    const w = 60 + Math.floor(rand() * 30)
    const h = 70 + Math.floor(rand() * 90)
    const x = 20 + i * 84
    const windows = [0, 1, 2].map((k) => `<rect x="${x + 10 + k * 22}" y="${330 - h + 14 + (k % 2) * 26}" width="10" height="14" fill="${rand() > 0.35 ? ACID : INK}"/>`).join('')
    return `<rect x="${x}" y="${330 - h}" width="${w}" height="${h}" fill="${i % 3 === 0 ? SAGE : SURFACE}"/><polygon points="${x},${330 - h} ${x + w / 2},${300 - h} ${x + w},${330 - h}" fill="${INK}"/>${windows}`
  }).join('')
  const boats = Array.from({ length: 3 }, (_, i) => {
    const x = 90 + i * 250 + Math.floor(rand() * 60)
    return `<polygon points="${x},392 ${x + 90},392 ${x + 74},420 ${x + 16},420" fill="${INK}"/><rect x="${x + 44}" y="340" width="4" height="52" fill="${INK}"/><polygon points="${x + 48},342 ${x + 48},388 ${x + 84},388" fill="${ORANGE}"/>`
  }).join('')
  return frame(`<rect width="800" height="500" fill="${GROUND}"/><rect y="0" width="800" height="150" fill="${SURFACE}"/><circle cx="${620 + Math.floor(rand() * 100)}" cy="70" r="34" fill="${ACID}"/>${houses}<rect y="330" width="800" height="14" fill="${INK}"/><rect y="344" width="800" height="156" fill="${SAGE}"/>${boats}<rect y="436" width="800" height="64" fill="${INK}"/>`)
}

function room(rand: () => number): string {
  const lamp = 100 + Math.floor(rand() * 40)
  return frame(`<rect width="800" height="500" fill="${SURFACE}"/><rect y="380" width="800" height="120" fill="${GROUND}"/><rect x="470" y="70" width="240" height="210" fill="${INK}"/><circle cx="${540 + Math.floor(rand() * 80)}" cy="140" r="30" fill="${ACID}"/><rect x="470" y="168" width="240" height="8" fill="${GROUND}"/><rect x="586" y="70" width="8" height="210" fill="${GROUND}"/><rect x="90" y="270" width="330" height="110" fill="${INK}"/><rect x="90" y="236" width="330" height="48" fill="${SAGE}"/><rect x="110" y="214" width="110" height="36" fill="${GROUND}"/><rect x="${lamp + 330}" y="230" width="10" height="150" fill="${INK}"/><polygon points="${lamp + 310},230 ${lamp + 360},230 ${lamp + 350},190 ${lamp + 320},190" fill="${ORANGE}"/>`)
}

function terrace(rand: () => number): string {
  const sail = 240 + Math.floor(rand() * 120)
  return frame(`<rect width="800" height="500" fill="${GROUND}"/><rect y="170" width="800" height="110" fill="${SAGE}"/><rect y="200" width="800" height="6" fill="${INK}"/><rect y="280" width="800" height="220" fill="${SURFACE}"/><rect x="${sail}" y="120" width="8" height="260" fill="${INK}"/><polygon points="${sail - 160},150 ${sail + 168},150 ${sail + 4},60" fill="${ORANGE}"/><rect x="${sail - 80}" y="340" width="170" height="14" fill="${INK}"/><rect x="${sail - 70}" y="354" width="10" height="70" fill="${INK}"/><rect x="${sail + 70}" y="354" width="10" height="70" fill="${INK}"/><circle cx="${sail + 20}" cy="326" r="14" fill="${ACID}"/><rect x="620" y="300" width="90" height="120" fill="${INK}"/>`)
}

/** Three drawn pictures per property, varied by the property code. */
export function picture(code: string, n: number): string {
  const rand = rng(`${code}|${n}`)
  return [harbour, room, terrace][n - 1](rand)
}

export const PICTURE_COUNT = 3
