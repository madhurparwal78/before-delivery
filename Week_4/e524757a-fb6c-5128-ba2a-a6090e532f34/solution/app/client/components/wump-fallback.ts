/** Wump drawn in SVG, for browsers without WebGL: a moss-backed tide-newt. */
import { svg } from '../lib/dom'
import type { GuideView } from '../engine/api'

export interface WumpDrawing { el: SVGElement; set(view: GuideView): void }

export function wumpFallback(): WumpDrawing {
  const body = svg('g', null,
    svg('path', { d: 'M36 56 C 18 58, 10 70, 22 76 C 34 80, 44 68, 52 62 Z', fill: '#7c8f45' }),
    svg('ellipse', { cx: '84', cy: '56', rx: '38', ry: '16', fill: '#6b7f3a' }),
    svg('ellipse', { cx: '84', cy: '62', rx: '32', ry: '9', fill: '#ece2bd' }),
    svg('ellipse', { cx: '76', cy: '48', rx: '14', ry: '6', fill: '#93a552' }),
    svg('ellipse', { cx: '98', cy: '50', rx: '10', ry: '5', fill: '#8fa04a' }),
    svg('circle', { cx: '66', cy: '56', r: '2.6', fill: '#2f8f9a' }),
    svg('circle', { cx: '84', cy: '53', r: '2.2', fill: '#2f8f9a' }),
    svg('circle', { cx: '104', cy: '57', r: '2.6', fill: '#2f8f9a' }),
    svg('ellipse', { cx: '120', cy: '54', rx: '14', ry: '11', fill: '#6b7f3a' }),
    svg('circle', { cx: '126', cy: '50', r: '3.6', fill: '#ffffff' }),
    svg('circle', { cx: '127', cy: '50', r: '1.9', fill: '#0b0b0c' }),
    svg('rect', { x: '62', y: '66', width: '7', height: '12', rx: '3', fill: '#5a6c30' }),
    svg('rect', { x: '100', y: '66', width: '7', height: '12', rx: '3', fill: '#5a6c30' }),
  )
  const group = svg('g', null, body)
  const el = svg('svg', { viewBox: '0 0 160 90', class: 'wump-fallback', 'aria-hidden': 'true', focusable: 'false' }, group)
  return {
    el,
    set(view) {
      const turn = Math.max(0.35, Math.abs(Math.cos((view.spin * Math.PI) / 180)))
      const scale = view.zoom * 0.9
      const sx = scale * turn * (1 + view.stretch * 0.5)
      const sy = scale * (1 - view.stretch * 0.15)
      group.setAttribute('transform', `translate(80 ${70 - view.hop * 10}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-80 -70)`)
    },
  }
}
