// Contracts between the playback engine and the editor that hosts it.

import type { TimeSignature } from '../../shared/music.js'
import type { Bank } from '../../shared/protocol.js'
import type { PlacedEvent } from '../../shared/voice.js'

export interface PlaybackScore {
  measureCount: number
  timeSignatures: TimeSignature[]
  /** `bpm` is quarter notes per minute. */
  tempos: { measure: number; bpm: number }[]
  staves: { id: string; name: string }[]
}

export interface PlaybackSource {
  score(): PlaybackScore
  /** `[voice 1 events, voice 2 events]`, visible events in order, concert pitch. */
  events(staffId: string): PlacedEvent[][]
  /** Newest first; each staff plays its most recent bank. */
  banks(): Bank[]
  /** Rejects when the bank cannot be fetched. */
  fetchBank(bank: Bank): Promise<ArrayBuffer>
  /** A section player's own staves play at full volume and every other staff at half; null means everyone full. */
  ownStaffIds: string[] | null
}

export interface PlaybackEvents {
  /** Called from the audio clock while playing. `beat` is 1-based, in the time signature's beat unit. */
  onPosition(position: { measure: number; beat: number }): void
  onNotice(notice: string | null): void
  onState(playing: boolean): void
}

/** One note to sound, on the audio context's own time line. */
export interface NoteRequest {
  midi: number
  when: number
  length: number
  level: number
}

export interface NoteVoice {
  /** Fades the note out from audio time `now`. */
  stop(now: number): void
}
