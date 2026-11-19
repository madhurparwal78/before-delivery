import { Sticker } from './sticker.tsx';
import type { StickerKind } from './sticker.tsx';

/** One plump headline and one sticker: the empty state, the not-found page and the error pages. */
export function EmptyState({ headline, sticker = 'blob', level = 2 }: { headline: string; sticker?: StickerKind; level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section className="empty-state">
      <Heading className="empty-headline">{headline}</Heading>
      <Sticker kind={sticker} />
    </section>
  );
}
