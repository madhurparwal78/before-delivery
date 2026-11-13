import { useState } from "react";
import type { CollectionSummary } from "../../shared/api";
import { Band, BAND_TONES } from "../components/Band";
import { Masthead } from "../components/Masthead";
import { Loading, ServerError } from "../components/Panel";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { useData } from "../lib/useData";
import "../styles/store.css";

const TONES = ["red", "blue", "teal", "yellow"] as const;

const BLURBS: Record<string, string> = {
  luggage: "Spinners and trunks, every variant measured against the cabin frame.",
  backpacks: "Packs that carry a day or a week and still sit under the seat.",
  totes: "Open carriers and duffels for the part of the trip that is not the case.",
  wallets: "Passports and cards kept flat and close.",
  accessories: "Cubes, tags, locks and pillows for the small hours of travel.",
};

export function Home() {
  const { data, error } = useData<CollectionSummary[]>("/api/collections");
  const [units, setUnits] = useState<Record<string, number>>({});
  useLive("collection", (event) => setUnits((current) => ({ ...current, [event.slug]: event.units })));

  const collections = (data ?? []).filter((c) => c.slug !== "all");

  return (
    <div className="page home">
      <Masthead />
      <section className="hero">
        <h1 className="hero-title">Carry what the trip needs</h1>
        <p className="hero-standfirst">Cases, packs and small goods, measured against the cabin frame before they reach the gate.</p>
      </section>
      {error && <ServerError />}
      {!data && !error && <Loading />}
      {collections.map((collection, index) => (
        <div key={collection.slug}>
          <Band
            collection={{ ...collection, units: units[collection.slug] ?? collection.units }}
            tone={BAND_TONES[collection.slug] ?? TONES[index % TONES.length] ?? "teal"}
            level={2}
          />
          <section className="text-page">
            <p className="text-page-copy">{BLURBS[collection.slug] ?? `${collection.designs} designs from Roam House.`}</p>
            <Link href={`/collections/${collection.slug}`} className="btn btn-primary">
              Browse {collection.name}
            </Link>
          </section>
        </div>
      ))}
    </div>
  );
}
