// A backlink numeral: rolls to a new count (old digits up and out, new ones in from below) with a
// brief vermilion flash, or shows it at once under reduced motion.
import { useLayoutEffect, useRef } from 'react';
import { NUMERAL_FLASH_MS, NUMERAL_MS } from '../../shared/motion.ts';
import { QUIRE_CURVE_CSS, reducedMotion } from '../motion.ts';

export function Numeral({ value, roll = false, delay = 0 }: { value: number; roll?: boolean; delay?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useLayoutEffect(() => {
    const el = box.current;
    const from = shown.current;
    shown.current = value;
    if (!el || from === value) return;
    for (const a of el.getAnimations({ subtree: true })) a.cancel();
    el.querySelector('.numeral-old')?.remove();
    if (!roll || reducedMotion()) return;
    const up = value > from ? 1 : -1;
    const old = document.createElement('span');
    old.className = 'numeral-old';
    old.setAttribute('aria-hidden', 'true');
    old.textContent = String(from);
    el.append(old);
    const digits = el.querySelector<HTMLElement>('.numeral-digits');
    const enter = digits?.animate([{ transform: `translateY(${100 * up}%)` }, { transform: 'translateY(0)' }], { duration: NUMERAL_MS, delay, easing: QUIRE_CURVE_CSS, fill: 'backwards' });
    if (enter) enter.id = 'numeral';
    const leave = old.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-100 * up}%)` }], { duration: NUMERAL_MS, delay, easing: QUIRE_CURVE_CSS, fill: 'forwards' });
    void leave.finished.then(() => old.remove(), () => old.remove());
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--quire-accent').trim();
    el.animate([{ color: accent }, { color: getComputedStyle(el).color }], { duration: NUMERAL_FLASH_MS, easing: 'linear', delay: delay + NUMERAL_MS });
  }, [value, roll, delay]);
  return (
    <span className="numeral mono" data-backlink-count={value} ref={box}>
      <span className="numeral-digits">{value}</span>
    </span>
  );
}
