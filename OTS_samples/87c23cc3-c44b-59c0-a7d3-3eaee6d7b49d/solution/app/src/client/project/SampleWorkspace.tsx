import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { HERO_FIRST_LINK, HERO_SAMPLE } from '../../shared/templates.ts'
import { useAnnounce } from '../announce.tsx'
import { boot } from '../boot.ts'
import { Diagram, type DiagramActions } from '../diagram/Diagram.tsx'
import { reducedMotion } from '../motion.ts'
import { CodeEditor, type GhostCaret } from './CodeEditor.tsx'
import { EmptyCanvas } from './panes.tsx'
import { ProjectStore } from './store.ts'
import { appendStarterEntity } from '../../shared/canonical.ts'
import { parseMortise } from '../../shared/mortise.ts'

const PREFIX = HERO_SAMPLE.slice(0, HERO_SAMPLE.indexOf(HERO_FIRST_LINK) + HERO_FIRST_LINK.length)
const CHAR_MS = 35
const LINE_PAUSE_MS = 300
const BLINK_MS = 350
const BLINKS = 3
const IN_VIEW = 0.25

function caretAt(text: string): GhostCaret {
  const lines = text.split('\n')
  const last = lines[lines.length - 1] as string
  return { line: lines.length - 1, column: Array.from(last).length }
}

/** The landing page's working editor: types the sample once, then hands over to live editing. It never saves. */
export function SampleWorkspace() {
  const { say } = useAnnounce()
  const hooks = { say, raise: () => undefined, parseDelayMs: boot.parseDelayMs, self: null }
  const store = useMemo(() => new ProjectStore({ kind: 'sample', text: reducedMotion() ? HERO_SAMPLE : PREFIX }, hooks), [])
  store.hooks = hooks
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [selection, setSelection] = useState<string[]>([])
  const [ghost, setGhost] = useState<GhostCaret | null>(null)
  const [blinking, setBlinking] = useState(false)
  const root = useRef<HTMLElement>(null)
  const timers = useRef<number[]>([])
  const phase = useRef<'waiting' | 'playing' | 'done'>(reducedMotion() ? 'done' : 'waiting')

  const stop = (): void => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
    phase.current = 'done'
    setGhost(null)
    setBlinking(false)
  }

  const later = (ms: number, work: () => void): void => {
    timers.current.push(window.setTimeout(work, ms))
  }

  const play = (): void => {
    phase.current = 'playing'
    setGhost(caretAt(PREFIX))
    setBlinking(true)
    const rest = HERO_SAMPLE.slice(PREFIX.length)
    const type = (index: number): void => {
      if (index > rest.length) {
        phase.current = 'done'
        setGhost(null)
        return
      }
      const text = PREFIX + rest.slice(0, index)
      store.replaceNow(text)
      setGhost(caretAt(text))
      const pause = rest.charAt(index - 1) === '\n' ? LINE_PAUSE_MS : 0
      later(CHAR_MS + pause, () => type(index + 1))
    }
    later(BLINK_MS * BLINKS, () => {
      setBlinking(false)
      later(CHAR_MS, () => type(1))
    })
  }

  useEffect(() => {
    const element = root.current
    if (!element || phase.current !== 'waiting') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && phase.current === 'waiting') {
          observer.disconnect()
          play()
        }
      },
      { threshold: IN_VIEW },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      for (const timer of timers.current) window.clearTimeout(timer)
    }
    // The demo is armed once per page load.
  }, [])

  const interact = (): void => {
    if (phase.current === 'playing' || phase.current === 'waiting') {
      stop()
      store.replaceNow(HERO_SAMPLE)
    }
  }

  const actions: DiagramActions = {
    move: (name, x, y) => store.moveEntity(name, x, y),
    drawLink: (from, to) => void store.drawLink(from, to),
    openDetails: () => undefined,
    openRename: () => undefined,
    openGroup: () => undefined,
    say: (text) => say('diagram', text),
  }

  const reset = (): void => {
    stop()
    store.replaceNow(HERO_SAMPLE)
  }

  return (
    <section ref={root} id="sample" aria-label="Sample editor" className="sample-window dark">
      <div className="toolbar-strip">
        <span className="sample-tab">library.mortise</span>
        <button type="button" className="chip" onClick={reset}>
          <RotateCcw size={14} aria-hidden="true" />
          <span>Reset sample</span>
        </button>
        <span className="sample-note">Sample only: nothing here is saved</span>
      </div>
      <div className="panes sample-panes">
        <div className="text-pane">
          <CodeEditor
            label="Sample schema text"
            text={snap.text}
            readOnly={false}
            errors={snap.errors}
            onChange={(text) => {
              interact()
              store.typed(text)
            }}
            caret={snap.caret}
            ghost={ghost}
            blinking={blinking}
            onInteract={interact}
          />
        </div>
        <div className="diagram-wrap">
          <Diagram
            label="Sample diagram"
            fit
            model={snap.model}
            layout={snap.layout}
            canEdit
            layoutCause={snap.layoutCause}
            selection={selection}
            onSelection={setSelection}
            onFocusEntity={() => undefined}
            actions={actions}
          />
          {!snap.model || snap.model.entities.length === 0 ? (
            <EmptyCanvas canEdit onAdd={() => store.typed(appendStarterEntity(snap.text, parseMortise(snap.text).model))} />
          ) : null}
        </div>
      </div>
    </section>
  )
}
