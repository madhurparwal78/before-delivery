import type { GameJson, HistoryStats, PlayerJson, Settings } from '../../shared/types.ts'
import { formatTime, revealedPhrase } from '../../shared/format.ts'
import { api, linkFor } from '../api.ts'
import { openDialog } from '../dialog.ts'
import { h } from '../dom.ts'

const MOTION_MS = 200

function enter(element: HTMLElement, reducedMotion: boolean): void {
  if (reducedMotion) return
  element.animate([{ transform: 'translateY(12px)', opacity: 0.6 }, { transform: 'translateY(0)', opacity: 1 }], { duration: MOTION_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
}

export function openShare(game: () => GameJson, isHost: boolean, apply: (game: GameJson) => void): void {
  const link = h('input', { type: 'text', readOnly: true, 'aria-label': 'Game link', value: '' })
  const status = h('p', { role: 'status', 'aria-label': 'Share status', class: 'status-line' })
  const copy = h('button', { type: 'button' }, 'Copy link')
  const show = (): void => {
    const code = game().code
    link.value = code ? linkFor(code) : ''
    copy.disabled = code === null
  }
  show()
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(link.value).then(
      () => (status.textContent = 'Link copied'),
      () => {
        link.select()
        status.textContent = document.execCommand('copy') ? 'Link copied' : ''
      },
    )
  })
  const change = (path: 'off' | 'replace', done: string): HTMLButtonElement =>
    h('button', {
      type: 'button',
      onclick: () => {
        api<GameJson>('POST', `/api/games/${game().id}/link/${path}`, {}).then((updated) => {
          apply(updated)
          show()
          status.textContent = done
        }, () => undefined)
      },
    }, path === 'off' ? 'Turn off link' : 'Replace link')
  const dialog = openDialog({
    label: 'Share game',
    content: [h('h2', null, 'Share game'), link, status, h('div', { class: 'tile-actions' }, copy, ...(isHost ? [change('off', 'Link turned off'), change('replace', 'New link ready')] : [])), h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, 'Close')],
    initialFocus: () => link,
  })
}

export function openSettings(settings: () => Settings, save: (next: Settings) => void): void {
  const box = (name: string, key: keyof Settings): HTMLLabelElement => {
    const input = h('input', { type: 'checkbox', checked: settings()[key] })
    input.addEventListener('change', () => save({ ...settings(), [key]: input.checked }))
    return h('label', { class: 'check-label' }, input, h('span', null, name))
  }
  const dialog = openDialog({
    label: 'Solving settings',
    content: [h('h2', null, 'Solving settings'), box('Skip filled squares', 'skip_filled'), box('Jump to the next clue', 'jump_next_clue'), box('Autocheck my letters', 'autocheck'), h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, 'Close')],
  })
}

export function openSolved(elapsedMs: number, revealed: number, stats: readonly HistoryStats[], reducedMotion: boolean, focusGrid: () => void): void {
  const heading = h('h2', { tabindex: '-1' }, `Solved in ${formatTime(elapsedMs)}`)
  const dialog = openDialog({
    label: 'Puzzle solved',
    className: 'sheet solved-sheet',
    content: [
      heading,
      h('p', null, revealed >= 1 ? revealedPhrase(revealed) : 'No squares revealed'),
      h('ul', { 'aria-label': 'Solve stats' }, ...stats.map((entry) => h('li', null, `${entry.display_name} · ${entry.letters} letters · ${entry.revealed} revealed`))),
      h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, 'Close'),
    ],
    initialFocus: () => heading,
    onClose: focusGrid,
  })
  enter(dialog.element, reducedMotion)
}

function raceResult(players: readonly PlayerJson[], scores: { 1: number; 2: number }): { heading: string; rows: string[] } {
  const heading = scores[1] === scores[2] ? `Tie at ${scores[1]}` : scores[1] > scores[2] ? `Team 1 wins ${scores[1]} to ${scores[2]}` : `Team 2 wins ${scores[2]} to ${scores[1]}`
  const racers = players.filter((player) => player.team !== null)
  const rows = racers.map((player, order) => ({ player, order })).sort((a, b) => b.player.score - a.player.score || a.order - b.order)
  return { heading, rows: rows.map(({ player }) => `${player.display_name} · Team ${player.team} · ${player.score}`) }
}

export function openRaceOver(players: readonly PlayerJson[], scores: { 1: number; 2: number }, reducedMotion: boolean, focusGrid: () => void): void {
  const { heading, rows } = raceResult(players, scores)
  const title = h('h2', { tabindex: '-1' }, heading)
  const dialog = openDialog({
    label: 'Race over',
    className: 'sheet solved-sheet',
    content: [title, h('ul', { 'aria-label': 'Race scores' }, ...rows.map((row) => h('li', null, row))), h('button', { type: 'button', class: 'close', onclick: () => dialog.close() }, 'Close')],
    initialFocus: () => title,
    onClose: focusGrid,
  })
  enter(dialog.element, reducedMotion)
}

export function openClearConfirm(clearPuzzle: () => void, focusGrid: () => void): void {
  const cancel = h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel')
  const dialog = openDialog({
    label: 'Clear the puzzle?',
    content: [
      h('h2', null, 'Clear every unlocked square?'),
      h('div', { class: 'tile-actions' }, cancel, h('button', { type: 'button', onclick: () => {
        clearPuzzle()
        dialog.close()
      } }, 'Clear puzzle')),
    ],
    initialFocus: () => cancel,
    onClose: focusGrid,
  })
}
