// The dashboard (DP-48): the signed-in person's parts, review rooms and liked parts.
import { useEffect, useState } from "react";
import type { DashboardJson } from "../shared/api";
import { display } from "../shared/numbers";
import { get } from "./api";
import { PageHeading } from "./chrome";
import { Icon } from "./icons";
import { navigate } from "./router";
import { useSession } from "./session";
import { Link, stateLabel } from "./shell";

function Thumb({ digest }: { digest: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="row-thumb">
      {broken ? <span className="thumb-missing">Preview unavailable</span> : <img src={`/api/solids/${digest}/thumbnail.svg`} alt="" onError={() => setBroken(true)} />}
    </span>
  );
}

export function DashboardPage() {
  const { me, ready } = useSession();
  const [data, setData] = useState<DashboardJson | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!me) {
      navigate(`/signin?next=${encodeURIComponent("/dashboard")}`, true);
      return;
    }
    void get<DashboardJson>("/api/dashboard").then((reply) => reply.ok && setData(reply.data));
  }, [ready, me]);

  if (!data) return <div className="loading-page" aria-busy="true" />;
  return (
    <div className="page dashboard-page">
      <PageHeading>Dashboard</PageHeading>
      <section role="region" aria-label="My parts" className="dash-section">
        <h2>My parts</h2>
        {data.parts.length === 0 ? (
          <div className="empty">
            <Icon name="dimension" size={32} />
            <p>You have no parts yet.</p>
            <Link to="/" className="button">
              Browse the gallery
            </Link>
          </div>
        ) : (
          <ul className="rows">
            {data.parts.map((p) => (
              <li key={p.slug}>
                <Thumb digest={p.head.geometryDigest} />
                <div className="row-text">
                  <Link to={`/parts/${p.slug}`}>{p.title}</Link>
                  <span className="muted">{` · ${p.head.label} · ${display(p.revisionCount, 0)} ${p.revisionCount === 1 ? "revision" : "revisions"}`}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section role="region" aria-label="Review rooms" className="dash-section">
        <h2>Review rooms</h2>
        {data.rooms.length === 0 ? (
          <div className="empty">
            <Icon name="dimension" size={32} />
            <p>No review rooms yet.</p>
          </div>
        ) : (
          <ul className="rows">
            {data.rooms.map((r) => (
              <li key={r.id}>
                <Thumb digest={r.geometryDigest} />
                <div className="row-text">
                  <Link to={`/rooms/${r.id}`}>{r.title}</Link>
                  <span className="muted">{` · ${stateLabel(r.state)} · Approvals ${display(r.approvals, 0)} of ${display(r.requiredApprovals, 0)}`}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section role="region" aria-label="Liked parts" className="dash-section">
        <h2>Liked parts</h2>
        {data.liked.length === 0 ? (
          <div className="empty">
            <Icon name="dimension" size={32} />
            <p>You have not liked any parts yet.</p>
          </div>
        ) : (
          <ul className="rows">
            {data.liked.map((l) => (
              <li key={l.slug}>
                <Thumb digest={l.geometryDigest} />
                <div className="row-text">
                  <Link to={`/parts/${l.slug}`}>{l.title}</Link>
                  <span className="muted">{` · ${l.author}`}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
