// Shared desk parts: the workspace frame (list pane plus Inspector on desktop), fact boxes, the
// desktop Stock grid and Exchange list, specimen chips, coin discs and holders drawn to scale.

import { useEffect, useState, type ReactNode } from "react";
import { windowText } from "../shared/counts";
import { CELL_MM } from "../shared/limits";
import type { Holder, Offer, Specimen, SpecimenPage } from "../shared/types";
import { api } from "./api";
import { useDesk } from "./desk";
import { follow, navigate, useLayout, useLocation } from "./route";

export const label = (key: string) => `Specimen ${key}`;

/** Cells and holders share one drawing scale, the CSS length `--mm` (brief: drawn to their millimetre sizes at one scale). */
const mm = (millimetres: number) => `calc(${millimetres} * var(--mm))`;

export function Workspace({ name, heading, list, facts, className, children }: {
  name: string;
  heading: string;
  list: "stock" | "exchange";
  facts?: ReactNode;
  className: string;
  children: ReactNode;
}) {
  const layout = useLayout();
  const desktop = layout === "desktop";
  return (
    <section className={`workspace ${className}`} aria-label={name}>
      <h1 className="workspace-heading">{heading}</h1>
      <div className="workspace-body">
        <div className="list-pane">{list === "stock" ? <StockGrid /> : <ExchangeList />}</div>
        <div className="inspector" role={desktop ? "region" : undefined} aria-label={desktop ? "Inspector" : undefined}>
          <div className="panes">{children}</div>
          {facts && <div className="inspector-facts">{facts}</div>}
        </div>
      </div>
    </section>
  );
}

export function EmptyFacts({ heading, steps }: { heading: string; steps: [string, string] }) {
  return (
    <div className="fact-box">
      <h2>{heading}</h2>
      <ul>
        <li>{steps[0]}</li>
        <li>{steps[1]}</li>
      </ul>
    </div>
  );
}

/** G21 and G22 for one specimen: each face's stored photograph and the attribution it carries. */
export function FactBoxes({ specimenKey, specimen }: { specimenKey: string; specimen: Specimen | undefined }) {
  const face = (name: "obverse" | "reverse") => specimen?.photos.filter((p) => p.label === name).at(-1);
  const register = specimen?.attribution.register === "stored"
    ? `Register record ${specimen.attribution.reference} revision ${specimen.attribution.revision}`
    : "Catalog record pending";
  const box = (name: "obverse" | "reverse", title: string) => {
    const photo = face(name);
    return (
      <section className="fact-box" aria-label={title}>
        <h2>{`${label(specimenKey)} ${name}:`}</h2>
        {photo && specimen ? (
          <ul className="figures">
            <li>{`Photograph ${photo.width} × ${photo.height} px`}</li>
            <li>{`Stored as ${photo.sha256.slice(0, 12)}…`}</li>
            <li>{name === "obverse" ? register : `Holder: ${specimen.holder.kind} ${specimen.holder.width_mm} × ${specimen.holder.height_mm} mm`}</li>
            <li>{name === "obverse" ? `Mintmark ${specimen.attribution.mintmark ?? "not read"}` : `Status: ${specimen.status.replace("_", " ")}`}</li>
          </ul>
        ) : (
          <ul>
            <li>No stored photograph for this face yet.</li>
            <li>Take the face in at Intake to see its facts here.</li>
          </ul>
        )}
      </section>
    );
  };
  return (
    <div className="fact-pair">
      {box("obverse", "Obverse facts")}
      {box("reverse", "Reverse facts")}
    </div>
  );
}

/** A stroked coin disc with its mintmark, for chips. */
export function CoinDisc({ mintmark, size = 40 }: { mintmark: string | null; size?: number }) {
  return (
    <svg className="coin-disc" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="18" className="disc-face" />
      <circle cx="20" cy="20" r="14.5" className="disc-beads" />
      <text x="20" y="25" textAnchor="middle" className="disc-mark">
        {mintmark ?? "?"}
      </text>
    </svg>
  );
}

/** A holder drawn at the shared scale (a flip, a slab or a capsule) around a 38 mm coin. */
export function HolderShape({ holder, mintmark }: { holder: Holder; mintmark: string | null }) {
  return (
    <span
      className={`holder-shape holder-${holder.kind}`}
      style={{ width: mm(holder.width_mm), height: mm(holder.height_mm) }}
      aria-hidden="true"
    >
      <span className="holder-coin" style={{ width: mm(38), height: mm(38) }}>
        <CoinDisc mintmark={mintmark} size={40} />
      </span>
    </span>
  );
}

export const CELL_SIZE = mm(CELL_MM);

/** The specimen this Stock workspace shows: `?specimen=` or the first of the dealer's stock. */
export function useSelectedSpecimen(): [string | null, Specimen | undefined] {
  const { state } = useDesk();
  const { query } = useLocation();
  const asked = query.get("specimen");
  const key = asked && state?.specimens[asked] ? asked : (Object.entries(state?.specimens ?? {}).find(([, s]) => s.owner === "dealer")?.[0] ?? null);
  return [key, key ? state?.specimens[key] : undefined];
}

/** G33: the desktop Stock list of specimen chips, in capped pages that never repeat or skip. */
function StockGrid() {
  const { ns, state } = useDesk();
  const { route } = useLocation();
  const [cursors, setCursors] = useState<string[]>([""]);
  const [page, setPage] = useState<SpecimenPage | null>(null);
  const cursor = cursors.at(-1)!;
  useEffect(() => {
    let live = true;
    void api<SpecimenPage>("GET", `/api/desks/${ns}/specimens?limit=12${cursor ? `&after=${cursor}` : ""}`).then((r) => {
      if (live && r.ok) setPage(r.body);
    });
    return () => {
      live = false;
    };
  }, [ns, cursor, state?.version]);
  const slug = route.kind === "workspace" ? route.slug : "attribution";
  return (
    <section className="list-box" aria-label="Stock grid">
      <h2 className="box-heading">Stock:</h2>
      <ul className="chip-grid">
        {page?.items.map((item) => (
          <li key={item.key}>
            <button type="button" className="chip" onClick={() => navigate(`/desk/${ns}/${slug}?specimen=${encodeURIComponent(item.key)}`)}>
              <CoinDisc mintmark={item.attribution.mintmark} />
              <span className="chip-label">{label(item.key)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="pager">
        <button type="button" className="button quiet" disabled={cursors.length === 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
          Previous page
        </button>
        <button type="button" className="button quiet" disabled={!page?.next} onClick={() => page?.next && setCursors((c) => [...c, page.next!])}>
          Next page
        </button>
      </div>
    </section>
  );
}

/** G34: the desktop list of offers with each one's server-stated window. */
function ExchangeList() {
  const { ns, state } = useDesk();
  const { route, query } = useLocation();
  const slug = route.kind === "workspace" ? route.slug : "offers";
  const offers = Object.entries(state?.offers ?? {});
  return (
    <section className="list-box" aria-label="Exchange list">
      <h2 className="box-heading">Offers:</h2>
      {offers.length === 0 && <p className="caption-text">No offers yet.</p>}
      <ul className="offer-rows">
        {offers.map(([key, offer]) => (
          <li key={key} className={query.get("offer") === key ? "offer-row current" : "offer-row"}>
            <a href={`/desk/${ns}/${slug}?offer=${key}`} onClick={follow}>
              <span className="offer-key">{key}</span>
              <span className="offer-status">{offer.status}</span>
            </a>
            <span className="offer-items">
              {offer.dealer_items.map(label).join(", ") || "Nothing yet"} for {offer.counterpart_items.map(label).join(", ") || "nothing yet"}
            </span>
            {windowText(offer) && <span className="offer-window figures">{windowText(offer)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The offer an Exchange workspace shows: `?offer=`, else the newest offer in a status the workspace
 * acts on (offer assembly prefers the first draft).
 */
export function useSelectedOffer(statuses: readonly Offer["status"][], preferFirst = false): [string | null, Offer | undefined] {
  const { state } = useDesk();
  const { query } = useLocation();
  const offers = Object.entries(state?.offers ?? {}).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  const asked = query.get("offer");
  const matching = offers.filter(([, o]) => statuses.includes(o.status));
  const chosen = asked && state?.offers[asked] ? asked : ((preferFirst ? matching[0] : matching.at(-1))?.[0] ?? offers.at(-1)?.[0] ?? null);
  return [chosen, chosen ? state?.offers[chosen] : undefined];
}
