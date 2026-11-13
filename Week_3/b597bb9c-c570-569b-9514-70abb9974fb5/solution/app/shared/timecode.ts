import type { FrameRate } from "./rational";

const two = (n: number): string => String(n).padStart(2, "0");

/** HH:MM:SS:FF, non-drop, counted at the nominal rate from frame 0. */
export function timecode(rate: FrameRate, frame: number): string {
  const seconds = Math.floor(frame / rate.nominal);
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}:${two(frame % rate.nominal)}`;
}

export function srtTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const rest = ms % 3_600_000;
  return `${two(hours)}:${two(Math.floor(rest / 60_000))}:${two(Math.floor(rest / 1000) % 60)},${String(rest % 1000).padStart(3, "0")}`;
}
