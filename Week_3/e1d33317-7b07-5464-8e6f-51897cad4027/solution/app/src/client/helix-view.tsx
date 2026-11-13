// Helix view: the WebGL drum of engraved systems, the hidden system groups for assistive tech, and the Helix peel
// that carries a part from the cylinder onto its page and back.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { SystemSvg } from '../shared/protocol.js'
import { HelixScene } from './helix/scene.js'
import { useSession, useSnapshot } from './ui.js'

/** True when this browser can give a WebGL context. */
export function webglAvailable(): boolean {
  const probe = document.createElement('canvas')
  const context = probe.getContext('webgl2') ?? probe.getContext('webgl')
  if (!context) return false
  ;(context as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext()
  return true
}

interface Props {
  systems: SystemSvg[] | null
  reduced: boolean
  partId: string | null
  onSettled: () => void
  onFallback: () => void
  editorRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent) => void
  staves: ReactNode
  overlay: ReactNode
}

export function HelixView({ systems, reduced, partId, onSettled, onFallback, editorRef, onKeyDown, staves, overlay }: Props): ReactNode {
  const session = useSession()
  const snap = useSnapshot()
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<HelixScene | null>(null)
  const peeled = useRef<string | null>(null)
  const settled = useRef(onSettled)
  settled.current = onSettled
  const [sheet, setSheet] = useState<CSSProperties>({})
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const made = HelixScene.create(element, { reducedMotion: reduced })
    if (!made) {
      onFallback()
      return
    }
    scene.current = made
    return () => {
      made.dispose()
      scene.current = null
      peeled.current = null
    }
    // the scene is created once per mount; later changes arrive through the effects below
  }, [])

  useEffect(() => scene.current?.setReducedMotion(reduced), [reduced])

  useEffect(() => {
    if (systems) scene.current?.setSystems(systems.map((s) => ({ index: s.index, svg: s.svg })))
  }, [systems])

  useEffect(() => {
    const live = scene.current
    if (!live || !systems) return
    const position = snap.position
    const target = snap.playing && position ? systems.find((s) => position.measure >= s.firstMeasure && position.measure <= s.lastMeasure) : undefined
    if (!target || !position) {
      live.setPlayhead(null)
      return
    }
    const beats = session.measureGrid.signatureAt(position.measure).beats
    const span = target.lastMeasure - target.firstMeasure + 1
    live.setPlayhead({ systemIndex: target.index, fraction: Math.min(1, (position.measure - target.firstMeasure + (position.beat - 1) / beats) / span) })
  }, [snap.position, snap.playing, systems, session])

  useEffect(() => {
    const live = scene.current
    if (!live) return
    if (partId && peeled.current !== partId) {
      peeled.current = partId
      let cancelled = false
      void (async () => {
        await session.loadPartSystems(partId)
        const state = session.getSnapshot()
        const part = state.parts.find((p) => p.id === partId)
        const entry = state.partSystems[partId]
        if (cancelled || !part || !entry) {
          settled.current()
          return
        }
        const first = entry.systems.filter((s) => s.page === 1)
        await live.peel({ staffIds: part.staffIds, partSystems: first.map((s) => ({ index: s.index, page: s.page, svg: s.svg })) })
        if (!cancelled) {
          const rect = live.sheetRect()
          setSheet({ '--sheet-left': `${Math.round(rect.left)}px`, '--sheet-top': `${Math.round(rect.top)}px`, '--sheet-width': `${Math.round(rect.width)}px` } as CSSProperties)
          settled.current()
        }
      })()
      return () => {
        cancelled = true
      }
    }
    if (!partId && peeled.current) {
      peeled.current = null
      void live.unpeel()
    }
  }, [partId, session])

  return (
    <>
      {staves}
      <div
        ref={editorRef} className="score-editor" role="application" aria-label="Score editor" tabIndex={0}
        onKeyDown={(event) => onKeyDown(event.nativeEvent)}
      >
        <div className="helix-stage" ref={stage}>
          <canvas ref={canvas} role="img" aria-label={`Helix view of ${snap.score?.title ?? ''}`} />
          <div className="sr-only">
            {systems?.map((s) => <div key={s.index} role="group" aria-label={`System ${s.index}, measures ${s.firstMeasure}–${s.lastMeasure}`} />)}
          </div>
          {overlay && <div className="helix-overlay" style={sheet}>{overlay}</div>}
        </div>
      </div>
    </>
  )
}
