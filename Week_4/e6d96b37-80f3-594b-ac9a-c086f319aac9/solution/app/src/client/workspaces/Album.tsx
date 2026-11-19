// Album: fill a register-defined hole from the dealer's specimens through "Fill album hole".
// Open holes read as named missing issues with their mintmark, in a dashed outline.

import { useState } from "react";
import { jsonCommand } from "../commands";
import { useDesk } from "../desk";
import { useMoves } from "../moves";
import { CoinDisc, EmptyFacts, FactBoxes, label, Workspace } from "../parts";
import { Review } from "../Review";

interface Staged {
  specimen: string;
  hole: string;
}

const STATUS_WORDS: Record<string, string> = {
  quarantined: "Quarantined",
  reserved: "Reserved",
  outbound: "Outbound",
  pending_catalogue: "Catalog pending",
};

export function Album() {
  const { state, send } = useDesk();
  const [staged, setStaged] = useState<Staged | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [holeError, setHoleError] = useState<{ hole: string; copy: string } | null>(null);
  const moves = useMoves((source, destination) => {
    setStaged({ specimen: source, hole: destination.slice("hole:".length) });
    setHoleError(null);
  });
  if (!state) return null;
  const album = "holes" in state.album ? state.album : null;
  const candidates = Object.entries(state.specimens).filter(([, s]) => s.owner === "dealer" && s.status !== "transferred");

  const confirm = async () => {
    const plan = staged!;
    const outcome = await send(jsonCommand("fill", "POST", `/album/holes/${encodeURIComponent(plan.hole)}/fill`, { expected_version: state.versions.album, specimen: plan.specimen }));
    if (outcome.ok) setStaged(null);
    else if (outcome.error?.fields?.specimen) setHoleError({ hole: plan.hole, copy: outcome.error.fields.specimen });
    return "close" as const;
  };

  return (
    <Workspace name="Album workspace" heading={album ? `Album · ${album.set}` : "Album"} list="stock" className="ws-album" facts={<FactBoxes specimenKey={staged?.specimen ?? candidates[0]?.[0] ?? "A"} specimen={state.specimens[staged?.specimen ?? candidates[0]?.[0] ?? "A"]} />}>
      <div className="area-holes album-box">
        {album ? (
          <ul className="holes">
            {Object.entries(album.holes).map(([name, hole]) => {
              const filling = staged?.hole === name ? staged.specimen : hole.specimen;
              return (
                <li key={name}>
                  <button
                    type="button"
                    className={filling ? (staged?.hole === name ? "hole staged" : "hole filled") : "hole open"}
                    {...moves.destination(`hole:${name}`)}
                  >
                    <span className="sr-only">{`Hole ${name}`}</span>
                    <span className="hole-label" aria-hidden="true">{name}</span>
                    <span className="hole-mark" aria-hidden="true">
                      <CoinDisc mintmark={hole.mintmark} size={34} />
                    </span>
                    <span className="hole-text" aria-hidden="true">
                      {filling ? `${label(filling)}${staged?.hole === name ? " (staged)" : ""}` : `Missing ${hole.reference}, mintmark ${hole.mintmark}`}
                    </span>
                  </button>
                  {holeError?.hole === name && <p className="field-error">{holeError.copy}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyFacts heading="Album:" steps={["The register has not supplied this album's holes yet.", "Holes appear here once the register record is stored."]} />
        )}
      </div>
      <div className="area-chips chip-box">
        <h2 className="box-heading">Candidates:</h2>
        <ul className="chips">
          {candidates.map(([key, s]) => (
            <li key={key}>
              <button type="button" className="chip" {...moves.source(key)}>
                <CoinDisc mintmark={s.attribution.mintmark} />
                <span className="chip-label">{label(key)}</span>
                {STATUS_WORDS[s.status] && <span className="chip-status" aria-hidden="true">{STATUS_WORDS[s.status]}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review album placement
        </button>
      </div>
      {reviewing && (
        <Review
          label="Fill album hole"
          onClose={() => setReviewing(false)}
          onConfirm={confirm}
          confirmDisabled={!staged}
          summary={
            staged ? (
              <p>
                Fills <strong>Hole {staged.hole}</strong> with <strong>{label(staged.specimen)}</strong>.
              </p>
            ) : (
              <p>No specimen is staged. Move a specimen onto a hole first.</p>
            )
          }
        />
      )}
    </Workspace>
  );
}
