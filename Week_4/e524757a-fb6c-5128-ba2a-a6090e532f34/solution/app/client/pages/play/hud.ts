/** The controls laid over the World view, in the published Tab order. */
import { h } from '../../lib/dom'
import { figure, frames, stampsText, type Figure } from '../../lib/figure'

export interface Hud {
  skip: HTMLAnchorElement
  /** Everything after the World view, in Tab order. */
  bar: HTMLElement
  camera: HTMLButtonElement
  zoomIn: HTMLButtonElement
  zoomOut: HTMLButtonElement
  focus: HTMLButtonElement
  take: HTMLButtonElement
  map: HTMLButtonElement
  album: HTMLButtonElement
  settings: HTMLButtonElement
  restart: HTMLButtonElement
  run: HTMLButtonElement
  jump: HTMLButtonElement
  photoControls: HTMLElement
  joystick: HTMLElement
  knob: HTMLElement
  film: Figure
  stamps: Figure
  time: HTMLElement
  /** Where the status regions live. */
  messages: HTMLElement
  /** Where the safari region lives. */
  safariSlot: HTMLElement
  controls: HTMLElement
  chips: HTMLElement
}

const button = (label: string, extra = ''): HTMLButtonElement => h('button', { type: 'button', class: `btn hud-btn ${extra}`.trim() }, label)

export function buildHud(film: number, stamps: number, sound: HTMLButtonElement): Hud {
  const camera = button('Camera')
  camera.setAttribute('aria-pressed', 'false')
  const zoomIn = button('Zoom in')
  const zoomOut = button('Zoom out')
  const focus = button('Focus')
  const take = h('button', { type: 'button', class: 'btn btn-primary hud-btn shutter' }, 'Take photo')
  const photoControls = h('div', { class: 'photo-controls', hidden: true }, zoomIn, zoomOut, focus, take)
  const map = button('Map')
  const album = button('Album')
  const settings = button('Settings')
  const restart = button('Restart expedition')
  const run = button('Run', 'touch-btn')
  run.setAttribute('aria-pressed', 'false')
  const jump = button('Jump', 'touch-btn')
  const knob = h('span', { class: 'joystick-knob' })
  const joystick = h('div', { role: 'group', 'aria-label': 'Joystick', class: 'joystick' }, knob)
  const skip = h('a', { class: 'skip-link', href: '/text-world' }, 'Skip to the text world')
  const filmFigure = figure('film', frames, film)
  const stampsFigure = figure('stamps', stampsText, stamps)
  const time = h('span', { role: 'timer', 'aria-label': 'World time', class: 'world-time' })
  const chips = h('div', { class: 'chips' },
    h('span', { class: 'chip' }, filmFigure.el),
    h('span', { class: 'chip' }, stampsFigure.el),
    h('span', { class: 'chip' }, time))
  const messages = h('div', { class: 'hud-messages' })
  const safariSlot = h('div', { class: 'safari-slot' })
  const controls = h('div', { class: 'hud-controls' }, run, jump)
  const bar = h('div', { class: 'hud' },
    h('div', { class: 'hud-bar' }, camera, photoControls, map, album, sound, settings, restart),
    chips, messages, safariSlot, joystick, controls)
  return {
    skip, bar, camera, zoomIn, zoomOut, focus, take, map, album, settings, restart, run, jump, photoControls,
    joystick, knob, film: filmFigure, stamps: stampsFigure, time, messages, safariSlot, controls, chips,
  }
}
