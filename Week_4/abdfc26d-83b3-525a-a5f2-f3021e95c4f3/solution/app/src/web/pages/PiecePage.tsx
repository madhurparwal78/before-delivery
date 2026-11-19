import { useCallback, useEffect, useState } from "react";
import { seedHash } from "../../shared/rules";
import { api, type EditionStatus, type Piece } from "../api";
import { EditionStage } from "../components/EditionStage";
import { Icon, LiveStatus, useAnnouncer } from "../components/ui";
import { copy, money } from "../copy";
import { Link, navigate, useLocation } from "../router";
import { useSession } from "../session";
import { NotFound } from "./NotFound";

export function PiecePage({ slug }: { slug: string }) {
  const { search } = useLocation();
  const { me, has } = useSession();
  const [piece, setPiece] = useState<Piece | null>(null);
  const [missing, setMissing] = useState(false);
  const [lens, setLens] = useState<{ n: number; status: EditionStatus } | null>(null);
  const announcer = useAnnouncer();
  useEffect(() => {
    setPiece(null);
    void api<Piece>("GET", `/api/pieces/${slug}`).then((result) => {
      if (result.ok) setPiece(result.data);
      else setMissing(true);
    });
  }, [slug]);
  const onEditionChange = useCallback((n: number, status: EditionStatus) => setLens({ n, status }), []);

  if (missing) return <NotFound />;
  if (!piece) return <div className="page piece-page" aria-busy="true" />;

  const count = piece.edition_count ?? 0;
  const requested = Number(search.get("edition"));
  const canRemix = has("creator") && me?.id !== piece.creator.id && piece.state === "published" && !piece.remix_of;
  const remix = async () => {
    const result = await api<{ piece: Piece }>("POST", `/api/pieces/${piece.slug}/remix`);
    if (result.ok) navigate(`/studio/pieces/${result.data.piece.slug}`, { message: copy.remixCreated(piece.title) });
    else announcer.say(result.error.message);
  };

  return (
    <div className="page piece-page">
      <div className="piece-layout">
        <div className="piece-stage">
          {piece.state === "published" && count > 0 ? (
            <EditionStage
              piece={{ slug: piece.slug, title: piece.title, editionCount: count, priceCents: piece.price_cents ?? 0 }}
              initial={Number.isInteger(requested) && requested > 0 ? requested : 1}
              variant="piece"
              onEditionChange={onEditionChange}
            />
          ) : (
            <p className="banner">This piece is not on sale. Owners keep their exports and invoices in their library.</p>
          )}
        </div>
        <aside className="piece-details">
          <p className="eyebrow"><span className="eyebrow-name">{piece.remix_of ? "Remix" : "GLSL"} · edition run</span></p>
          <h1 className="display display-md">{piece.title}</h1>
          <p className="piece-creator">by {piece.creator.display_name}</p>
          {piece.remix_of ? (
            <p className="muted">
              Remix of <Link to={`/pieces/${piece.remix_of.slug}`}>{piece.remix_of.title}</Link> by {piece.remix_of.creator_display_name}
            </p>
          ) : null}
          <dl className="piece-facts">
            <div><dt>Price</dt><dd className="tabular">{money(piece.price_cents ?? 0)} + VAT by billing country</dd></div>
            <div><dt>Editions left</dt><dd className="tabular">{piece.editions_left ?? 0} of {count}</dd></div>
            {lens ? (
              <div>
                <dt>Seed of edition {lens.n}</dt>
                <dd className="mono seed-hash">{seedHash(piece.slug, lens.n)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="muted">Move across the piece to look at each numbered edition. Press Enter or tap to hold one for ten minutes while you check out.</p>
          {canRemix ? (
            <button type="button" className="button button-ghost" onClick={() => void remix()}>
              <Icon name="shuffle" size={16} />
              Remix
            </button>
          ) : null}
          <LiveStatus label="Remix status" announcer={announcer} />
        </aside>
      </div>
    </div>
  );
}
