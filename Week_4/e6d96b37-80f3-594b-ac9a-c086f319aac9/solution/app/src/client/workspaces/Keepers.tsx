// Keeper preferences: rank duplicates of one issue, confirm the order, or undo the last move.
// Every chip shows its stored obverse at one image scale so the wear can be compared.

import { useState } from "react";
import { draftKey } from "../../shared/drafts";
import { jsonCommand } from "../commands";
import { useDesk } from "../desk";
import { useDraft } from "../drafts";
import { FactBoxes, label, Workspace } from "../parts";
import { useReorder } from "../reorder";
import { Review } from "../Review";
import { CoinImage } from "../viewers";

export function Keepers() {
  const { ns, state, send, announce } = useDesk();
  const [staged, setStaged, clearStaged] = useDraft<string[] | null>(draftKey(ns, "keepers", "order"), null);
  const [mode, setMode] = useState<"save" | "undo" | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const saved = state?.keeper_order ?? [];
  const valid = staged !== null && staged.length === saved.length && staged.every((k) => saved.includes(k));
  const order = valid ? staged : saved;
  const { item } = useReorder({ order, setOrder: setStaged, label, announce });
  if (!state) return null;
  const shown = focused ?? order[0] ?? null;
  const obverseOf = (key: string) => state.specimens[key]?.photos.filter((p) => p.label === "obverse").at(-1);

  const confirm = async () => {
    const outcome =
      mode === "undo"
        ? await send(jsonCommand("undo", "POST", "/keeper-order/undo", { expected_version: state.versions.keeper_order }))
        : await send(jsonCommand("keeper", "PUT", "/keeper-order", { expected_version: state.versions.keeper_order, order }));
    if (outcome.ok || (outcome.status === 409 && mode === "save")) clearStaged();
    return "close" as const;
  };

  const focusedPhoto = shown ? obverseOf(shown) : undefined;
  return (
    <Workspace name="Keeper preference workspace" heading="Keeper preferences" list="stock" className="ws-keepers" facts={shown && <FactBoxes specimenKey={shown} specimen={state.specimens[shown]} />}>
      <div className="area-list list-box">
        <ul className="keeper-list" aria-label="Keeper preference">
          {order.map((key, index) => {
            const photo = obverseOf(key);
            return (
              <li key={key} className="keeper-item">
                <span className="keeper-rank figures">{index + 1}</span>
                <span className="keeper-photo">{photo && <CoinImage photo={photo} alt={`${label(key)} obverse`} displayWidth={96} />}</span>
                <span className="keeper-meta">
                  <button type="button" className="chip keeper-chip" onFocus={() => setFocused(key)} {...item(key)}>
                    <span className="chip-label">{label(key)}</span>
                    <span className="chip-status" aria-hidden="true">{state.specimens[key]?.holder.kind}</span>
                  </button>
                  {index === 0 && <span className="badge">Keeper</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {valid && <p className="caption-text">Staged order, not saved yet.</p>}
      </div>
      <div className="area-focus keeper-focus">
        {shown && focusedPhoto && (
          <figure>
            <CoinImage photo={focusedPhoto} alt={`${label(shown)} obverse`} displayWidth={192} />
            <figcaption>{label(shown)} at keeper scale</figcaption>
          </figure>
        )}
      </div>
      <div className="area-undo actions">
        <button type="button" className="button quiet" onClick={() => setMode("undo")}>
          Undo last move
        </button>
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setMode("save")}>
          Review keeper order
        </button>
      </div>
      {mode && (
        <Review
          label="Save keeper order"
          onClose={() => setMode(null)}
          onConfirm={confirm}
          summary={
            mode === "undo" ? (
              <p>Restores the keeper order from before the last confirmed move.</p>
            ) : (
              <ol className="review-order">
                {order.map((key, index) => (
                  <li key={key}>
                    {label(key)}
                    {index === 0 ? " (Keeper)" : ""}
                  </li>
                ))}
              </ol>
            )
          }
        />
      )}
    </Workspace>
  );
}
