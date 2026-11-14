import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Payload, Position, StripRow } from "../../shared/wire.ts";
import type { SessionInfo } from "../session.ts";

/** What the typed line currently names, from the server's latest preview reply. */
export interface Preview {
  callsign: string | null;
  route: string[];
  stop: string | null;
  conflicts: string[];
}

export const NO_PREVIEW: Preview = { callsign: null, route: [], stop: null, conflicts: [] };

export interface CommandApi {
  /** Fills the command line with a clearance and focuses it. */
  prefill: (line: string, callsign: string) => void;
  focus: () => void;
}

/** Everything the boards, map, command line and alerts of one session page share. */
export interface Room {
  id: string;
  payload: Payload;
  sessionInfo: SessionInfo;
  /** The seat this browser holds, if any. */
  position: Position | null;
  instructor: boolean;
  reduced: boolean;
  glideMs: number;
  pending: ReadonlySet<string>;
  setPending: (callsign: string, on: boolean) => void;
  preview: Preview;
  setPreview: (preview: Preview) => void;
  selected: string | null;
  select: (callsign: string | null) => void;
  commandError: string;
  setCommandError: (message: string) => void;
  stripNotice: string;
  setStripNotice: (message: string) => void;
  /** Focus this strip once the server shows it at a version above `afterVersion`. */
  requestFocus: (callsign: string, afterVersion: number) => void;
  focusRequest: { callsign: string; afterVersion: number } | null;
  clearFocusRequest: () => void;
  commandApi: { current: CommandApi | null };
  refetch: () => Promise<void>;
  rowsOf: (board: Position) => StripRow[];
}

export const RoomContext = createContext<Room | null>(null);

export function useRoom(): Room {
  const room = useContext(RoomContext);
  if (!room) throw new Error("no room");
  return room;
}
