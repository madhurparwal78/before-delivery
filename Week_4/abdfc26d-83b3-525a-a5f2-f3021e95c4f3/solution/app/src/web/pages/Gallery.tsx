import { useEffect, useRef, useState } from "react";
import { api, type Card, type Gallery as GalleryData } from "../api";
import { LiveCanvas } from "../components/LiveCanvas";
import { PieceCard } from "../components/PieceCard";
import { EmptyState, Icon, Reveal } from "../components/ui";
import { Link, useLocation } from "../router";
import { useReducedMotion, useViewport } from "../session";

const SHOWN = { desktop: 6, tablet: 4, phone: 6 } as const;

export function Gallery() {
  const { search } = useLocation();
  const creator = search.get("creator");
  const [data, setData] = useState<GalleryData | null>(null);
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    void api<GalleryData>("GET", `/api/gallery${creator ? `?creator=${encodeURIComponent(creator)}` : ""}`).then((result) => {
      if (result.ok) setData(result.data);
      else setFailed(true);
    });
  }, [creator]);
  const featured = data?.featured ?? null;
  return (
    <div className="page gallery-page">
      <section className="featured-run" aria-label="Featured run">
        {featured ? (
          <>
            <LiveCanvas
              program={{ kind: "house", slug: featured.slug }}
              slug={featured.slug}
              still={reduced}
              scale={0.6}
              className="featured-canvas"
              scene={() => ({ seed: 0, uniforms: {}, time: (t) => t })}
              noteFallback
            />
            <div className="featured-text">
              <p className="eyebrow"><span className="eyebrow-name">Featured run{creator ? ` · ${featured.creator_display_name}` : ""}</span></p>
              <p className="display display-md">{featured.title}</p>
              <p className="muted tabular">
                {featured.creator_display_name} · {featured.editions_left} of {featured.edition_count} left
              </p>
              <Link to={`/pieces/${featured.slug}`} className="arrow-link">
                Choose an edition
                <Icon name="arrowRight" size={16} />
              </Link>
            </div>
          </>
        ) : (
          <div className="featured-empty" />
        )}
      </section>
      {failed ? <p className="banner">The gallery could not be loaded. Reload the page to try again.</p> : null}
      {data?.sections.map((section) => (
        <GallerySection key={section.id} id={section.id} title={section.title} total={section.total} pieces={section.pieces} />
      ))}
    </div>
  );
}

function GallerySection({ id, title, total, pieces }: { id: "runs" | "remixes"; title: string; total: number; pieces: Card[] }) {
  const viewport = useViewport();
  const [all, setAll] = useState(false);
  const firstNew = useRef<HTMLHeadingElement>(null);
  const shown = SHOWN[viewport];
  const visible = all ? pieces : pieces.slice(0, shown);
  const focusNext = useRef(false);
  useEffect(() => {
    if (all && focusNext.current) {
      focusNext.current = false;
      firstNew.current?.focus();
    }
  }, [all]);
  const headingId = `section-${id}`;
  return (
    <section className="gallery-section" aria-labelledby={headingId}>
      <div className="section-head">
        <h2 id={headingId} className="display display-sm">{title}</h2>
        <p className="muted tabular">{total} {total === 1 ? "piece" : "pieces"}</p>
      </div>
      {pieces.length === 0 ? (
        id === "runs" ? (
          <EmptyState sentence="Nothing numbered yet." action={<Link to="/#describe" className="button button-accent">Start a piece</Link>} />
        ) : (
          <EmptyState sentence="No remixes yet." action={<Link to="/gallery" className="button button-accent">Browse the gallery</Link>} />
        )
      ) : (
        <>
          <ul className="card-grid">
            {visible.map((card, i) => (
              <Reveal as="li" key={card.slug} delay={(i % shown) * 100}>
                <PieceCard card={card} ref={i === shown ? firstNew : undefined} />
              </Reveal>
            ))}
          </ul>
          {!all && total > shown ? (
            <div className="show-more">
              <button
                type="button"
                className="pill"
                onClick={() => {
                  focusNext.current = true;
                  setAll(true);
                }}
              >
                Show all {title}
              </button>
              <p className="muted tabular counter">
                {Math.min(shown, total)} of {total}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
