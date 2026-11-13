import { drawHero } from '../hero.ts'
import { h } from '../dom.ts'
import type { View } from '../view.ts'

const HERO_INK = 'Solve one grid with friends in other rooms, each with your own colour.'
const HERO_BRASS = 'Upload a puzzle in plain text and send the link.'

export function renderHome({ main, onLeave, brass }: View): void {
  brass(false)
  main.classList.add('home')
  onLeave(() => main.classList.remove('home'))
  const dither = (name: string): HTMLCanvasElement => h('canvas', { class: `dither ${name}`, role: 'img', 'aria-label': 'Dithered picture of a newspaper crossword grid' })
  const topRight = dither('top-right')
  const bottomLeft = dither('bottom-left')
  main.append(
    h('section', { class: 'tile paper name-tile' }, h('h1', null, 'Overlap')),
    h('section', { class: 'tile picture picture-top' }, topRight),
    h('section', { class: 'tile picture picture-bottom' }, bottomLeft),
    h('section', { class: 'tile ink hero-line' }, h('p', null, HERO_INK)),
    h('section', { class: 'tile brass hero-line' }, h('p', null, HERO_BRASS)),
  )
  const paint = (): void => void drawHero(topRight, bottomLeft)
  paint()
  let width = innerWidth
  const resize = (): void => {
    if (innerWidth !== width) {
      width = innerWidth
      paint()
    }
  }
  window.addEventListener('resize', resize)
  onLeave(() => window.removeEventListener('resize', resize))
}
