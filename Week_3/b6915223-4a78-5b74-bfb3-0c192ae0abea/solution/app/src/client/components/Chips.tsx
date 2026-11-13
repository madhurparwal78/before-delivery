import { useState } from "preact/hooks";
import { CHIPS, type ChipCode, type SquadView } from "../../shared/api.ts";
import { request } from "../api.ts";
import { CHIP_ABOUT, CHIP_NAME } from "../format.ts";
import { Modal } from "./Dialog.tsx";

// The chips bar (brief: Interactions / Chips). Refusals carry the brief's copy in their message.

export function ChipsBar(props: { view: SquadView; editable: boolean; announce: (text: string, error?: boolean) => void; onChange: (view: SquadView) => void }) {
  const [asking, setAsking] = useState<ChipCode | null>(null);
  const [pending, setPending] = useState<{ chip: ChipCode; copy: string } | null>(null);
  const gameweek = props.view.gameweek;

  const outcome = (result: Awaited<ReturnType<typeof request<SquadView>>>, success: string) => {
    if (result.ok) {
      props.onChange(result.data);
      props.announce(success);
    } else {
      props.announce(result.error.message, true);
    }
  };

  const press = async (chip: ChipCode) => {
    if (props.view.chips[chip] !== "active") {
      setAsking(chip);
      return;
    }
    setPending({ chip, copy: "Cancelling…" });
    const result = await request<SquadView>("DELETE", `/api/chips/${gameweek}`);
    setPending(null);
    outcome(result, `${CHIP_NAME[chip]} cancelled.`);
  };

  const play = async (chip: ChipCode, close: () => void) => {
    setPending({ chip, copy: "Playing…" });
    const result = await request<SquadView>("POST", "/api/chips", { gameweek, chip });
    setPending(null);
    close();
    outcome(result, `${CHIP_NAME[chip]} played for gameweek ${gameweek}.`);
  };

  return (
    <div class="chips-block">
      <span class="label">Chips</span>
      <div class="chips" role="group" aria-label="Chips">
        {CHIPS.map((chip) => {
          const state = props.view.chips[chip];
          const busy = pending?.chip === chip;
          return (
            <button
              type="button"
              class="chip-btn"
              aria-pressed={state === "active" ? "true" : "false"}
              disabled={!props.editable || state === "used" || busy}
              onClick={() => void press(chip)}
            >
              <span class="chip-name">{CHIP_NAME[chip]}</span>
              {(busy || state !== "available") && <span class="chip-state">{busy ? pending.copy : state === "active" ? "Active" : "Used"}</span>}
            </button>
          );
        })}
      </div>
      {asking && (
        <Modal title={`Play ${CHIP_NAME[asking]}`} onClose={() => setAsking(null)}>
          {(close) => (
            <>
              <p>{CHIP_ABOUT[asking]}</p>
              <div class="dialog-actions">
                <button type="button" class="btn" onClick={close}>
                  Not now
                </button>
                <button type="button" class="btn btn-primary" disabled={pending?.chip === asking} onClick={() => void play(asking, () => setAsking(null))}>
                  {pending?.chip === asking ? "Playing…" : `Play ${CHIP_NAME[asking]}`}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
