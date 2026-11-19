// The programme: every performance in start order, with its tiers, prices and seats remaining.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatMoney } from "../../shared/rules.js";
import type { Performance } from "../../shared/types.js";
import { get } from "../api.js";
import { Link, VenueStart } from "../components.js";
import { useLive, useLoader } from "../live.js";

export function Programme(): JSX.Element {
  const [shows, setShows] = useState<Performance[] | null>(null);
  const refresh = useLoader(async () => {
    const found = await get<{ performances: Performance[] }>("/api/performances");
    if (found.ok) setShows(found.data.performances);
  });
  useEffect(refresh, []);
  useLive((event) => {
    if (event.type === "seats" || event.type === "performances" || event.type === "resync") refresh();
  });

  return (
    <div class="page-narrow programme">
      <div class="page-head">
        <p class="kicker">Halyard Hall · Season listing</p>
        <h1>Programme</h1>
      </div>
      {shows === null ? (
        <div aria-busy="true"><div class="skeleton-line" /><div class="skeleton-line" /><div class="skeleton-line" /></div>
      ) : (
        <div class="programme-list">
          {shows.map((show) => (
            <article class="programme-entry" key={show.id} aria-labelledby={`show-${show.id}`}>
              <p class="when"><VenueStart label={show.startsAtVenue} /></p>
              <div>
                <h2 id={`show-${show.id}`}>{show.title}</h2>
                <ul class="tier-lines">
                  {show.tiers.map((tier) => (
                    <li key={tier.id}>
                      <span>{tier.name}</span> <span class="amount">{formatMoney(tier.faceCents)}</span>{" "}
                      <span class="amount remaining">{tier.remaining === 0 ? "Sold out" : `${tier.remaining} left`}</span>
                    </li>
                  ))}
                </ul>
                {show.salesOpen ? null : <p class="sales-closed">Sales closed</p>}
              </div>
              <Link href={`/p/${show.id}?section=ST&seat=ST-A-15&tier=all`} class="button" aria-label={`Choose seats for ${show.title}`}>
                Choose seats
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
