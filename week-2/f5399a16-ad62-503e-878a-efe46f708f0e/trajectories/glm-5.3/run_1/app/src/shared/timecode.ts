import { NOMINAL_RATE, type FrameRate } from "./framerate";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// Non-drop-frame timecode with base 25 or 24, colon separated. The frame
// count is the number of frames since the start.
function ndf(frames: number, base: bigint): string {
  const f = BigInt(frames);
  const frame = f % base;
  const totalSecs = f / base;
  const secs = totalSecs % 60n;
  const totalMins = totalSecs / 60n;
  const mins = totalMins % 60n;
  const hours = totalMins / 60n;
  return `${pad2(Number(hours))}:${pad2(Number(mins))}:${pad2(Number(secs))}:${pad2(Number(frame))}`;
}

// Drop-frame timecode at 29.97: the frame count is the index among frames
// kept for display, frame numbers 00 and 01 being dropped at the start of
// every minute except each tenth minute. A display index is turned into the
// displayed time by adding the frames dropped before it.
function dropFrameTimecode(frames: number): string {
  const group = Math.floor(frames / 17982);
  const within = frames - group * 17982;
  const extra = within >= 2 ? 2 * Math.floor((within - 2) / 1798) : 0;
  const adjusted = frames + group * 18 + extra;
  const frame = adjusted % 30;
  const totalSecs = Math.floor(adjusted / 30);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)};${pad2(frame)}`;
}

// The display index of a drop-frame timecode: minutes that keep their first
// two frame numbers hold 1800 display frames, the others 1798, and the frame
// numbers 00 and 01 appear only in those minutes that keep them.
function dropFrameIndex(mi: number, s: number, fr: number): number {
  let start = 0;
  for (let k = 0; k < mi; k++) start += k % 10 === 0 ? 1800 : 1798;
  const frameInMinute = mi % 10 === 0 ? fr : fr - 2;
  return start + s * 30 + frameInMinute;
}

// The one place a frame count becomes timecode text.
export function timecode(frames: number, rate: FrameRate): string {
  switch (rate) {
    case "25":
      return ndf(frames, NOMINAL_RATE["25"]);
    case "23.976":
      return ndf(frames, NOMINAL_RATE["23.976"]);
    case "29.97":
      return dropFrameTimecode(frames);
  }
}

// The frame count a timecode names, for the edit decision list's record
// times. Returns null when the text is not a timecode of that rate.
export function framesOfTimecode(text: string, rate: FrameRate): number | null {
  const sep = rate === "29.97" ? ";" : ":";
  const re = new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2})${sep}(\\d{2})$`);
  const m = re.exec(text);
  if (!m) return null;
  const h = Number(m[1]!), mi = Number(m[2]!), s = Number(m[3]!), fr = Number(m[4]!);
  const base = Number(NOMINAL_RATE[rate]);
  if (s >= 60 || mi >= 60 || h >= 24) return null;
  if (rate === "29.97") {
    if (fr >= 30) return null;
    return dropFrameIndex(mi, s, fr);
  }
  if (fr >= base) return null;
  return (h * 3600 + mi * 60 + s) * base + fr;
}
