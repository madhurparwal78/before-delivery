// The inspector view: one truck's commissary visits, read-only, from its own two API paths only.
import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import type { InspectorView } from "../../shared/api.ts";
import { api, download, errorCopy } from "../api.ts";
import { OverdueNotice, VisitTable } from "../VisitTable.tsx";

const VISITS_REFRESH_MS = 60_000;

type State = { kind: "loading" } | { kind: "view"; view: InspectorView } | { kind: "dead"; heading: string };

const DEAD: Record<string, string> = {
  link_expired: "This link has expired",
  link_revoked: "This link was revoked",
  not_found: "Link not found",
};

export function Inspect({ token }: { token: string }): ReactNode {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pdfError, setPdfError] = useState<string | null>(null);
  const base = `/api/inspect/${encodeURIComponent(token)}`;

  useEffect(() => {
    const load = (): void => {
      void api<InspectorView>(base).then((result) => {
        if (result.ok) setState({ kind: "view", view: result.data });
        else if (result.status === 404 || result.status === 410) setState({ kind: "dead", heading: DEAD[result.error?.code ?? ""] ?? "Link not found" });
      });
    };
    load();
    const id = setInterval(load, VISITS_REFRESH_MS);
    return () => clearInterval(id);
  }, [base]);

  return (
    <>
      <header className="header">
        <p className="wordmark">Pilotlight</p>
      </header>
      <main className="main screen inspect">
        {state.kind === "dead" && <h1 className="screen-title">{state.heading}</h1>}
        {state.kind === "view" && (
          <>
            <div className="inspect-top">
              <div className="inspect-head">
                <h1 className="screen-title">{state.view.truck.name} commissary visits</h1>
                <p className="lede">
                  Commissary: {state.view.commissary.site_name}, {state.view.commissary.address}
                </p>
                <p className="lede">Operator: {state.view.operator.business_name}</p>
                <p className="meta">
                  Permit <span className="mono">{state.view.truck.permit_number}</span>
                </p>
              </div>
              <div className="inspect-side">
                <OverdueNotice overdue={state.view.overdue} lastDepartedAt={state.view.last_departed_at} timeZone={state.view.commissary.time_zone} />
                <a
                  className="button button-primary download-pdf"
                  href={`${base}/log.pdf`}
                  onClick={async (event) => {
                    event.preventDefault();
                    setPdfError(null);
                    const result = await download(`${base}/log.pdf`);
                    if (!result.ok) setPdfError(errorCopy(result, { storage_unavailable: "The PDF can't be downloaded right now. The table above is current." }));
                  }}
                >
                  <FileText aria-hidden="true" size={16} /> Download PDF
                </a>
                {pdfError && <p className="field-error">{pdfError}</p>}
              </div>
            </div>
            <VisitTable name="Commissary visits" visits={state.view.visits} timeZone={state.view.commissary.time_zone} />
          </>
        )}
      </main>
    </>
  );
}
