/** The service panels and the enquire links that prefill the project type. */

import { serviceById } from '../shared/seed.js';
import { projectTypeAnnouncement } from '../shared/text.js';
import { announce, focusPlaced, need, query, queryAll, reducedMotion } from './dom.js';
import { currentUrl, jumpToSection, pushAddress, replaceAddress } from './jumps.js';

const PANEL_MS = 300;

interface Panel {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
}

const openPanel = (panel: HTMLElement): void => {
  panel.hidden = false;
  panel.removeAttribute('inert');
  panel.removeAttribute('aria-hidden');
  if (reducedMotion()) return;
  const height = panel.scrollHeight;
  panel.animate(
    [
      { height: '0px', opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ],
    { duration: PANEL_MS, easing: 'ease' },
  );
};

const closePanel = (panel: HTMLElement): void => {
  // A collapsing panel is already out of reach of Tab and of screen readers.
  panel.setAttribute('inert', '');
  panel.setAttribute('aria-hidden', 'true');
  if (reducedMotion()) {
    panel.hidden = true;
    panel.removeAttribute('inert');
    panel.removeAttribute('aria-hidden');
    return;
  }
  const height = panel.scrollHeight;
  const animation = panel.animate(
    [
      { height: `${height}px`, opacity: 1 },
      { height: '0px', opacity: 0 },
    ],
    { duration: PANEL_MS, easing: 'ease' },
  );
  void animation.finished
    .then(() => {
      if (panel.getAttribute('aria-hidden') !== 'true') return;
      panel.hidden = true;
      panel.removeAttribute('inert');
      panel.removeAttribute('aria-hidden');
    })
    .catch(() => undefined);
};

/** Sets the project type, keeps every typed value and moves focus to the name. */
const prefillProjectType = (value: string, withAnnouncement: boolean): boolean => {
  const service = serviceById(value);
  const select = query<HTMLSelectElement>('[data-field="projectType"]');
  const nameField = query<HTMLInputElement>('[data-field="name"]');
  if (service === undefined || select === null || nameField === null) return false;
  select.value = service.id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  if (withAnnouncement) announce(projectTypeAnnouncement(service.name));
  focusPlaced(nameField);
  return true;
};

export const setUpServices = (): void => {
  const panels: Panel[] = queryAll<HTMLElement>('[data-service]').map((item) => ({
    button: need<HTMLButtonElement>('.service-button', item),
    panel: need<HTMLElement>('[data-service-panel]', item),
  }));

  for (const entry of panels) {
    entry.button.addEventListener('click', () => {
      const isOpen = entry.button.getAttribute('aria-expanded') === 'true';
      for (const other of panels) {
        if (other === entry) continue;
        if (other.button.getAttribute('aria-expanded') !== 'true') continue;
        other.button.setAttribute('aria-expanded', 'false');
        closePanel(other.panel);
      }
      entry.button.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      if (isOpen) closePanel(entry.panel);
      else openPanel(entry.panel);
    });
  }

  for (const link of queryAll<HTMLAnchorElement>('[data-enquire]')) {
    link.addEventListener('click', (event) => {
      const value = link.dataset.enquire ?? '';
      event.preventDefault();
      const url = currentUrl();
      url.searchParams.set('service', value);
      url.hash = '#contact';
      pushAddress(url);
      jumpToSection('contact', true);
      prefillProjectType(value, true);
    });
  }
};

/** `/?service=<value>#contact` in a fresh page gives the prefilled state at once. */
export const applyServiceParameter = (): boolean => {
  const url = currentUrl();
  const value = url.searchParams.get('service');
  if (value === null) return false;
  if (serviceById(value) === undefined) {
    url.searchParams.delete('service');
    replaceAddress(url);
    return false;
  }
  if (url.hash !== '#contact') return false;
  jumpToSection('contact', false);
  return prefillProjectType(value, false);
};
