// Every animation in the app runs on animation frames and page timers, so a paused page clock steps it.

const ease = (t: number): number => 1 - Math.pow(1 - t, 4);

export interface Tween {
  cancel(): void;
}

/** Run `frame` with an eased 0..1 and the elapsed ms for `duration` ms, then `done` exactly once, on a timer as well as on frames. */
export function tween(duration: number, frame: (eased: number, elapsed: number) => void, done: () => void): Tween {
  const start = performance.now();
  let finished = false;
  let raf = 0;
  const finish = (): void => {
    if (!finished) {
      finished = true;
      cancelAnimationFrame(raf);
      frame(1, duration);
      done();
    }
  };
  const step = (): void => {
    if (finished) {
      return;
    }
    const t = Math.min(1, (performance.now() - start) / duration);
    if (t >= 1) {
      finish();
      return;
    }
    frame(ease(t), t * duration);
    raf = requestAnimationFrame(step);
  };
  const timer = window.setTimeout(finish, duration);
  raf = requestAnimationFrame(step);
  return {
    cancel: () => {
      finished = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    },
  };
}
