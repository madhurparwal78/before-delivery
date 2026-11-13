import { pathwayDiagram } from './art.js';
import { notAMedicine, type Product } from './core.js';
import { pathwayName, pathwayText } from './story.js';

export function initScience(product: Product): void {
  document.querySelectorAll<HTMLElement>('[data-disclosure]').forEach((disclosure) => {
    const button = disclosure.querySelector<HTMLButtonElement>('[data-disclosure-button]');
    const panel = disclosure.querySelector<HTMLElement>('[data-disclosure-panel]');
    if (!button || !panel) return;
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
    });
  });

  const slider = document.querySelector<HTMLInputElement>('[data-pathway-slider]');
  const diagram = document.querySelector<HTMLElement>('[data-pathway-diagram]');
  const text = document.querySelector<HTMLElement>('[data-pathway-text]');
  const notice = document.querySelector<HTMLElement>('[data-not-medicine]');
  if (notice) notice.textContent = notAMedicine(product);
  if (!slider || !diagram || !text) return;

  const apply = (value: number) => {
    slider.value = String(value);
    slider.setAttribute('aria-valuetext', pathwayName(value));
    diagram.setAttribute('data-step', String(value));
    diagram.innerHTML = pathwayDiagram(value, 320, 70);
    text.textContent = pathwayText(value);
  };

  slider.addEventListener('input', () => {
    apply(Number(slider.value));
  });

  apply(1);
}
