import { api } from '../api.js';
import { button, clear, h, region } from '../dom.js';
import { PENDING_COPY, SUCCESS_COPY, feedback } from '../feedback.js';
import type { Shell } from '../shell.js';

let rules: Record<string, unknown> | null = null;

function renderValue(value: unknown): Node {
  if (value === null) return document.createTextNode('null');
  if (Array.isArray(value)) {
    return h(
      'ul',
      { class: 'rules-list' },
      value.map((item) => h('li', {}, [renderValue(item)])),
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return h(
      'dl',
      { class: 'rules-tree' },
      entries.flatMap(([key, item]) => [h('dt', {}, [key]), h('dd', {}, [renderValue(item)])]),
    );
  }
  return document.createTextNode(String(value));
}

export function renderRules(shell: Shell): void {
  const content = region('Rules reference', 'panel paper rules', [h('h2', {}, ['Rules reference'])]);
  const body = h('div', { class: 'rules-body' });
  content.append(
    h('p', {}, [
      'Every simulation, arithmetic, randomness, ranking, season and limit rule is published here and through GET /api/rules.',
    ]),
    button('Refresh harbour rules', () => void load(body)),
    body,
  );
  shell.main.append(content);
  if (rules === null) void load(body);
  else body.append(renderValue(rules));
}

async function load(body: HTMLElement): Promise<void> {
  feedback.pending(PENDING_COPY.inspection);
  try {
    rules = await api.get<Record<string, unknown>>('/api/rules');
    clear(body);
    body.append(renderValue(rules));
    feedback.succeed(SUCCESS_COPY.inspection);
  } catch (error) {
    feedback.fail(error);
  }
}
