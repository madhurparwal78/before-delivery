import { useRef, useState } from 'react';
import type { GalleryResponse, GallerySection } from '../../shared/api.js';
import { emptyStates } from '../../shared/copy.js';
import { api } from '../lib/api.js';
import { useBreakpoint, useLoader } from '../lib/hooks.js';
import { PUBLIC_PIECE_SHADER } from '../lib/pieceShader.js';
import { usePublicUniforms } from '../lib/pieceUniforms.js';
import { Link, useQueryParam } from '../lib/router.js';
import { LiveCanvas } from '../components/LiveCanvas.js';
import { PieceCard } from '../components/PieceCard.js';
import { EmptyState } from '../components/StatusRegion.js';

/** Desktop shows 6 cards in 3 columns, tablet 4 in 2, phones a 6-card carousel. */
const SHOWN = { desktop: 6, tablet: 4, phone: 6 } as const;

function FeaturedRun({ slug, title }: { slug: string; title: string }): JSX.Element {
  const uniforms = usePublicUniforms(slug);
  return (
    <Link to={`/pieces/${slug}`} className="featured-run">
      <LiveCanvas fragmentSource={PUBLIC_PIECE_SHADER} uniforms={uniforms} seed={0} />
      <span className="featured-run__scrim" aria-hidden="true" />
      <h2 className="featured-run__title display">{title}</h2>
    </Link>
  );
}

function Section({ section }: { section: GallerySection }): JSX.Element {
  const breakpoint = useBreakpoint();
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shown = SHOWN[breakpoint];
  const visible = expanded ? section.pieces : section.pieces.slice(0, shown);
  const hasMore = !expanded && section.total > visible.length;

  const empty =
    section.id === 'runs'
      ? { sentence: emptyStates.freshRuns, label: 'Start a piece', to: '/studio' }
      : { sentence: emptyStates.remixes, label: 'Browse the gallery', to: '/gallery' };

  return (
    <section className="gallery-section" aria-label={section.title}>
      <h2 className="gallery-section__heading display">{section.title}</h2>

      {section.pieces.length === 0 ? (
        <EmptyState sentence={empty.sentence} actionLabel={empty.label} actionTo={empty.to} />
      ) : (
        <>
          <div
            className={`gallery-grid${breakpoint === 'phone' ? ' gallery-grid--carousel' : ''}`}
            ref={listRef}
          >
            {visible.map((card, index) => (
              <PieceCard key={card.slug} card={card} index={index} />
            ))}
          </div>

          {hasMore && (
            <div className="show-more">
              <button
                type="button"
                className="show-more__pill"
                onClick={() => {
                  setExpanded(true);
                  // Focus moves to the heading of the first newly shown card.
                  window.requestAnimationFrame(() => {
                    const headings = listRef.current?.querySelectorAll<HTMLElement>('.piece-card__title');
                    const target = headings?.[visible.length];
                    if (target) {
                      target.setAttribute('tabindex', '-1');
                      target.focus();
                    }
                  });
                }}
              >
                Show all {section.title}
              </button>
              <p className="show-more__count muted tabular">
                {visible.length} of {section.total}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Gallery(): JSX.Element {
  const creator = useQueryParam('creator');
  const gallery = useLoader(
    () => api.get<GalleryResponse>(`/api/gallery${creator ? `?creator=${encodeURIComponent(creator)}` : ''}`),
    [creator],
  );

  return (
    <div className="shell gallery">
      <h1 className="gallery__title display">Pieces that keep running.</h1>
      {creator && <p className="gallery__filter muted">Showing pieces by {creator}.</p>}

      {gallery.data?.featured && (
        <FeaturedRun slug={gallery.data.featured.slug} title={gallery.data.featured.title} />
      )}

      {(gallery.data?.sections ?? []).map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </div>
  );
}
