// The Margin Tether's motion: the card morph, the tether draw and pull-back, and the block collapse.
import { MORPH_MS, REFUSAL_SHRINK_MS, TETHER_MS, tetherReverseMs } from '../../shared/motion.ts';
import { QUIRE_CURVE_CSS, reducedMotion } from '../motion.ts';

export interface Morph { finished: Promise<void>; land: () => void; shrink: () => Promise<void>; remaining: () => number }

/** A picture of the picked row that travels to the slot where the quote block will sit. */
export function morphCard(from: DOMRect, to: DOMRect, text: string): Morph {
  const card = document.createElement('div');
  card.className = 'morph-card';
  card.setAttribute('aria-hidden', 'true');
  card.textContent = text;
  Object.assign(card.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  document.body.append(card);
  const sx = from.width / Math.max(1, to.width);
  const sy = from.height / Math.max(1, to.height);
  const anim = card.animate(
    [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
    { duration: MORPH_MS, easing: QUIRE_CURVE_CSS, fill: 'forwards' },
  );
  anim.id = 'morph';
  const finished = anim.finished.then(() => undefined, () => undefined);
  return {
    finished,
    remaining: () => Math.max(0, MORPH_MS - Number(anim.currentTime ?? MORPH_MS)),
    land: () => void finished.then(() => card.remove()),
    shrink: async () => {
      anim.cancel();
      const out = card.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], { duration: REFUSAL_SHRINK_MS, easing: QUIRE_CURVE_CSS, fill: 'forwards' });
      await out.finished.catch(() => undefined);
      card.remove();
    },
  };
}

const offsetOf = (line: SVGElement): number => parseFloat(getComputedStyle(line).strokeDashoffset) || 0;

/** Draws a tether from hidden (dash offset 1) to fully drawn (0), after `delay` ms (the morph still landing). */
export function drawTether(line: SVGElement, delay: number): void {
  line.style.strokeDashoffset = '0';
  if (reducedMotion()) return;
  const anim = line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: TETHER_MS, delay, easing: QUIRE_CURVE_CSS, fill: 'backwards' });
  anim.id = 'tether';
}

/** Whether the tether is still drawing (or waiting to draw). */
export const tetherDrawing = (line: SVGElement | null): boolean =>
  !!line && line.getAnimations().some((a) => a.playState === 'running' || a.playState === 'paused');

/** Pulls a tether back into the block's edge from wherever it is, never snapping to fully drawn first. */
export function retractTether(line: SVGElement): Promise<void> {
  const o = Math.min(1, offsetOf(line));
  for (const a of line.getAnimations()) a.cancel();
  line.style.strokeDashoffset = '1';
  if (reducedMotion()) return Promise.resolve();
  // 180 × (1 − o) ms: a tether that had not started drawing (o = 1) pulls back in no time at all.
  const anim = line.animate([{ strokeDashoffset: o }, { strokeDashoffset: 1 }], { duration: tetherReverseMs(o), easing: QUIRE_CURVE_CSS });
  anim.id = 'tether';
  return anim.finished.then(() => undefined, () => undefined);
}

/** The quote block collapses to nothing (the reverse of the morph). */
export function collapseBlock(el: HTMLElement): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const h = el.getBoundingClientRect().height;
  el.style.overflow = 'hidden';
  const anim = el.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }],
    { duration: MORPH_MS, easing: QUIRE_CURVE_CSS, fill: 'forwards' });
  anim.id = 'collapse';
  return anim.finished.then(() => undefined, () => undefined);
}
