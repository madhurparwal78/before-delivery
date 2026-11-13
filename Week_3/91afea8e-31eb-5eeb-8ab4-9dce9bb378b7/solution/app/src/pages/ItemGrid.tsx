import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { rupees } from "../../shared/format";
import "../styles/shared.css";

interface Tile {
  key: string;
  product_id: string;
  title: string;
  image_url: string;
  price_paise: number;
}

const TONES = ["", "card--black", "card--pink"] as const;

/** One column on phones, two on tablets, three on desktops. */
export function ItemGrid({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <ul className="items" aria-label={label}>
      {children}
    </ul>
  );
}

/** A product card: art, title, price at poster scale and the page's own actions. The card colour rotates raised, black, pink. */
export function ItemTile({ tile, index, children }: { tile: Tile; index: number; children: ReactNode }): ReactNode {
  return (
    <li className={`card items__tile ${TONES[index % TONES.length]}`}>
      <img className="items__art" src={tile.image_url} alt={tile.title} width={400} height={400} loading="lazy" />
      <h3 className="items__title">
        <Link to={`/p/${tile.product_id}`}>{tile.title}</Link>
      </h3>
      <p className="price">{rupees(tile.price_paise)}</p>
      <div className="items__actions">{children}</div>
    </li>
  );
}
