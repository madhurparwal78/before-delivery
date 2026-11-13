import { all, need } from './dom';

/** Collapsed disclosures and the three-step nitrate pathway slider. */
export function setupScience(): void {
  for (const button of all<HTMLButtonElement>('[data-disclosure]')) {
    const panel = need<HTMLElement>(
      `[data-disclosure-panel="${button.dataset['disclosure'] ?? ''}"]`,
    );
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      panel.hidden = expanded;
    });
  }

  const slider = need<HTMLInputElement>('[data-nitrate-slider]');
  const diagram = need<SVGElement>('[data-nitrate-diagram]');
  const nodes = all<SVGElement>('[data-nitrate-node]', diagram);
  const texts = all<HTMLElement>('[data-nitrate-text]');

  const apply = (): void => {
    const step = slider.value;
    diagram.dataset['step'] = step;
    for (const node of nodes) {
      node.classList.toggle('is-active', node.dataset['nitrateNode'] === step);
    }
    for (const text of texts) {
      text.hidden = text.dataset['nitrateText'] !== step;
    }
    const active = texts.find((text) => text.dataset['nitrateText'] === step);
    slider.setAttribute('aria-valuetext', active?.dataset['stepName'] ?? '');
  };

  slider.addEventListener('input', apply);
  apply();
}
