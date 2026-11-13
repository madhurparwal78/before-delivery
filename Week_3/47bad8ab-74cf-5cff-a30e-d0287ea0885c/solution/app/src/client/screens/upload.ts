import type { PuzzleJson, PuzzleListEntry } from '../../shared/types.ts'
import { api } from '../api.ts'
import { h } from '../dom.ts'
import { ensurePlayer } from '../session.ts'
import { openUploadDialog, previewGrid, startRoomButton } from '../upload-dialog.ts'
import type { Uploaded } from '../upload-dialog.ts'
import { done, loadingTiles } from '../view.ts'
import type { View } from '../view.ts'

export async function renderUpload(view: View): Promise<void> {
  const { main } = view
  await ensurePlayer()
  loadingTiles(main, ['c6 r4', 'c6 r4'])
  const preview = h('section', { class: 'tile c6 r4 preview-tile page-preview' })
  const show = (puzzle: PuzzleJson | null, uploaded: Uploaded | null = null): void => {
    view.brass(puzzle === null)
    preview.replaceChildren(
      ...(puzzle
        ? [h('h2', null, puzzle.title), h('p', null, `${puzzle.cols}x${puzzle.rows}`), previewGrid(puzzle, uploaded?.solution ?? null), startRoomButton(puzzle.id)]
        : [h('p', { class: 'sentence' }, 'Nothing uploaded yet.')]),
    )
  }
  const { puzzles } = await api<{ puzzles: PuzzleListEntry[] }>('GET', '/api/puzzles?source=mine')
  const latest = puzzles[0] ? await api<PuzzleJson>('GET', `/api/puzzles/${puzzles[0].id}`) : null
  if (!view.current()) return
  show(latest)
  done(main)
  main.replaceChildren(
    h(
      'section',
      { class: 'tile c6 r4 drop-page-tile' },
      h('h2', null, 'Upload a puzzle'),
      h('p', null, 'Paste or choose a file written in the Overlap text format.'),
      h('div', { class: 'tile-actions' }, h('button', { type: 'button', onclick: () => openUploadDialog((uploaded) => show(uploaded.puzzle, uploaded)) }, 'Upload puzzle'), h('a', { href: '/build', class: 'button-link' }, 'Build a puzzle')),
    ),
    preview,
  )
}
