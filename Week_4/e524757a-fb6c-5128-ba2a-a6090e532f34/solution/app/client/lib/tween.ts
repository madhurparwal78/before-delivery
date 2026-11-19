/** Everything that moves runs on page time: animation frames and `performance.now`, never a CSS transition event. */
import { reducedMotion } from './dom'

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

export interface Running { cancel(): void; finished: Promise<void> }

/** Calls `frame(eased)` on animation frames for `duration` ms of page time; a page timer at exactly `duration` makes the
 *  last call, exactly 1, so the end state never waits for the next frame. */
export function animate(duration: number, frame: (progress: number) => void, ease: (t: number) => number = easeOut): Running {
  const start = performance.now()
  let id = 0
  let done = false
  let finish: () => void = () => undefined
  const finished = new Promise<void>((resolve) => { finish = resolve })
  const end = (): void => {
    if (done) return
    done = true
    cancelAnimationFrame(id)
    clearTimeout(timer)
    frame(1)
    finish()
  }
  const tick = (now: number): void => {
    if (done) return
    const t = (now - start) / duration
    if (t >= 1) { end(); return }
    frame(ease(Math.max(0, t)))
    id = requestAnimationFrame(tick)
  }
  const timer = setTimeout(end, duration)
  id = requestAnimationFrame(tick)
  return { cancel: () => { done = true; cancelAnimationFrame(id); clearTimeout(timer); finish() }, finished }
}

/** Like `animate`, but cuts to the end at once when the visitor asked for reduced motion. */
export function glide(duration: number, frame: (progress: number) => void, ease?: (t: number) => number): Running {
  if (reducedMotion()) {
    frame(1)
    return { cancel: () => undefined, finished: Promise.resolve() }
  }
  return animate(duration, frame, ease)
}

/** A debounce on page timers. */
export function debounce<A extends unknown[]>(wait: number, run: (...args: A) => void): { call(...args: A): void; cancel(): void } {
  let handle: ReturnType<typeof setTimeout> | undefined
  return {
    call: (...args) => { clearTimeout(handle); handle = setTimeout(() => run(...args), wait) },
    cancel: () => clearTimeout(handle),
  }
}
