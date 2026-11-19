import { useEffect, useState } from "react";
import type { Pen, PenSummary } from "../../shared/types.js";
import { api } from "../api.js";
import { CrossfadeStage } from "../components/crossfade-stage.js";
import { PenRowItem, StatePanel } from "../components/panels.js";
import { Shell } from "../components/shell.js";
import { navigate, takeFlash } from "../router.js";
import { useRequireUser } from "../use-user.js";

export function DashboardPage(): React.JSX.Element {
  const user = useRequireUser();
  const [pens, setPens] = useState<PenSummary[] | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [message] = useState(() => takeFlash() ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user === null) return;
    void api.get<{ pens: PenSummary[] }>("/api/pens").then((answer) => setPens(answer.pens));
  }, [user]);

  const start = (): void => {
    setBusy(true);
    void api
      .post<Pen>("/api/pens")
      .then((pen) => navigate(`/pen/${pen.id}`))
      .finally(() => setBusy(false));
  };

  const shown = previewing ?? pens?.find((pen) => pen.head > 0)?.id ?? null;

  return (
    <Shell>
      <div className="split">
        <div className="split-stage">
          <CrossfadeStage penId={shown} label="Preview of the highlighted pen" />
        </div>
        <section className="split-column">
          <h1>Your pens</h1>
          <button type="button" className="button primary" onClick={start} disabled={busy} aria-busy={busy}>
            Start a pen
          </button>
          <p role="status" aria-label="Dashboard status" className="status-line">
            {message}
          </p>
          {pens === null ? (
            <StatePanel drawing={false}>Loading your pens…</StatePanel>
          ) : pens.length === 0 ? (
            <StatePanel>You have no pens yet. Start one, and every save becomes a version you can go back to.</StatePanel>
          ) : (
            <ul aria-label="Your pens" className="rows">
              {pens.map((pen) => (
                <PenRowItem key={pen.id} pen={pen} onPreview={setPreviewing} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
