import type { Clef, TimeSignature, Transpose } from '../../shared/music.js'
import type { PlacedEvent } from '../../shared/voice.js'
import type { PartLayout } from '../../shared/protocol.js'

export interface StaffSource {
  id: string
  name: string
  clef: Clef
  transpose: Transpose
  /** Events are concert pitch; the part view engraves them at written pitch. */
  voices: [PlacedEvent[], PlacedEvent[]]
}

export interface EngraveRequest {
  view: 'score' | 'part'
  title: string
  partName: string | null
  measureCount: number
  timeSignatures: TimeSignature[]
  tempos: { measure: number; bpm: number }[]
  staves: StaffSource[]
  layout: PartLayout
}

export interface SystemPlan {
  index: number
  page: number
  firstMeasure: number
  lastMeasure: number
}
