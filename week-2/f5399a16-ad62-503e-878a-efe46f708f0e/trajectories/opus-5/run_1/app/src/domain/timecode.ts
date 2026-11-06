import { divide, multiply, rational, roundHalfUp, roundUp, toFixedHalfUp } from './rational.js';
import type { Rational } from './rational.js';

export const FRAME_RATES = ['25', '23.976', '29.97'] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

/** The exact rate, never the label: 23.976 is 24000/1001. */
export function exactRate(rate: FrameRate): Rational {
  switch (rate) {
    case '25':
      return rational(25);
    case '23.976':
      return rational(24000, 1001);
    case '29.97':
      return rational(30000, 1001);
  }
}

/** Frames in one nominal second: the timecode base. */
export function nominalFrames(rate: FrameRate): number {
  switch (rate) {
    case '25':
      return 25;
    case '23.976':
      return 24;
    case '29.97':
      return 30;
  }
}

export function isDropFrame(rate: FrameRate): boolean {
  return rate === '29.97';
}

/**
 * Timecode of a frame number. Colons with base 25 or 24; at 29.97 drop frame,
 * with a semicolon before the frames, dropping frame numbers 00 and 01 at the
 * start of every minute except each tenth minute.
 */
export function timecode(frame: number, rate: FrameRate): string {
  const base = nominalFrames(rate);
  let counted = frame;
  if (isDropFrame(rate)) {
    const tenMinuteBlocks = Math.floor(frame / 17982);
    const withinBlock = frame % 17982;
    counted =
      frame +
      18 * tenMinuteBlocks +
      (withinBlock > 2 ? 2 * Math.floor((withinBlock - 2) / 1798) : 0);
  }
  const frames = counted % base;
  const seconds = Math.floor(counted / base) % 60;
  const minutes = Math.floor(counted / (base * 60)) % 60;
  const hours = Math.floor(counted / (base * 3600)) % 24;
  const separator = isDropFrame(rate) ? ';' : ':';
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(frames)}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Record times count from frame 107892 at 29.97 and from 01:00:00:00 at the other rates. */
export function recordStartFrame(rate: FrameRate): number {
  return isDropFrame(rate) ? 107892 : nominalFrames(rate) * 3600;
}

/** Real seconds of a frame count, kept exact. */
export function realSeconds(frames: number, rate: FrameRate): Rational {
  return divide(rational(frames), exactRate(rate));
}

/** `5.01 s` form: real seconds half up to 0.01. */
export function secondsText(frames: number, rate: FrameRate): string {
  return `${toFixedHalfUp(realSeconds(frames, rate), 2)} s`;
}

/** Nominal seconds times 25, 24 or 30. */
export function targetFrames(targetSeconds: number, rate: FrameRate): number {
  return targetSeconds * nominalFrames(rate);
}

export function targetText(totalFrames: number, target: number): string {
  const difference = totalFrames - target;
  if (difference === 0) return 'exact';
  const count = Math.abs(difference);
  const word = count === 1 ? 'frame' : 'frames';
  return `${count} ${word} ${difference > 0 ? 'over' : 'under'}`;
}

/** Each clip's real length kept as near as whole frames allow, never under 1. */
export function convertFrames(frames: number, from: FrameRate, to: FrameRate): number {
  if (from === to) return frames;
  const converted = roundHalfUp(
    multiply(rational(frames), divide(exactRate(to), exactRate(from))),
  );
  return Number(converted < 1n ? 1n : converted);
}

/** The playhead converts the same way, but may sit on frame 0. */
export function convertPlayhead(frame: number, from: FrameRate, to: FrameRate): number {
  if (from === to || frame === 0) return frame;
  return Number(roundHalfUp(multiply(rational(frame), divide(exactRate(to), exactRate(from)))));
}

/** Seconds given as an exact decimal turned into frames, half up at the job's rate. */
export function framesFromSeconds(seconds: Rational, rate: FrameRate): number {
  return Number(roundHalfUp(multiply(seconds, exactRate(rate))));
}

/** Reading time: words / 3 seconds, rounded up to a whole frame. */
export function readingFrames(words: number, rate: FrameRate): number {
  return Number(roundUp(multiply(divide(rational(words), rational(3)), exactRate(rate))));
}
