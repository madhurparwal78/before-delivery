import { useEffect, useState } from "react";
import type { PublicRoadmap } from "../../shared/api.js";
import { api, isFailure } from "../api.js";
import { RoadmapOrnament } from "../art.js";

export function PublicRoadmapPage({ token }: { token: string }) {
  const [roadmap, setRoadmap] = useState<PublicRoadmap | null>(null);
  const [inactive, setInactive] = useState(false);
  useEffect(() => {
    api.get<PublicRoadmap>(`/api/public/roadmap/${encodeURIComponent(token)}`).then(setRoadmap, (error: unknown) => {
      if (isFailure(error)) setInactive(true);
    });
  }, [token]);

  return (
    <div className="public">
      <main className="public-page">
        <header className="public-head">
          <RoadmapOrnament />
          <h1>{inactive ? "This roadmap link is no longer active" : "Product roadmap"}</h1>
          {!inactive && <p className="lede">What we are building next, month by month.</p>}
        </header>
        {roadmap?.columns.length === 0 && <p className="empty-line">Nothing is on the public roadmap yet.</p>}
        {roadmap?.columns.map((column) => (
          <section key={column.month} aria-label={column.label} className="public-month">
            <h2>{column.label}</h2>
            {column.releases.map((release) => (
              <article key={`${release.name}-${release.targetMonth}`} className="public-release">
                <h3>{release.name}</h3>
                {release.features.length === 0 ? <p className="empty-line">Details coming soon.</p> : (
                  <ul className="public-features">
                    {release.features.map((f) => (
                      <li key={f.name}>
                        <strong>{f.name}</strong>
                        {f.publicDescription && <span>{f.publicDescription}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
