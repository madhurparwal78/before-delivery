/** The group plate a ride was opened from, kept for the shutter reveal on the ride page. */
export interface ShutterSource {
  rect: { left: number; top: number; width: number; height: number };
  canvas: HTMLCanvasElement | null;
}

let pending: ShutterSource | null = null;

export function setShutterSource(source: ShutterSource | null): void {
  pending = source;
}

export function takeShutterSource(): ShutterSource | null {
  const source = pending;
  pending = null;
  return source;
}
