import { el } from './dom';

/** Two equal flat fields, mint for the planning parent and pink for the other, with a crisp edge between. */
export function fields(): HTMLElement {
  return el('div', { class: 'fields', 'aria-hidden': 'true' }, [
    el('div', { class: 'field-mint' }),
    el('div', { class: 'field-pink' }),
  ]);
}

/** A screen that opens on the two fields with its content centred on the join. */
export function hero(children: HTMLElement[]): HTMLElement {
  return el('section', { class: 'hero' }, [fields(), ...children]);
}

/** The headline band every working screen opens with. */
export function pageBand(title: string): HTMLElement {
  return el('header', { class: 'page-band' }, [fields(), el('h1', { class: 'page-headline', text: title })]);
}
