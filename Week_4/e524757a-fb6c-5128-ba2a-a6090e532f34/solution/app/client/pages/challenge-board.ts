/** `/boards/<island>`: the challenge board. Rows re-rank in place as players enter. */
import '../styles/boards.css'
import { siteHeader } from '../components/site-header'
import { ApiFailure, NetworkFailure, get, post } from '../lib/api'
import { h, setDigits } from '../lib/dom'
import { closeLayer, openLayer, type Layer } from '../lib/layers'
import { openLive } from '../lib/live'
import type { Mounted, PageContext } from '../lib/router'
import { session } from '../lib/session'
import { status } from '../lib/status'
import { debounce } from '../lib/tween'
import { islandById } from '../../shared/island'
import type { Board, BoardEntry, Photo } from '../../shared/types'

const FILTER_MS = 250
const LOAD_FAILED = "Couldn't load the board. Try again."

interface Row { tr: HTMLTableRowElement; rank: HTMLElement; player: HTMLElement; creature: HTMLElement; score: HTMLElement }

const entriesText = (n: number): string => (n === 1 ? '1 entry' : `${n} entries`)

export function mountChallengeBoard(context: PageContext): Mounted {
  const number = Number(context.params[0])
  const island = islandById(number)
  const me = session.me
  const note = status('Board status')
  note.el.classList.add('sticky-status')
  const body = h('tbody')
  const table = h('table', { 'aria-label': 'Challenge board' },
    h('thead', null, h('tr', null, ...['Rank', 'Player', 'Creature', 'Score'].map((name) => h('th', { scope: 'col' }, name)))), body)
  const tableBox = h('div', { class: 'board-table' }, table)
  const empty = h('div', { class: 'frame-empty' }, h('span', { class: 'corners' }), h('p', null, 'No entries yet.'))
  const search = h('input', { type: 'search', id: 'filter-players', 'aria-label': 'Filter players', autocomplete: 'off', spellcheck: 'false' })
  const enter = h('button', { type: 'button', class: 'btn btn-primary' }, 'Enter a photo')
  const rows = new Map<string, Row>()
  const fail = (error: unknown): void => {
    if (error instanceof ApiFailure || error instanceof NetworkFailure) note.say(error.message, { error: true })
    else throw error
  }
  let all: BoardEntry[] = []
  let failed = false
  let ticket = 0
  let absorbOwn = false

  function makeRow(): Row {
    const rank = h('td')
    const player = h('td')
    const creature = h('td')
    const score = h('td')
    return { tr: h('tr', null, rank, player, creature, score), rank, player, creature, score }
  }

  /** Rows are keyed by player and moved in place; nothing is rebuilt. */
  function show(entries: BoardEntry[]): void {
    const keep = new Set(entries.map((entry) => entry.handle))
    for (const [handle, row] of rows) {
      if (!keep.has(handle)) { row.tr.remove(); rows.delete(handle) }
    }
    entries.forEach((entry, index) => {
      let row = rows.get(entry.handle)
      if (!row) { row = makeRow(); rows.set(entry.handle, row) }
      setDigits(row.rank, String(entry.rank))
      row.player.textContent = entry.player
      row.creature.textContent = entry.creature_name
      setDigits(row.score, String(entry.total))
      row.tr.dataset.me = String(entry.handle === me?.player.handle)
      if (body.children[index] !== row.tr) body.insertBefore(row.tr, body.children[index] ?? null)
    })
    tableBox.hidden = entries.length === 0
    empty.hidden = entries.length > 0
  }

  const matches = (text: string): BoardEntry[] => all.filter((entry) => entry.player.toLowerCase().includes(text.toLowerCase()))

  function loaded(board: Board, text: string): void {
    if (text === '') all = board.entries
    show(board.entries)
    failed = false
    note.say(text === '' ? entriesText(board.total) : `Showing ${board.shown} of ${board.total} entries for “${text}”.`)
  }

  function load(): void {
    const text = search.value
    const mine = ++ticket
    const path = text === '' ? `/api/boards/${number}` : `/api/boards/${number}?player=${encodeURIComponent(text)}`
    get<Board>(path).then((board) => {
      if (mine === ticket) loaded(board, text)
    }, () => {
      if (mine !== ticket) return
      failed = true
      note.say(LOAD_FAILED, { error: true })
    })
  }
  const filter = debounce(FILTER_MS, load)
  search.addEventListener('input', () => filter.call())

  async function refreshAfter(event: { player_name: string; rank: number }): Promise<void> {
    const board = await get<Board>(`/api/boards/${number}`)
    all = board.entries
    show(search.value === '' ? board.entries : matches(search.value))
    if (failed) return
    if (absorbOwn && event.player_name === me?.player.name) absorbOwn = false
    else note.say(`Board updated. ${event.player_name} is now number ${event.rank}.`)
  }

  const live = openLive()
  live.on('board', (event) => {
    if (event.island === number) refreshAfter(event).catch(() => undefined)
  })

  function enterDialog(photos: Photo[]): void {
    const form = h('form', { novalidate: true })
    const group = h('fieldset', { class: 'choices', role: 'radiogroup', 'aria-label': 'Your photos' })
    const submit = h('button', { type: 'submit', class: 'btn btn-primary', disabled: true }, 'Enter photo')
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel')
    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Enter a photo' }, h('h2', null, 'Enter a photo'), form)
    form.append(group, h('div', { class: 'actions' }, cancel, submit))
    const backdrop = h('div', { class: 'dialog-backdrop' })
    const layer: Layer = { el: dialog, modal: true, opener: enter, dismiss: () => close(), initial: () => group.querySelector('input') ?? cancel }
    const close = (): void => { dialog.remove(); backdrop.remove(); closeLayer(layer) }
    if (photos.length === 0) group.append(h('p', null, 'No photos taken on this island yet.'))
    for (const photo of photos) {
      group.append(h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'photo', value: photo.id }), `${photo.creature_name} photo, ${photo.score.total}`))
    }
    cancel.addEventListener('click', close)
    backdrop.addEventListener('click', close)
    group.addEventListener('change', () => { submit.disabled = false })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const chosen = group.querySelector<HTMLInputElement>('input:checked')
      const photo = photos.find((item) => item.id === chosen?.value)
      if (!photo || submit.getAttribute('aria-busy') === 'true') return
      submit.setAttribute('aria-busy', 'true')
      post<{ entry: BoardEntry }>(`/api/boards/${number}/entries`, { photo: photo.id }).then(() => {
        absorbOwn = true
        close()
        note.say(`Your ${photo.creature_name} photo is entered.`)
        load()
      }, (error: unknown) => {
        close()
        fail(error)
      }).finally(() => submit.removeAttribute('aria-busy'))
    })
    ;(document.getElementById('layers') as HTMLElement).append(backdrop, dialog)
    openLayer(layer)
  }
  enter.addEventListener('click', () => {
    get<{ photos: Photo[] }>('/api/me/photos').then((answer) => {
      enterDialog(answer.photos.filter((photo) => photo.island === number).sort((p, q) => q.score.total - p.score.total || p.tick - q.tick))
    }, fail)
  })

  context.root.append(
    siteHeader(),
    h('main', { class: 'page' },
      h('h1', null, island ? `Challenge board: ${island.name}` : 'Challenge board'),
      note.el,
      h('div', { class: 'board-bar' },
        h('div', { class: 'field' }, h('label', { for: 'filter-players' }, 'Filter players'), search), enter),
      tableBox, empty),
  )
  tableBox.hidden = true
  empty.hidden = true
  load()

  return { unmount: () => { filter.cancel(); live.close() } }
}
