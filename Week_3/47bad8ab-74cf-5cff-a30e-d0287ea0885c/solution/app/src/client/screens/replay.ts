import type { Colour, HistoryEntry, Op, SolveRecord, Square } from '../../shared/types.ts'
import { squaresPhrase } from '../../shared/format.ts'
import { marked } from '../../shared/squares.ts'
import { ApiFailure, config, download } from '../api.ts'
import { openDialog } from '../dialog.ts'
import { h } from '../dom.ts'
import { SOMETHING_WRONG, STORAGE_DOWN } from '../../shared/copy.ts'

const SPEEDS = [1, 2, 4] as const
const PAGE = 10

/** The squares after applying the first `step` ops of the record. */
function squaresAt(record: SolveRecord, step: number): Square[] {
  const squares = new Map(record.initial.map((square) => [`${square.row},${square.col}`, { ...square }]))
  const colour = (playerId: string): Colour | null => record.players.find((player) => player.id === playerId)?.colour ?? null
  for (const op of record.ops.slice(0, step)) {
    if (op.type === 'cell') {
      squares.set(`${op.row},${op.col}`, { row: op.row, col: op.col, value: op.value, pencil: op.pencil, state: op.state, owner: op.value === '' ? null : colour(op.by) })
    } else if (op.type === 'check') {
      for (const mark of op.squares) {
        const square = squares.get(`${mark.row},${mark.col}`)
        if (square) squares.set(`${mark.row},${mark.col}`, marked(square, mark.state))
      }
    } else if (op.type === 'reveal' || op.type === 'claim') {
      for (const revealed of op.squares) squares.set(`${revealed.row},${revealed.col}`, { row: revealed.row, col: revealed.col, value: revealed.value, pencil: false, state: revealed.state, owner: revealed.owner })
    } else {
      for (const cleared of op.squares) squares.set(`${cleared.row},${cleared.col}`, { row: cleared.row, col: cleared.col, value: '', pencil: false, state: 'empty', owner: null })
    }
  }
  return [...squares.values()]
}

function sentence(record: SolveRecord, op: Op | undefined): string {
  if (!op) return 'Start'
  const name = record.players.find((player) => player.id === op.by)?.display_name ?? ''
  if (op.type === 'cell') {
    const place = `row ${op.row + 1}, column ${op.col + 1}`
    return op.value === '' ? `${name} cleared ${place}` : `${name} ${op.pencil ? 'pencilled' : 'wrote'} ${op.value} in ${place}`
  }
  if (op.type === 'check') return `${name} checked the ${op.scope}: ${op.squares.filter((mark) => mark.state === 'wrong').length} wrong`
  if (op.type === 'reveal') return `${name} revealed the ${op.scope}: ${squaresPhrase(op.squares.length)}`
  if (op.type === 'clear') return `${name} cleared the ${op.scope}: ${squaresPhrase(op.squares.length)}`
  return `${name} claimed row ${op.row + 1}, column ${op.col + 1}`
}

const isMark = (op: Op | undefined): boolean => op?.type === 'check' || op?.type === 'reveal' || op?.type === 'clear'

export async function openReplay(entry: HistoryEntry, opener: HTMLElement, outage: (message: string | null) => void): Promise<void> {
  let record: SolveRecord
  try {
    record = JSON.parse(await (await download(`/api/history/${entry.game_id}/record`)).text()) as SolveRecord
    outage(null)
  } catch (failure) {
    outage(failure instanceof ApiFailure && failure.status === 503 ? STORAGE_DOWN : SOMETHING_WRONG)
    return
  }
  const { replay_step_ms: stepMs } = await config()
  const last = record.ops.length
  let step = 0
  let speed: (typeof SPEEDS)[number] = 1
  let playing = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const status = h('p', { role: 'status', 'aria-label': 'Replay step', class: 'replay-step' })
  const op = h('p', { role: 'status', 'aria-label': 'Replay op', class: 'replay-op' })
  const grid = h('div', { role: 'group', 'aria-label': 'Replay grid', class: 'mini-grid replay-grid', style: `--cols:${record.cols}` })
  const thumb = h('i', { class: 'thumb' })
  const slider = h('div', { role: 'slider', tabindex: '0', 'aria-label': 'Replay position', 'aria-valuemin': '0', 'aria-valuemax': String(last), class: 'slider' }, h('i', { class: 'rail' }), thumb)
  const previous = h('button', { type: 'button' }, 'Previous step')
  const next = h('button', { type: 'button' }, 'Next step')
  const play = h('button', { type: 'button' }, 'Play')

  const render = (): void => {
    status.textContent = `Step ${step} of ${last}`
    op.textContent = sentence(record, record.ops[step - 1])
    slider.setAttribute('aria-valuenow', String(step))
    thumb.style.left = `${last === 0 ? 0 : (step / last) * 100}%`
    previous.disabled = step === 0
    next.disabled = step === last
    play.textContent = playing ? 'Pause' : 'Play'
    const squares = new Map(squaresAt(record, step).map((square) => [`${square.row},${square.col}`, square]))
    grid.replaceChildren(
      ...Array.from({ length: record.rows * record.cols }, (_, index) => {
        const [row, col] = [Math.floor(index / record.cols), index % record.cols]
        const square = squares.get(`${row},${col}`)
        if (!square) return h('i', { class: 'block' })
        return h('i', { class: 'open', 'data-row': row, 'data-col': col, 'data-value': square.value, 'data-state': square.state, 'data-owner': square.owner, 'data-colour': square.owner }, h('span', null, square.value))
      }),
    )
  }
  const stop = (): void => {
    playing = false
    clearTimeout(timer)
  }
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      step += 1
      if (step >= last) playing = false
      render()
      if (playing) schedule()
    }, stepMs / speed)
  }
  const go = (to: number): void => {
    stop()
    step = Math.max(0, Math.min(last, to))
    render()
  }
  previous.addEventListener('click', () => go(step - 1))
  next.addEventListener('click', () => go(step + 1))
  play.addEventListener('click', () => {
    if (playing) {
      stop()
      render()
      return
    }
    if (step === last) step = 0
    playing = true
    render()
    schedule()
  })
  slider.addEventListener('keydown', (event) => {
    const target = ((): number | null => {
      if (event.shiftKey && event.key === 'ArrowRight') return record.ops.findIndex((candidate, index) => index >= step && isMark(candidate)) + 1 || last
      if (event.shiftKey && event.key === 'ArrowLeft') {
        const before = record.ops.map((candidate, index) => (index + 1 < step && isMark(candidate) ? index + 1 : -1)).filter((index) => index >= 0)
        return before.at(-1) ?? 0
      }
      const keys: Record<string, number> = { ArrowRight: step + 1, ArrowUp: step + 1, ArrowLeft: step - 1, ArrowDown: step - 1, Home: 0, End: last, PageUp: step + PAGE, PageDown: step - PAGE }
      return keys[event.key] ?? null
    })()
    if (target === null) return
    event.preventDefault()
    go(target)
  })
  slider.addEventListener('pointerdown', (event) => {
    const box = slider.getBoundingClientRect()
    go(Math.round(((event.clientX - box.left) / box.width) * last))
    slider.focus()
  })
  const speedGroup = h(
    'div',
    { role: 'radiogroup', 'aria-label': 'Replay speed', class: 'speeds' },
    ...SPEEDS.map((value) => {
      const input = h('input', { type: 'radio', name: 'replay-speed', value: String(value), checked: value === speed })
      input.addEventListener('change', () => {
        speed = value
        if (playing) schedule()
      })
      return h('label', { class: 'chip-label' }, input, h('span', null, `${value}x`))
    }),
  )
  const dialog = openDialog({
    label: 'Replay',
    className: 'sheet replay-sheet',
    content: [h('h2', null, record.puzzle_title), status, grid, op, slider, h('div', { class: 'tile-actions' }, previous, next, play), speedGroup, h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, 'Close')],
    returnFocus: () => opener,
    onClose: stop,
  })
  render()
}

