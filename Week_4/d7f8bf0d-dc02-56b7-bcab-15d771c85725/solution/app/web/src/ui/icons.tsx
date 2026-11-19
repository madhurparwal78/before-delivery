import type { ReactNode } from 'react'

interface IconProps { size?: number; className?: string }

function Svg({ size = 24, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM10.3 1.5h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 3-2 1.8c.1.6.1 1.2 0 1.8l2 1.8-1.7 3-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-3 2-1.8a6 6 0 0 1 0-1.8l-2-1.8 1.7-3 2.5.9c.5-.4 1.1-.7 1.7-.9z" />
  </Svg>
)
export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" d="M8.5 4.5h7l1.4 2.2H20a2 2 0 0 1 2 2v9.3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.7a2 2 0 0 1 2-2h3.1zM12 9.2a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4z" />
  </Svg>
)
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}><path fill="currentColor" d="M7 3.8v16.4a1 1 0 0 0 1.5.9l13-8.2a1 1 0 0 0 0-1.7l-13-8.2A1 1 0 0 0 7 3.8z" /></Svg>
)
export const ReturnIcon = (p: IconProps) => (
  <Svg {...p}><path fill="currentColor" d="M9.5 4 3 10.5 9.5 17v-4.2c4.6 0 7.6 1.1 9.8 4.7.2-6.7-3.2-10.4-9.8-10.5z" /></Svg>
)
export const BuildIcon = (p: IconProps) => (
  <Svg {...p}><path fill="currentColor" d="M15.6 2.4a5.7 5.7 0 0 0-5.2 7.6L2.6 17.8a2.1 2.1 0 0 0 3 3l7.8-7.8a5.7 5.7 0 0 0 7.6-5.2l-3.3 3.3-3-.6-.6-3 3.3-3.3a5.7 5.7 0 0 0-1.8-.4z" /></Svg>
)
export const OperateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" d="M5 3.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2l1.8 3.5h-2.4l-1.2-2.5H8.8l-1.2 2.5H5.2L7 16.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 0-2zM6.8 6v4.4h10.4V6zM8.5 13.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm7 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" />
  </Svg>
)

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}><path fill="none" stroke="currentColor" strokeWidth="5" d="M4 8l8 8 8-8" /></Svg>
)

// Tile glyphs: one set, a thick band of track at one weight with pale sleepers, so each piece reads by its silhouette.
const BAND = 9
const band = (colour: string, line: string) => (
  <g key={line} fill="none">
    <path d={line} stroke={colour} strokeWidth={BAND} strokeLinecap="butt" />
    <path d={line} stroke="#fff" strokeWidth={BAND - 3.6} strokeLinecap="butt" strokeDasharray="2 3.4" />
  </g>
)
const track = (colour: string, ...lines: string[]) => (p: IconProps) => <Svg {...p}>{lines.map(line => band(colour, line))}</Svg>
const ramp = (colour: string, line: string, arrow: string) => (p: IconProps) => (
  <Svg {...p}>
    {band(colour, line)}
    <path fill="#2b3145" d={arrow} />
  </Svg>
)
export const Straight12Icon = track('#0fa6ee', 'M12 0v24')
export const Straight6Icon = track('#3fb56b', 'M12 5v14')
export const CurveLeftIcon = track('#ff9f0f', 'M19 24C19 13 14 6 1 6')
export const CurveRightIcon = track('#e8478b', 'M5 24C5 13 10 6 23 6')
export const TurnoutLeftIcon = track('#7a5cf0', 'M17 24V0', 'M17 18C17 11 12 7 1 6')
export const TurnoutRightIcon = track('#0158b4', 'M7 24V0', 'M7 18C7 11 12 7 23 6')
export const RiseIcon = ramp('#3fb56b', 'M0 22 24 11', 'M6 0l6.5 6.5H8.2v5H3.8v-5H-.5z')
export const FallIcon = ramp('#e8478b', 'M0 11 24 22', 'M18 11.5l-6.5-6.5h4.3V0h4.4v5h4.3z')
export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    {band('#2b3145', 'M21 22C21 13.5 16 10 9 10')}
    <path fill="#2b3145" d="M10.5 .5v19L0 10z" />
  </Svg>
)
