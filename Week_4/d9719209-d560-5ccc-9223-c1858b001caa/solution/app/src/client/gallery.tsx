import { useRef, useSyncExternalStore } from 'react';
import { useState } from 'react';
import type { PostView } from '../shared/types.js';
import './gallery.css';
import { ChevronIcon } from './ui.js';

/** Posts whose spoiler images the reader revealed; one reveal shows every image of that post for the rest of the page view. */
const revealed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function reveal(postId: string): void {
  revealed.add(postId);
  version++;
  listeners.forEach((l) => l());
}

const useRevealed = (postId: string): boolean => {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => version);
  return revealed.has(postId);
};

const SWIPE_FRACTION = 0.25;

export function Gallery({ post, compact = false }: { post: PostView; compact?: boolean }): React.JSX.Element {
  const [index, setIndex] = useState(0);
  const shown = useRevealed(post.id);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ start: number; last: number } | null>(null);
  const total = post.images.length;
  const image = post.images[index];
  const blurred = post.spoiler && !shown;

  const go = (to: number): void => setIndex(Math.min(total - 1, Math.max(0, to)));

  if (!image) return <></>;
  const alt = image.alt ?? `Image ${index + 1} of ${total} posted by ${post.author?.username ?? 'a member'}`;

  return (
    <div className={`gallery${compact ? ' gallery-compact' : ''}`}>
      <div
        ref={stage} role="region" aria-label="Images" tabIndex={0} className="gallery-stage"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        }}
        onTouchStart={(event) => {
          const x = event.touches[0]?.clientX ?? 0;
          touch.current = { start: x, last: x };
        }}
        onTouchMove={(event) => {
          if (touch.current) touch.current.last = event.touches[0]?.clientX ?? touch.current.last;
        }}
        onTouchEnd={() => {
          const t = touch.current;
          touch.current = null;
          const width = stage.current?.getBoundingClientRect().width ?? 0;
          if (!t || width === 0) return;
          const dx = t.last - t.start;
          if (Math.abs(dx) > width * SWIPE_FRACTION) go(dx < 0 ? index + 1 : index - 1);
        }}
      >
        <img
          key={image.id} className="gallery-image" src={image.src} srcSet={image.srcset} alt={alt}
          sizes={compact ? '(min-width: 768px) 560px, 100vw' : '(min-width: 1024px) 680px, 100vw'}
          width={image.width} height={image.height} data-blurred={blurred} draggable={false}
        />
        {blurred && <button type="button" className="spoiler-btn" onClick={() => reveal(post.id)}>Show spoiler</button>}
      </div>
      <div className="gallery-bar">
        {total > 1 && (
          <button type="button" className="btn btn-plain" aria-label="Previous image" aria-disabled={index === 0} onClick={() => go(index - 1)}>
            <ChevronIcon direction="left" />
          </button>
        )}
        <span id={compact ? undefined : 'gallery-counter'} className="gallery-counter">{`Image ${index + 1} of ${total}`}</span>
        {total > 1 && (
          <button type="button" className="btn btn-plain" aria-label="Next image" aria-disabled={index === total - 1} onClick={() => go(index + 1)}>
            <ChevronIcon direction="right" />
          </button>
        )}
      </div>
    </div>
  );
}
