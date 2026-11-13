import { el } from '../dom';
import { problems, t } from '../i18n';

export interface Problem {
  label: string;
  message: string;
  focus: () => void;
}

/** `region "Problems"`: one link per problem, in field order. */
export function problemsRegion(list: Problem[]): HTMLElement {
  const region = el('div', { role: 'region', 'aria-label': t('ui.problems'), tabindex: '-1', class: 'problems' });
  region.append(el('h2', {}, [problems(list.length)]));
  const items = list.map((problem) => {
    const link = el('a', { href: '#' }, [`${problem.label}: ${problem.message}`]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      problem.focus();
    });
    return el('li', {}, [link]);
  });
  region.append(el('ul', {}, items));
  return region;
}
