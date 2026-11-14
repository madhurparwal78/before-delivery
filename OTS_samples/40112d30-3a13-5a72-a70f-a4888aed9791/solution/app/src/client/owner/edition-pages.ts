import type { ChoiceOption, FormDefinition, Question } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';
import { TYPE_NAMES } from './question-types.ts';

// A published edition, read only: each page with its questions as the owner wrote them.

function choices(name: string, options: ChoiceOption[] | undefined): HTMLElement | null {
  if (!options || options.length === 0) return null;
  return h('p', { class: 'choices' }, `${name}: ${options.map((option) => option.label).join(', ')}`);
}

function questionBlock(question: Question): HTMLElement {
  return h('li', { class: 'edition-question' },
    h('p', { class: 'question-label' }, question.label),
    question.help ? h('p', { class: 'help' }, question.help) : null,
    h('p', {}, question.required ? `${TYPE_NAMES[question.type]}, Required` : TYPE_NAMES[question.type]),
    choices('Options', question.options),
    choices('Rows', question.rows),
    choices('Columns', question.columns));
}

export function editionPages(definition: FormDefinition): HTMLElement {
  return h('div', { class: 'edition-pages' }, definition.pages.map((page) => h('section', { class: 'edition-page' },
    h('h2', {}, page.title),
    h('ul', {}, page.questions.map(questionBlock)))));
}
