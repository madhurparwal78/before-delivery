// The engraved score on screen: server-made systems with the overlays drawn from live state (holds, carets, cursors, playhead).

import { createContext, memo, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from './editor.js'
import type { SystemSvg } from '../shared/protocol.js'
import { formatBeat } from '../shared/music.js'
import { useReducedMotion, useSession, useSnapshot } from './ui.js'

export const EditorContext = createContext<{ editor: Editor; focusEditor: () => void } | null>(null)

const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0] ?? '').join('').toUpperCase()

interface Mark {
  key: string
  left: number
  top: number
  width: number
  height: number
  label?: string
}

interface Marks {
  brackets: Mark[]
  caret: Mark | null
  cursors: Mark[]
  playhead: Mark | null
  highlight: Mark | null
}

const NO_MARKS: Marks = { brackets: [], caret: null, cursors: [], playhead: null, highlight: null }

const SvgHost = memo(function SvgHost({ svg }: { svg: string }): ReactNode {
  return <div className="svg-host" dangerouslySetInnerHTML={{ __html: svg }} />
})

const selectorFor = (attribute: string, value: string): string => `[${attribute}="${CSS.escape(value)}"]`

function rectIn(el: Element, wrapper: DOMRect): Mark {
  const r = el.getBoundingClientRect()
  return { key: '', left: r.left - wrapper.left, top: r.top - wrapper.top, width: r.width, height: r.height }
}

/** A staff's box: its left edge and the vertical extent of its five lines, from the engraver's data attributes. */
function staffRect(el: Element, wrapper: DOMRect): Mark {
  const mark = rectIn(el, wrapper)
  const top = Number(el.getAttribute('data-staff-top'))
  const height = Number(el.getAttribute('data-staff-height'))
  const transform = (el as SVGGElement).ownerSVGElement?.getScreenCTM()
  if (!transform || !Number.isFinite(top) || !(height > 0)) return mark
  return { ...mark, top: transform.f + top * transform.d - wrapper.top, height: height * transform.d }
}

export function SystemFigure({ system, role = 'score', fadeIds }: { system: SystemSvg; role?: 'score' | 'part'; fadeIds?: Set<string> }): ReactNode {
  const session = useSession()
  const snap = useSnapshot()
  const context = useContext(EditorContext)
  const wrapper = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [marks, setMarks] = useState<Marks>(NO_MARKS)
  const label = role === 'score'
    ? `System ${system.index}, measures ${system.firstMeasure}–${system.lastMeasure}`
    : `Part system ${system.index}, measures ${system.firstMeasure}–${system.lastMeasure}`

  useLayoutEffect(() => {
    const node = wrapper.current
    if (!node) return
    const compute = (): void => {
      const box = node.getBoundingClientRect()
      const next: Marks = { brackets: [], caret: null, cursors: [], playhead: null, highlight: null }
      const staffEl = (id: string): Element | null => node.querySelector(`g${selectorFor('data-staff-id', id)}`)
      if (role === 'score') {
        for (const hold of snap.holds) {
          const el = staffEl(hold.staffId)
          if (el) next.brackets.push({ ...staffRect(el, box), key: hold.staffId, label: initialsOf(hold.holder.name) })
        }
        const { entry, me } = snap
        const staff = staffEl(entry.staffId)
        if (staff) {
          const sr = staffRect(staff, box)
          const id = entry.current ? `${entry.current.lamport}@${entry.current.site}` : null
          const hits = id ? [...node.querySelectorAll(`[data-event=${JSON.stringify(id)}]`)].filter((e) => e.closest('g[data-staff-id]') === staff) : []
          const last = hits[hits.length - 1]
          if (last) next.caret = { ...sr, key: 'caret', left: rectIn(last, box).left + rectIn(last, box).width + 3, width: 2 }
          else if (!id && system.firstMeasure === 1) {
            const first = node.querySelector(selectorFor('data-measure-box', '1'))
            if (first) next.caret = { ...sr, key: 'caret', left: rectIn(first, box).left + 2, width: 2 }
          }
        }
        for (const entry of snap.presence) {
          if (entry.collaboratorId === me?.id || !entry.cursor) continue
          const staff = staffEl(entry.cursor.staffId)
          if (!staff) continue
          const sr = staffRect(staff, box)
          const at = node.querySelector(`[data-event][data-measure="${entry.cursor.measure}"][data-beat=${JSON.stringify(formatBeat(entry.cursor.beat))}]`)
          const measure = node.querySelector(selectorFor('data-measure-box', String(entry.cursor.measure)))
          const anchor = at ?? measure
          if (anchor) next.cursors.push({ ...sr, key: entry.collaboratorId, left: rectIn(anchor, box).left, width: 2, label: initialsOf(entry.name) })
        }
        const position = snap.position
        if (snap.playing && position && position.measure >= system.firstMeasure && position.measure <= system.lastMeasure) {
          const measure = node.querySelector(selectorFor('data-measure-box', String(position.measure)))
          if (measure) {
            const mr = rectIn(measure, box)
            const beats = session.measureGrid.signatureAt(position.measure).beats
            if (reduced) next.highlight = { ...mr, key: 'highlight' }
            else next.playhead = { ...mr, key: 'playhead', left: mr.left + (mr.width * (position.beat - 1)) / beats, width: 3 }
          }
        }
      }
      setMarks(next)
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(node)
    return () => observer.disconnect()
  }, [system.svg, snap.holds, snap.presence, snap.entry, snap.position, snap.playing, snap.me, role, reduced, session])

  useLayoutEffect(() => {
    if (!fadeIds || fadeIds.size === 0 || !wrapper.current) return
    for (const el of wrapper.current.querySelectorAll('[data-event]')) {
      if (fadeIds.has(el.getAttribute('data-event') ?? '')) el.classList.add('note-fade')
    }
  }, [system.svg, fadeIds])

  const onClick = (event: React.MouseEvent): void => {
    if (role !== 'score' || !context) return
    const target = event.target as Element
    const staff = target.closest('g[data-staff-id]')
    if (!staff) return
    const staffId = staff.getAttribute('data-staff-id') ?? ''
    const note = target.closest('[data-event]')
    if (note) {
      const [lamport, ...site] = (note.getAttribute('data-event') ?? '').split('@')
      session.setEntry({ staffId, voice: Number(note.getAttribute('data-voice')) === 2 ? 2 : 1, current: { lamport: Number(lamport), site: site.join('@') } })
    } else {
      context.editor.selectStaff(staffId)
    }
    context.focusEditor()
  }

  return (
    <div className="system" role="group" aria-label={label} ref={wrapper} onClick={onClick}>
      <SvgHost svg={system.svg} />
      <div className="overlay" aria-hidden="true">
        {marks.brackets.map((m) => (
          <div key={m.key} className="hold-bracket" style={{ left: m.left - 8, top: m.top - 2, height: m.height + 4 }}><span>{m.label}</span></div>
        ))}
        {marks.cursors.map((m) => (
          <div key={m.key} className="cursor-mark" style={{ left: m.left, top: m.top - 2, height: m.height + 4 }}><span>{m.label}</span></div>
        ))}
        {marks.caret && <div className="caret-mark" style={{ left: marks.caret.left, top: marks.caret.top - 2, height: marks.caret.height + 4 }} />}
        {marks.highlight && <div className="measure-highlight" style={{ left: marks.highlight.left, top: marks.highlight.top, width: marks.highlight.width, height: marks.highlight.height }} />}
        {marks.playhead && <div className="playhead" style={{ left: marks.playhead.left, top: marks.playhead.top, height: marks.playhead.height }} />}
      </div>
    </div>
  )
}

/** Groups systems by the page the server put them on. */
export function byPage(systems: SystemSvg[]): SystemSvg[][] {
  const pages: SystemSvg[][] = []
  for (const s of systems) (pages[s.page - 1] ??= []).push(s)
  return pages.filter(Boolean)
}

export function PagesView({ systems, fadeIds }: { systems: SystemSvg[] | null; fadeIds: Set<string> }): ReactNode {
  if (!systems) return <div className="skeleton-sheet"><i /><i /><i /><p>Engraving the score…</p></div>
  return (
    <div className="sheets">
      {byPage(systems).map((page, i) => (
        <div className="sheet" key={i}>
          {page.map((s) => <SystemFigure key={s.index} system={s} fadeIds={fadeIds} />)}
          <div className="sheet-number mono">{i + 1}</div>
        </div>
      ))}
    </div>
  )
}

export function StripView({ systems, fadeIds }: { systems: SystemSvg[] | null; fadeIds: Set<string> }): ReactNode {
  return (
    <div role="region" aria-label="System strip" className="strip" tabIndex={0}>
      {(systems ?? []).map((s) => (
        <div className="strip-system" key={s.index}><SystemFigure system={s} fadeIds={fadeIds} /></div>
      ))}
    </div>
  )
}
