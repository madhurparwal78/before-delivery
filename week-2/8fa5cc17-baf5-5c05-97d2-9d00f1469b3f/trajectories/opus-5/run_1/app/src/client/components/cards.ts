import { el, prefersReducedMotion, setHidden } from '../dom';
import { animate, fadeIn } from '../anim';
import { ObjectDto, TypeDto } from '../types';
import {
  CARD_PERSPECTIVE_PX,
  CARD_ROW_DELAY_MS,
  CARD_ROW_MS,
  CARD_ROW_STAGGER_MS,
  CARD_TURN_MS,
  CARD_WIDE_THRESHOLD_PX,
  REDUCED_FADE_MS,
} from '../../shared/motion';

export type CardOptions = {
  object: ObjectDto;
  type: TypeDto | undefined;
  relationTitle: (id: string) => string;
  onOpen: (object: ObjectDto, titleNode: HTMLElement) => void;
};

/** Type pages show objects as index cards that turn to a back face of properties. */
export function objectCard(options: CardOptions): HTMLElement {
  const { object } = options;
  const card = el('article', { className: 'object-card', attrs: { 'aria-label': object.title } });
  card.style.perspective = `${CARD_PERSPECTIVE_PX}px`;
  const inner = el('div', { className: 'card-inner', attrs: { 'data-card-inner': '' } });
  const front = el('div', { className: 'card-face', attrs: { 'data-card-face': 'front' } });
  const back = el('div', { className: 'card-face', attrs: { 'data-card-face': 'back' } });

  const titleLink = el('a', { className: 'card-title', text: object.title, attrs: { href: `/o/${object.id}` } });
  titleLink.addEventListener('click', (event) => {
    event.preventDefault();
    options.onOpen(object, titleLink);
  });
  const numeral = el('span', {
    className: 'card-count',
    text: String(object.backlinks),
    attrs: { 'data-backlink-count': String(object.backlinks) },
  });
  const showProperties = el('button', {
    className: 'card-flip',
    text: 'Show properties',
    attrs: { type: 'button', 'aria-label': `Show properties of ${object.title}` },
  });
  front.append(el('div', { className: 'card-head', children: [titleLink, numeral] }), showProperties);

  const showFront = el('button', {
    className: 'card-flip',
    text: 'Show front',
    attrs: { type: 'button', 'aria-label': `Show front of ${object.title}` },
  });
  const list = el('dl', { className: 'card-properties' });
  const rows: HTMLElement[] = [];
  for (const field of options.type?.fields ?? []) {
    const value = object.properties[field.name];
    let shown = '—';
    if (value !== null && value !== undefined && value !== '') {
      shown = field.kind === 'relation' ? options.relationTitle(String(value)) : String(value);
    }
    const row = el('div', {
      className: 'card-property',
      children: [el('dt', { text: field.name }), el('dd', { text: shown })],
    });
    rows.push(row);
    list.append(row);
  }
  back.append(el('h3', { text: object.title }), list, showFront);

  inner.append(front, back);
  card.append(inner);

  let flipped = false;
  let turning: Animation | null = null;

  const setFaceAvailability = (): void => {
    setHidden(front, flipped);
    setHidden(back, !flipped);
  };
  setFaceAvailability();

  const currentAngle = (): number => {
    const transform = getComputedStyle(inner).transform;
    if (transform === 'none') return flipped ? 0 : 180;
    const matrix = new DOMMatrixReadOnly(transform);
    return (Math.atan2(-matrix.m31, matrix.m11) * 180) / Math.PI;
  };

  /** A second press mid-turn reverses the turn from its current angle. */
  const turn = (toFlipped: boolean): void => {
    const to = toFlipped ? 180 : 0;
    let from = toFlipped ? 0 : 180;
    let duration = CARD_TURN_MS;
    if (turning !== null) {
      const elapsed = Number(turning.currentTime ?? 0);
      from = currentAngle();
      duration = Math.max(1, elapsed);
      turning.cancel();
      turning = null;
      for (const row of rows) for (const animation of row.getAnimations()) animation.reverse();
    }
    flipped = toFlipped;
    setFaceAvailability();
    if (prefersReducedMotion()) {
      inner.style.transform = `rotateY(${to}deg)`;
      fadeIn(flipped ? back : front, REDUCED_FADE_MS);
      return;
    }
    turning = animate(inner, [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }], duration);
    inner.style.transform = `rotateY(${to}deg)`;
    if (toFlipped) {
      rows.forEach((row, index) => {
        animate(
          row,
          [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          CARD_ROW_MS,
          undefined,
          CARD_ROW_DELAY_MS + CARD_ROW_STAGGER_MS * index,
        );
      });
    }
    void turning.finished.then(
      () => {
        turning = null;
      },
      () => undefined,
    );
  };

  showProperties.addEventListener('click', () => {
    turn(true);
    showFront.focus();
  });
  showFront.addEventListener('click', () => {
    turn(false);
    showProperties.focus();
  });

  /** Each card picks its wide or narrow layout from its own width. */
  const applyWidth = (width: number): void => {
    card.setAttribute('data-card-layout', width >= CARD_WIDE_THRESHOLD_PX ? 'wide' : 'narrow');
  };
  applyWidth(card.clientWidth);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) applyWidth(entry.contentRect.width);
    });
    observer.observe(card);
  }

  return card;
}
