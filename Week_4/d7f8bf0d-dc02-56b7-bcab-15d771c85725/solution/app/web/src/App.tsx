import { useEffect, useRef } from 'react'
import { DialogHost, SheetHost } from './sheets'
import { useAppState, store } from './state'
import { ModeSwitch, RoundControls } from './components/Controls'
import { BuildTools } from './components/BuildTools'
import { Notices, StatusRegion } from './components/Notices'
import { ConflictSheet, DeadlockSheet, PieceInspector } from './components/OperateSheets'
import { Readout } from './components/Readout'
import { SchematicDock } from './components/Schematic'
import { SessionBar } from './components/SessionBar'
import { SignIn, SignInAgain } from './components/SignIn'
import { Splash } from './components/Splash'
import { rightInsets, Stage } from './components/Stage'
import { Walkthrough } from './components/Walkthrough'

export function App() {
  const state = useAppState()
  useEffect(() => {
    if (state.boot === 'loading' && state.bootDone >= state.bootTotal && state.sceneProgress >= 1) store.set({ boot: 'ready' })
  }, [state.boot, state.bootDone, state.bootTotal, state.sceneProgress])

  // The pill is finished boot requests plus the scene as one more step; it never goes back.
  const loading = state.boot === 'checking' || state.boot === 'loading'
  const reached = useRef(0)
  reached.current = Math.max(reached.current, Math.floor((100 * (state.bootDone + state.sceneProgress)) / (state.bootTotal + 1)))
  const pill = loading ? Math.min(99, reached.current) : 100
  const signedOut = state.boot === 'signed-out'

  return (
    <>
      <Stage />
      <StageOverlays visible={!signedOut && state.boot === 'ready'} />
      {signedOut ? <SignIn /> : null}
      <SignInAgain />
      <Splash needed={loading} progress={pill} />
    </>
  )
}

// The session bar with the readout beside it. Its height is published as `--top-row-height`, so on tablets the
// schematic dock starts just under the readout that sits above it.
function TopRow({ operate }: { operate: boolean }) {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = row.current
    if (node === null) return
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--top-row-height', `${node.offsetHeight}px`))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={row} className="top-row">
      <SessionBar />
      {operate ? <Readout /> : null}
    </div>
  )
}

function StageOverlays({ visible }: { visible: boolean }) {
  const state = useAppState()
  // Keys hold each overlay to its own node: unkeyed, the loading `.top` is reused as `.bottom-edge` and jumps down the page.
  if (!visible) return <div key="top" className="top"><StatusRegion /></div>
  const { bar, bottom } = rightInsets(state)
  return (
    <>
      <div key="bottom-edge" className="bottom-edge" data-sheet={bottom > 0 || undefined} style={{ right: bottom + 16 }}>
        <BuildTools />
        <RoundControls />
        <ModeSwitch />
      </div>
      <div key="top" className="top" data-sheet={bottom > 0 || undefined} style={{ right: bar + 16 }}>
        <TopRow operate={state.mode === 'operate'} />
        <StatusRegion />
        <Notices />
      </div>
      <SchematicDock />
      <SheetHost />
      {state.sheet === 'conflict' ? <ConflictSheet /> : null}
      {state.sheet === 'deadlock' ? <DeadlockSheet /> : null}
      {state.sheet === 'piece-inspector' ? <PieceInspector /> : null}
      <DialogHost />
      <Walkthrough />
    </>
  )
}
