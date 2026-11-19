/** Island sound is generated, never a file. Before the first press of `Sound` no audio context, source or gain exists.
 *  First press: one context, one looping generated buffer through a music gain and a master gain (1) to the output;
 *  effects go through an effects gain into the same master. Later presses only move the master between 0 and 1. */
import { h } from './dom'

interface Graph { context: AudioContext; master: GainNode; music: GainNode; effects: GainNode }

let graph: Graph | null = null
let on = false
const volumes = { music: 60, effects: 80 }
const buttons = new Set<HTMLButtonElement>()

/** Brown-ish noise with a slow swell, long enough that the loop does not sound like one. */
function ambience(context: AudioContext, island: number): AudioBuffer {
  const seconds = 8
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate)
  const data = buffer.getChannelData(0)
  const cutoff = 0.02 + island * 0.006
  let low = 0
  let seed = 7 + island
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    low += ((seed / 0xffffffff) * 2 - 1 - low) * cutoff
    const swell = 0.55 + 0.45 * Math.sin((i / data.length) * Math.PI * 2 * 2)
    const fade = Math.min(1, i / 2000, (data.length - i) / 2000)
    data[i] = low * swell * fade * 5
  }
  return buffer
}

function start(island: number): Graph {
  const context = new AudioContext()
  const master = context.createGain()
  const music = context.createGain()
  const effects = context.createGain()
  master.gain.value = 1
  music.gain.value = volumes.music / 100
  effects.gain.value = volumes.effects / 100
  music.connect(master)
  effects.connect(master)
  master.connect(context.destination)
  const source = context.createBufferSource()
  source.buffer = ambience(context, island)
  source.loop = true
  source.connect(music)
  source.start()
  return { context, master, music, effects }
}

function paint(): void {
  for (const button of buttons) button.setAttribute('aria-pressed', String(on))
}

export function setVolumes(music: number, effects: number): void {
  volumes.music = music
  volumes.effects = effects
  if (graph) {
    graph.music.gain.value = music / 100
    graph.effects.gain.value = effects / 100
  }
}

/** A short effect, heard only while sound is on. */
export function playEffect(kind: 'shutter' | 'stamp' | 'step'): void {
  if (!graph || !on) return
  const { context, effects } = graph
  const oscillator = context.createOscillator()
  const envelope = context.createGain()
  const now = context.currentTime
  const [from, to, length] = kind === 'shutter' ? [1800, 300, 0.09] : kind === 'stamp' ? [520, 780, 0.25] : [220, 160, 0.05]
  oscillator.frequency.setValueAtTime(from, now)
  oscillator.frequency.exponentialRampToValueAtTime(to, now + length)
  envelope.gain.setValueAtTime(0.4, now)
  envelope.gain.exponentialRampToValueAtTime(0.001, now + length)
  oscillator.connect(envelope)
  envelope.connect(effects)
  oscillator.start(now)
  oscillator.stop(now + length)
}

export function soundButton(island = 1): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(on) }, 'Sound')
  button.addEventListener('click', () => {
    if (!graph) {
      graph = start(island)
      on = true
    } else {
      on = !on
      graph.master.gain.value = on ? 1 : 0
      if (on) void graph.context.resume()
    }
    paint()
  })
  buttons.add(button)
  return button
}

export function releaseSoundButton(button: HTMLButtonElement): void {
  buttons.delete(button)
}
