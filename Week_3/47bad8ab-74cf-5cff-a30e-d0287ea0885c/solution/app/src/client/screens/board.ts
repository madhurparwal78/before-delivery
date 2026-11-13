import type { PuzzleListEntry } from '../../shared/types.ts'
import { api } from '../api.ts'
import { h } from '../dom.ts'
import { navigate } from '../navigation.ts'
import { ensurePlayer } from '../session.ts'
import { openUploadDialog } from '../upload-dialog.ts'
import { done, loadingTiles } from '../view.ts'
import type { View } from '../view.ts'

const REFRESH_MS = 10000
const SIZES = ['small', 'medium', 'large'] as const
const SOURCES = ['library', 'mine'] as const

function sizeClass(entry: PuzzleListEntry): string {
  const side = Math.max(entry.cols, entry.rows)
  return side <= 7 ? 'c3 r2' : side <= 12 ? 'c3 r4' : 'c6 r4'
}

export async function renderBoard(view: View): Promise<void> {
  const { main } = view
  await ensurePlayer()
  const query = new URLSearchParams(location.search)
  const filters = { size: query.get('size'), source: query.get('source') }
  loadingTiles(main, ['c6 r2', 'c3 r2', 'c3 r2', 'c3 r4', 'c3 r4'])

  const chip = (label: string, kind: 'size' | 'source', value: string): HTMLButtonElement => {
    const button = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filters[kind] === value) }, label)
    button.addEventListener('click', () => {
      filters[kind] = filters[kind] === value ? null : value
      const next = new URLSearchParams()
      if (filters.size) next.set('size', filters.size)
      if (filters.source) next.set('source', filters.source)
      history.pushState(null, '', next.size > 0 ? `/puzzles?${next}` : '/puzzles')
      for (const other of chips) other.button.setAttribute('aria-pressed', String(filters[other.kind] === other.value))
      void refresh()
    })
    return button
  }
  const chips = [
    ...SIZES.map((value) => ({ kind: 'size' as const, value, button: chip(value[0].toUpperCase() + value.slice(1), 'size', value) })),
    ...SOURCES.map((value) => ({ kind: 'source' as const, value, button: chip(value[0].toUpperCase() + value.slice(1), 'source', value) })),
  ]
  const filterTile = h(
    'section',
    { class: 'tile c6 r2 filter-tile' },
    h('div', { class: 'chips' }, ...chips.map((entry) => entry.button)),
    h('button', { type: 'button', onclick: () => openUploadDialog(() => void refresh()) }, 'Upload puzzle'),
  )
  const start = (entry: PuzzleListEntry, mode: 'shared' | 'race'): void => {
    api<{ id: string }>('POST', '/api/games', { puzzle_id: entry.id, mode }).then(
      (game) => navigate(`/games/${game.id}`),
      () => undefined,
    )
  }
  const tile = (entry: PuzzleListEntry): HTMLElement =>
    h(
      'section',
      { class: `tile puzzle-tile ${sizeClass(entry)}` },
      h('h2', null, entry.title),
      h('p', { class: 'size' }, `${entry.cols}x${entry.rows}`),
      h('p', null, `By ${entry.author}`),
      entry.in_progress >= 1 ? h('p', { class: 'progress' }, `In progress with ${entry.in_progress}`) : null,
      h('div', { class: 'tile-actions' }, h('button', { type: 'button', 'aria-label': `Start ${entry.title}`, onclick: () => start(entry, 'shared') }, 'Start'), h('button', { type: 'button', 'aria-label': `Race ${entry.title}`, onclick: () => start(entry, 'race') }, 'Race')),
    )

  async function refresh(): Promise<void> {
    const params = new URLSearchParams()
    if (filters.size) params.set('size', filters.size)
    if (filters.source) params.set('source', filters.source)
    const { puzzles } = await api<{ puzzles: PuzzleListEntry[] }>('GET', `/api/puzzles${params.size > 0 ? `?${params}` : ''}`)
    if (!view.current()) return
    done(main)
    main.replaceChildren(filterTile, ...(puzzles.length > 0 ? puzzles.map(tile) : [h('section', { class: 'tile message-tile c6 r2' }, h('p', null, 'No puzzles match these filters.'))]))
  }

  await refresh()
  const timer = setInterval(() => void refresh(), REFRESH_MS)
  view.onLeave(() => clearInterval(timer))
}
