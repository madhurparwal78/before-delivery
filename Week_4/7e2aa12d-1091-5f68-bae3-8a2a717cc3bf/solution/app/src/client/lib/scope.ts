import { useCallback, useState } from 'react';
import { breakpointTabName, scopeShowing } from '../../shared/messages.js';
import type { Scope } from '../../shared/types.js';

export const PREVIEW_MIN = 320;
export const PREVIEW_MAX = 1440;
const PREVIEW_START = 1280;
export const BASE_TAB_WIDTH = 375;
export const PREVIEW_STEP = 10;

/** The tab in effect: the widest breakpoint whose minimum width is at or below the width, else Base. */
function scopeAt(breakpoints: { min_width: number }[], width: number): Scope {
  return breakpoints.reduce<Scope>((found, breakpoint) => (breakpoint.min_width <= width ? breakpoint.min_width : found), 'base');
}

/** 320, every breakpoint's minimum width, and 1440: where Page Up and Page Down stop. */
export const edgesOf = (breakpoints: { min_width: number }[]): number[] => [PREVIEW_MIN, ...breakpoints.map((breakpoint) => breakpoint.min_width), PREVIEW_MAX];

const clampWidth = (width: number): number => Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, Math.round(width)));

/** The preview width, and the scope it puts in effect; moving it announces a change of scope. */
export function usePreviewWidth(breakpoints: { min_width: number }[], announce: (text: string) => void) {
  const [width, setWidth] = useState(PREVIEW_START);
  const scope = scopeAt(breakpoints, width);
  const moveTo = useCallback(
    (target: number): void => {
      const next = clampWidth(target);
      const arrived = scopeAt(breakpoints, next);
      if (arrived !== scopeAt(breakpoints, width)) announce(scopeShowing(breakpointTabName(arrived), next));
      setWidth(next);
    },
    [breakpoints, width, announce],
  );
  return { width, scope, moveTo };
}
