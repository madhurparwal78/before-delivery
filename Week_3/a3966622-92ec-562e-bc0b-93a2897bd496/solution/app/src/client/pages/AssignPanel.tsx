// The assignment panel: each pilot's turn position and verdict from the server, the next eligible
// pilot preselected, a dispatcher note and, for a pilot breaching rest, an immediate-safety reason.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { Eligibility, Move, TurnEntry } from "../../shared/types";
import { get, NO_REPLY, request, useKeyedControl } from "../api";
import { Panel } from "../ui/Panel";
import type { Live } from "../ui/live";
import { clockOf } from "../ui/format";

export interface AssignTarget {
  ref: string;
  version: number;
  vessel: string;
}

function verdict(entry: TurnEntry, next: string | null): ReactNode {
  if (entry.pilot_id === next) return "Next eligible";
  if (entry.reasons.length === 0) return "Eligible, behind the next";
  const words: Record<string, ReactNode> = {
    licence: "Licence does not cover this vessel",
    rest: entry.rest_until ? (
      <>
        Rest breach - rest until <span className="num">{clockOf(entry.rest_until)}</span> port time
      </>
    ) : (
      "Rest breach - too little rest before or after this duty"
    ),
    night_rest: "Night rest breach - 12 hours owed after a third night",
    rota_days: "Rota breach - over 15 consecutive duty days",
  };
  return entry.reasons.map((r, i) => (
    <Fragment key={r}>
      {i > 0 ? "; " : null}
      {words[r] ?? r}
    </Fragment>
  ));
}

interface AssignPanelProps {
  target: AssignTarget | null;
  announcements: Live;
  onClose: () => void;
  onAssigned: (move: Move) => void;
  onStale: () => void;
}

export function AssignPanel({ target, announcements, onClose, onAssigned, onStale }: AssignPanelProps) {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const keyedControl = useKeyedControl();
  const ref = target?.ref ?? null;

  useEffect(() => {
    if (!ref) return;
    setEligibility(null);
    setChosen(null);
    setNote("");
    setReason("");
    void get<Eligibility>(`/api/moves/${encodeURIComponent(ref)}/eligibility`).then((outcome) => {
      if (outcome.kind !== "ok") return;
      setEligibility(outcome.data);
      setChosen((c) => c ?? outcome.data.next_eligible);
    });
  }, [ref]);

  const pick = eligibility?.turn.find((t) => t.pilot_id === chosen) ?? null;
  const breaching = pick?.rest_breach ?? false;

  const assign = async (): Promise<void> => {
    if (!target || !pick) return;
    const body: Record<string, string> = { pilot_id: pick.pilot_id };
    if (note.trim()) body.note = note;
    if (breaching && reason !== "") body.rest_override_reason = reason;
    const key = keyedControl.begin({ body, version: target.version });
    if (key === null) return;
    announcements.say("Assigning pilot...");
    const outcome = await request<Move>(`/api/moves/${encodeURIComponent(target.ref)}/assignment`, { body, key, ifMatch: target.version });
    keyedControl.end(outcome);
    if (outcome.kind === "no-reply") {
      announcements.say(NO_REPLY);
      return;
    }
    if (outcome.kind === "ok") {
      announcements.say(`Pilot ${pick.name} assigned to ${target.ref}`);
      onAssigned(outcome.data);
      return;
    }
    const error = outcome.error;
    const { turn, next_eligible: next } = error;
    if (turn && next !== undefined) setEligibility((e) => (e ? { ...e, turn, next_eligible: next } : e));
    const copy: Record<string, string> = {
      licence_not_covering: `Pilot ${pick.name} is not licensed for this vessel. Fresh turn list shown.`,
      not_next_in_turn: `Pilot ${pick.name} is not next eligible. Fresh turn list shown.`,
      rest_breach: "Rest rules not met. Type an immediate-safety reason to override.",
      validation_failed: "Override reason not accepted. Type 10 to 500 characters for a pilot breaching rest.",
    };
    const message = copy[error.error];
    if (message) {
      announcements.say(message);
      return;
    }
    announcements.say("Another dispatcher changed this move. Fresh data shown.");
    onStale();
  };

  return (
    <Panel open={target !== null} label="Assign pilot" variant="dialog" onClose={onClose}>
      <header className="panel-head">
        <h2>Assign pilot</h2>
        <p className="muted">
          {target?.ref} · {target?.vessel}
        </p>
      </header>
      <form
        className="panel-body assign-body"
        onSubmit={(event) => {
          event.preventDefault();
          void assign();
        }}
      >
        <div className="assign-scroll">
        <fieldset role="radiogroup" aria-label="Pilot" className="pilots">
          <legend>Pilot, in turn order</legend>
          {eligibility ? (
            [...eligibility.turn]
              .sort((a, b) => a.position - b.position)
              .map((entry) => (
                <label key={entry.pilot_id} className={entry.reasons.length ? "pilot-row blocked" : "pilot-row"} data-checked={chosen === entry.pilot_id || undefined}>
                  <input
                    type="radio"
                    name="pilot"
                    value={entry.pilot_id}
                    checked={chosen === entry.pilot_id}
                    onChange={() => setChosen(entry.pilot_id)}
                  />
                  <span className="pilot-name">{entry.name}</span>
                  <span className="num pos">{entry.position}</span>
                  <span className="pilot-class">Class {entry.licence_class}</span>
                  <span className="pilot-verdict">{verdict(entry, eligibility.next_eligible)}</span>
                </label>
              ))
          ) : (
            <p className="muted">Reading the turn list</p>
          )}
        </fieldset>
        <label className="field">
          <span>Dispatcher note</span>
          <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {breaching ? (
          <label className="field">
            <span>Rest override reason</span>
            <textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="override-help" />
            <span id="override-help" className="muted">
              Immediate safety only, 10 to 500 characters. Attributed to you and shown only to dispatchers.
            </span>
          </label>
        ) : null}
        </div>
        <div className="panel-actions panel-foot">
          <button type="submit" className="primary">
            Assign
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Close assignment
          </button>
        </div>
      </form>
    </Panel>
  );
}
