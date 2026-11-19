import { Link } from "react-router-dom";

const AVAILABILITY = { cloud: "Cloud", oss: "OSS", hybrid: "Hybrid" };

function monogram(name) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

// A catalog card: monogram tile, name, category and availability tags. The name is the card's one link,
// stretched over the whole card.
export default function CatalogCard({ definition, to }) {
  return (
    <article className="catalog-card">
      <span className="monogram" aria-hidden="true">{monogram(definition.name)}</span>
      <h3><Link to={to} className="card-link">{definition.name}</Link></h3>
      <span>{definition.category}</span>
      <span className="tags">
        <span className="tag label">{definition.type === "source" ? "Source" : "Destination"}</span>
        {definition.availability.map((key) => <span key={key} className="tag label">{AVAILABILITY[key]}</span>)}
      </span>
    </article>
  );
}
