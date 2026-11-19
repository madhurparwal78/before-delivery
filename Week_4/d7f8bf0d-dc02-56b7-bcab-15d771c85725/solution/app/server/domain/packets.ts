import type { PacketContent } from '../../shared/domain'
import { canonicalHash } from '../canonical'
import { fastClockLabel, type PinnedBlock, type SessionState } from './session/state'

// Crew packet content is built at render time from the session version and the current names.

export function packetContent(state: SessionState): PacketContent {
  const stationName = (id: string): string => state.stations.find(station => station.id === id)?.name ?? id
  const trains = [...state.trains].sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
  const entries = (trainId: string) => state.timetable.filter(entry => entry.train_id === trainId)
    .sort((a, b) => a.depart_fast_seconds - b.depart_fast_seconds || a.id.localeCompare(b.id))
  const startName = (trainId: string): string => {
    const train = state.trains.find(candidate => candidate.id === trainId)
    const block = state.blocks.find(candidate => candidate.id === train?.start_block_id)
    return state.stations.find(station => block !== undefined && station.block_ids.includes(block.id))?.name ?? block?.name ?? ''
  }
  const timetable = [...state.timetable]
    .sort((a, b) => a.depart_fast_seconds - b.depart_fast_seconds || a.id.localeCompare(b.id))
    .map(entry => ({
      entry_id: entry.id,
      time: fastClockLabel(entry.depart_fast_seconds),
      train_number: state.trains.find(train => train.id === entry.train_id)?.number ?? entry.train_id,
      station: stationName(entry.station_id),
    }))
  const orders = trains.map(train => {
    const own = entries(train.id)
    const first = own.length > 0 ? stationName(own[0].station_id) : startName(train.id)
    const last = own.length > 0 ? stationName(own[own.length - 1].station_id) : first
    const departing = fastClockLabel(own.length > 0 ? own[0].depart_fast_seconds : 0)
    return `Train ${train.number} ${train.name}: run ${train.direction} from ${first} to ${last}, departing ${departing}.`
  })
  const blocks = [...state.blocks].sort((a, b) => a.number - b.number)
  return {
    timetable,
    train_orders: orders,
    block_table: blocks.map(block => ({ number: block.number, name: block.name, kind: block.kind, length_mm: block.length_mm })),
    track_diagram: blocks.map(block => ({ number: block.number, name: block.name, kind: block.kind })),
  }
}

export const packetHash = (sessionVersion: number, content: PacketContent): string =>
  canonicalHash({ session_version: sessionVersion, content })

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)

function diagram(blocks: PacketContent['track_diagram'], pinned: PinnedBlock[]): string {
  const width = 720
  const mainline = blocks.filter(block => block.kind !== 'loop')
  const total = mainline.reduce((sum, block) => sum + (pinned.find(p => p.number === block.number)?.length_mm ?? 1), 0)
  const spans = new Map<number, [number, number]>()
  let cursor = 0
  for (const block of mainline) {
    const length = pinned.find(p => p.number === block.number)?.length_mm ?? 1
    spans.set(block.number, [cursor / total * width, (cursor + length) / total * width])
    cursor += length
  }
  const drawn = blocks.map(block => {
    const [x0, x1] = spans.get(block.number) ?? loopSpan(block.number, pinned, spans)
    const y = block.kind === 'loop' ? 70 : 20
    const fill = block.kind === 'loop' ? '#E8ECF4' : block.kind === 'approach' ? '#FFE3B8' : '#CDEBD8'
    return `<g><rect x="${x0.toFixed(1)}" y="${y}" width="${Math.max(x1 - x0 - 4, 8).toFixed(1)}" height="34" rx="6" fill="${fill}" stroke="#0158B4" stroke-width="1.5"/>`
      + `<text x="${((x0 + x1) / 2 - 2).toFixed(1)}" y="${y + 22}" font-size="11" text-anchor="middle" fill="#2B3145">${block.number}</text></g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="120" viewBox="0 0 ${width} 120">${drawn.join('')}</svg>`
}

function loopSpan(number: number, pinned: PinnedBlock[], spans: Map<number, [number, number]>): [number, number] {
  const loop = pinned.find(block => block.number === number)
  const neighbours = (loop?.neighbour_ids ?? []).map(id => pinned.find(block => block.id === id)).filter((b): b is PinnedBlock => b !== undefined)
  if (neighbours.length >= 2) {
    const west = spans.get(Math.min(...neighbours.map(b => b.number)))
    const east = spans.get(Math.max(...neighbours.map(b => b.number)))
    if (west !== undefined && east !== undefined) return [west[1], east[0]]
  }
  const anchor = neighbours[0]?.number ?? number
  const beside = [...spans.keys()].filter(n => (number < anchor ? n < anchor : n > anchor)).sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0]
  return spans.get(beside) ?? [0, 80]
}

export function packetHtml(sessionName: string, sessionVersion: number, content: PacketContent, pinned: PinnedBlock[]): string {
  const rowsOf = (cells: string[][]): string => cells.map(cell => `<tr>${cell.map(text => `<td>${escapeHtml(text)}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Crew packet</title><style>
body{font-family:Helvetica,Arial,sans-serif;color:#2B3145;font-size:12px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;color:#0158B4;margin:18px 0 6px;border-bottom:2px solid #0158B4}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #AEB8D0;padding:4px 6px;text-align:left}th{background:#E8ECF4}
p.order{margin:3px 0}</style></head><body>
<h1>${escapeHtml(sessionName)}</h1><div>Session version ${sessionVersion}</div>
<h2>Timetable</h2><table><tr><th>Time</th><th>Train</th><th>Station</th></tr>${rowsOf(content.timetable.map(row => [row.time, row.train_number, row.station]))}</table>
<h2>Train orders</h2>${content.train_orders.map(line => `<p class="order">${escapeHtml(line)}</p>`).join('')}
<h2>Block table</h2><table><tr><th>Block</th><th>Name</th><th>Kind</th><th>Length</th></tr>${rowsOf(content.block_table.map(row => [String(row.number), row.name, row.kind, `${row.length_mm} mm`]))}</table>
<h2>Track diagram</h2>${diagram(content.track_diagram, pinned)}
</body></html>`
}

export function packetFooterHtml(sessionVersion: number, hash: string): string {
  return `<html><head><style>body{font-family:Helvetica,Arial,sans-serif;font-size:7px;width:100%;text-align:center;color:#2B3145;margin:0}</style></head>`
    + `<body><span>Session version ${sessionVersion} | Content hash ${hash}</span></body></html>`
}
