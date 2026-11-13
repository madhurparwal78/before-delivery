import type { CollectionSummary } from "../../shared/api";
import { plural } from "../../shared/format";

export const BAND_TONES: Record<string, "red" | "blue" | "teal" | "yellow"> = {
  all: "teal",
  luggage: "red",
  backpacks: "blue",
  totes: "yellow",
  wallets: "teal",
  accessories: "red",
};

/** A collection opens with a full-width solid colour band: one large numeral and two caption lines. */
export function Band({ collection, tone, level }: { collection: CollectionSummary; tone: "red" | "blue" | "teal" | "yellow"; level: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section className={`band tone-${tone}`} data-page={tone}>
      <Heading className="band-name">{collection.name}</Heading>
      <p className="band-numeral">{collection.units}</p>
      <p className="band-caption">units ready to ship</p>
      <p className="band-caption">
        {collection.designs} {plural(collection.designs, "design", "designs")}
      </p>
    </section>
  );
}
