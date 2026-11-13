// Status actions on a move. Present only when the status the screen last confirmed permits them;
// each is keyed, so a retry after a lost reply shows the server's original result.
import { useCallback, useEffect, useState } from "react";
import type { Move, MoveAction } from "../../shared/types";
import { get, NO_REPLY, request, useKeyedControl, type Outcome } from "../api";
import { statusText } from "./format";
import type { Live } from "./live";

const REREAD_MS = 30_000;

/**
 * A move as last confirmed by the server: re-read every 30 seconds after the last read or action,
 * and at once after an action of the user's own that received a reply.
 */
export function useConfirmedMove(ref: string | null) {
  const [move, setMove] = useState<Move | null | "missing">(null);
  const [beat, setBeat] = useState(0);
  const reread = useCallback(async () => {
    if (!ref) return;
    const outcome = await get<Move>(`/api/moves/${encodeURIComponent(ref)}`);
    if (outcome.kind === "ok") setMove(outcome.data);
    else if (outcome.kind === "refused" && outcome.error.error === "not_found") setMove("missing");
    setBeat((b) => b + 1);
  }, [ref]);
  useEffect(() => {
    setMove(null);
    void reread();
  }, [reread]);
  useEffect(() => {
    const timer = window.setTimeout(() => void reread(), REREAD_MS);
    return () => window.clearTimeout(timer);
  }, [beat, reread]);
  /** Restarts the 30-second wait without reading (after a request that got no reply). */
  const touch = useCallback(() => setBeat((b) => b + 1), []);
  return { move, setMove, reread, touch };
}

interface ActionProps {
  move: Move;
  announcements: Live;
  onReply: () => void;
  onNoReply: () => void;
}

type Action = { label: string; path: "transitions" | "detention"; body: Record<string, string> };

/** The status controls, shown for the actions the server says this user may take now. */
const STATUS_CONTROLS: [MoveAction, Action][] = [
  ["pilot_away", { label: "Confirm pilot away", path: "transitions", body: { to: "Pilot away" } }],
  ["boarding", { label: "Confirm boarding", path: "transitions", body: { to: "On board" } }],
  ["complete", { label: "Complete move", path: "transitions", body: { to: "Completed" } }],
  ["start_detention", { label: "Start detention", path: "detention", body: { action: "start" } }],
  ["stop_detention", { label: "Stop detention", path: "detention", body: { action: "stop" } }],
];

function ActionButton({ action, move, announcements, onReply, onNoReply }: { action: Action } & ActionProps) {
  const control = useKeyedControl();
  const run = async (): Promise<void> => {
    const key = control.begin({ ref: move.ref, path: action.path, body: action.body });
    if (key === null) return;
    announcements.say("Saving...");
    const outcome: Outcome<Move> = await request<Move>(`/api/moves/${encodeURIComponent(move.ref)}/${action.path}`, { body: action.body, key });
    control.end(outcome);
    if (outcome.kind === "no-reply") {
      announcements.say(NO_REPLY);
      onNoReply();
      return;
    }
    if (outcome.kind === "ok") {
      announcements.say(
        action.body.to === "Completed" ? "Move completed. Charges post when the billing provider confirms." : `Status now ${statusText(outcome.data)}`,
      );
    } else {
      announcements.say("This action is not available for the move's current status.");
    }
    onReply();
  };
  return (
    <button type="button" className={action.path === "transitions" ? "primary" : "ghost"} onClick={() => void run()}>
      {action.label}
    </button>
  );
}

export function MoveActions({ move, announcements, onReply, onNoReply }: ActionProps) {
  const actions = STATUS_CONTROLS.filter(([name]) => move.actions.includes(name)).map(([, action]) => action);
  if (!actions.length) return null;
  return (
    <div className="actions">
      {actions.map((action) => (
        <ActionButton key={action.label} action={action} move={move} announcements={announcements} onReply={onReply} onNoReply={onNoReply} />
      ))}
    </div>
  );
}
