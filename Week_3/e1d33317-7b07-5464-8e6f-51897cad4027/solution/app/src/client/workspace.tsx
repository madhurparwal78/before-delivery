// The workspace: top rail, staves list, the score (Helix, pages or strip), the tools rail and every dialog.

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Staff } from '../shared/protocol.js'
import { ROLE_WORD, type Collaborator, type Part } from '../shared/protocol.js'
import { formatBeat, type Step } from '../shared/music.js'
import { AddMeasuresDialog, AddStaffDialog, ExtractDialog, InviteDialog, RemoveDialog, StaffSettingsDialog, StavesForDialog, TextDialog } from './dialogs.js'
import { Editor } from './editor.js'
import { HelixView, webglAvailable } from './helix-view.js'
import { PartPage } from './part-page.js'
import { EditorContext, PagesView, StripView } from './score-view.js'
import { api, ApiFailure } from './api.js'
import { ActionsContext, NoticeRegions, ToolsRail, type Tab, type WorkspaceActions } from './tools.js'
import { Icon, StaveMark, Status, SessionContext, Toasts, useMedia, useReducedMotion, useSession, useSnapshot } from './ui.js'
import { Session } from './session.js'

type Dialog =
  | { kind: 'addStaff' } | { kind: 'addMeasures' } | { kind: 'extract' } | { kind: 'staffSettings'; staff: Staff } | { kind: 'text' } | { kind: 'invite' }
  | { kind: 'stavesFor'; person: Collaborator } | { kind: 'remove'; person: Collaborator }

export function SeatInvalid(): ReactNode {
  return (
    <main className="centred">
      <div className="card">
        <StaveMark />
        <h1>Seat link not valid</h1>
        <p>This seat link is not valid. Ask the composer for a new one.</p>
      </div>
    </main>
  )
}

interface Props {
  partId: string | null
  navigate: (path: string, replace?: boolean) => void
}

export function Workspace({ partId, navigate }: Props): ReactNode {
  const session = useMemo(() => new Session(), [])
  useEffect(() => {
    void session.start()
    return () => session.dispose()
  }, [session])
  return (
    <SessionContext.Provider value={session}>
      <Gate partId={partId} navigate={navigate} />
    </SessionContext.Provider>
  )
}

function Gate({ partId, navigate }: Props): ReactNode {
  const { phase, me, score } = useSnapshot()
  const landed = useRef(false)
  // A section player opens on their own part, so the score is never drawn for them first (that flash would reflow the page).
  const deciding = phase === 'ready' && me?.role === 'player' && !partId && !landed.current && score !== null
  const own = deciding && score && me ? score.parts.find((p) => p.staffIds.every((s) => me.staffIds.includes(s))) : undefined
  useEffect(() => {
    if (!deciding) return
    landed.current = true
    if (own && score) navigate(`/score/${score.id}/parts/${own.id}`, true)
  }, [deciding, own, score, navigate])
  if (phase === 'invalid' || phase === 'removed') return <SeatInvalid />
  if (phase === 'loading' || own) return <main className="centred"><div className="card"><h1>Fairline</h1><p>Opening the score…</p></div></main>
  return <Shell partId={partId} navigate={navigate} />
}

function Shell({ partId, navigate }: Props): ReactNode {
  const session = useSession()
  const snap = useSnapshot()
  const { score, entry } = snap
  const phone = useMedia('(max-width: 767px)')
  const sheet = useMedia('(max-width: 1023px)')
  const reduced = useReducedMotion()
  const gl = useMemo(() => webglAvailable(), [])
  const [view, setView] = useState<'helix' | 'pages'>(gl ? 'helix' : 'pages')
  const [toolsOpen, setToolsOpen] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('Parts')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [settled, setSettled] = useState(true)
  const [cameFromScore, setCameFromScore] = useState(false)
  const editorElement = useRef<HTMLDivElement>(null)
  const effectiveView = phone || !gl ? 'pages' : view

  useEffect(() => {
    if (!gl) session.notice('View', '3D view unavailable — showing pages.')
  }, [gl, session])

  const openText = useCallback(() => setDialog({ kind: 'text' }), [])
  const editor = useMemo(() => new Editor(session, openText), [session, openText])
  const focusEditor = useCallback(() => editorElement.current?.focus(), [])

  const partOf = useCallback((staffId: string): string => score?.staves.find((s) => s.id === staffId)?.partId ?? '', [score])

  const holdSelected = useCallback(() => {
    const { selection, connectionId } = session.getSnapshot()
    if (selection.length === 0) return
    const names = (ids: string[]): string => ids.map((id) => session.getSnapshot().score?.staves.find((s) => s.id === id)?.name ?? id).join(', ')
    void api('POST', `/api/scores/${session.scoreId}/holds`, { staffIds: selection, connectionId }).then(
      () => session.notice('Holds', `Holding ${names(selection)}.`),
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 423 && error.body.heldBy) session.notice('Holds', `${error.body.heldBy.name} is holding ${names(error.body.staffIds ?? [])}. Your notes still save.`)
        else if (error instanceof ApiFailure && error.status === 409) session.notice('Holds', 'Reconnecting — try the hold again in a moment.')
        else session.notice('Holds', error instanceof ApiFailure ? error.detail : 'Reconnecting — try the hold again in a moment.')
      },
    )
  }, [session])

  const releaseMine = useCallback(() => {
    const mine = session.getSnapshot().holds.filter((h) => h.holder.id === session.me.id).map((h) => h.staffId)
    if (mine.length === 0) return
    const names = mine.map((id) => session.getSnapshot().score?.staves.find((s) => s.id === id)?.name ?? id).join(', ')
    void api('DELETE', `/api/scores/${session.scoreId}/holds?staffIds=${mine.join(',')}`).then(() => session.notice('Holds', `Released ${names}.`), () => undefined)
  }, [session])

  const openPart = useCallback((id: string) => {
    if (!partId) setCameFromScore(true)
    setSettled(effectiveView !== 'helix' || reduced)
    navigate(`/score/${session.scoreId}/parts/${id}`)
  }, [navigate, partId, session, effectiveView, reduced])

  const actions = useMemo<WorkspaceActions>(() => ({
    holdSelected,
    releaseMine,
    openStaffSettings: () => {
      const staff = score?.staves.find((s) => s.id === session.getSnapshot().selection[0])
      if (staff) setDialog({ kind: 'staffSettings', staff })
    },
    openInvite: () => setDialog({ kind: 'invite' }),
    openStavesFor: (person) => setDialog({ kind: 'stavesFor', person }),
    openRemove: (person) => setDialog({ kind: 'remove', person }),
    openPart,
  }), [holdSelected, releaseMine, openPart, score, session])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="spinbutton"]')) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (event.code === 'KeyP') session.togglePlay()
      else if (event.code === 'KeyE') setDialog({ kind: 'extract' })
      else if (event.code === 'KeyH') holdSelected()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, holdSelected])

  useEffect(() => {
    const placed = session.eventsOf(entry.staffId, entry.voice).find((e) => e.id.lamport === entry.current?.lamport && e.id.site === entry.current.site)
    session.setCursor(entry.staffId ? { staffId: entry.staffId, measure: placed?.measure ?? 1, beat: placed?.beat ?? 1 } : null)
  }, [session, entry, snap.voiceVersion])

  const onExtracted = (part: Part): void => {
    setCameFromScore(!partId)
    setSettled(effectiveView !== 'helix' || reduced)
    if (!partId || partId !== part.id) navigate(`/score/${session.scoreId}/parts/${part.id}`)
  }

  const backToScore = (): void => {
    setSettled(true)
    navigate(`/score/${session.scoreId}`)
  }

  const inPart = !!partId
  const helixMounted = effectiveView === 'helix' && (!inPart || cameFromScore)
  const showPartOverlay = inPart
  const sheetStatus = sheet ? sheetOpen : toolsOpen
  const setToolsState = sheet ? setSheetOpen : setToolsOpen
  const initialPart = partOf(entry.staffId)

  return (
    <ActionsContext.Provider value={actions}>
      <EditorContext.Provider value={{ editor, focusEditor }}>
        <div className="workspace">
          <TopRail
            view={effectiveView} setView={setView} gl={gl} phone={phone}
            openDialog={setDialog}
          />
          <div className="status-bar">
            <Status label="Entry" text={snap.notices.Entry} visible />
            <Status label="Sync queue" text={snap.notices['Sync queue']} visible />
            <Status label="Playback" text={snap.notices.Playback} visible />
          </div>
          <NoticeRegions />
          <div className="main" data-tools={sheet ? 'sheet' : toolsOpen ? 'open' : 'closed'}>
            <div className="centre" data-mode={helixMounted ? 'helix' : 'flow'} data-pad={phone && !inPart ? 'true' : undefined}>
              {helixMounted && (
                <div className="helix-layout">
                  <HelixView
                    systems={snap.systems} reduced={reduced} partId={inPart ? partId : null}
                    onSettled={() => setSettled(true)} onFallback={() => setView('pages')}
                    editorRef={editorElement} onKeyDown={(e) => { if (editor.handleKey(e)) e.preventDefault() }}
                    staves={<StavesList />} overlay={showPartOverlay ? (
                      <PartPage partId={partId as string} onBack={backToScore} onExtract={onExtracted} settled={settled} inHelix />
                    ) : null}
                  />
                </div>
              )}
              {!helixMounted && inPart && <PartPage partId={partId as string} onBack={backToScore} onExtract={onExtracted} settled />}
              {!helixMounted && !inPart && (
                <div className="paper-column">
                  {!phone && <StavesList />}
                  <div
                    ref={editorElement} className="score-editor" role="application" aria-label="Score editor" tabIndex={0}
                    onKeyDown={(e) => { if (editor.handleKey(e.nativeEvent)) e.preventDefault() }}
                  >
                    {phone ? <StripView systems={snap.systems} fadeIds={snap.fadeIds} /> : <PagesView systems={snap.systems} fadeIds={snap.fadeIds} />}
                  </div>
                </div>
              )}
            </div>
            <ToolsRail sheet={sheet} open={sheetStatus} setOpen={setToolsState} staves={phone && !inPart ? <StavesList /> : undefined} tab={tab} setTab={(next) => { setTab(next); if (sheet) setSheetOpen(true) }} />
          </div>
          <Toasts />
          {phone && !inPart && <NotePad editor={editor} />}
          {dialog && renderDialog(dialog, () => setDialog(null), { session, editor, initialPart, onExtracted })}
        </div>
      </EditorContext.Provider>
    </ActionsContext.Provider>
  )
}

function renderDialog(
  dialog: Dialog, close: () => void, context: { session: Session; editor: Editor; initialPart: string; onExtracted: (part: Part) => void },
): ReactNode {
  switch (dialog.kind) {
    case 'addStaff': return <AddStaffDialog onClose={close} />
    case 'addMeasures': return <AddMeasuresDialog onClose={close} />
    case 'extract': return <ExtractDialog onClose={close} initialPartId={context.initialPart} onExtract={context.onExtracted} />
    case 'staffSettings': return <StaffSettingsDialog staff={dialog.staff} onClose={close} />
    case 'invite': return <InviteDialog onClose={close} />
    case 'stavesFor': return <StavesForDialog person={dialog.person} onClose={close} />
    case 'remove': return <RemoveDialog person={dialog.person} onClose={close} />
    case 'text': {
      const current = context.editor.currentEvent()
      const entry = context.session.getSnapshot().entry
      if (!current) return null
      return (
        <TextDialog
          initial={current.text} onClose={close}
          onSave={(raw) => context.session.setText(entry.staffId, entry.voice, current.id, raw).then(() => context.session.notice('Text', 'Text saved.'))}
        />
      )
    }
  }
}

interface TopRailProps {
  view: 'helix' | 'pages'
  setView: (view: 'helix' | 'pages') => void
  gl: boolean
  phone: boolean
  openDialog: (dialog: Dialog) => void
}

function TopRail({ view, setView, gl, phone, openDialog }: TopRailProps): ReactNode {
  const session = useSession()
  const { score, me, playing, position, presence, sync } = useSnapshot()
  const composer = me?.role === 'composer'
  const timer = position ? `Measure ${position.measure} · Beat ${formatBeat(position.beat)}` : 'Measure 1 · Beat 1'
  const syncText = sync === 'paused' ? 'Live sync paused. Your edits are saved and reach others within 10 seconds.' : sync === 'restored' ? 'Live sync restored.' : 'Live'
  return (
    <header className="top-rail">
      <div className="rail-main">
        <h1>{score?.title}</h1>
        <div className="transport">
          <button type="button" className="btn" onClick={() => session.togglePlay()}>
            <Icon name={playing ? 'stop' : 'play'} />{playing ? 'Stop' : 'Play'}
          </button>
          <span role="timer" aria-label="Playback position" className="mono">{timer}</span>
        </div>
        {!phone && (
          <div className="view-switch" role="radiogroup" aria-label="View">
            <label><input type="radio" name="view" value="helix" checked={view === 'helix'} disabled={!gl} onChange={() => setView('helix')} />Helix</label>
            <label><input type="radio" name="view" value="pages" checked={view === 'pages'} onChange={() => setView('pages')} />Pages</label>
          </div>
        )}
        <div className="rail-group">
          <button type="button" className="btn quiet" onClick={() => openDialog({ kind: 'extract' })}>Extract part…</button>
          {composer && <button type="button" className="btn quiet" onClick={() => openDialog({ kind: 'addStaff' })}>Add staff</button>}
          {composer && <button type="button" className="btn quiet" onClick={() => openDialog({ kind: 'addMeasures' })}>Add measures</button>}
        </div>
      </div>
      <div className="rail-meta">
        <div role="status" aria-label="Live sync" className="sync-chip" data-state={sync === 'paused' ? 'paused' : 'live'}>{syncText}</div>
        <ul className="presence" aria-label="Collaborators here">
          {presence.map((p) => (
            <li key={p.collaboratorId} data-initials={p.name.split(/\s+/).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase()}><span className="presence-name">{`${p.name} · ${ROLE_WORD[p.role]}`}</span></li>
          ))}
        </ul>
      </div>
    </header>
  )
}

function StavesList(): ReactNode {
  const session = useSession()
  const { score, selection, entry, me } = useSnapshot()
  const context = useContext(EditorContext)
  const staves = score?.staves ?? []
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState(0)
  const move = (to: number, extend: boolean): void => {
    const next = Math.min(staves.length - 1, Math.max(0, to))
    setActive(next)
    if (extend) {
      const [from, until] = [Math.min(anchor, next), Math.max(anchor, next)]
      session.setSelection(staves.slice(from, until + 1).map((s) => s.id))
    } else setAnchor(next)
  }
  const toggle = (index: number): void => {
    const id = (staves[index] as Staff).id
    session.setSelection(selection.includes(id) ? selection.filter((s) => s !== id) : staves.filter((s) => s.id === id || selection.includes(s.id)).map((s) => s.id))
    setAnchor(index)
  }
  return (
    <section className="staves-panel">
      <h2 id="staves-title">Staves</h2>
      <div
        role="listbox" aria-label="Staves" aria-multiselectable="true" className="staves" tabIndex={0}
        aria-activedescendant={staves[active] ? `staff-option-${staves[active]?.id}` : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') move(active + 1, event.shiftKey)
          else if (event.key === 'ArrowUp') move(active - 1, event.shiftKey)
          else if (event.key === 'Home') move(0, event.shiftKey)
          else if (event.key === 'End') move(staves.length - 1, event.shiftKey)
          else if (event.key === ' ') toggle(active)
          else if (event.key === 'Enter' && staves[active]) {
            context?.editor.selectStaff((staves[active] as Staff).id)
            return
          } else return
          event.preventDefault()
        }}
      >
        {staves.map((s, i) => (
          <div
            key={s.id} id={`staff-option-${s.id}`} role="option" aria-selected={selection.includes(s.id)} data-active={i === active || undefined}
            data-entry={s.id === entry.staffId || undefined} aria-disabled={me?.role === 'player' && !me.staffIds.includes(s.id) ? true : undefined}
            onClick={() => {
              setActive(i)
              toggle(i)
            }}
          >
            {s.name}
          </div>
        ))}
      </div>
    </section>
  )
}


function NotePad({ editor }: { editor: Editor }): ReactNode {
  return (
    <div role="toolbar" aria-label="Note pad" className="note-pad">
      <div className="letters">
        {(['C', 'D', 'E', 'F', 'G', 'A', 'B'] as Step[]).map((letter) => (
          <button key={letter} type="button" className="btn" onClick={() => editor.enterNote(letter)}>{letter}</button>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => editor.enterRest()}>Rest</button>
        <button type="button" className="btn" onClick={() => editor.stepDuration(-1)}>Shorter</button>
        <button type="button" className="btn" onClick={() => editor.stepDuration(1)}>Longer</button>
        <button type="button" className="btn" onClick={() => editor.deleteCurrent()}>Delete</button>
        <button type="button" className="btn" onClick={() => editor.openText()}>Add text</button>
      </div>
    </div>
  )
}
