import { Link2, Plus, Save, Share2, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Mascot } from "../icons";
import { useStore } from "../store";
import { IconButton } from "../ui/Pane";
import {
  clearRecipe, copyLink, keepMine, loadLatest, requireSignIn, setAutoBake,
} from "./actions";
import { AddOperationSheet } from "./AddOperationSheet";
import { bakeNow, stepNow } from "./bake";
import { ChangedDialog, SaveDialog, ShareDialog } from "./RecipeDialogs";
import { spanOf } from "./spanView";
import { StepCard } from "./StepCard";
import { activeTab, stepsKey, workbench } from "./state";

type Dialog = { kind: "save" } | { kind: "share" } | { kind: "stale"; message: string } | { kind: "sheet" } | null;

function RunFooter() {
  const bake = useStore(workbench, (state) => state.bake);
  const autoBake = useStore(workbench, (state) => state.autoBake);
  const paused = bake.phase === "paused";
  return (
    <div className="run-footer">
      <button type="button" className="step-run" onClick={stepNow}>Step</button>
      <button type="button" className="bake-pill" aria-label={paused ? "Resume" : "Bake"} aria-busy={bake.busy} onClick={bakeNow}>
        {bake.busy ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <>
            <Mascot size={24} />
            <span>{paused ? "Resume" : "Bake"}</span>
          </>
        )}
      </button>
      <div className="run-options">
        <label className="auto-bake">
          <input type="checkbox" checked={autoBake} onChange={(event) => setAutoBake(event.target.checked)} />
          <span>Auto-bake</span>
        </label>
        <div role="status" aria-label="Bake status" aria-live="off" className="bake-status">{bake.statusText}</div>
      </div>
    </div>
  );
}

function UpdateBanner() {
  const update = useStore(workbench, (state) => state.update);
  return (
    <div role="status" aria-label="Recipe update" className="update-banner" aria-live="off">
      {update && (
        <>
          <span>Recipe updated by {update.authorName}</span>
          <div className="banner-actions">
            <button type="button" onClick={() => void loadLatest()}>Load latest</button>
            <button type="button" onClick={keepMine}>Keep mine</button>
          </div>
        </>
      )}
    </div>
  );
}

export function RecipePane({ phone }: { phone: boolean }) {
  const steps = useStore(workbench, (state) => state.steps);
  const bake = useStore(workbench, (state) => state.bake);
  const binding = useStore(workbench, (state) => state.binding);
  const link = useStore(workbench, (state) => state.link);
  const tab = useStore(workbench, activeTab);
  const [dialog, setDialog] = useState<Dialog>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const span = useMemo(() => spanOf(steps, bake, tab), [steps, bake, tab]);
  const edited = binding !== null && stepsKey(steps) !== binding.savedKey;
  const line = binding ? `${binding.name} · version ${binding.baseVersion}${edited ? " · edited" : ""}` : "Unsaved recipe";
  const close = (): void => setDialog(null);

  const open = (kind: "save" | "share"): void => {
    if (requireSignIn()) setDialog({ kind });
  };

  return (
    <section role="region" aria-label="Recipe" tabIndex={-1} className="pane recipe">
      <div className="title-bar">
        <div className="title-stack">
          <h2 className="pane-title">Recipe</h2>
          <span className="recipe-line">{line}</span>
        </div>
        <div className="title-actions">
          <IconButton ref={saveButton} label="Save" onClick={() => open("save")}>
            <Save size={22} aria-hidden="true" />
          </IconButton>
          <IconButton label="Copy link" onClick={() => void copyLink()}>
            <Link2 size={22} aria-hidden="true" />
          </IconButton>
          <IconButton label="Share snapshot" onClick={() => open("share")}>
            <Share2 size={22} aria-hidden="true" />
          </IconButton>
          <IconButton label="Clear recipe" onClick={clearRecipe}>
            <Trash2 size={22} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <UpdateBanner />
      {link && (
        <div className="link-row">
          <input readOnly aria-label="Recipe link" value={link} onFocus={(event) => event.currentTarget.select()} />
        </div>
      )}
      <div className="pane-body recipe-body">
        {phone && (
          <button ref={addButton} type="button" className="add-operation" onClick={() => setDialog({ kind: "sheet" })}>
            <Plus size={18} aria-hidden="true" />
            <span>Add operation</span>
          </button>
        )}
        <ul role="list" aria-label="Recipe steps" className="steps">
          {steps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              index={index}
              chip={span?.chips[index] ?? null}
              current={bake.phase === "paused" && bake.current === index}
              failed={bake.phase === "error" && bake.errorStep === index}
            />
          ))}
        </ul>
        {steps.length === 0 && <p className="empty">No steps yet. Press / to find an operation.</p>}
      </div>
      <RunFooter />
      {dialog?.kind === "save" && (
        <SaveDialog onClose={close} returnFocus={saveButton} onStale={(message) => setDialog({ kind: "stale", message })} />
      )}
      {dialog?.kind === "stale" && <ChangedDialog message={dialog.message} onClose={close} returnFocus={saveButton} />}
      {dialog?.kind === "share" && <ShareDialog onClose={close} />}
      {dialog?.kind === "sheet" && <AddOperationSheet onClose={close} returnFocus={addButton} />}
    </section>
  );
}

