import type { PuzzleJson, Solution } from '../shared/types.ts'
import { ApiFailure, api, upload } from './api.ts'
import { type OpenDialog, openDialog } from './dialog.ts'
import { h } from './dom.ts'
import { navigate } from './navigation.ts'
import { ensurePlayer } from './session.ts'

export interface Uploaded {
  puzzle: PuzzleJson
  solution: Solution
}

/** The parsed grid of a puzzle: numbers on every numbered square, answers when they are known. */
export function previewGrid(puzzle: PuzzleJson, solution: Solution | null): HTMLElement {
  const numbers = new Map(puzzle.numbers.map((entry) => [`${entry.row},${entry.col}`, entry.number]))
  const grid = h('div', { class: 'mini-grid', style: `--cols:${puzzle.cols}`, role: 'img', 'aria-label': `${puzzle.title}, ${puzzle.cols}x${puzzle.rows}` })
  puzzle.blocks.forEach((row, r) =>
    [...row].forEach((block, c) => {
      grid.append(block === '#' ? h('i', { class: 'block' }) : h('i', { class: 'open' }, numbers.has(`${r},${c}`) ? h('b', null, numbers.get(`${r},${c}`)) : null, solution ? h('span', null, solution[r][c]) : null))
    }),
  )
  return grid
}

export function startRoomButton(puzzleId: string, beforeLeaving: () => void = () => undefined): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'primary',
      onclick: () => {
        api<{ id: string }>('POST', '/api/games', { puzzle_id: puzzleId }).then(
          (game) => {
            beforeLeaving()
            navigate(`/games/${game.id}`)
          },
          () => undefined,
        )
      },
    },
    'Start a room with this puzzle',
  )
}

export function openUploadDialog(onUploaded: (uploaded: Uploaded) => void): void {
  void ensurePlayer().then(() => mount(onUploaded))
}

function mount(onUploaded: (uploaded: Uploaded) => void): void {
  let chosen: Uint8Array<ArrayBuffer> | null = null
  let pending = false
  const textarea = h('textarea', { id: 'puzzle-text', rows: 10, spellcheck: 'false' })
  textarea.addEventListener('input', () => {
    chosen = null
  })
  const file = h('input', { type: 'file', accept: '.overlap.txt', 'aria-label': 'Puzzle file' })
  file.addEventListener('change', () => {
    const picked = file.files?.[0]
    if (!picked) return
    void picked.arrayBuffer().then((buffer) => {
      chosen = new Uint8Array(buffer)
      textarea.value = new TextDecoder().decode(buffer)
    })
  })
  const status = h('p', { role: 'status', 'aria-label': 'Upload status', class: 'status-line' })
  const outage = h('div', { class: 'band inline-band', role: 'alert', hidden: true })
  const send = h('button', { type: 'button', class: 'primary' }, 'Upload')
  const errors = h('section', { class: 'tile ink errors-tile', hidden: true })
  const preview = h('section', { class: 'tile preview-tile', hidden: true })
  const dropTile = h(
    'section',
    { class: 'tile drop-tile' },
    h('label', { class: 'file-button' }, 'Choose file', file),
    h('label', { for: 'puzzle-text' }, 'Puzzle text'),
    textarea,
    status,
    outage,
    send,
  )
  let dialog: OpenDialog
  const reset = (): void => {
    errors.hidden = true
    preview.hidden = true
    outage.hidden = true
    status.textContent = ''
  }
  const showErrors = (heading: string, lines: string[] | null): void => {
    const title = h('h3', { tabindex: '-1' }, heading)
    errors.replaceChildren(title, ...(lines ? [h('ul', { 'aria-label': 'Upload errors' }, ...lines.map((line) => h('li', null, line)))] : []))
    errors.hidden = false
    title.focus()
  }
  const submit = async (): Promise<void> => {
    if (pending) return
    pending = true
    reset()
    send.disabled = true
    status.textContent = 'Checking your puzzle'
    try {
      const bytes = chosen ?? new TextEncoder().encode(textarea.value)
      const created = await upload<Uploaded>('/api/puzzles', bytes)
      status.textContent = `Puzzle ready: ${created.puzzle.title}`
      send.classList.remove('primary')
      preview.replaceChildren(h('h3', null, created.puzzle.title), h('p', null, `${created.puzzle.cols}x${created.puzzle.rows}`), previewGrid(created.puzzle, created.solution), startRoomButton(created.puzzle.id, () => dialog.close()))
      preview.hidden = false
      onUploaded(created)
    } catch (failure) {
      status.textContent = ''
      if (failure instanceof ApiFailure && failure.body.error === 'invalid_puzzle') showErrors(failure.message, failure.body.lines ?? [])
      else if (failure instanceof ApiFailure && failure.body.error === 'too_large') showErrors(failure.message, null)
      else {
        outage.textContent = 'Puzzle storage is unreachable right now. Your text is still here; try again in a moment.'
        outage.hidden = false
      }
    }
    pending = false
    send.disabled = false
    if (errors.hidden) send.focus()
  }
  send.addEventListener('click', () => void submit())
  dialog = openDialog({
    label: 'Upload a puzzle',
    className: 'sheet upload-sheet',
    content: [h('h2', null, 'Upload a puzzle'), h('div', { class: 'sheet-board' }, dropTile, errors, preview), h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, 'Close')],
    initialFocus: () => file,
  })
}
