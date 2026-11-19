import { useLayoutEffect, useRef } from "react";
import type { CiJson } from "../../../server/cis.js";
import type { ProposalJson } from "../../../server/major.js";
import { animate, Button, StatusBlock } from "../../lib/ui.js";
import { NODE_HEIGHT, STATUS_LABELS, sentence, type MapEdge } from "./mapData.js";

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function attributeText(value: unknown): string {
  return typeof value === "boolean" ? yesNo(value) : String(value);
}

/**
 * The details region of one expanded node. Opening grows its height from the node's height to its full height over 420 ms;
 * closing reverses that, then reports that it is gone. Under reduced motion both happen at once.
 */
export function NodeDetails({
  ci,
  edges,
  proposal,
  closing,
  canMark,
  canSchedule,
  busy,
  error,
  onMark,
  onSchedule,
  onClosed,
}: {
  ci: CiJson;
  edges: MapEdge[];
  proposal: ProposalJson | null;
  closing: boolean;
  canMark: boolean;
  canSchedule: boolean;
  busy: boolean;
  error: string | null;
  onMark: (status: "down" | "degraded" | "healthy") => void;
  onSchedule: () => void;
  onClosed: () => void;
}): JSX.Element {
  const region = useRef<HTMLElement>(null);
  const full = useRef(0);
  const closed = useRef(onClosed);
  closed.current = onClosed;

  useLayoutEffect(() => {
    const node = region.current!;
    full.current = node.offsetHeight;
    animate(node, [{ height: `${NODE_HEIGHT}px`, overflow: "hidden" }, { height: `${full.current}px`, overflow: "hidden" }], 420);
  }, []);

  useLayoutEffect(() => {
    if (!closing) return;
    const run = animate(region.current, [{ height: `${full.current}px`, overflow: "hidden" }, { height: `${NODE_HEIGHT}px`, overflow: "hidden" }], 420);
    if (!run) {
      closed.current();
      return;
    }
    void run.finished.then(
      () => closed.current(),
      () => undefined,
    );
  }, [closing]);

  const outgoing = edges.filter((edge) => edge.source === ci.name);
  const incoming = edges.filter((edge) => edge.target === ci.name);
  const attributes = Object.entries(ci.attributes).filter(([, value]) => value !== null && value !== undefined && value !== "");

  return (
    <section ref={region} className="map-region" aria-label={`${ci.name} details`}>
      <header className="details-head">
        <h2>{ci.name}</h2>
        <StatusBlock>{STATUS_LABELS[ci.effective_status]}</StatusBlock>
      </header>
      {proposal ? <p className="details-proposal">Major incident proposed for {ci.name}.</p> : null}
      <dl className="details-list">
        <dt>Class</dt>
        <dd>{ci.class}</dd>
        <dt>Marked as</dt>
        <dd>{sentence(ci.status)}</dd>
        <dt>Criticality</dt>
        <dd>{ci.criticality}</dd>
        <dt>Business critical</dt>
        <dd>{yesNo(ci.business_critical)}</dd>
        <dt>Owner department</dt>
        <dd>{ci.owner_department}</dd>
        {attributes.map(([name, value]) => (
          <div key={name} className="details-pair">
            <dt>{sentence(name)}</dt>
            <dd>{attributeText(value)}</dd>
          </div>
        ))}
      </dl>
      <h3>Who uses it</h3>
      {ci.used_by.departments.length + ci.used_by.people.length === 0 ? (
        <p>No department or person uses this item directly.</p>
      ) : (
        <ul className="details-items">
          {ci.used_by.departments.map((name) => (
            <li key={`d-${name}`}>{name} department</li>
          ))}
          {ci.used_by.people.map((name) => (
            <li key={`p-${name}`}>{name}</li>
          ))}
        </ul>
      )}
      <h3>Relationships</h3>
      {outgoing.length + incoming.length === 0 ? (
        <p>No relationships yet.</p>
      ) : (
        <ul className="details-items">
          {outgoing.map((edge) => (
            <li key={`o-${edge.type}-${edge.target}`}>
              {edge.type} {edge.target}
            </li>
          ))}
          {incoming.map((edge) => (
            <li key={`i-${edge.source}-${edge.type}`}>
              {edge.source} {edge.type} this item
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="form-error">{error}</p> : null}
      {canMark || canSchedule ? (
        <div className="details-actions">
          {canMark ? (
            <>
              <Button busy={busy} onClick={() => onMark("down")}>
                Mark down
              </Button>
              <Button busy={busy} onClick={() => onMark("degraded")}>
                Mark degraded
              </Button>
              <Button busy={busy} onClick={() => onMark("healthy")}>
                Mark healthy
              </Button>
            </>
          ) : null}
          {canSchedule ? (
            <Button variant="outline" onClick={onSchedule}>
              Schedule maintenance
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
