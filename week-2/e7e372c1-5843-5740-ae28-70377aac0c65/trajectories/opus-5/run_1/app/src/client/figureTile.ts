/** A figure tile, updated in place from its stored computation. */
import { element, setText } from './dom';
import { CLOCK_BADGES } from '../shared/labels';
import { tileAsOfLine, tileCitationLine } from './copy';
import { newYorkFields } from './format';
import { Computation } from './types';

export interface FigureTile {
  root: HTMLElement;
  activate: HTMLButtonElement;
  numeral: HTMLElement;
  chipHost: HTMLElement;
  computation: Computation;
  update(computation: Computation): void;
}

function badgeOf(computation: Computation): string {
  const setter = computation.inputs.find((input) => input.sets_as_of) ?? computation.inputs[0];
  return setter === undefined ? '' : CLOCK_BADGES[setter.clock];
}

function citationOf(computation: Computation): string {
  for (const input of computation.inputs) {
    if (input.source.kind === 'exhibit') {
      return tileCitationLine(input.source.accession, input.source.page);
    }
  }
  return '';
}

export function createFigureTile(computation: Computation, headingLevel: 'h2' | 'h3'): FigureTile {
  const heading = element(headingLevel, { className: 'tile-label', text: computation.label });
  const numeral = element('p', { className: 'tile-numeral numeric', text: computation.display });
  const rule = element('div', { className: 'tile-rule' });
  const badge = element('span', { className: 'clock-badge', text: badgeOf(computation) });
  const asOf = element('p', { className: 'tile-asof' });
  const citation = element('p', { className: 'tile-citation' });
  const chipHost = element('div', { className: 'tile-chip-host' });
  const activate = element('button', {
    className: 'tile-activate',
    attributes: { type: 'button', 'aria-label': `Unspool ${computation.label}` },
  });
  const root = element('article', {
    className: 'figure-tile',
    children: [heading, numeral, rule, badge, asOf, citation, chipHost, activate],
  });

  const tile: FigureTile = {
    root,
    activate,
    numeral,
    chipHost,
    computation,
    update(next: Computation) {
      tile.computation = next;
      setText(heading, next.label);
      setText(numeral, next.display);
      setText(badge, badgeOf(next));
      const fields = newYorkFields(next.as_of);
      setText(asOf, tileAsOfLine(fields.date, fields.time));
      setText(citation, citationOf(next));
      activate.setAttribute('aria-label', `Unspool ${next.label}`);
    },
  };
  tile.update(computation);
  return tile;
}
