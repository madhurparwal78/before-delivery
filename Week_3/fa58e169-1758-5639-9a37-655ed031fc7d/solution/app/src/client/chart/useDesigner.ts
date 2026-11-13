import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKey, type PointerEvent as ReactPointer } from 'react'
import type { Conflict, DesignerPattern, EditResult, LiveMessage, MirrorResult, NoteEntry, Repeat, Structure, TesterEntry, TextResult, VersionEntry } from '../../shared/api.ts'
import { CABLE_CELLS, CABLE_KEY, COLOUR_LETTERS, readsLeftward, symbolByKey, symbolsFor } from '../../shared/symbols.ts'
import { ApiFail, call, failureText, newId } from '../api.ts'
import { useLive } from '../live.ts'
import { useSession } from '../session.tsx'
import { EMPTY_VIEW, type GridView, type Mark } from './Grid.tsx'
import { useTwinLift } from './useTwinLift.ts'
import { type Change, type ChartModel, checkAnnouncement, labelOf, modelOf, reuseRows, withChanges, withStructure } from './model.ts'

interface Meta { id: string; name: string; role: DesignerPattern['role']; state: 'draft' | 'published'; version: number }
interface Pos { cursor: { row: number; col: number }; anchor: { row: number; col: number } | null }
type Tool = 'paint' | 'select'
type Block = { stitch: string; colour: string }[][]
interface StepCell { row: number; col: number; before: { stitch: string; colour: string }; after: { stitch: string; colour: string }; rev: number }
type Step = { kind: 'cells'; cells: StepCell[] } | { kind: 'box-add'; box: Repeat } | { kind: 'expand'; box: Repeat }

const MOVES: Record<string, [number, number]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function line(a: { row: number; col: number }, b: { row: number; col: number }): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = []
  let [r, c] = [a.row, a.col]
  const dr = Math.abs(b.row - r)
  const dc = Math.abs(b.col - c)
  const sr = r < b.row ? 1 : -1
  const sc = c < b.col ? 1 : -1
  let err = dc - dr
  for (;;) {
    out.push({ row: r, col: c })
    if (r === b.row && c === b.col) return out
    const e2 = 2 * err
    if (e2 > -dr) { err -= dr; c += sc }
    if (e2 < dc) { err += dc; r += sr }
  }
}

export function useDesigner(id: string) {
  const { me, config, reduceMotion } = useSession()
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'missing'>('loading')
  const [model, setModelState] = useState<ChartModel | null>(null)
  const modelRef = useRef<ChartModel | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [testers, setTesters] = useState<TesterEntry[]>([])
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [notes, setNotes] = useState<NoteEntry[]>([])
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [peers, setPeers] = useState<Map<string, { name: string; row: number; col: number }>>(new Map())
  const [sync, setSync] = useState('')
  const [announce, setAnnounce] = useState('')
  const [check, setCheck] = useState('')
  const [conflict, setConflict] = useState<string[]>([])
  const [rowChanged, setRowChanged] = useState('')
  const [editing, setEditingState] = useState<number | null>(null)
  const editingRef = useRef<number | null>(null)
  const [pos, setPosState] = useState<Pos>({ cursor: { row: 1, col: 1 }, anchor: null })
  const posRef = useRef(pos)
  const [tool, setTool] = useState<Tool>('paint')
  const [symbol, setSymbol] = useState('k')
  const [colour, setColour] = useState('A')
  const [marks, setMarks] = useState<Map<number, Map<number, Mark>>>(new Map())
  const [preview, setPreview] = useState<Map<number, Set<number>>>(new Map())
  const focusWanted = useRef(false)
  const clipboard = useRef<Block | null>(null)
  const undoStack = useRef<Step[]>([])
  const redoStack = useRef<Step[]>([])
  const ownOps = useRef(new Set<string>())
  const chain = useRef<Promise<void>>(Promise.resolve())
  const markStore = useRef(new Map<string, { kind: Mark; gen: number }>())
  const markGen = useRef(0)
  const conflictTimer = useRef<number | undefined>(undefined)
  const drag = useRef<{ mode: Tool; last: { row: number; col: number }; cells: Map<string, { row: number; col: number }> } | null>(null)
  const reduce = useRef(reduceMotion)
  reduce.current = reduceMotion
  const limits = config!.limits

  const setModel = (next: ChartModel) => { modelRef.current = next; setModelState(next) }
  const setPos = (next: Pos) => { posRef.current = next; setPosState(next) }
  const setEditing = (row: number | null) => { editingRef.current = row; setEditingState(row); if (row === null) setRowChanged('') }

  const { live, send } = useLive(id, (message) => handle(message))
  const sendRef = useRef(send)
  sendRef.current = send

  const enqueue = (task: () => Promise<void>) => { chain.current = chain.current.then(task).catch(() => undefined) }

  // ---- loading
  useEffect(() => {
    let alive = true
    // The pattern, its versions and its notes land together, so the page is laid out once and nothing below it moves later.
    const pattern = call<DesignerPattern>('GET', `/api/patterns/${id}`)
    const listed = call<{ versions: VersionEntry[] }>('GET', `/api/patterns/${id}/versions`).then((r) => r.versions, () => [] as VersionEntry[])
    const noted = call<{ notes: NoteEntry[] }>('GET', `/api/patterns/${id}/notes`).then((r) => r.notes, () => [] as NoteEntry[])
    Promise.all([pattern, listed, noted]).then(([p, v, n]) => {
      if (!alive) return
      setModel(modelOf(p, p.colourWarnings))
      setMeta({ id: p.id, name: p.name, role: p.role, state: p.state, version: p.version })
      setTesters(p.testers)
      setVersions(v)
      setNotes(n)
      setSymbol(symbolsFor(p.craft, p.terms)[0].key)
      setState('ready')
    }, (error) => { if (alive) setState(error instanceof ApiFail && error.status === 404 ? 'missing' : 'failed') })
    return () => { alive = false }
  }, [id])

  // ---- marks and notices
  const publishMarks = () => {
    const next = new Map<number, Map<number, Mark>>()
    for (const [key, { kind }] of markStore.current) {
      const [r, c] = key.split(',').map(Number)
      if (!next.has(r)) next.set(r, new Map())
      next.get(r)!.set(c, kind)
    }
    setMarks(next)
  }
  const addMarks = (changed: { row: number; col: number }[]) => {
    if (!changed.length) return
    const kind: Mark = reduce.current ? 'outline' : 'flash'
    const gen = ++markGen.current
    for (const c of changed) markStore.current.set(`${c.row},${c.col}`, { kind, gen })
    publishMarks()
    window.setTimeout(() => {
      for (const [key, value] of markStore.current) if (value.gen === gen) markStore.current.delete(key)
      publishMarks()
    }, kind === 'flash' ? 600 : 2000)
  }
  const showConflicts = (conflicts: Conflict[]) => {
    const sorted = [...conflicts].sort((a, b) => a.row - b.row || a.col - b.col)
    const lines = sorted.slice(0, 3).map((c) => `${c.by} changed row ${c.row}, column ${c.col} first. Your change was not kept.`)
    if (sorted.length > 3) lines.push(`and ${sorted.length - 3} more ${plural(sorted.length - 3, 'cell', 'cells')}.`)
    setConflict(lines)
    window.clearTimeout(conflictTimer.current)
    conflictTimer.current = window.setTimeout(() => setConflict([]), limits.noticeSeconds * 1000)
  }
  const touchedRows = (changed: { row: number }[]) => {
    const row = editingRef.current
    if (row !== null && changed.some((c) => c.row === row)) setRowChanged(`Row ${row} changed while you were typing.`)
  }

  // ---- applying server answers
  const commitEdit = (changes: Change[], rows: EditResult['rows'], warnings: EditResult['colourWarnings'], origin: 'own' | 'push' | 'text') => {
    const before = modelRef.current!
    const { model: next, changed } = withChanges(before, changes, rows, warnings)
    setModel(next)
    const said = checkAnnouncement(before.rows, next.rows)
    if (said) setCheck(said)
    if (origin !== 'own') addMarks(changed)
    if (origin === 'push') touchedRows(changed)
  }
  const clampCursor = (m: ChartModel) => {
    const { cursor } = posRef.current
    const next = { row: Math.min(cursor.row, m.height), col: Math.min(cursor.col, m.width) }
    if (next.row !== cursor.row || next.col !== cursor.col || posRef.current.anchor) setPos({ cursor: next, anchor: null })
  }
  const commitStructure = (s: Structure, origin: 'own' | 'push') => {
    const before = modelRef.current!
    const next = withStructure(before, s)
    const changed: { row: number; col: number }[] = []
    if (origin === 'push') {
      next.grid.forEach((cells, r) => cells.forEach((cell, c) => {
        const old = before.grid[r]?.[c]
        if (old && (old.stitch !== cell.stitch || old.colour !== cell.colour)) changed.push({ row: r + 1, col: c + 1 })
      }))
    }
    setModel(next)
    clampCursor(next)
    const said = checkAnnouncement(before.rows, next.rows)
    if (said) setCheck(said)
    if (origin === 'push') { addMarks(changed); touchedRows(changed) }
  }

  /** Our own change moved a cell from one revision to the next: steps that still point at the old one follow it. */
  const followRevs = (applied: { row: number; col: number; rev: number }[]) => {
    const m = modelRef.current!
    for (const a of applied) {
      const held = m.grid[a.row - 1][a.col - 1].rev
      if (a.rev !== held + 1) continue
      for (const step of [...undoStack.current, ...redoStack.current]) {
        if (step.kind !== 'cells') continue
        for (const c of step.cells) if (c.row === a.row && c.col === a.col && c.rev === held) c.rev = a.rev
      }
    }
  }

  const pushStep = (step: Step) => {
    undoStack.current.push(step)
    if (undoStack.current.length > limits.undoDepth) undoStack.current.shift()
    redoStack.current = []
  }

  // ---- cell edits
  const sendCells = async (entries: { row: number; col: number; stitch: string; colour: string; rev?: number }[]):
    Promise<{ done: StepCell[]; conflicts: Conflict[] } | null> => {
    const m = modelRef.current!
    const wanted = entries.filter((e) => {
      const held = m.grid[e.row - 1]?.[e.col - 1]
      return held && (held.stitch !== e.stitch || held.colour !== e.colour)
    })
    if (!wanted.length) return { done: [], conflicts: [] }
    const sent = wanted.map((e) => ({ row: e.row, col: e.col, stitch: e.stitch, colour: e.colour, rev: e.rev ?? m.grid[e.row - 1][e.col - 1].rev }))
    const was = new Map(sent.map((e) => [`${e.row},${e.col}`, { stitch: m.grid[e.row - 1][e.col - 1].stitch, colour: m.grid[e.row - 1][e.col - 1].colour }]))
    const opId = newId()
    ownOps.current.add(opId)
    try {
      const result = await call<EditResult>('POST', `/api/patterns/${id}/cells`, { opId, cells: sent })
      followRevs(result.applied)
      const changes: Change[] = []
      const done: StepCell[] = []
      for (const a of result.applied) {
        const s = sent.find((e) => e.row === a.row && e.col === a.col)!
        changes.push({ row: s.row, col: s.col, stitch: s.stitch, colour: s.colour, rev: a.rev })
        if (a.rev === s.rev + 1) done.push({ row: s.row, col: s.col, before: was.get(`${s.row},${s.col}`)!, after: { stitch: s.stitch, colour: s.colour }, rev: a.rev })
      }
      for (const c of result.conflicts) changes.push({ row: c.row, col: c.col, stitch: c.stitch, colour: c.colour, rev: c.rev })
      commitEdit(changes, result.rows, result.colourWarnings, 'own')
      return { done, conflicts: result.conflicts }
    } catch (error) {
      setSync(failureText(error))
      return null
    }
  }

  const place = (entries: { row: number; col: number; stitch: string; colour: string }[]) => enqueue(async () => {
    const result = await sendCells(entries)
    if (!result) return
    if (result.done.length) pushStep({ kind: 'cells', cells: result.done })
    if (result.conflicts.length) showConflicts(result.conflicts)
  })

  const swap = (cells: StepCell[]): StepCell[] => cells.map((c) => ({ ...c, before: c.after, after: c.before }))

  const replay = async (step: Step, direction: 'undo' | 'redo'): Promise<Step | null> => {
    if (step.kind === 'cells') {
      const entries = step.cells.map((c) => ({ row: c.row, col: c.col, ...(direction === 'undo' ? c.before : c.after), rev: c.rev }))
      const result = await sendCells(entries)
      if (!result) return null
      if (result.conflicts.length) {
        const first = [...result.conflicts].sort((a, b) => a.row - b.row || a.col - b.col)[0]
        const n = result.conflicts.length
        setSync(`${n} ${plural(n, 'cell left as', 'cells left as')} ${first.by} changed ${plural(n, 'it', 'them')}.`)
      }
      return { kind: 'cells', cells: direction === 'undo' ? swap(result.done) : result.done }
    }
    const forward = direction === 'redo'
    const base = `/api/patterns/${id}/repeats`
    const op = newId()
    ownOps.current.add(op)
    try {
      if (step.kind === 'box-add') {
        const result = forward
          ? await call<Structure>('POST', base, { ...step.box }, op)
          : await call<Structure>('DELETE', `${base}/${step.box.id}`, undefined, op)
        commitStructure(result, 'own')
      } else {
        const result = forward
          ? await call<Structure & { added: number }>('POST', `${base}/${step.box.id}/expand`, undefined, op)
          : await call<Structure>('POST', `${base}/undo-expand`, { ...step.box }, op)
        commitStructure(result, 'own')
      }
      return step
    } catch (error) {
      setSync(failureText(error))
      return null
    }
  }

  const travel = (direction: 'undo' | 'redo') => enqueue(async () => {
    const from = direction === 'undo' ? undoStack : redoStack
    const to = direction === 'undo' ? redoStack : undoStack
    const step = from.current.pop()
    if (!step) return
    const next = await replay(step, direction)
    if (!next) return void from.current.push(step)
    if (next.kind !== 'cells' || next.cells.length) to.current.push(next)
  })
  const undo = () => travel('undo')
  const redo = () => travel('redo')

  // ---- selection helpers
  const rectOf = (p: Pos = posRef.current) => {
    const a = p.anchor ?? p.cursor
    return { fromRow: Math.min(a.row, p.cursor.row), toRow: Math.max(a.row, p.cursor.row), fromCol: Math.min(a.col, p.cursor.col), toCol: Math.max(a.col, p.cursor.col) }
  }
  const selection = pos.anchor ? rectOf(pos) : null

  const moveTo = (cursor: { row: number; col: number }, anchor: Pos['anchor'], spoken = true) => {
    focusWanted.current = true
    setPos({ cursor, anchor })
    if (spoken) {
      const c = modelRef.current!.grid[cursor.row - 1][cursor.col - 1]
      const m = modelRef.current!
      setAnnounce(`${labelOf(cursor.row, cursor.col, symbolByKey(m.craft, m.terms, c.stitch)?.name ?? c.stitch, c.colour, c.repeat)}.`)
    }
    sendRef.current({ type: 'cursor', row: cursor.row, col: cursor.col })
  }

  const readingStep = () => (readsLeftward(modelRef.current!.rows[posRef.current.cursor.row - 1].side) ? -1 : 1)

  const cellsOfRect = (r: ReturnType<typeof rectOf>) => {
    const out: { row: number; col: number }[] = []
    for (let row = r.fromRow; row <= r.toRow; row++) for (let col = r.fromCol; col <= r.toCol; col++) out.push({ row, col })
    return out
  }

  const fill = (patch: (cell: { stitch: string; colour: string }) => { stitch: string; colour: string }) => {
    const m = modelRef.current!
    place(cellsOfRect(rectOf()).map(({ row, col }) => ({ row, col, ...patch(m.grid[row - 1][col - 1]) })))
  }

  const placeSymbol = (key: string) => {
    const m = modelRef.current!
    const { cursor, anchor } = posRef.current
    const name = symbolByKey(m.craft, m.terms, key)!.name
    setAnnounce(`Placed ${name} at row ${cursor.row}, column ${cursor.col}.`)
    if (anchor) return fill((cell) => ({ stitch: key, colour: cell.colour }))
    const cells = key === CABLE_KEY ? Array.from({ length: CABLE_CELLS }, (_, k) => cursor.col - k).filter((c) => c >= 1) : [cursor.col]
    const colourOf = (c: number) => m.grid[cursor.row - 1][c - 1].colour
    place(cells.map((col) => ({ row: cursor.row, col, stitch: key, colour: colourOf(col) })))
    const step = readingStep()
    const target = key === CABLE_KEY ? (step === -1 ? cursor.col - CABLE_CELLS : cursor.col + 1) : cursor.col + step
    if (target >= 1 && target <= m.width) moveTo({ row: cursor.row, col: target }, null, false)
    else focusWanted.current = true
  }

  const copy = (): Block => {
    const m = modelRef.current!
    const r = rectOf()
    const block: Block = []
    for (let row = r.fromRow; row <= r.toRow; row++) {
      block.push(m.grid[row - 1].slice(r.fromCol - 1, r.toCol).map((c) => ({ stitch: c.stitch, colour: c.colour })))
    }
    clipboard.current = block
    return block
  }

  const paste = () => {
    const block = clipboard.current
    if (!block) return
    const m = modelRef.current!
    const { cursor } = posRef.current
    const letters = new Set(m.colours.map((c) => c.letter))
    const entries: { row: number; col: number; stitch: string; colour: string }[] = []
    let total = 0
    block.forEach((cells, i) => cells.forEach((cell, j) => {
      total++
      const row = cursor.row + i
      const col = cursor.col + j
      if (row <= m.height && col <= m.width) entries.push({ row, col, stitch: cell.stitch, colour: letters.has(cell.colour) ? cell.colour : 'A' })
    }))
    const dropped = total - entries.length
    enqueue(async () => {
      const result = await sendCells(entries)
      if (!result) return
      if (result.done.length) pushStep({ kind: 'cells', cells: result.done })
      if (result.conflicts.length) showConflicts(result.conflicts)
      setSync(dropped
        ? `Pasted ${entries.length} of ${total} cells. ${dropped} ${plural(dropped, 'was', 'were')} past the edge.`
        : `Pasted ${total} ${plural(total, 'cell', 'cells')}.`)
    })
  }

  const mirror = () => {
    const r = rectOf()
    const m = modelRef.current!
    enqueue(async () => {
      const opId = newId()
      ownOps.current.add(opId)
      const was = (row: number, col: number) => ({ stitch: m.grid[row - 1][col - 1].stitch, colour: m.grid[row - 1][col - 1].colour })
      const snapshot = new Map<string, { stitch: string; colour: string }>()
      for (const { row, col } of cellsOfRect(r)) snapshot.set(`${row},${col}`, was(row, col))
      try {
        const result = await call<MirrorResult>('POST', `/api/patterns/${id}/mirror`, { opId, ...r })
        followRevs(result.applied)
        commitEdit(result.applied, result.rows, result.colourWarnings, 'own')
        if (result.applied.length) {
          pushStep({ kind: 'cells', cells: result.applied.map((a) => ({ row: a.row, col: a.col, before: snapshot.get(`${a.row},${a.col}`)!, after: { stitch: a.stitch, colour: a.colour }, rev: a.rev })) })
        }
      } catch (error) {
        setSync(failureText(error))
      }
    })
  }

  const addRepeat = () => {
    const r = rectOf()
    enqueue(async () => {
      const op = newId()
      ownOps.current.add(op)
      try {
        const result = await call<Structure & { id: string; times: number }>('POST', `/api/patterns/${id}/repeats`,
          { fromCol: r.fromCol, toCol: r.toCol, fromRow: r.fromRow, toRow: r.toRow }, op)
        commitStructure(result, 'own')
        pushStep({ kind: 'box-add', box: { id: result.id, fromCol: r.fromCol, toCol: r.toCol, fromRow: r.fromRow, toRow: r.toRow, times: result.times } })
      } catch (error) {
        setSync(failureText(error))
      }
    })
  }

  const setTimes = async (boxId: string, times: number): Promise<void> => {
    const op = newId()
    ownOps.current.add(op)
    try {
      const result = await call<{ rows: EditResult['rows']; repeats: Repeat[]; colourWarnings: EditResult['colourWarnings'] }>(
        'PATCH', `/api/patterns/${id}/repeats/${boxId}`, { times }, op)
      const before = modelRef.current!
      const next = { ...before, rows: reuseRows(before.rows, result.rows), repeats: result.repeats, warnings: result.colourWarnings }
      setModel(next)
      const said = checkAnnouncement(before.rows, next.rows)
      if (said) setCheck(said)
    } catch (error) {
      setSync(failureText(error))
      throw error
    }
  }

  const expand = (box: Repeat) => enqueue(async () => {
    const op = newId()
    ownOps.current.add(op)
    try {
      const result = await call<Structure & { added: number }>('POST', `/api/patterns/${id}/repeats/${box.id}/expand`, undefined, op)
      commitStructure(result, 'own')
      pushStep({ kind: 'expand', box })
      setSync(`Repeat ${box.id} expanded: ${result.added} ${plural(result.added, 'column', 'columns')} added.`)
    } catch (error) {
      setSync(failureText(error))
    }
  })

  const applyText = async (row: number, text: string): Promise<{ message: string; position: number | null } | null> => {
    const m = modelRef.current!
    const was = new Map<string, { stitch: string; colour: string }>()
    m.grid[row - 1].forEach((c, i) => was.set(`${row},${i + 1}`, { stitch: c.stitch, colour: c.colour }))
    const op = newId()
    ownOps.current.add(op)
    try {
      const result = await call<TextResult>('POST', `/api/patterns/${id}/text`, { row, text }, op)
      followRevs(result.cells)
      commitEdit(result.cells, result.rows, result.colourWarnings, 'text')
      if (result.cells.length) {
        pushStep({ kind: 'cells', cells: result.cells.map((c) => ({ row, col: c.col, before: was.get(`${row},${c.col}`)!, after: { stitch: c.stitch, colour: c.colour }, rev: c.rev })) })
      }
      setSync(`Row ${row} updated: ${result.changed} ${plural(result.changed, 'cell', 'cells')} changed.`)
      setEditing(null)
      focusEdit.current = row
      return null
    } catch (error) {
      if (error instanceof ApiFail && error.status === 422 && error.body.field === 'text') {
        return { message: error.body.message ?? '', position: error.body.position ?? null }
      }
      setSync(failureText(error))
      return { message: failureText(error), position: null }
    }
  }
  const focusEdit = useRef<number | null>(null)

  // ---- keyboard
  const onKeyDown = (e: ReactKey<HTMLElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('[role=dialog]') || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && (target as HTMLInputElement).type !== 'radio') return
    const m = modelRef.current
    if (!m) return
    const key = e.key
    const ctrl = e.ctrlKey || e.metaKey
    const onCell = target.matches('[role=gridcell][data-col]')
    const lower = key.length === 1 ? key.toLowerCase() : key
    if (ctrl && lower === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo() }
    if (ctrl && lower === 'y') { e.preventDefault(); return redo() }
    if (e.altKey) return
    if (!ctrl && !onCell && (lower === 'm' || lower === 'b')) {
      e.preventDefault()
      return lower === 'm' ? mirror() : addRepeat()
    }
    if (!onCell) return
    const { cursor, anchor } = posRef.current
    if (ctrl) {
      if (lower === 'c') { e.preventDefault(); copy() }
      else if (lower === 'x') { e.preventDefault(); copy(); fill(() => ({ stitch: 'ns', colour: 'A' })) }
      else if (lower === 'v') { e.preventDefault(); paste() }
      return
    }
    if (MOVES[key]) {
      e.preventDefault()
      const [dr, dc] = MOVES[key]
      const next = { row: Math.min(m.height, Math.max(1, cursor.row + dr)), col: Math.min(m.width, Math.max(1, cursor.col + dc)) }
      moveTo(next, e.shiftKey ? anchor ?? cursor : null)
      return
    }
    if (key === 'Escape') { setPos({ cursor, anchor: null }); return }
    if (key === 'Enter') { e.preventDefault(); lift.pinCell(cursor.row, cursor.col); return }
    if (key === 'Delete') {
      e.preventDefault()
      setAnnounce(`Placed No stitch at row ${cursor.row}, column ${cursor.col}.`)
      return fill((cell) => ({ stitch: 'ns', colour: cell.colour }))
    }
    if (/^[1-6]$/.test(key)) {
      const letter = COLOUR_LETTERS[Number(key) - 1]
      if (m.colours.some((c) => c.letter === letter)) fill((cell) => ({ stitch: cell.stitch, colour: letter }))
      return
    }
    if (lower === 'm') return mirror()
    if (lower === 'b') return addRepeat()
    const found = symbolsFor(m.craft, m.terms).find((s) => s.letter === lower)
    if (found && key.length === 1) { e.preventDefault(); placeSymbol(found.key) }
  }

  // ---- pointer
  const cellAt = (e: ReactPointer<HTMLElement>) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[role=gridcell][data-col]')
    return el ? { row: Number(el.dataset.row), col: Number(el.dataset.col) } : null
  }
  const showPreview = () => {
    const next = new Map<number, Set<number>>()
    for (const { row, col } of drag.current?.cells.values() ?? []) {
      if (!next.has(row)) next.set(row, new Set())
      next.get(row)!.add(col)
    }
    setPreview(next)
  }
  const onPointerDown = (e: ReactPointer<HTMLElement>) => {
    if (e.button !== 0) return
    const cell = cellAt(e)
    if (!cell) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode: toolRef.current, last: cell, cells: new Map([[`${cell.row},${cell.col}`, cell]]) }
    if (toolRef.current === 'select') moveTo(cell, cell, false)
    else { moveTo(cell, null, false); showPreview() }
  }
  const onPointerMove = (e: ReactPointer<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const cell = cellAt(e)
    if (!cell || (cell.row === d.last.row && cell.col === d.last.col)) return
    if (d.mode === 'paint') {
      for (const c of line(d.last, cell)) d.cells.set(`${c.row},${c.col}`, c)
      showPreview()
    }
    d.last = cell
    focusWanted.current = true
    if (d.mode === 'select') setPos({ cursor: cell, anchor: posRef.current.anchor })
    else setPos({ cursor: cell, anchor: null })
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    setPreview(new Map())
    sendRef.current({ type: 'cursor', row: posRef.current.cursor.row, col: posRef.current.cursor.col })
    if (d.mode === 'select') {
      const r = rectOf()
      const rows = r.toRow - r.fromRow + 1
      const cols = r.toCol - r.fromCol + 1
      setSync(`Selected ${rows} ${plural(rows, 'row', 'rows')} by ${cols} ${plural(cols, 'column', 'columns')}.`)
      return
    }
    place([...d.cells.values()].map(({ row, col }) => ({ row, col, stitch: symbolRef.current, colour: colourRef.current })))
  }
  const onPointerCancel = () => { drag.current = null; setPreview(new Map()) }

  const toolRef = useRef(tool); toolRef.current = tool
  const symbolRef = useRef(symbol); symbolRef.current = symbol
  const colourRef = useRef(colour); colourRef.current = colour

  // ---- twin lift
  const lift = useTwinLift(model)

  const view: GridView = useMemo(() => {
    if (!model) return EMPTY_VIEW
    const peerRows = new Map<number, Record<number, string>>()
    for (const p of peers.values()) peerRows.set(p.row, { ...(peerRows.get(p.row) ?? {}), [p.col]: p.name })
    return { cursor: pos.cursor, selection, peers: peerRows, lifted: lift.lifted, pinned: lift.pinned, marks, preview, diffs: EMPTY_VIEW.diffs }
  }, [model, lift.lifted, lift.pinned, peers, pos, selection, marks, preview])

  // ---- live messages
  function handle(message: LiveMessage): void {
    const m = modelRef.current
    switch (message.type) {
      case 'hello':
        setUsers(message.users)
        sendRef.current({ type: 'cursor', row: posRef.current.cursor.row, col: posRef.current.cursor.col })
        break
      case 'presence':
        setUsers(message.users)
        setPeers((old) => new Map([...old].filter(([uid]) => message.users.some((u) => u.id === uid))))
        break
      case 'cursor':
        if (message.user.id !== me?.id) setPeers((old) => new Map(old).set(message.user.id, { name: message.user.name, row: message.row, col: message.col }))
        break
      case 'edit':
        if (m && !(message.op && ownOps.current.has(message.op))) commitEdit(message.cells, message.rows, message.colourWarnings, 'push')
        break
      case 'structure':
        if (!m || (message.op && ownOps.current.has(message.op))) break
        if (message.restored) { undoStack.current = []; redoStack.current = [] }
        commitStructure(message.structure, 'push')
        break
      case 'times':
        if (m && !(message.op && ownOps.current.has(message.op))) {
          setModel({ ...m, rows: reuseRows(m.rows, message.rows), repeats: message.repeats, warnings: message.colourWarnings })
          const said = checkAnnouncement(m.rows, message.rows)
          if (said) setCheck(said)
        }
        break
      case 'colours':
        if (m && !(message.op && ownOps.current.has(message.op))) setModel({ ...m, colours: message.colours })
        break
      case 'versions':
        setVersions((old) => [...old.filter((v) => v.version !== message.entry.version), message.entry].sort((a, b) => a.version - b.version))
        setMeta((old) => (old ? { ...old, version: message.latest } : old))
        break
      case 'counter':
        setTesters((old) => old.map((t) => (t.id === message.user.id ? { ...t, row: message.row, version: message.version } : t)))
        break
      case 'followed':
        setTesters((old) => old.map((t) => (t.id === message.user.id ? { ...t, row: message.row, version: message.version } : t)))
        break
      case 'tester':
        setTesters((old) => [...old.filter((t) => t.id !== message.tester.id), message.tester].sort((a, b) => a.name.localeCompare(b.name)))
        break
      case 'note':
        setNotes((old) => [...old, { row: message.row, text: message.text, tester: message.user.name, version: message.version }]
          .sort((a, b) => a.row - b.row))
        setTesters((old) => old.map((t) => (t.id === message.user.id ? { ...t, notes: message.testerNotes } : t)))
        if (m) setModel({ ...m, rows: m.rows.map((r) => (r.row === message.row ? { ...r, notes: message.rowNotes } : r)) })
        break
    }
  }

  const addColour = (colour: { letter: string; name: string; hex: string }) => {
    const m = modelRef.current!
    if (!m.colours.some((c) => c.letter === colour.letter)) setModel({ ...m, colours: [...m.colours, colour] })
  }

  const clearUndo = () => { undoStack.current = []; redoStack.current = [] }

  return {
    state, model, meta, setMeta, testers, versions, notes, users, live, sync, setSync, announce, check, conflict, rowChanged,
    editing, setEditing, pos, tool, setTool, symbol, setSymbol, colour, setColour, view, focusWanted, focusEdit,
    onKeyDown, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, moveTo, mirror, addRepeat,
    setTimes, expand, applyText, lift, addColour, clearUndo, ownOps,
    commitStructure,
    setVersions,
  }
}
