const drivers = new WeakMap<Animation, number>();

function duration(animation: Animation): number {
  return Number(animation.effect?.getComputedTiming().endTime ?? 0);
}

export function drive(animation: Animation, onEnd: (direction: 1 | -1) => void): void {
  const earlier = drivers.get(animation);
  if (earlier !== undefined) cancelAnimationFrame(earlier);
  animation.pause();
  let last = performance.now();
  const tick = (now: number) => {
    const direction = animation.playbackRate < 0 ? -1 : 1;
    const total = duration(animation);
    const next = Number(animation.currentTime ?? 0) + (now - last) * direction;
    last = now;
    animation.currentTime = Math.min(Math.max(next, 0), total);
    if ((direction === 1 && next >= total) || (direction === -1 && next <= 0)) {
      drivers.delete(animation);
      onEnd(direction);
      return;
    }
    drivers.set(animation, requestAnimationFrame(tick));
  };
  drivers.set(animation, requestAnimationFrame(tick));
}

export function stop(animation: Animation): void {
  const frame = drivers.get(animation);
  if (frame !== undefined) cancelAnimationFrame(frame);
  drivers.delete(animation);
  animation.cancel();
}
