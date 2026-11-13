import type { Direction } from '../../shared/numbering.ts'
import { h } from '../dom.ts'
import type { PuzzleModel, Clue } from './model.ts'

const SCROLL_MS = 200

const key = (clue: Clue): string => `${clue.direction}:${clue.number}`
const ease = (t: number): number => 1 - (1 - t) ** 3

/** The Across and Down clue tiles. */
export class ClueLists {
  readonly across: HTMLElement
  readonly down: HTMLElement
  readonly acrossTile: HTMLElement
  readonly downTile: HTMLElement
  private readonly items = new Map<string, HTMLElement>()
  private frame = 0

  constructor(model: PuzzleModel, select: (clue: Clue) => void, private readonly reducedMotion: boolean) {
    const list = (direction: Direction): HTMLElement =>
      h(
        'ul',
        { class: 'clue-list', tabindex: '0', 'aria-label': direction === 'across' ? 'Across clues' : 'Down clues' },
        ...model.clues
          .filter((clue) => clue.direction === direction)
          .map((clue) => {
            const item = h('li', { 'aria-label': `${clue.number} ${clue.text}`, onclick: () => select(clue) }, h('b', null, clue.number), ' ', h('span', null, clue.text))
            this.items.set(key(clue), item)
            return item
          }),
      )
    this.across = list('across')
    this.down = list('down')
    this.acrossTile = h('section', { class: 'tile clue-tile across-tile' }, h('h2', null, 'Across'), this.across)
    this.downTile = h('section', { class: 'tile clue-tile down-tile' }, h('h2', null, 'Down'), this.down)
  }

  /** Marks the active clue, the clue crossing the selected square and the clues linked to the active one. */
  paint(active: Clue | undefined, crossing: Clue | undefined, linked: readonly Clue[]): void {
    const linkedKeys = new Set(linked.map(key))
    for (const [id, item] of this.items) {
      if (active && id === key(active)) item.setAttribute('aria-current', 'true')
      else item.removeAttribute('aria-current')
      if (crossing && id === key(crossing)) item.dataset.crossing = 'true'
      else delete item.dataset.crossing
      if (linkedKeys.has(id)) item.dataset.linked = 'true'
      else delete item.dataset.linked
    }
  }

  /** Scrolls the active clue's list so the clue's top sits a third of the way down its visible height. */
  scrollTo(clue: Clue): void {
    const item = this.items.get(key(clue))
    const box = clue.direction === 'across' ? this.across : this.down
    if (!item) return
    cancelAnimationFrame(this.frame)
    const goal = (): number => {
      const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
      return Math.max(0, Math.min(top - box.clientHeight / 3, box.scrollHeight - box.clientHeight))
    }
    if (this.reducedMotion) {
      box.scrollTop = goal()
      return
    }
    const from = box.scrollTop
    let started: number | null = null
    const step = (now: number): void => {
      started ??= now
      const progress = Math.min(1, (now - started) / SCROLL_MS)
      box.scrollTop = from + (goal() - from) * ease(progress)
      if (progress < 1) this.frame = requestAnimationFrame(step)
    }
    this.frame = requestAnimationFrame(step)
  }
}
