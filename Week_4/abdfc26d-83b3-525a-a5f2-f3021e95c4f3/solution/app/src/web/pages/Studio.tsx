import { useEffect, useState } from "react";
import { api, type Credits, type Plan, type StudioPiece } from "../api";
import { PlanList } from "../components/PlanList";
import { EmptyState, Icon } from "../components/ui";
import { Link } from "../router";

const STATE_WORDS: Record<StudioPiece["state"], string> = { draft: "Draft", published: "Published", withdrawn: "Withdrawn" };
const PLAN_NAMES: Record<Plan["code"], string> = { "studio-monthly": "Studio", "pro-monthly": "Pro" };

export function Studio() {
  const [pieces, setPieces] = useState<StudioPiece[] | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    void api<{ pieces: StudioPiece[] }>("GET", "/api/me/pieces").then((r) => r.ok && setPieces(r.data.pieces));
    void api<Credits>("GET", "/api/me/credits").then((r) => r.ok && setCredits(r.data));
    void api<{ plan: Plan | null }>("GET", "/api/me/plan").then((r) => r.ok && setPlan(r.data.plan));
  }, []);
  return (
    <div className="page studio-page">
      <header className="page-head">
        <p className="eyebrow"><span className="eyebrow-name">Studio</span></p>
        <h1 className="display display-md">Your pieces.</h1>
      </header>
      <div className="studio-summary">
        <div className="summary-card">
          <p className="summary-label">Credits</p>
          <p className="summary-figure tabular">{credits?.available ?? "—"}</p>
          <p className="muted tabular">{credits ? `${credits.held} reserved` : "Loading"}</p>
        </div>
        <div className="summary-card">
          <p className="summary-label">Plan</p>
          <p className="summary-figure">{plan && plan.state !== "ended" ? PLAN_NAMES[plan.code] : "None"}</p>
          <p className="muted">{plan?.state === "cancelling" ? `Ends on ${plan.ends_on}` : plan?.state === "pending_payment" ? "Waiting for Kill Bill" : plan?.state === "active" ? "Active" : "Credits by pack"}</p>
        </div>
        <Link to="/studio/credits" className="arrow-link">
          Plans and credits
          <Icon name="arrowRight" size={16} />
        </Link>
      </div>
      {pieces === null ? (
        <div className="table-skeleton" aria-busy="true" />
      ) : pieces.length === 0 ? (
        <EmptyState sentence="No pieces yet." action={<Link to="/#describe" className="button button-accent">Start a piece</Link>} />
      ) : (
        <table className="data-table stack-on-phone">
          <caption className="visually-hidden">Your pieces</caption>
          <thead>
            <tr><th scope="col">Piece</th><th scope="col">State</th><th scope="col" className="num">Version</th><th scope="col" className="num">Editions sold</th></tr>
          </thead>
          <tbody>
            {pieces.map((p) => (
              <tr key={p.slug}>
                <td data-label="Piece">
                  <Link to={`/studio/pieces/${p.slug}`} className="table-title">{p.title}</Link>
                  {p.remix_of ? <span className="muted"> · remix of {p.remix_of.title}</span> : null}
                </td>
                <td data-label="State"><span className={`badge badge-${p.state}`}>{STATE_WORDS[p.state]}</span></td>
                <td data-label="Version" className="num tabular">{p.version}</td>
                <td data-label="Editions sold" className="num tabular">{p.edition_count === null ? "—" : `${p.editions_sold} of ${p.edition_count}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function StudioCredits() {
  return (
    <div className="page credits-page">
      <header className="page-head">
        <p className="eyebrow"><span className="eyebrow-name">Studio · plans and credits</span></p>
        <h1 className="display display-md">Credits for every render.</h1>
        <p className="muted">A 720p second costs one credit and a 1080p second costs two. Credits arrive only once Kill Bill confirms the payment.</p>
      </header>
      <PlanList />
    </div>
  );
}
