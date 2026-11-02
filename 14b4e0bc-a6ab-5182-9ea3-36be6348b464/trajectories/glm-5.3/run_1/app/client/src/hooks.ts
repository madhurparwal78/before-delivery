import { useEffect, useState } from 'react';

/** The viewer's motion preference, followed live (DP-48). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export interface Viewport {
  width: number;
  narrow: boolean; // below 768
  medium: boolean; // 768..1199
  wide: boolean; // 1200+
}

/** The published breakpoints, followed as the window changes. */
export function useViewport(): Viewport {
  const read = (): Viewport => {
    const width = window.innerWidth;
    return { width, narrow: width < 768, medium: width >= 768 && width < 1200, wide: width >= 1200 };
  };
  const [vp, setVp] = useState<Viewport>(read);
  useEffect(() => {
    let frame = 0;
    const onResize = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
  }, []);
  return vp;
}

export interface FocusRequest {
  selector: string;
  fallbackSelector?: string;
}

/** Announces a message once in a named live region by identity of the message. */
export function useAnnouncer() {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  let seq = 0;
  return {
    message,
    announce: (text: string): void => {
      seq += 1;
      setMessage({ text, id: seq });
    },
  };
}

export const COPY = {
  signingIn: 'Signing in...',
  searching: 'Searching...',
  matchingAssets: (n: number) => `Matching assets: ${n}`,
  saving: 'Saving...',
  uploadingEvidence: 'Uploading evidence...',
  tracing: 'Tracing...',
  searchUnavailable: 'Search is unavailable. Try again.',
  traceUnavailable: 'Trace is unavailable. Try again.',
  emptySearch: 'No assets match these filters. Clear a filter or search a broader term.',
  noAsset: 'Pick an asset to see its lineage.',
  lineageChanged: 'Lineage changed since this trace. Trace again to include it.',
  nodeChosen: (id: string, hop: string) => `${id}, hop ${hop}`,
  sessionEnded: 'Your session ended. Sign in again.',
  roleChanged: (role: string) => `Your role changed to ${role}.`,
  heldRows: (n: number) => `${n} new audit rows.`,
  showHeldRows: (n: number) => `Show ${n} new audit rows`,
  termRenamed: (oldName: string, newName: string) => `Term renamed: ${oldName} is now ${newName}.`,
  deprecatedUpstream: (id: string) => `Upstream ${id} is deprecated. Values here may stop updating.`,
  evidenceOutage: 'Evidence storage is unreachable. Verification is paused; everything else works.',
  mailOutage: 'The mail relay is unreachable. Deprecation notices are queued and will send when it returns.',
  queuedNotices: (n: number) => `Queued notices: ${n}`,
  tagSourceDirect: (tag: string) => `${tag} set directly`,
  tagSourceInherited: (tag: string, id: string) => `${tag} inherited from ${id}`,
  hopListSource: (tag: string, ids: string[]) => `${tag} from ${ids.join(', ')}`,
} as const;
