// The lobby idle bob: each bean rises and falls two pixels on a two-second wave, slightly out of phase with its neighbours.
// One paused element.animate() per bean is scrubbed from page time. A 2 px wave needs no per-frame work, so one shared
// timer moves every bean twenty times a second and the page stays idle in between.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { prefersReducedMotion } from "./ui.js";

const PERIOD_MS = 2000;
const STEP_MS = 50;
const waves = new Map<Animation, number>();
let timer: number | null = null;

function place(wave: Animation, phase: number): void {
  wave.currentTime = (performance.now() + phase) % PERIOD_MS;
}

function drive(): void {
  for (const [wave, phase] of waves) place(wave, phase);
}

export function Bob({ phase, children }: { phase: number; children: ComponentChildren }) {
  const holder = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (holder.current === null || prefersReducedMotion()) return undefined;
    const wave = holder.current.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-2px)" }, { transform: "translateY(0)" }],
      { duration: PERIOD_MS, easing: "ease-in-out" },
    );
    wave.pause();
    waves.set(wave, phase * PERIOD_MS);
    place(wave, phase * PERIOD_MS);
    timer ??= window.setInterval(drive, STEP_MS);
    return () => {
      waves.delete(wave);
      wave.cancel();
      if (waves.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, [phase]);
  return <span ref={holder} class="bob">{children}</span>;
}
