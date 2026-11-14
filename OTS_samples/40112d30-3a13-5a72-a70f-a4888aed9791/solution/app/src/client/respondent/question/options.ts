import type { ChoiceOption } from '../../../shared/types.ts';
import { h } from '../../lib/dom.ts';

/** One option of a choice or checkbox question, or one column of a phone grid card: a native input inside its label. */
export function optionRow(type: 'radio' | 'checkbox', name: string, option: ChoiceOption, checked: boolean): { row: HTMLLabelElement; input: HTMLInputElement } {
  const input = h('input', { type, name, value: option.value });
  input.checked = checked;
  return { row: h('label', { class: 'option' }, input, h('span', {}, option.label)), input };
}
