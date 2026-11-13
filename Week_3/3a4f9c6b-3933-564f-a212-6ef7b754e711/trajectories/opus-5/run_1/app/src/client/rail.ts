import type { GraphEdge, RailPhase } from '../shared/types.js';
import { el, prefersReducedMotion } from './dom.js';

const SEGMENTS: { phase: RailPhase; label: string }[] = [
  { phase: 'queued', label: 'Queued' },
  { phase: 'window_check', label: 'Window check' },
  { phase: 'applying', label: 'Applying' },
  { phase: 'health_wait', label: 'Health wait' },
  { phase: 'healthy', label: 'Healthy' },
];

const CARRYING: RailPhase[] = ['queued', 'window_check', 'applying', 'health_wait', 'degraded'];

/** How far through the five fixed segments a phase has reached. */
function reachedIndex(phase: RailPhase, progress: number): number {
  switch (phase) {
    case 'queued':
      return 0;
    case 'window_check':
      return 1;
    case 'applying':
      return 2;
    case 'health_wait':
      return 3;
    case 'healthy':
      return 4;
    case 'degraded':
      return progress >= 0.6 ? 3 : 2;
    case 'idle':
    case 'stopped':
      return -1;
  }
}

export interface EdgeView {
  root: HTMLElement;
  update(edge: GraphEdge, capsuleDigest: string | null): void;
}

/**
 * One edge of the rail. Its phase and progress come straight from the server; the drawn stroke
 * only ever grows, and the capsule rides its tip.
 */
export function createEdge(from: string, to: string): EdgeView {
  const drawn = el('span', { class: 'edge-drawn' });
  const segments = SEGMENTS.map((segment) =>
    el('span', { class: 'segment', 'data-segment': segment.phase, 'data-reached': 'false' }, [
      segment.label,
    ]),
  );
  const segmentBar = el('span', { class: 'segments' }, segments);
  const track = el('span', {
    class: 'edge-track',
    role: 'img',
    'aria-label': `Promotion rail ${from} to ${to}`,
    'data-phase': 'idle',
    'data-progress': '0',
  });
  const capsule = el('span', { class: 'capsule', role: 'img', 'aria-label': 'Bundle' });
  const root = el('span', { class: 'edge', 'data-phase': 'idle' }, [track]);

  let reduced = prefersReducedMotion();
  let shown = 0;
  let promotionId: string | null = null;
  let failureDrawn = false;

  function layout(): void {
    track.replaceChildren(reduced ? segmentBar : drawn);
    if (reduced) capsule.remove();
  }
  layout();

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    reduced = event.matches;
    failureDrawn = false;
    root.querySelector('.edge-failed')?.remove();
    resetSegments();
    layout();
  });

  function paintFailure(): void {
    if (failureDrawn || reduced) return;
    failureDrawn = true;
    // The overlay lives inside the track, so its fraction is of the track's own length.
    track.append(el('span', { class: 'edge-failed', style: `--p:${shown}` }));
  }

  function resetSegments(): void {
    for (const segment of segments) segment.setAttribute('data-reached', 'false');
  }

  return {
    root,
    update(edge, capsuleDigest) {
      track.setAttribute('data-phase', edge.phase);
      track.setAttribute('data-progress', String(edge.progress));
      root.setAttribute('data-phase', edge.phase);

      if (edge.promotion_id !== promotionId) {
        promotionId = edge.promotion_id;
        shown = 0;
        failureDrawn = false;
        root.querySelector('.edge-failed')?.remove();
        resetSegments();
        drawn.style.setProperty('--p', '0');
        capsule.style.setProperty('--p', '0');
      }

      const atRest = edge.phase === 'idle' || edge.phase === 'stopped';
      if (atRest) {
        shown = 0;
        drawn.style.setProperty('--p', '0');
        capsule.remove();
        root.querySelector('.edge-failed')?.remove();
        resetSegments();
        failureDrawn = false;
        return;
      }

      // Progress never moves backward, not even on failure.
      shown = Math.max(shown, edge.progress);
      drawn.style.setProperty('--p', String(shown));

      if (reduced) {
        const reached = reachedIndex(edge.phase, edge.progress);
        segments.forEach((segment, index) => {
          if (index <= reached) segment.setAttribute('data-reached', 'true');
        });
        return;
      }

      if (capsuleDigest !== null && CARRYING.includes(edge.phase)) {
        capsule.textContent = capsuleDigest;
        capsule.setAttribute('aria-label', `Bundle ${capsuleDigest}`);
        capsule.style.setProperty('--p', String(shown));
        if (!capsule.isConnected) root.append(capsule);
      } else {
        capsule.remove();
      }

      if (edge.phase === 'degraded') paintFailure();
    },
  };
}

/** Counts a mono counter up to its new value; with reduced motion it simply swaps. */
export function countUp(node: HTMLElement, from: number, to: number, total: number): void {
  const render = (value: number): void => {
    node.textContent = `in sync ${value}/${total}`;
  };
  if (prefersReducedMotion() || from === to) {
    render(to);
    return;
  }
  const started = performance.now();
  const duration = 420;
  const step = (now: number): void => {
    const ratio = Math.min(1, (now - started) / duration);
    render(Math.round(from + (to - from) * ratio));
    if (ratio < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
