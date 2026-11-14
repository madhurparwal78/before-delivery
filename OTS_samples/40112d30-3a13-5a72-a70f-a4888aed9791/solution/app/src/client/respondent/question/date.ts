import type { AnswerValue, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { h, svg } from '../../lib/dom.ts';
import { compareDays, formatDay, parseDay, requireDay, type Day } from '../dates.ts';
import { openDatePicker } from '../date-picker.ts';
import { asText } from './answers.ts';
import type { Field, FieldEnv } from './field.ts';
import { controlId, createShell } from './shell.ts';
import { wireTypedBox } from './typed-box.ts';

const DATE_FORMAT = 'YYYY-MM-DD';

const chooseLabel = (label: string): string => `Choose date for ${label}`;

const calendarIcon = (): SVGSVGElement =>
  svg('svg', { viewBox: '0 0 16 16', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false', class: 'icon' },
    svg('path', { d: 'M2.5 4.5h11v9h-11zM2.5 7.5h11M5.5 2.5v3M10.5 2.5v3', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));

const boundOf = (value: string | number | undefined): Day | null => (typeof value === 'string' ? parseDay(value) : null);

/** The day the calendar opens on when nothing is chosen: today, or the nearest allowed day. */
function nearestAllowed(today: Day, min: Day | null, max: Day | null): Day {
  if (min && compareDays(today, min) < 0) return min;
  if (max && compareDays(today, max) > 0) return max;
  return today;
}

/** A date is a text box that takes YYYY-MM-DD, plus a button that opens the calendar dialog. */
export function dateField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, env: FieldEnv): Field {
  const shell = createShell(item, 'label');
  const box = h('input', { id: controlId(item.key), type: 'text', autocomplete: 'off', placeholder: DATE_FORMAT });
  box.value = asText(answer);
  if (spec.required) box.setAttribute('aria-required', 'true');
  const typed = wireTypedBox(box, item.key, env);
  const opener = h('button', { type: 'button', class: 'calendar-open', 'aria-label': chooseLabel(item.label) }, calendarIcon());
  opener.addEventListener('click', () => {
    const selected = parseDay(box.value);
    const min = boundOf(spec.min);
    const max = boundOf(spec.max);
    openDatePicker({
      opener,
      selected,
      min,
      max,
      start: selected ?? nearestAllowed(requireDay(env.today), min, max),
      onPick: (day) => {
        box.value = formatDay(day);
        typed.commit();
      },
    });
  });
  shell.bind(box);
  shell.relabel(item.label, item.help);
  shell.root.append(h('div', { class: 'date-row' }, box, opener));
  return {
    key: item.key,
    element: shell.root,
    update: (next) => {
      shell.relabel(next.label, next.help);
      opener.setAttribute('aria-label', chooseLabel(next.label));
    },
    showError: shell.showError,
    clearError: shell.clearError,
    focusTarget: () => box,
    flush: typed.commit,
  };
}
