import { useState } from "react";
import { failureText, post } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { navigate } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, loadingScreen, useLoad } from "../../lib/ui.js";
import { AddItemDialog, AddRelationshipDialog, MaintenanceDialog } from "./dialogs.js";
import { MapCanvas } from "./MapCanvas.js";
import { loadMap, type MapData } from "./mapData.js";
import { NodeDetails } from "./NodeDetails.js";

type Dialog = "item" | "relationship" | "maintenance" | null;

function MapView({ data, reload }: { data: MapData; reload: () => void }): JSX.Element {
  const session = useSession();
  const [current, setCurrent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = session.user?.roles ?? [];
  const canMark = session.isOperator || roles.includes("technician");
  const expandedCi = data.cis.find((ci) => ci.name === expanded) ?? null;
  const openProposals = data.proposals.filter((proposal) => proposal.status === "open");

  const toggle = (name: string): void => {
    setError(null);
    if (expanded === name && !closing) {
      setClosing(true);
      return;
    }
    setExpanded(name);
    setClosing(false);
  };

  const finish = (): void => {
    setDialog(null);
    reload();
  };

  const mark = (status: "down" | "degraded" | "healthy"): void => {
    if (!expandedCi || busy) return;
    setBusy(true);
    setError(null);
    post(`/api/cis/${encodeURIComponent(expandedCi.name)}/status`, { status }).then(
      () => {
        setBusy(false);
        reload();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failureText(failure));
      },
    );
  };

  const decide = (id: number, action: "promote" | "reject"): void => {
    setError(null);
    post<{ record?: { number: string } }>(`/api/major-proposals/${id}/${action}`, action === "reject" ? { reason: "" } : {}).then(
      (answer) => {
        if (answer.record) navigate(`/desk/major/${answer.record.number}`);
        else reload();
      },
      (failure: unknown) => {
        setError(failureText(failure));
        reload();
      },
    );
  };

  return (
    <main className="page map-page">
      <h1 className="subject">Service map</h1>
      <section className="rest" aria-label="Map">
        {session.isOperator ? (
          <div className="map-tools">
            <Button onClick={() => setDialog("item")}>Add item</Button>
            <Button onClick={() => setDialog("relationship")}>Add relationship</Button>
          </div>
        ) : null}
        {openProposals.map((proposal) => (
          <section key={proposal.id} className="map-proposal" aria-label="Major incident proposal">
            <div>
              <p className="proposal-line">Major incident proposed for {proposal.ci}.</p>
              <p className="proposal-reason">{proposal.reason}</p>
            </div>
            {session.isOperator ? (
              <div className="row">
                <Button onClick={() => decide(proposal.id, "promote")}>Promote to major incident</Button>
                <Button variant="outline" onClick={() => decide(proposal.id, "reject")}>
                  Reject proposal
                </Button>
              </div>
            ) : null}
          </section>
        ))}
        {expandedCi === null && error ? <p className="form-error">{error}</p> : null}
        <div className="map-layout">
          <MapCanvas data={data} current={current} expanded={expanded} onCurrent={setCurrent} onToggle={toggle} />
          <aside className="map-side">
            {expandedCi ? (
              <NodeDetails
                key={expandedCi.name}
                ci={expandedCi}
                edges={data.edges.filter((edge) => edge.source === expandedCi.name || edge.target === expandedCi.name)}
                proposal={openProposals.find((proposal) => proposal.ci === expandedCi.name) ?? null}
                closing={closing}
                canMark={canMark}
                canSchedule={session.isOperator}
                busy={busy}
                error={error}
                onMark={mark}
                onSchedule={() => setDialog("maintenance")}
                onClosed={() => {
                  setExpanded(null);
                  setClosing(false);
                }}
              />
            ) : (
              <p className="side-hint">Choose an item to see who uses it, what it depends on and its status.</p>
            )}
          </aside>
        </div>
      </section>
      {dialog === "item" ? <AddItemDialog onClose={() => setDialog(null)} onDone={finish} /> : null}
      {dialog === "relationship" ? (
        <AddRelationshipDialog items={data.nodes.map((node) => node.name)} from={expanded ?? ""} onClose={() => setDialog(null)} onDone={finish} />
      ) : null}
      {dialog === "maintenance" && expandedCi ? (
        <MaintenanceDialog item={expandedCi.name} zone={session.user?.time_zone ?? "UTC"} onClose={() => setDialog(null)} onDone={finish} />
      ) : null}
    </main>
  );
}

export function ServiceMap(): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(loadMap, [session.accessVersion, session.workspace]);
  useTopics(["list:ci"], reload);
  if (state.status !== "ready") return loadingScreen(state, "Service map", reload) as JSX.Element;
  return <MapView data={state.data} reload={reload} />;
}
