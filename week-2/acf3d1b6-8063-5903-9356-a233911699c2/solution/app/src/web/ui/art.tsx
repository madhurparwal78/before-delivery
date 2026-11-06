import type { Aspect } from '../../shared/catalog.js';
import { drawPicture } from '../../shared/picture.js';

/** A decorative picture in the app's drawn language, from a fixed phrase. */
export function Art({ phrase, aspect = '16:9', class: className }: { phrase: string; aspect?: Aspect; class?: string }) {
  const idPrefix = `a${phrase.replace(/[^a-z]/gi, '').slice(0, 12)}${phrase.length}`;
  return (
    <div
      class={`art ${className ?? ''}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: drawPicture({ phrase, aspect, idPrefix }) }}
    />
  );
}
