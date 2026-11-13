import type { Colour, Square } from '../../shared/types.ts'
import { type Direction, directionName, wordSquares } from '../../shared/numbering.ts'
import { h } from '../dom.ts'
import { type PuzzleModel, type Position, type Clue, opposite } from './model.ts'

const PIVOT_SHRINK_MS = 90
const PIVOT_GROW_MS = 140
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

const squareId = (row: number, col: number): string => `sq-${row}-${col}`
const keyOf = (row: number, col: number): string => `${row},${col}`

/** The room's grid: builds the squares once and paints changes in place. */
export class GridView {
  readonly element: HTMLElement
  readonly overlay: HTMLElement
  readonly tile: HTMLElement
  private readonly squareElements = new Map<string, HTMLElement>()
  private readonly numbers = new Map<string, number>()
  private pivotTimers: ReturnType<typeof setTimeout>[] = []
  private pivotAnimations: Animation[] = []

  constructor(private readonly model: PuzzleModel, private readonly reducedMotion: boolean) {
    const { puzzle } = model
    for (const entry of puzzle.numbers) this.numbers.set(keyOf(entry.row, entry.col), entry.number)
    this.element = h('div', { role: 'grid', 'aria-label': 'Puzzle grid', tabindex: '0', class: 'grid', 'data-direction': 'across', 'data-pivot': 'idle', style: `--cols:${puzzle.cols}` })
    this.element.append(
      ...puzzle.blocks.map((blocks, row) =>
        h(
          'div',
          { role: 'row', class: 'xrow' },
          ...[...blocks].map((block, col) => {
            if (block === '#') return h('div', { role: 'gridcell', 'aria-label': 'Black square', class: 'xsq black' })
            const number = this.numbers.get(keyOf(row, col))
            const box = h('div', { role: 'gridcell', id: squareId(row, col), class: 'xsq', 'data-row': row, 'data-col': col, 'data-number': number, 'data-state': 'empty', 'aria-selected': 'false' }, number ? h('b', { class: 'num', 'aria-hidden': 'true', 'data-n': number }) : null, h('span', { class: 'letter', 'aria-hidden': 'true' }))
            this.squareElements.set(keyOf(row, col), box)
            return box
          }),
        ),
      ),
    )
    this.overlay = h('div', { class: 'pivot-band', 'aria-hidden': 'true', hidden: true })
    this.tile = h('section', { class: 'tile ink grid-tile' }, this.element, this.overlay)
  }

  squareElement(row: number, col: number): HTMLElement | undefined {
    return this.squareElements.get(keyOf(row, col))
  }

  /** The name of a white square for the grid's active direction, and its letter, marks and owner hooks. */
  paintSquare(square: Square, direction: Direction): void {
    const box = this.squareElement(square.row, square.col)
    if (!box) return
    const clue = this.model.clueAt(direction, square.row, square.col) ?? this.model.clueAt(opposite(direction), square.row, square.col)
    const index = clue ? this.model.squares(clue).findIndex((entry) => entry.row === square.row && entry.col === square.col) : 0
    const marks = `${square.pencil ? ', pencil' : ''}${square.state === 'revealed' ? ', revealed' : square.state === 'right' ? ', checked right' : square.state === 'wrong' ? ', checked wrong' : ''}`
    box.setAttribute('aria-label', `${clue?.number} ${clue ? directionName(clue.direction) : ''}, letter ${index + 1} of ${clue?.length}, ${square.value === '' ? 'empty' : square.value}${marks}`)
    box.dataset.state = square.state
    box.toggleAttribute('data-pencil', square.pencil)
    if (square.owner) box.dataset.owner = square.owner
    else delete box.dataset.owner
    const letter = box.querySelector('.letter')
    if (letter && letter.textContent !== square.value) letter.textContent = square.value
    box.classList.toggle('long', square.value.length > 1)
    if (square.value.length > 1) box.style.setProperty('--letters', String(square.value.length))
    else box.style.removeProperty('--letters')
  }

  setDirection(direction: Direction): void {
    this.element.dataset.direction = direction
  }

  paintSelection(at: Position, previous: Position | null, active: Clue | undefined, linked: readonly Clue[]): void {
    if (previous) this.squareElement(previous.row, previous.col)?.setAttribute('aria-selected', 'false')
    const selected = this.squareElement(at.row, at.col)
    selected?.setAttribute('aria-selected', 'true')
    this.element.setAttribute('aria-activedescendant', squareId(at.row, at.col))
    const inWord = new Set(active ? wordSquares(active).map((box) => keyOf(box.row, box.col)) : [])
    const linkedKeys = new Set(linked.flatMap((clue) => wordSquares(clue).map((box) => keyOf(box.row, box.col))))
    for (const [key, box] of this.squareElements) {
      if (inWord.has(key)) box.dataset.inWord = 'true'
      else delete box.dataset.inWord
      if (linkedKeys.has(key)) box.dataset.linked = 'true'
      else delete box.dataset.linked
    }
  }

  paintCursors(cursors: ReadonlyMap<string, { row: number; col: number; colour: Colour; order: number }>): void {
    const bySquare = new Map<string, { colour: Colour; order: number }[]>()
    for (const cursor of cursors.values()) bySquare.set(keyOf(cursor.row, cursor.col), [...(bySquare.get(keyOf(cursor.row, cursor.col)) ?? []), cursor])
    for (const [key, box] of this.squareElements) {
      const here = (bySquare.get(key) ?? []).sort((a, b) => a.order - b.order)
      const value = here.map((cursor) => cursor.colour).join(' ')
      if ((box.dataset.cursor ?? '') === value) continue
      box.querySelectorAll('.cursor-block').forEach((block) => block.remove())
      if (value === '') delete box.dataset.cursor
      else {
        box.dataset.cursor = value
        box.append(...here.map((cursor, index) => h('i', { class: 'cursor-block', 'data-colour': cursor.colour, style: `right:${2 + index * 10}px` })))
      }
    }
  }

  markClaimed(row: number, col: number): void {
    this.squareElement(row, col)?.setAttribute('data-claimed', 'true')
  }

  private rectOf(squares: { row: number; col: number }[]): { left: number; top: number; width: number; height: number } {
    const base = this.tile.getBoundingClientRect()
    const boxes = squares.map((square) => this.squareElement(square.row, square.col)?.getBoundingClientRect()).filter((box): box is DOMRect => box !== undefined)
    const left = Math.min(...boxes.map((box) => box.left))
    const top = Math.min(...boxes.map((box) => box.top))
    return { left: left - base.left, top: top - base.top, width: Math.max(...boxes.map((box) => box.right)) - left, height: Math.max(...boxes.map((box) => box.bottom)) - top }
  }

  /** The Pivot band: the old word's tint shrinks into the cursor square, then grows along the new word. */
  pivot(from: Clue | undefined, to: Clue | undefined, at: Position): void {
    this.cancelPivot()
    if (this.reducedMotion || !from || !to) return
    this.element.dataset.pivot = 'shrink'
    const old = this.rectOf(this.model.squares(from))
    const cursor = this.rectOf([{ row: at.row, col: at.col }])
    const fresh = this.rectOf(this.model.squares(to))
    const px = (rect: typeof old): Record<string, string> => ({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    this.overlay.hidden = false
    Object.assign(this.overlay.style, px(old))
    this.pivotAnimations = [this.overlay.animate([px(old), px(cursor)], { duration: PIVOT_SHRINK_MS, easing: EASE, fill: 'forwards' })]
    this.pivotTimers.push(
      setTimeout(() => {
        this.element.dataset.pivot = 'grow'
        this.pivotAnimations = [this.overlay.animate([px(cursor), px(fresh)], { duration: PIVOT_GROW_MS, easing: EASE, fill: 'forwards' })]
      }, PIVOT_SHRINK_MS),
      setTimeout(() => this.cancelPivot(), PIVOT_SHRINK_MS + PIVOT_GROW_MS),
    )
  }

  private cancelPivot(): void {
    for (const timer of this.pivotTimers) clearTimeout(timer)
    for (const animation of this.pivotAnimations) animation.cancel()
    this.pivotTimers = []
    this.pivotAnimations = []
    this.overlay.hidden = true
    this.element.dataset.pivot = 'idle'
  }
}
