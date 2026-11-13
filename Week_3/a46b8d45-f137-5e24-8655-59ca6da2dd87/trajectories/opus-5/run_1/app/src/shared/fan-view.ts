/**
 * The exploded fitting fan, used by the owner's claim form, the share page and the
 * operator's workspace.
 *
 * At slider value 0 the parts sit stacked on one shared centre. As the slider rises they
 * fan out along the model's axis: part k moves round(s × k × g) px, and the whole diagram
 * shrinks by `data-fan-scale` so the spread fits. Each part carries a hairline callout to
 * its booklet number.
 *
 * A model whose diagram cannot be drawn shows the published heading and a numbered list of
 * part buttons instead, with no slider in the accessibility tree.
 */

import { CONTROL_NAMES, partButtonName } from './copy';
import { FAN_GAP_NARROW, FAN_GAP_WIDE, fanScale, fanSeparation, offsetStyle, partOffset, type FanAxis } from './fan-math';
import { h, bilingual, bilingualLabel, fragment, pick, text, type Attributes } from './html';
import type { Language } from './format';

/** What the fan needs to know about one part. */
export interface FanPart {
  bookletNumber: number;
  name: string;
  status: 'active' | 'withdrawn';
}

export interface FanOptions {
  parts: readonly FanPart[];
  axis: FanAxis | null;
  language: Language;
  /** The booklet number of the selected part, or null for none. */
  selected: number | null;
  value: number;
  /** The share page shows the claimed part selected and lets nobody change it. */
  readOnly: boolean;
}

function partButton(part: FanPart, options: FanOptions, index: number): string {
  const withdrawn = part.status === 'withdrawn';
  const selected = options.selected === part.bookletNumber;
  const offset = partOffset(options.value, index, FAN_GAP_WIDE);
  const names = {
    'en-GB': partButtonName(part.bookletNumber, part.name, 'en-GB'),
    'pl-PL': partButtonName(part.bookletNumber, part.name, 'pl-PL'),
  };

  const attributes: Attributes = {
    type: 'button',
    class: `fan-part${selected ? ' is-selected' : ''}${withdrawn ? ' is-withdrawn' : ''}`,
    'aria-label': pick(names, options.language),
    ...bilingualLabel(names),
    'aria-pressed': selected ? 'true' : 'false',
    'aria-disabled': withdrawn ? 'true' : undefined,
    'data-booklet': part.bookletNumber,
    'data-part-offset': offset,
    'data-part-status': part.status,
    style: options.axis === null ? undefined : offsetStyle(options.axis, offset),
  };

  return h(
    'button',
    attributes,
    // Everything inside is decoration: the button's name comes from its label.
    h('span', { class: 'fan-part-shape', 'aria-hidden': 'true' }),
    h(
      'span',
      { class: 'fan-part-callout', 'aria-hidden': 'true' },
      h('span', { class: 'fan-callout-line' }),
      h('span', { class: 'fan-callout-number' }, text(part.bookletNumber)),
    ),
  );
}

export function renderFan(options: FanOptions): string {
  const count = options.parts.length;
  const drawable = options.axis !== null;
  const value = options.value;

  const rootAttributes: Attributes = {
    role: 'region',
    class: `fan${drawable ? '' : ' fan-fallback'}${options.readOnly ? ' is-read-only' : ''}`,
    'aria-label': pick(CONTROL_NAMES.fittingFan, options.language),
    ...bilingualLabel(CONTROL_NAMES.fittingFan),
    'data-fan-separation': drawable ? fanSeparation(value, count, FAN_GAP_WIDE) : 0,
    'data-fan-scale': fanScale(value),
    'data-fan-axis': options.axis ?? 'none',
    'data-active-part': options.selected === null ? 'none' : options.selected,
    'data-part-count': count,
    'data-gap-wide': FAN_GAP_WIDE,
    'data-gap-narrow': FAN_GAP_NARROW,
    'data-read-only': options.readOnly ? 'true' : 'false',
  };

  if (!drawable) {
    // The slider is not rendered at all, so it is absent from the accessibility tree.
    return h(
      'section',
      rootAttributes,
      h(
        'h2',
        { class: 'fan-unavailable', ...bilingual(CONTROL_NAMES.diagramUnavailable) },
        text(pick(CONTROL_NAMES.diagramUnavailable, options.language)),
      ),
      h(
        'ul',
        {
          class: 'fan-list',
          'aria-label': pick(CONTROL_NAMES.partsInBookletOrder, options.language),
          ...bilingualLabel(CONTROL_NAMES.partsInBookletOrder),
          'data-active-part': options.selected === null ? 'none' : options.selected,
        },
        ...options.parts.map((part, index) => h('li', {}, partButton(part, options, index))),
      ),
    );
  }

  return h(
    'section',
    rootAttributes,
    h('input', {
      type: 'range',
      class: 'fan-slider',
      min: 0,
      max: 100,
      step: 1,
      value,
      'aria-label': pick(CONTROL_NAMES.separateParts, options.language),
      ...bilingualLabel(CONTROL_NAMES.separateParts),
    }),
    h(
      'div',
      { class: 'fan-stage', style: `--fan-scale:${fanScale(value)}` },
      fragment(...options.parts.map((part, index) => partButton(part, options, index))),
    ),
  );
}
