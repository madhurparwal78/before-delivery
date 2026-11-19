import { listen, need, query, queryAll } from './dom.js';
import { EASE_OUT, SERVICE_MS, reduced } from './motion.js';
import { writeHash, writeParam } from './params.js';
import { JUMP_TOP, focusWithout, jumpToSection, jumpToSectionControl, scrollTop } from './focus.js';
import { chooseCategory } from './work.js';
import type { CategoryId } from '../shared/types.js';

const panelOf = (root: ParentNode, id: string): HTMLElement =>
  need<HTMLElement>(`[data-service-panel="${id}"]`, root);

const buttonOf = (root: ParentNode, id: string): HTMLElement =>
  need<HTMLElement>(`[data-service-button="${id}"]`, root);

function open(root: ParentNode, id: string): void {
  const panel = panelOf(root, id);
  const button = buttonOf(root, id);
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  if (!reduced()) {
    panel.animate([{ height: '0px' }, { height: `${panel.scrollHeight}px` }], {
      duration: SERVICE_MS,
      easing: EASE_OUT,
    });
  }
  writeParam('service', id);
}

function close(root: ParentNode, id: string): void {
  const panel = panelOf(root, id);
  const button = buttonOf(root, id);
  button.setAttribute('aria-expanded', 'false');
  writeParam('service', null);
  if (reduced()) {
    panel.hidden = true;
    return;
  }
  const animation = panel.animate(
    [{ height: `${panel.scrollHeight}px` }, { height: '0px' }],
    { duration: SERVICE_MS, easing: EASE_OUT },
  );
  const hide = (): void => {
    if (button.getAttribute('aria-expanded') === 'false') panel.hidden = true;
  };
  animation.finished.then(hide, hide);
}

export function initServices(root: ParentNode, first: boolean): void {
  const buttons = queryAll<HTMLElement>('[data-service-button]', root);
  if (buttons.length === 0) return;

  const toggle = (id: string): void => {
    const expanded = buttonOf(root, id).getAttribute('aria-expanded') === 'true';
    for (const other of buttons) {
      const otherId = other.dataset.serviceButton!;
      if (other.getAttribute('aria-expanded') === 'true') close(root, otherId);
    }
    if (!expanded) open(root, id);
  };

  buttons.forEach((button, index) => {
    listen(button, 'click', () => toggle(button.dataset.serviceButton!));
    listen(button, 'keydown', (event) => {
      const last = buttons.length - 1;
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % buttons.length
          : event.key === 'ArrowUp'
            ? (index + last) % buttons.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? last
                : null;
      if (next === null) return;
      event.preventDefault();
      buttons[next]!.focus();
    });
  });

  for (const link of queryAll<HTMLAnchorElement>('[data-service-work]', root)) {
    listen(link, 'click', (event) => {
      event.preventDefault();
      chooseCategory(root, link.dataset.serviceWork as CategoryId, true);
      writeHash('#work');
      jumpToSection('work');
    });
  }

  for (const link of queryAll<HTMLAnchorElement>('[data-service-start]', root)) {
    listen(link, 'click', (event) => {
      event.preventDefault();
      const id = link.dataset.serviceStart!;
      const radio = query<HTMLInputElement>(`input[name="project_type"][value="${id}"]`, root);
      if (radio) radio.checked = true;
      writeParam('type', id);
      writeHash('#contact');
      jumpToSectionControl('contact', need<HTMLElement>('[data-field="name"]', root));
    });
  }

  const openService = query<HTMLElement>('[data-service-button][aria-expanded="true"]', root);
  if (first && openService) {
    focusWithout(openService);
    scrollTop(window.scrollY + openService.getBoundingClientRect().top - JUMP_TOP, true);
  }
}
