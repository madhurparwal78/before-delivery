// The public tape address (DP-43..DP-45): a stored revision replayed one operation at a time.
import { useEffect, useMemo, useRef, useState } from "react";
import type { PartJson, TapeJson } from "../shared/api";
import { fixed } from "../shared/numbers";
import { parseTine, poseOfSolid, type Pose } from "../shared/tine";
import { get } from "./api";
import { BuildTape } from "./BuildTape";
import { PageHeading } from "./chrome";
import { useEpoch } from "./epoch";
import { ForkDialog } from "./partDialogs";
import { partAddress } from "./partAddress";
import { navigate } from "./router";
import { useSession } from "./session";
import { Link, NotFound } from "./shell";
import { useSnapshot } from "./solids";
import { Viewport } from "./viewport/Viewport";

export function TapePage({ revisionId }: { revisionId: string }) {
  const [state, setState] = useState<{ tape: TapeJson; part: PartJson } | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const tape = await get<TapeJson>(`/api/revisions/${revisionId}/tape`);
      if (!tape.ok) return alive && setState(null);
      const part = await get<PartJson>(`/api/parts/${tape.data.partSlug}?revision=${revisionId}`);
      if (alive) setState(part.ok ? { tape: tape.data, part: part.data } : null);
    })();
    return () => {
      alive = false;
    };
  }, [revisionId]);
  if (state === null) return <NotFound />;
  if (state === undefined) return <div className="loading-page" aria-busy="true" />;
  return <TapeView tape={state.tape} part={state.part} />;
}

function TapeView({ tape, part }: { tape: TapeJson; part: PartJson }) {
  const { me, storageDown } = useSession();
  const [k, setK] = useState(tape.n);
  const [epoch, bumpEpoch] = useEpoch(`tinework:epoch:tape:${tape.revisionId}`);
  const { snapshot, lastGood } = useSnapshot(tape, k, bumpEpoch);
  const [forking, setForking] = useState(false);
  const defaultPose = useRef<Pose | null>(null);
  if (snapshot && snapshot !== "outage" && !defaultPose.current) defaultPose.current = poseOfSolid(snapshot.scene.solid ?? { ops: [] });
  const shot = snapshot && snapshot !== "outage" ? snapshot : null;
  const owner = me?.id === part.owner.id;
  const model = useMemo(() => {
    const parsed = parseTine(part.source);
    return parsed.ok ? parsed.model : null;
  }, [part.source]);
  const lines = useMemo(() => part.source.split("\n").filter((_, i, all) => i < all.length - 1 || all[i] !== ""), [part.source]);
  const activeLine = tape.operations[k]?.line;
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = pane.current;
    const line = el?.querySelector<HTMLElement>('[data-line][aria-current="true"]');
    if (!el || !line) return;
    if (line.offsetTop < el.scrollTop) el.scrollTop = line.offsetTop;
    else if (line.offsetTop + line.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = line.offsetTop + line.offsetHeight - el.clientHeight;
  }, [activeLine]);

  const pins = (tape.preflight?.findings ?? []).filter((f) => f.severity !== "Pass" && f.operation <= k).map((f) => ({ id: `pin-${f.id}`, kind: "finding" as const, position: f.pose.target }));
  return (
    <div className="page tape-page">
      <header className="part-header">
        <PageHeading>{`${part.title} · ${part.revision.label} build tape`}</PageHeading>
        <p className="by muted">
          <Link to={partAddress(part.slug, { revision: part.revision.id })}>Open the part</Link>
        </p>
      </header>
      <div className="stage">
        <Viewport
          attrs={{
            "data-digest": shot?.digest,
            "data-volume": shot ? fixed(shot.measure.volume, 2) : undefined,
            "data-bbox": shot ? shot.measure.bbox.join(",") : undefined,
            "data-faces": shot?.measure.faces,
            "data-tape-operation": shot?.k,
            "data-epoch": epoch,
          }}
          scene={shot?.scene ?? null}
          defaultPose={defaultPose.current}
          pins={pins}
          outage={snapshot === "outage" ? { lastGood } : null}
          fallback={{ src: `/api/solids/${part.revision.geometryDigest}/thumbnail.svg`, alt: `${part.title}, ${part.revision.label}` }}
        />
        <BuildTape tape={tape} k={k} disabled={false} onChange={setK} onFork={owner ? () => setForking(true) : undefined} />
        {tape.preflight ? null : <p className="muted small">{`No pre-flight report for ${part.revision.label} yet.`}</p>}
      </div>
      <section className="source" role="region" aria-label="Source" tabIndex={0} ref={pane}>
        <ol>
          {lines.map((text, i) => (
            <li key={i} data-line={i + 1} aria-current={activeLine === i + 1 ? "true" : undefined}>
              <code>{text}</code>
            </li>
          ))}
        </ol>
      </section>
      {forking && model ? (
        <ForkDialog
          revisionId={tape.revisionId}
          operation={k}
          bodyIndex={model.bodyIndex}
          knownHead={part.headRevisionId}
          storageDown={storageDown}
          onClose={() => setForking(false)}
          onForked={(rev) => navigate(partAddress(part.slug, { revision: rev.id, operation: String(k) }))}
          onConflict={() => setForking(false)}
        />
      ) : null}
    </div>
  );
}
