import { store, type AppState, type SheetName } from './state'

const SHEETS: SheetName[] = [
  'layouts', 'versions', 'timetable', 'crew-packets', 'members', 'standards', 'history', 'trash', 'sessions',
  'conflict', 'deadlock', 'piece-inspector',
]

interface ViewParams {
  workspace: string | null
  layout: string | null
  version: string | null
  session: string | null
  mode: 'build' | 'operate'
  train: string | null
  block: number | null
  piece: string | null
  end: string | null
  heading: number
  sheet: SheetName | null
}

export function readUrl(): ViewParams {
  const query = new URLSearchParams(window.location.search)
  const sheet = query.get('sheet')
  const block = Number(query.get('block'))
  const heading = Number(query.get('heading'))
  return {
    workspace: query.get('workspace'),
    layout: query.get('layout'),
    version: query.get('version'),
    session: query.get('session'),
    mode: query.get('mode') === 'operate' ? 'operate' : 'build',
    train: query.get('train'),
    block: query.get('block') !== null && Number.isInteger(block) ? block : null,
    piece: query.get('piece'),
    end: query.get('end'),
    heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0,
    sheet: SHEETS.find(name => name === sheet) ?? null,
  }
}

function paramsOf(state: AppState): URLSearchParams {
  const query = new URLSearchParams()
  const put = (name: string, value: string | number | null): void => {
    if (value !== null && value !== '') query.set(name, String(value))
  }
  put('workspace', state.workspaceId)
  put('layout', state.layoutId)
  put('version', state.versionId)
  put('session', state.sessionId)
  put('mode', state.mode)
  put('train', state.selection.trainNumber)
  put('block', state.selection.blockNumber)
  put('piece', state.selection.pieceId)
  put('end', state.selection.endId)
  put('heading', state.heading === 0 ? null : Math.round(state.heading))
  put('sheet', state.sheet)
  return query
}

// Every change writes the URL, and a refresh restores the same view.
export function startUrlSync(): void {
  let last = window.location.search
  store.subscribe(() => {
    const state = store.get()
    if (state.boot !== 'ready' && state.boot !== 'loading') return
    const next = `?${paramsOf(state).toString()}`
    if (next !== last) {
      last = next
      window.history.replaceState(null, '', `${window.location.pathname}${next}`)
    }
  })
}
