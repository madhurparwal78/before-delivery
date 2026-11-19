import { useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

export function AlbumWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const [picked, setPicked] = useState<string | null>(null);
  const [pendingHole, setPendingHole] = useState<string | null>(null);
  const [holeError, setHoleError] = useState<string | null>(null);

  const album = state?.album;
  const candidates = state
    ? Object.entries(state.specimens).filter(
        ([, s]) =>
          s.owner === "dealer" &&
          s.attribution.register === "stored" &&
          s.attribution.certainty === "certain" &&
          !s.quarantined &&
          !s.missing &&
          s.status !== "reserved" &&
          s.status !== "outbound" &&
          s.status !== "transferred",
      )
    : [];

  const stageFill = (hole: string) => {
    if (!picked) return;
    const specimen = state?.specimens[picked];
    const holeRecord = album?.holes[hole];
    if (!holeRecord || !specimen) return;
    setHoleError(null);
    if (specimen.quarantined) {
      setHoleError(feedback("F_SET_UNCERTAIN"));
      desk.reportError(feedback("F_SET_UNCERTAIN"));
      return;
    }
    if (specimen.status === "reserved" || specimen.status === "outbound") {
      setHoleError(feedback("F_SET_OUTBOUND"));
      desk.reportError(feedback("F_SET_OUTBOUND"));
      return;
    }
    if (specimen.attribution.mintmark !== holeRecord.mintmark) {
      setHoleError(feedback("F_SET_MISMATCH"));
      desk.reportError(feedback("F_SET_MISMATCH"));
      return;
    }
    setPendingHole(hole);
  };

  const confirmFill = async () => {
    if (!pendingHole || !picked) return;
    const commandId = `album-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/album/holes/${encodeURIComponent(pendingHole)}/fill`, {
          command_id: commandId,
          expected_version: state?.versions.album,
          specimen: picked,
        });
        desk.announce(feedback("F_SET_OK"));
        setPendingHole(null);
        setPicked(null);
        await desk.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          desk.reportError(err.failure.body.message);
          return;
        }
        throw err;
      }
    });
  };

  return (
    <div aria-label="Album workspace" className="workspace-two-col">
      <div className="panel" aria-label="Album">
        <h3>{album?.set ? album.set : "Album"}</h3>
        {album &&
          Object.entries(album.holes).map(([hole, record]) => (
            <button
              key={hole}
              className={`album-hole${record.specimen ? " filled" : ""}`}
              aria-label={`Hole ${hole}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const key = e.dataTransfer.getData("text/plain");
                if (key) {
                  setPicked(key);
                  stageFill(hole);
                }
              }}
              onClick={() => stageFill(hole)}
            >
              <span className="hole-name">{record.specimen ? state?.specimens[record.specimen]?.display_label : `${hole} missing`}</span>
              <span className="hole-mintmark">Mintmark {record.mintmark}</span>
            </button>
          ))}
        {holeError && <span className="field-error">{holeError}</span>}
      </div>
      <div className="panel" aria-label="Candidates">
        <h3>Candidates</h3>
        {candidates.map(([key, s]) => (
          <button
            key={key}
            className={`specimen-chip${picked === key ? " picked" : ""}`}
            aria-label={`Specimen ${key}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", key);
              setPicked(key);
            }}
            onClick={() => setPicked(picked === key ? null : key)}
            onKeyDown={(e) => {
              if (e.key === " ") {
                e.preventDefault();
                setPicked(picked === key ? null : key);
              }
              if (e.key === "Escape") setPicked(null);
            }}
          >
            <span className="coin-disc">{s.attribution.mintmark}</span>
            <span>
              <span className="chip-label">{s.display_label}</span>
              <span className="chip-sub">{s.attribution.reference}</span>
            </span>
          </button>
        ))}
        <button className="btn btn-primary" aria-label="Review album placement" disabled={!picked || !pendingHole} onClick={() => setPendingHole(pendingHole)}>
          Review album placement
        </button>
      </div>
      {pendingHole && picked && (
        <ReviewDialog
          title="Fill album hole"
          summary={`Fill ${pendingHole} with ${state?.specimens[picked]?.display_label}.`}
          onConfirm={() => void confirmFill()}
          onCancel={() => setPendingHole(null)}
        />
      )}
    </div>
  );
}
