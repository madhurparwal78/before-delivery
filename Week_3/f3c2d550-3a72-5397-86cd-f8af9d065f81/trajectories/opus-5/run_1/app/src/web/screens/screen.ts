import type { ReferenceJson, Unit } from '../../shared/types.js';
import type { Stop } from '../field.js';
import type { Shell } from '../shell.js';

export interface Screen {
  destroy(): void;
}

export interface ScreenContext {
  shell: Shell;
  params: Record<string, string>;
  search: URLSearchParams;
  navigate: (
    path: string,
    options?: { replace?: boolean; fromNavigation?: boolean; quiet?: boolean },
  ) => void;
}

export function stopFor(reference: ReferenceJson, unit: Unit): Stop {
  return {
    key: reference.id,
    title: reference.title,
    maker: reference.maker,
    year: reference.year,
    sizeLine: reference.size_text[unit],
    swatch: reference.swatch,
    photoUrl: reference.photo.display_url,
  };
}

/** Screens refetch on load, every 60 seconds and whenever the window regains focus. */
export function startRefetch(run: () => void): () => void {
  const timer = window.setInterval(run, 60_000);
  const onFocus = (): void => run();
  window.addEventListener('focus', onFocus);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', onFocus);
  };
}
