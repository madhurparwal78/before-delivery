import { listen, query, queryAll } from './dom.js';
import { EASE_OUT, animate } from './motion.js';

const PROCESS_MS = 280;

export function initProcess(root: ParentNode): void {
  const process = query<HTMLElement>('[data-process]', root);
  if (!process) return;
  const tabs = queryAll<HTMLButtonElement>('[data-process-tab]', process);
  const panels = queryAll<HTMLElement>('[data-process-panel]', process);

  const select = (index: number, move: boolean): void => {
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, position) => {
      panel.hidden = position !== index;
    });
    const inner = query<HTMLElement>('.process__panel-inner', panels[index]!);
    if (inner && move) {
      animate(inner, [{ transform: 'translateX(16px)', opacity: '0' }, { transform: 'translateX(0)', opacity: '1' }], {
        duration: PROCESS_MS,
        easing: EASE_OUT,
      });
    }
    tabs[index]!.focus();
  };

  tabs.forEach((tab, index) => {
    listen(tab, 'click', () => select(index, true));
    listen(tab, 'keydown', (event) => {
      const last = tabs.length - 1;
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft'
            ? (index + last) % tabs.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? last
                : null;
      if (next === null) return;
      event.preventDefault();
      select(next, true);
    });
  });
}
