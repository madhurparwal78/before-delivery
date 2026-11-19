import type { CloseReason, Quota, SegmentView, SessionState } from '../shared/types.js';

export type SessionEvent =
  | { readonly type: 'state'; readonly state: SessionState; readonly close_reason: CloseReason | null }
  | {
      readonly type: 'frame';
      readonly frame: number;
      readonly audio_ms: number;
      readonly peak_bin: number;
      readonly bins: readonly number[];
    }
  | { readonly type: 'segment'; readonly segment: SegmentView }
  | { readonly type: 'correction'; readonly segment: SegmentView; readonly wer: number | null }
  | { readonly type: 'quota'; readonly quota: Quota };

type Listener = (event: SessionEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export const subscribe = (sessionId: string, listener: Listener): (() => void) => {
  const set = listeners.get(sessionId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
  };
};

export const publish = (sessionId: string, event: SessionEvent): void => {
  const set = listeners.get(sessionId);
  if (set === undefined) return;
  for (const listener of [...set]) listener(event);
};
