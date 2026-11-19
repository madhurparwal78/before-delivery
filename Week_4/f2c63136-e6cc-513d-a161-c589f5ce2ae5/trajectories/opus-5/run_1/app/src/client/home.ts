import { reducedMotion } from './layout.js';

function showRevision(index: number): void {
  document.querySelectorAll<HTMLElement>('[data-revision-panel]').forEach((panel) => {
    panel.hidden = Number(panel.dataset.revisionPanel) !== index;
  });
  document.querySelectorAll<HTMLElement>('[data-revision-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', Number(tab.dataset.revisionTab) === index ? 'true' : 'false');
  });
}

/** The player steps once through the five revisions, driven by animation events, never by timers. */
function runOnce(player: HTMLElement): void {
  if (reducedMotion()) return;
  let clock = player.querySelector<HTMLElement>('.playerclock');
  if (!clock) {
    clock = document.createElement('span');
    clock.className = 'playerclock';
    clock.setAttribute('aria-hidden', 'true');
    player.append(clock);
  }
  let index = 1;
  showRevision(index);
  clock.classList.remove('running');
  void clock.offsetWidth;
  clock.classList.add('running');
  const onIteration = () => {
    index += 1;
    showRevision(Math.min(index, 5));
  };
  const onEnd = () => {
    clock!.removeEventListener('animationiteration', onIteration);
    clock!.removeEventListener('animationend', onEnd);
    clock!.classList.remove('running');
    showRevision(5);
  };
  clock.addEventListener('animationiteration', onIteration);
  clock.addEventListener('animationend', onEnd);
}

export function initHome(): void {
  const player = document.querySelector<HTMLElement>('[aria-label="Revision player"]');
  if (!player) return;

  player.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-revision-tab]');
    if (tab) {
      showRevision(Number(tab.dataset.revisionTab));
      return;
    }
    if ((event.target as HTMLElement).closest('[data-revision-play]')) runOnce(player);
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          runOnce(player);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(player);
  }
}
