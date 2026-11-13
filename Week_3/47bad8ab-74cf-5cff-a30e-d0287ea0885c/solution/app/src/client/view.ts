import { type Child, h } from './dom.ts'

/** What a screen gets from the shell. */
export interface View {
  main: HTMLElement
  params: string[]
  onLeave(handler: () => void): void
  /** The ink band under the top bar (outage, dead link, connection); null removes it. */
  band(message: string | null, ...extra: Child[]): void
  /** Says whether the logo square is the screen's single brass element. */
  brass(logoIsBrass: boolean): void
  /** False once the user has moved on to another screen. */
  current(): boolean
}

export function messageTile(main: HTMLElement, sentence: string): void {
  main.replaceChildren(h('section', { class: 'tile message-tile c12 r2' }, h('p', null, sentence)))
}

export function loadingTiles(main: HTMLElement, tiles: string[]): void {
  main.setAttribute('aria-busy', 'true')
  main.replaceChildren(...tiles.map((size) => h('div', { class: `tile loading ${size}`, 'aria-hidden': 'true' })))
}

export function done(main: HTMLElement): void {
  main.removeAttribute('aria-busy')
}
