/** One requestAnimationFrame loop for the whole story; `step` gets the frame time and the delta, both in ms. */
export function startFrameLoop(step: (time: number, delta: number) => void) {
  let frame = 0;
  let last: number | null = null;
  const tick = (time: number) => {
    const delta = last === null ? 16 : time - last;
    last = time;
    step(time, delta);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
