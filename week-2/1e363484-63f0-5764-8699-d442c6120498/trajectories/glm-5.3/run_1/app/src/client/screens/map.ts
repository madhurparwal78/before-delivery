/**
 * The boundary map. One place draws the survey: metre grid, boundary,
 * footprints and the covered tint.
 */

import { el } from '../ui.js'
import type { Sensor } from '../api.js'

export type MapState = {
  selected: Set<string>
  contributing: Set<string>
}

export class CoverageMap {
  private svg: SVGSVGElement
  private boundary: [number, number][]
  private sensors: Sensor[]
  private pad = 60
  private width = 700
  private height = 460

  constructor(parent: HTMLElement, boundary: [number, number][], sensors: Sensor[]) {
    this.boundary = boundary
    this.sensors = sensors
    const group = el('div', { class: 'map-panel panel', role: 'group', 'aria-label': 'Coverage map' })
    group.append(el('h2', { text: 'Coverage map', class: 'visually-hidden' }))
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`)
    this.svg.setAttribute('role', 'img')
    this.svg.setAttribute('aria-label', 'Boundary map with sensor footprints')
    group.append(this.svg)
    parent.append(group)
    this.draw({ selected: new Set(sensors.map((s) => s.id)), contributing: new Set() })
  }

  private toSvg(p: [number, number]): [number, number] {
    const xs = this.boundary.map((b) => b[0])
    const ys = this.boundary.map((b) => b[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const scale = Math.min(
      (this.width - 2 * this.pad) / (maxX - minX),
      (this.height - 2 * this.pad) / (maxY - minY),
    )
    // flip y: north up
    const x = this.pad + (p[0] - minX) * scale
    const y = this.pad + (maxY - p[1]) * scale
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
  }

  draw(state: MapState): void {
    const svg = this.svg
    while (svg.firstChild) svg.removeChild(svg.firstChild)

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
    pattern.setAttribute('id', 'hatch')
    pattern.setAttribute('width', '7')
    pattern.setAttribute('height', '7')
    pattern.setAttribute('patternUnits', 'userSpaceOnUse')
    pattern.setAttribute('patternTransform', 'rotate(45)')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('width', '2')
    rect.setAttribute('height', '7')
    rect.setAttribute('fill', '#47524a')
    pattern.append(rect)
    defs.append(pattern)
    svg.append(defs)

    // metre grid every 100 metres, with labelled axes
    const xs = this.boundary.map((b) => b[0])
    const ys = this.boundary.map((b) => b[1])
    const minX = Math.floor(Math.min(...xs) / 100) * 100
    const maxX = Math.ceil(Math.max(...xs) / 100) * 100
    const minY = Math.floor(Math.min(...ys) / 100) * 100
    const maxY = Math.ceil(Math.max(...ys) / 100) * 100
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    grid.setAttribute('class', 'map-grid')
    for (let x = minX; x <= maxX; x += 100) {
      const [x1, y1] = this.toSvg([x, minY])
      const [x2, y2] = this.toSvg([x, maxY])
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1))
      line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2))
      grid.append(line)
      if (x % 200 === 0) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('x', String(x1)); label.setAttribute('y', String(y2 + 14))
        label.setAttribute('class', 'map-axis')
        label.textContent = `${x} m`
        grid.append(label)
      }
    }
    for (let y = minY; y <= maxY; y += 100) {
      const [x1, y1] = this.toSvg([minX, y])
      const [x2, y2] = this.toSvg([maxX, y])
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1))
      line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2))
      grid.append(line)
      if (y % 200 === 0) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('x', String(Math.max(4, x1 - 34)))
        label.setAttribute('y', String(y1 + 4))
        label.setAttribute('class', 'map-axis')
        label.textContent = `${y} m`
        grid.append(label)
      }
    }
    svg.append(grid)

    const poly = (pts: [number, number][]): string =>
      pts.map((p) => this.toSvg(p).join(',')).join(' ')

    // boundary with hatched (uncovered) ground
    const boundaryEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    boundaryEl.setAttribute('points', poly(this.boundary))
    boundaryEl.setAttribute('class', 'map-hatch map-boundary')
    boundaryEl.setAttribute('stroke-linejoin', 'round')
    svg.append(boundaryEl)

    // covered ground: union of contributing sensors, drawn as tinted polygons
    const tint = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    for (const s of this.sensors) {
      if (!state.contributing.has(s.id)) continue
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      p.setAttribute('points', poly(s.polygon))
      p.setAttribute('class', 'map-covered coverage-tide')
      tint.append(p)
    }
    svg.append(tint)

    // sensor outlines on top; buttons handle selection
    for (const s of this.sensors) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      p.setAttribute('points', poly(s.polygon))
      const classes = [
        s.kind === 'tower' ? 'map-tower-outline' : 'map-cell-outline',
        'coverage-tide',
      ]
      if (!state.selected.has(s.id) || !state.contributing.has(s.id)) {
        classes.push('map-sensor-faint')
      }
      p.setAttribute('class', classes.join(' '))
      svg.append(p)
    }
  }
}
