import type { GuideState } from './types';

type GuideAction = 'publish' | 'withdraw';

type Transition =
  | { ok: true; to: GuideState }
  | { ok: false; from: GuideState; to: GuideState };

/** The one transition table for guide states. `sameVersion` says the named version is already the published one. */
export function transition(from: GuideState, action: GuideAction, sameVersion: boolean): Transition {
  if (action === 'publish') {
    return from === 'published' && sameVersion ? { ok: false, from, to: 'published' } : { ok: true, to: 'published' };
  }
  return from === 'published' ? { ok: true, to: 'withdrawn' } : { ok: false, from, to: 'withdrawn' };
}
