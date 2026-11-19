/** /shared/<token>: the read-only partner view. It reads only the shared-link endpoint and carries no private data. */
import { useEffect, useState, type ReactNode } from "react";
import type { SharedUnit } from "../shared/api-types.js";
import { COPY } from "../shared/copy.js";
import { BAND_LABEL, VIEW_LABEL, bedroomLabel, type Band, type ViewTag } from "../shared/domain.js";
import { api, NetworkError } from "./api.js";
import { groupedNumber, officeTime } from "./format.js";

type Load = { kind: "loading" } | { kind: "dead" } | { kind: "live"; unit: SharedUnit; endsAt: string };

export const SharedPage = ({ token }: { token: string }): ReactNode => {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void api<{ unit: SharedUnit; endsAt: string }>("GET", `/api/shared/${encodeURIComponent(token)}`)
      .then((result) => {
        if (live) setLoad(result.ok ? { kind: "live", unit: result.body.unit, endsAt: result.body.endsAt } : { kind: "dead" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof NetworkError)) throw error;
        if (live) setLoad({ kind: "dead" });
      });
    return () => {
      live = false;
    };
  }, [token]);

  // The key keeps React from reusing the skeleton's node as the numeral, which would count as that node jumping down the page.
  if (load.kind === "loading") return <main className="shared-page" aria-busy="true"><div key="skeleton" className="skeleton-block" aria-hidden="true" /></main>;
  if (load.kind === "dead") {
    return (
      <main className="shared-page">
        <h1>{COPY.deadLink}</h1>
        <p>
          <a className="button" href="/finder">
            Open the finder
          </a>
        </p>
      </main>
    );
  }
  const { unit, endsAt } = load;
  return (
    <main className="shared-page">
      <div className="detail-numeral" aria-hidden="true" data-numeral={unit.floor} />
      <div className="shared-body">
        <h1>Home {unit.code}</h1>
        <div className="shared-lens">
          {unit.viewUrl && !photoFailed ? (
            <img src={unit.viewUrl} alt={`View from ${unit.code}`} draggable={false} onError={() => setPhotoFailed(true)} />
          ) : (
            <p className="lens-caption">{photoFailed ? COPY.photoDown : COPY.noPhoto}</p>
          )}
        </div>
        <ul className="facts">
          <li className="figures">
            {unit.areaM2} m² · {groupedNumber(unit.areaSqft)} sq ft
          </li>
          <li>{bedroomLabel(unit.bedrooms)}</li>
          <li className="figures">
            {unit.bearing}° {unit.facing}
          </li>
          <li>{VIEW_LABEL[unit.viewTag as ViewTag]}</li>
          <li>{BAND_LABEL[unit.band as Band]}</li>
        </ul>
        <p className="tag-line">{unit.viewPhotographed ? COPY.viewPhotographed : COPY.noViewPhotographed}</p>
        <p className="figures">Held until {officeTime(endsAt)}.</p>
      </div>
    </main>
  );
};
