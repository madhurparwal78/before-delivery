import { highball, recallSelected, setMode } from '../actions'
import { canRun, useAppState } from '../state'
import { BuildIcon, OperateIcon, PlayIcon, ReturnIcon } from '../ui/icons'
import { turn } from './Stage'

// Highball and Recall (Operate mode only), the heading dial and the Build and Operate switch.
export function RoundControls() {
  const state = useAppState()
  const operate = state.mode === 'operate' && state.session !== null && canRun(state.role)
  return (
    <div className="round-controls">
      {operate ? (
        <>
          <button type="button" className="round" data-testid="highball" aria-label="Highball" onClick={() => void highball()}>
            <PlayIcon size={24} />
          </button>
          <button type="button" className="round" data-testid="recall" aria-label="Recall" onClick={() => void recallSelected()}>
            <ReturnIcon size={24} />
          </button>
        </>
      ) : null}
      <button type="button" className="dial" data-testid="heading-dial" aria-label="Rotate heading" onClick={() => turn(45)}>
        <svg viewBox="0 0 50 50" width="50" height="50" aria-hidden="true" focusable="false">
          <circle cx="25" cy="25" r="24" fill="#fff" />
          <circle cx="25" cy="25" r="22" fill="none" stroke="#e8ecf4" strokeWidth="4" />
          <path d="M25 3a22 22 0 0 1 19 11" fill="none" stroke="#3fb56b" strokeWidth="4" strokeLinecap="round" />
          <g stroke="#5a6178" strokeWidth="2" strokeLinecap="round">
            {Array.from({ length: 12 }, (_, i) => (
              <line key={i} x1="25" y1="7.5" x2="25" y2={i % 3 === 0 ? 12.5 : 10.5} transform={`rotate(${i * 30} 25 25)`} />
            ))}
          </g>
          <g className="needle" style={{ transform: `rotate(${state.heading}deg)`, transformOrigin: '25px 25px' }}>
            <path d="M25 11 L27.6 22.4 L37 25 L27.6 27.6 L25 39 L22.4 27.6 L13 25 L22.4 22.4 Z" fill="#0fa6ee" stroke="#0158b4" strokeWidth="1.4" strokeLinejoin="round" />
          </g>
        </svg>
      </button>
    </div>
  )
}

export function ModeSwitch() {
  const state = useAppState()
  const operate = state.mode === 'operate'
  return (
    <button type="button" role="switch" aria-checked={operate} aria-label="Operate mode" data-testid="mode-switch" className="mode-switch" onClick={() => setMode(operate ? 'build' : 'operate')}>
      <span className={`mode-glyph${operate ? '' : ' active'}`}><BuildIcon size={24} /></span>
      <span className="toggle" aria-hidden="true"><span className="knob" /></span>
      <span className={`mode-glyph${operate ? ' active' : ''}`}><OperateIcon size={24} /></span>
    </button>
  )
}
