import { SOMETHING_WRONG } from '../../shared/copy.ts'
import { ApiFailure, config, saveBlob, upload } from '../api.ts'
import { type Draft, SYMMETRIES, type Symmetry, blank, clueKey, defaultSymmetry, draftText, fileName, numbering, partner, problemsOf, wordsOf } from '../builder-text.ts'
import { directionName } from '../../shared/numbering.ts'
import { h } from '../dom.ts'
import { ensurePlayer } from '../session.ts'
import type { View } from '../view.ts'

const MIN_SIZE = 3
const OUTAGE = 'Puzzle storage is unreachable right now. Your grid is still here; try again in a moment.'

export async function renderBuilder(view: View): Promise<void> {
  const { main } = view
  await ensurePlayer()
  const { max_grid: maxGrid } = await config()
  if (!view.current()) return
  const draft: Draft = { cols: 5, rows: 5, title: '', author: '', symmetry: 'None', squares: blank(5, 5), clues: new Map() }
  let selected: [number, number] = [0, 0]
  let saved: string | null = null
  let saving = false

  const title = h('input', { id: 'builder-title', type: 'text', autocomplete: 'off' })
  const author = h('input', { id: 'builder-author', type: 'text', autocomplete: 'off' })
  const sizeInput = (id: string, value: number): HTMLInputElement => h('input', { id, type: 'number', min: MIN_SIZE, max: maxGrid, step: 1, value: String(value) })
  const cols = sizeInput('builder-cols', 5)
  const rows = sizeInput('builder-rows', 5)
  const radios = new Map<Symmetry, HTMLInputElement>()
  const symmetry = h(
    'div',
    { role: 'radiogroup', 'aria-label': 'Symmetry', class: 'radios' },
    ...SYMMETRIES.map((name) => {
      const input = h('input', { type: 'radio', name: 'symmetry', value: name })
      radios.set(name, input)
      input.addEventListener('change', () => {
        draft.symmetry = name
      })
      return h('label', { class: 'chip-label' }, input, h('span', null, name))
    }),
  )
  const grid = h('div', { role: 'grid', 'aria-label': 'Builder grid', tabindex: '0', class: 'builder-grid' })
  const clueList = h('div', { class: 'clue-fields' })
  const status = h('p', { role: 'status', 'aria-label': 'Builder status', class: 'status-line' })
  const problemList = h('ul', { 'aria-label': 'Grid problems', class: 'problems', tabindex: '0' })
  const download = h('button', { type: 'button' }, 'Download text')
  const save = h('button', { type: 'button' }, 'Save to my puzzles')

  const cellName = (row: number, col: number): string => {
    const square = draft.squares[row][col]
    return `Row ${row + 1}, column ${col + 1}, ${square === '#' ? 'black' : square === '' ? 'empty' : square}`
  }
  const renderGrid = (): void => {
    const numbers = new Map(numbering(draft).numbers.map((entry) => [`${entry.row},${entry.col}`, entry.number]))
    grid.style.setProperty('--cols', String(draft.cols))
    grid.replaceChildren(
      ...draft.squares.map((line, row) =>
        h(
          'div',
          { role: 'row', class: 'xrow' },
          ...line.map((square, col) =>
            h(
              'div',
              {
                role: 'gridcell',
                id: `bsq-${row}-${col}`,
                class: square === '#' ? 'xsq black' : 'xsq',
                'aria-label': cellName(row, col),
                'aria-selected': String(selected[0] === row && selected[1] === col),
                'data-row': row,
                'data-col': col,
                'data-number': numbers.get(`${row},${col}`),
                'data-black': square === '#' ? 'true' : null,
                onmousedown: (event: MouseEvent) => {
                  event.preventDefault()
                  selected = [row, col]
                  grid.focus()
                  renderGrid()
                },
              },
              numbers.has(`${row},${col}`) ? h('b', { class: 'num', 'aria-hidden': 'true', 'data-n': numbers.get(`${row},${col}`) }) : null,
              square === '#' ? null : h('span', { class: 'letter' }, square),
            ),
          ),
        ),
      ),
    )
    grid.setAttribute('aria-activedescendant', `bsq-${selected[0]}-${selected[1]}`)
  }
  let clueSignature = ''
  const renderClues = (): void => {
    const words = wordsOf(draft)
    const signature = words.map((word) => `${word.direction}${word.number}:${clueKey(word)}`).join('|')
    if (signature === clueSignature) return
    clueSignature = signature
    clueList.replaceChildren(
      ...words.map((word) => {
        const label = `${word.number} ${directionName(word.direction)} clue`
        const input = h('input', { type: 'text', id: `clue-${clueKey(word)}`, 'aria-label': label, autocomplete: 'off', value: draft.clues.get(clueKey(word)) ?? '' })
        input.addEventListener('input', () => {
          draft.clues.set(clueKey(word), input.value)
          renderStatus()
        })
        return h('div', { class: 'clue-field' }, h('span', { class: 'clue-tag', 'aria-hidden': 'true' }, `${word.number}${word.direction === 'across' ? 'A' : 'D'}`), input)
      }),
    )
  }
  function renderStatus(): void {
    const problems = problemsOf(draft)
    problemList.replaceChildren(...problems.map((problem) => h('li', null, problem)))
    status.textContent = saved ?? (problems.length === 0 ? 'Ready to save' : problems.length === 1 ? '1 problem' : `${problems.length} problems`)
    download.disabled = problems.length > 0
    save.disabled = problems.length > 0 || saving
    for (const [name, input] of radios) {
      input.checked = draft.symmetry === name
      input.disabled = name === 'Diagonal' && draft.cols !== draft.rows
    }
  }
  const changed = (): void => {
    saved = null
    renderGrid()
    renderClues()
    renderStatus()
  }
  const resize = (): void => {
    const [nextCols, nextRows] = [Number(cols.value), Number(rows.value)]
    const valid = (value: number): boolean => Number.isInteger(value) && value >= MIN_SIZE && value <= maxGrid
    if (!valid(nextCols) || !valid(nextRows) || (nextCols === draft.cols && nextRows === draft.rows)) return
    Object.assign(draft, { cols: nextCols, rows: nextRows, squares: blank(nextCols, nextRows), clues: new Map(), symmetry: defaultSymmetry(nextCols, nextRows) })
    selected = [0, 0]
    changed()
  }
  cols.addEventListener('input', resize)
  rows.addEventListener('input', resize)
  title.addEventListener('input', () => {
    draft.title = title.value
    changed()
  })
  author.addEventListener('input', () => {
    draft.author = author.value
    changed()
  })
  symmetry.addEventListener('change', renderStatus)

  const rowEdge = (row: number, from: number, step: 1 | -1): number => {
    for (let col = from + step; col >= 0 && col < draft.cols; col += step) if (draft.squares[row][col] !== '#') return col
    return from
  }
  const toggle = (): void => {
    const [row, col] = selected
    const [pairRow, pairCol] = partner(draft, row, col)
    const black = draft.squares[row][col] !== '#'
    for (const [r, c] of [[row, col], [pairRow, pairCol]]) draft.squares[r][c] = black ? '#' : ''
  }
  grid.addEventListener('keydown', (event) => {
    const [row, col] = selected
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (arrows[event.key]) {
      const [dr, dc] = arrows[event.key]
      if (row + dr >= 0 && row + dr < draft.rows && col + dc >= 0 && col + dc < draft.cols) selected = [row + dr, col + dc]
    } else if (event.key === '.') toggle()
    else if (/^[a-zA-Z]$/.test(event.key)) {
      if (draft.squares[row][col] === '#') return event.preventDefault()
      draft.squares[row][col] = event.key.toUpperCase()
      selected = [row, rowEdge(row, col, 1)]
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      if (draft.squares[row][col] !== '#') draft.squares[row][col] = ''
      if (event.key === 'Backspace') selected = [row, rowEdge(row, col, -1)]
    } else return
    event.preventDefault()
    changed()
  })

  download.addEventListener('click', () => saveBlob(new Blob([draftText(draft)], { type: 'text/plain' }), fileName(draft.title)))
  save.addEventListener('click', () => {
    if (saving) return
    saving = true
    renderStatus()
    upload('/api/puzzles', new TextEncoder().encode(draftText(draft)) as Uint8Array<ArrayBuffer>).then(
      () => {
        view.band(null)
        saved = `Saved: ${draft.title.trim()}`
      },
      (failure: unknown) => view.band(failure instanceof ApiFailure && failure.status === 503 ? OUTAGE : failure instanceof ApiFailure ? failure.message : SOMETHING_WRONG),
    ).finally(() => {
      saving = false
      renderStatus()
    })
  })

  changed()
  main.replaceChildren(
    h('section', { class: 'tile builder-settings' }, h('label', { for: 'builder-title' }, 'Title'), title, h('label', { for: 'builder-author' }, 'Author'), author, h('label', { for: 'builder-cols' }, 'Columns'), cols, h('label', { for: 'builder-rows' }, 'Rows'), rows, symmetry),
    h('section', { class: 'tile ink builder-grid-tile' }, grid),
    h('section', { class: 'tile builder-clues' }, h('h2', null, 'Clues'), clueList),
    h('section', { class: 'tile builder-problems' }, status, problemList, h('div', { class: 'tile-actions' }, download, save)),
  )
}
