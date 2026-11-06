// The motion vocabulary. Every movement is a WAAPI animation from these tokens, and none is made
// when the person has asked for reduced motion.

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const DURATION = { hover: 120, paneIn: 240, paneOut: 160, dialog: 160, chip: 160, crossfade: 250, lineFade: 160 };
export const SETTLE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const LEAVE = "cubic-bezier(0.4, 0, 1, 1)";

export const play = (el: Element | null, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null =>
  el && !reducedMotion() ? el.animate(frames, options) : null;

export const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
