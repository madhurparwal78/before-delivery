import { clamp, create } from './dom.js';
import { prefersReducedMotion, prefersSidewaysChapter } from './motion.js';
import { addRitual, catalogue, isChosen, minutesFor, removeRitual } from './store.js';

export interface RitualCards {
  sync(): void;
  travel(progress: number): void;
}

const addName = (title: string): string => `Add ${title} to my hour`;
const removeName = (title: string): string => `Remove ${title} from my hour`;

/** The six catalogue rituals as cards, with a clip that plays only while on screen. */
export function ritualCards(
  track: HTMLElement,
  chapter: HTMLElement,
  onRefused: (id: string) => void,
): RitualCards {
  const toggles = new Map<string, HTMLButtonElement>();
  const minutesLabels = new Map<string, HTMLElement>();
  const cards = new Map<string, HTMLElement>();

  for (const ritual of catalogue) {
    const card = create('div', { class: 'card', role: 'group', 'aria-label': ritual.title });
    const clip = create('video', {
      class: 'card__clip',
      muted: '',
      loop: '',
      playsinline: '',
      preload: 'metadata',
      poster: `/media/ritual-${ritual.id}-still.jpg`,
      'aria-hidden': 'true',
    }) as HTMLVideoElement;
    clip.muted = true;
    clip.append(create('source', { src: `/media/ritual-${ritual.id}.webm`, type: 'video/webm' }));
    clip.append(create('source', { src: `/media/ritual-${ritual.id}.mp4`, type: 'video/mp4' }));
    const minutes = create('p', { class: 'card__minutes' }, `${ritual.defaultMinutes} min`);
    const toggle = create('button', {
      type: 'button',
      class: 'button card__toggle',
      'aria-pressed': 'false',
    }) as HTMLButtonElement;
    toggle.textContent = addName(ritual.title);

    toggle.addEventListener('click', () => {
      if (isChosen(ritual.id)) removeRitual(ritual.id);
      else if (!addRitual(ritual.id)) onRefused(ritual.id);
    });

    toggle.addEventListener('focus', () => {
      if (prefersSidewaysChapter()) scrollCardIntoView(card);
    });

    card.append(clip, create('h3', { class: 'card__title' }, ritual.title), minutes, toggle);
    track.append(card);
    toggles.set(ritual.id, toggle);
    minutesLabels.set(ritual.id, minutes);
    cards.set(ritual.id, card);

    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !prefersReducedMotion()) void clip.play().catch(() => undefined);
          else clip.pause();
        }
      },
      { threshold: 0.5 },
    );
    watcher.observe(card);
  }

  /** Brings a focused card fully on screen while the chapter is pinned. */
  function scrollCardIntoView(card: HTMLElement): void {
    const travelWidth = track.scrollWidth - track.clientWidth;
    if (travelWidth <= 0) return;
    const wanted = clamp((card.offsetLeft + card.offsetWidth - track.clientWidth) / travelWidth, 0, 1);
    const top = chapter.offsetTop + wanted * (chapter.offsetHeight - window.innerHeight);
    window.scrollTo({ top, behavior: 'auto' });
  }

  return {
    sync() {
      for (const ritual of catalogue) {
        const toggle = toggles.get(ritual.id)!;
        const chosen = isChosen(ritual.id);
        toggle.setAttribute('aria-pressed', String(chosen));
        toggle.textContent = chosen ? removeName(ritual.title) : addName(ritual.title);
        minutesLabels.get(ritual.id)!.textContent = `${minutesFor(ritual.id)} min`;
      }
    },
    travel(progress) {
      if (!prefersSidewaysChapter()) {
        track.style.transform = '';
        return;
      }
      const travelWidth = Math.max(0, track.scrollWidth - track.clientWidth);
      track.style.transform = `translateX(${-travelWidth * progress}px)`;
    },
  };
}
