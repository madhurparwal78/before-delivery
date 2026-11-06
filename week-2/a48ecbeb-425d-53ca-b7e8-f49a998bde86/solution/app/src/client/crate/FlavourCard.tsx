import { Ban } from "lucide-react";
import { money } from "../../shared/format";
import type { Flavour } from "../lib/types";
import { Link } from "../lib/router";
import { useCrateDrop } from "../state/crate";
import { useShop } from "../state/shop";
import { CanArt } from "../can/CanArt";
import { FLAVOUR_COPY } from "../can/flavours";

export function FlavourCard({ flavour, first }: { flavour: Flavour; first: boolean }) {
  const { soldOut, stockUnavailable } = useShop();
  const { add, firstAddButton } = useCrateDrop();
  const isSoldOut = soldOut.has(flavour.slug) || flavour.stock_left === 0;
  const copy = FLAVOUR_COPY[flavour.slug];
  return (
    <li className={`flavour-card flavour-${flavour.slug}`}>
      <article aria-labelledby={`card-${flavour.slug}`}>
        <div className="card-art">
          <CanArt flavour={flavour.slug} />
          {flavour.limited && <span className="card-tag">Limited drop</span>}
          {isSoldOut && (
            <p className="sold-out">
              <Ban size={16} aria-hidden="true" />
              <span>Sold out</span>
            </p>
          )}
        </div>
        <div className="card-body">
          <h3 id={`card-${flavour.slug}`}>
            <Link href={`/flavours/${flavour.slug}`}>{flavour.name}</Link>
          </h3>
          <p className="card-tagline">{copy?.tagline}</p>
          <p className="card-figures">
            <span className="num card-price">{money(flavour.can_price_cents)}</span>
            <span className="card-per">per can</span>
            {stockUnavailable ? null : <span className="num card-left">{`${flavour.stock_left} left`}</span>}
          </p>
          <div className="card-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-label={`Add ${flavour.name}`}
              ref={first ? firstAddButton : undefined}
              onClick={(event) => add(flavour.slug, event.currentTarget.closest("article")?.querySelector(".card-art") ?? event.currentTarget)}
            >
              Add
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label={`Fill crate with ${flavour.name}`}
              onClick={(event) => add(flavour.slug, event.currentTarget.closest("article")?.querySelector(".card-art") ?? event.currentTarget, true)}
            >
              Fill crate
            </button>
          </div>
        </div>
      </article>
    </li>
  );
}
