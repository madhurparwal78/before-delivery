// The timecode rule (brief: Business rules > Timecode). Shared so the strip readout and the server agree.

const FRAME_RATES = [24, 25, 30] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

export function isFrameRate(value: number): value is FrameRate {
  return (FRAME_RATES as readonly number[]).includes(value);
}

export function totalFrames(durationMs: number, frameRate: FrameRate): number {
  return Math.max(1, Math.floor((durationMs * frameRate) / 1000));
}

const two = (n: number): string => String(n).padStart(2, "0");

/** Non-drop-frame HH:MM:SS:FF. */
export function timecode(frameIndex: number, frameRate: FrameRate): string {
  const seconds = Math.floor(frameIndex / frameRate);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${two(hours)}:${two(minutes)}:${two(seconds % 60)}:${two(frameIndex % frameRate)}`;
}
