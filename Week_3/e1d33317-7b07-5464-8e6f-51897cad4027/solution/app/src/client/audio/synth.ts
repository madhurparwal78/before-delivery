// The built-in oscillator synth: a triangle body with a quiet sine octave above, shaped by an ADSR.

import type { NoteRequest, NoteVoice } from './types.js'

interface Adsr {
  attack: number
  decay: number
  sustain: number
  release: number
}

const SYNTH_ADSR: Adsr = { attack: 0.012, decay: 0.09, sustain: 0.7, release: 0.14 }
const SYNTH_PEAK = 0.2
const OCTAVE_PARTIAL_LEVEL = 0.22
const FADE_SECONDS = 0.03

/** Shapes `gain` for a note sounding for `length` seconds from `at`; returns when the sound has died away. */
export function shapeEnvelope(gain: AudioParam, at: number, length: number, peak: number, adsr: Adsr): number {
  const end = at + Math.max(length, adsr.attack + 0.02)
  gain.setValueAtTime(0, at)
  gain.linearRampToValueAtTime(peak, at + adsr.attack)
  if (adsr.sustain < 1) gain.setTargetAtTime(peak * adsr.sustain, at + adsr.attack, adsr.decay / 3)
  gain.setTargetAtTime(0, end, adsr.release / 3)
  return end + adsr.release * 1.5
}

export function fadeOut(gain: AudioParam, now: number): void {
  gain.cancelScheduledValues(now)
  gain.setTargetAtTime(0, now, FADE_SECONDS / 3)
}

export const SAMPLE_ADSR: Adsr = { attack: 0.008, decay: 0, sustain: 1, release: 0.08 }

export function playSynthNote(ctx: BaseAudioContext, destination: AudioNode, note: NoteRequest, onEnded: () => void): NoteVoice {
  const frequency = 440 * 2 ** ((note.midi - 69) / 12)
  const envelope = ctx.createGain()
  envelope.gain.value = 0
  const body = ctx.createOscillator()
  body.type = 'triangle'
  body.frequency.value = frequency
  const partial = ctx.createOscillator()
  partial.type = 'sine'
  partial.frequency.value = frequency * 2
  const partialLevel = ctx.createGain()
  partialLevel.gain.value = OCTAVE_PARTIAL_LEVEL
  body.connect(envelope)
  partial.connect(partialLevel)
  partialLevel.connect(envelope)
  envelope.connect(destination)

  const stopAt = shapeEnvelope(envelope.gain, note.when, note.length, SYNTH_PEAK * note.level, SYNTH_ADSR)
  body.start(note.when)
  partial.start(note.when)
  body.stop(stopAt)
  partial.stop(stopAt)
  body.onended = () => {
    body.disconnect()
    partial.disconnect()
    partialLevel.disconnect()
    envelope.disconnect()
    onEnded()
  }
  return {
    stop(now: number): void {
      fadeOut(envelope.gain, now)
      body.stop(now + FADE_SECONDS * 2)
      partial.stop(now + FADE_SECONDS * 2)
    },
  }
}
