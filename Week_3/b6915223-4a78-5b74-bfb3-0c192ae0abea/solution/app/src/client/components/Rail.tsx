import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { lockedBanner } from "../format.ts";
import { useApp } from "../store.ts";
import { Modal } from "./Dialog.tsx";
import { LockIcon } from "./Icons.tsx";
import { RollingNumber } from "./Rolling.tsx";

// The ledger rail: a sticky column at 1280, a band of figures at 768, a bottom strip plus the
// "Ledger" sheet at 375 (brief: Screens and layout).
interface Figures {
  bank: string;
  squadValue: string;
  freeTransfers: string;
  hitCost: string;
  hitNegative: boolean;
  total: number;
  roll: number;
}

function FigureList({ figures, carriesTotal }: { figures: Figures; carriesTotal: boolean }) {
  return (
    <dl class="figures">
      <div>
        <dt>Bank</dt>
        <dd>{figures.bank}</dd>
      </div>
      <div>
        <dt>Squad value</dt>
        <dd>{figures.squadValue}</dd>
      </div>
      <div>
        <dt>Free transfers</dt>
        <dd>{figures.freeTransfers}</dd>
      </div>
      <div>
        <dt>Hit cost</dt>
        <dd class={figures.hitNegative ? "negative" : ""}>{figures.hitCost}</dd>
      </div>
      <div class="total">
        <dt>Gameweek total</dt>
        {carriesTotal ? (
          <dd data-gameweek-total="" data-points={String(figures.total)}>
            <RollingNumber value={figures.total} roll={figures.roll} />
          </dd>
        ) : (
          <dd>{figures.total}</dd>
        )}
      </div>
    </dl>
  );
}

export function Rail(props: { phone: boolean; figures: Figures; chips: ComponentChildren; children?: ComponentChildren }) {
  const [sheet, setSheet] = useState(false);
  if (!props.phone) {
    return (
      <aside class="rail panel" aria-label="Ledger">
        <FigureList figures={props.figures} carriesTotal />
        {props.chips}
        {props.children}
      </aside>
    );
  }
  return (
    <>
      <div class="ledger-strip">
        <dl>
          <div>
            <dt>Bank</dt>
            <dd>{props.figures.bank}</dd>
          </div>
          <div>
            <dt>Free transfers</dt>
            <dd>{props.figures.freeTransfers}</dd>
          </div>
          <div class="total">
            <dt>GW total</dt>
            <dd data-gameweek-total="" data-points={String(props.figures.total)}>
              <RollingNumber value={props.figures.total} roll={props.figures.roll} />
            </dd>
          </div>
        </dl>
        <button type="button" class="btn" onClick={() => setSheet(true)}>
          Ledger
        </button>
      </div>
      {sheet && (
        <Modal title="Ledger" sheet onClose={() => setSheet(false)}>
          {(close) => (
            <>
              <FigureList figures={props.figures} carriesTotal={false} />
              {props.chips}
              <div class="dialog-actions">
                <button type="button" class="btn" onClick={close}>
                  Close
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

export function LockedBanner() {
  const { gameweek } = useApp();
  if (!gameweek || gameweek.status === "open") return null;
  return (
    <div class="banner-slot">
      <div class="locked-banner" role="status" aria-label="Locked banner">
        <LockIcon />
        {lockedBanner(gameweek.number)}
      </div>
    </div>
  );
}

export function ViewSwitch({ view, onChange }: { view: "pitch" | "list"; onChange: (view: "pitch" | "list") => void }) {
  return (
    <div class="segmented" role="radiogroup" aria-label="View">
      {(["pitch", "list"] as const).map((option) => (
        <label key={option}>
          <input type="radio" name="board-view" value={option} checked={view === option} onChange={() => onChange(option)} />
          {option === "pitch" ? "Pitch" : "List"}
        </label>
      ))}
    </div>
  );
}
