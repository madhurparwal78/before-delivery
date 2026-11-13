import type { HistoryEntry } from '../../shared/types.ts'
import { formatTime, revealedPhrase } from '../../shared/format.ts'
import { SOMETHING_WRONG, STORAGE_DOWN } from '../../shared/copy.ts'
import { slug } from '../../shared/text.ts'
import { ApiFailure, api, download, saveBlob } from '../api.ts'
import { h } from '../dom.ts'
import { ensurePlayer } from '../session.ts'
import { done, loadingTiles, messageTile } from '../view.ts'
import type { View } from '../view.ts'
import { openReplay } from './replay.ts'

const PENDING_REFRESH_MS = 5000

function miniature(entry: HistoryEntry): HTMLElement {
  const owners = new Map(entry.squares.map((square) => [`${square.row},${square.col}`, square.owner]))
  const grid = h('div', { class: 'mini-grid history-grid', style: `--cols:${entry.cols}`, 'aria-hidden': 'true' })
  for (let r = 0; r < entry.rows; r++) {
    for (let c = 0; c < entry.cols; c++) {
      const key = `${r},${c}`
      grid.append(owners.has(key) ? h('i', { class: 'open owned', 'data-colour': owners.get(key) }) : h('i', { class: 'block' }))
    }
  }
  return grid
}

export async function renderHistory(view: View): Promise<void> {
  const { main } = view
  await ensurePlayer()
  loadingTiles(main, ['c3 r2', 'c3 r2', 'c3 r2'])
  let shown = ''

  const download_ = (entry: HistoryEntry): void => {
    download(`/api/history/${entry.game_id}/record`).then(
      (blob) => {
        view.band(null)
        saveBlob(blob, `${slug(entry.puzzle_title)}-solve-record.json`)
      },
      (failure: unknown) => view.band(failure instanceof ApiFailure && failure.status === 503 ? STORAGE_DOWN : SOMETHING_WRONG),
    )
  }
  const item = (entry: HistoryEntry): HTMLElement => {
    const replay = h('button', { type: 'button', disabled: !entry.record_ready }, 'Replay')
    replay.addEventListener('click', () => openReplay(entry, replay, (message) => view.band(message)))
    return h(
      'li',
      { class: 'tile history-tile' },
      miniature(entry),
      h('p', { class: 'row-text' }, `${entry.puzzle_title} · ${formatTime(entry.elapsed_ms)} · ${entry.solved_at.slice(0, 10)}`),
      entry.revealed_count >= 1 ? h('p', null, revealedPhrase(entry.revealed_count)) : null,
      ...entry.stats.map((stat) => h('p', { class: 'stat' }, `${stat.display_name} · ${stat.letters} letters · ${stat.revealed} revealed`)),
      entry.record_ready ? null : h('p', { class: 'pending' }, 'Solve record pending'),
      h('div', { class: 'tile-actions' }, h('button', { type: 'button', disabled: !entry.record_ready, onclick: () => download_(entry) }, 'Download solve record'), replay),
    )
  }

  const refresh = async (): Promise<void> => {
    const { entries } = await api<{ entries: HistoryEntry[] }>('GET', '/api/history')
    if (!view.current()) return
    const signature = JSON.stringify(entries.map((entry) => [entry.game_id, entry.record_ready]))
    if (signature !== shown) {
      shown = signature
      done(main)
      main.replaceChildren(...(entries.length > 0 ? [h('ul', { class: 'history-list', 'aria-label': 'History' }, ...entries.map(item))] : []))
      if (entries.length === 0) messageTile(main, 'No finished games yet.')
    }
    if (entries.some((entry) => !entry.record_ready)) timer = setTimeout(() => void refresh(), PENDING_REFRESH_MS)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  view.onLeave(() => clearTimeout(timer))
  await refresh()
}
