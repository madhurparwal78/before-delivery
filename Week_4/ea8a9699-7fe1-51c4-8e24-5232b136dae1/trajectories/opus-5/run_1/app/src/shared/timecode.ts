/** The one place that turns frame counts into the non-drop-frame HH:MM:SS:FF timecode. */
export function formatTimecode(frameIndex: number, frameRate: number): string {
  const frames = frameIndex % frameRate;
  const totalSeconds = Math.floor(frameIndex / frameRate);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':');
}

export function totalFramesFor(durationMs: number, frameRate: number): number {
  return Math.max(1, Math.floor((durationMs * frameRate) / 1000));
}
