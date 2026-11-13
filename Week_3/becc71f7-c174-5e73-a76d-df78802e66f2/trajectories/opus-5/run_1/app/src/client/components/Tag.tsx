import { useEffect, useRef } from 'preact/hooks';
import { formatMoney } from '../../shared/money.js';
import { OVERLAY_MS, OVERSHOOT, SETTLE, SWING_MS, useReducedMotion } from '../lib/motion.js';

interface TagProps {
  priceCents: number;
  previousPriceCents: number | null;
  /** The piece page's tag is larger than a card's. */
  size?: 'card' | 'page';
}

/**
 * The signature Markdown tag: a card price tag hanging on a thin string from a punched
 * hole. When the price changes while the tag is on screen the tag swings once and a brick
 * red line is drawn across the old price while the new one slides up, both starting in the
 * same frame. Nothing moves when a page first loads, and nothing moves under reduced
 * motion: the old price is already struck through and the new price already in place.
 */
export function Tag({ priceCents, previousPriceCents, size = 'card' }: TagProps) {
  const card = useRef<HTMLSpanElement>(null);
  const strike = useRef<HTMLSpanElement>(null);
  const price = useRef<HTMLSpanElement>(null);
  const shown = useRef<number>(priceCents);
  const reduced = useReducedMotion();

  useEffect(() => {
    const previous = shown.current;
    shown.current = priceCents;
    if (previous === priceCents || reduced) return;

    const cardNode = card.current;
    const strikeNode = strike.current;
    const priceNode = price.current;
    const animations: Animation[] = [];

    if (cardNode !== null) {
      animations.push(
        cardNode.animate(
          [
            { transform: 'rotate(0deg)' },
            { transform: 'rotate(-6deg)', offset: 0.22 },
            { transform: 'rotate(4.2deg)', offset: 0.5 },
            { transform: 'rotate(-1.8deg)', offset: 0.76 },
            { transform: 'rotate(0deg)' },
          ],
          { duration: SWING_MS, easing: SETTLE },
        ),
      );
    }
    if (strikeNode !== null) {
      animations.push(
        strikeNode.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
          duration: OVERLAY_MS,
          easing: SETTLE,
        }),
      );
    }
    if (priceNode !== null) {
      animations.push(
        priceNode.animate(
          [
            { transform: 'translateY(100%)', opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          { duration: OVERLAY_MS, easing: OVERSHOOT },
        ),
      );
    }
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [priceCents, reduced]);

  return (
    <span class={`tag tag--${size}`}>
      <span class="tag__string" aria-hidden="true" />
      <span ref={card} class="tag__card" data-tag>
        <span class="tag__hole" aria-hidden="true" />
        {previousPriceCents === null ? null : (
          <span class="tag__old">
            <span class="tag__old-text" data-old-price>
              {formatMoney(previousPriceCents)}
            </span>
            <span ref={strike} class="tag__strike" aria-hidden="true" />
          </span>
        )}
        <span class="tag__price-slot">
          <span ref={price} class="tag__price" data-price>
            {formatMoney(priceCents)}
          </span>
        </span>
      </span>
    </span>
  );
}
