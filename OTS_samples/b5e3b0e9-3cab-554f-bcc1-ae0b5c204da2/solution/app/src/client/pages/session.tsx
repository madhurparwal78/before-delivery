import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import { Board } from "../components/board.tsx";
import { CommandLine } from "../components/commandline.tsx";
import { MapPanel } from "../components/mappanel.tsx";
import { NO_PREVIEW, RoomContext, useRoom, type CommandApi, type Preview, type Room } from "../components/room.tsx";
import { AlertsList, Announcers, StatusBar } from "../components/status.tsx";
import { TabPanel, Tabs } from "../components/tabs.tsx";
import { useLayoutMode, type LayoutMode } from "../layoutmode.ts";
import { FLASH_MS, OUTLINE_MS, mark } from "../markers.ts";
import { useReducedMotion } from "../me.ts";
import { useSession, type SessionView } from "../session.ts";
import type { Payload, Position } from "../../shared/wire.ts";
import { Console } from "./console.tsx";
import { Loading, NotFound } from "./shared.tsx";

type Connection = SessionView["connection"];

const seatOf = (payload: Payload, userId: string): Position | null =>
  payload.seats.GND?.id === userId ? "GND" : payload.seats.TWR?.id === userId ? "TWR" : null;

function SeatPicker({ id, payload, onTaken }: { id: string; payload: Payload; onTaken: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const take = async (position: Position): Promise<void> => {
    try {
      await api("POST", `/api/sessions/${id}/seats`, { position });
      setMessage("");
      await onTaken();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setMessage(error.message);
    }
  };
  return (
    <div class="cell page-cell seat-picker">
      <h1>Take a seat</h1>
      {(["GND", "TWR"] as const).map((position) => (
        <div key={position} class="seat-row">
          <button type="button" onClick={() => void take(position)}>
            Take {position} seat
          </button>
          <span class="muted">{payload.seats[position] ? `Held by ${payload.seats[position]?.name ?? ""}` : "Free"}</span>
        </div>
      ))}
      <div role="alert" aria-label="Seat error" class={message ? "cell-error" : "cell-quiet"}>
        {message}
      </div>
    </div>
  );
}

function PositionPage({ mode, position }: { mode: LayoutMode; position: Position }) {
  const [tab, setTab] = useState("board");
  const room = useRoom();
  const stripViews = room.rowsOf(position);
  const board = <Board board={position} strips={stripViews} />;
  const command = <CommandLine position={position} />;
  if (mode === "desktop") {
    return (
      <div class="position-grid">
        <div class="col-board">
          {board}
          {command}
        </div>
        <div class="col-map cell">
          <MapPanel />
        </div>
        <div class="col-alerts">
          <AlertsList alerts={room.payload.alerts} />
        </div>
      </div>
    );
  }
  const tabs = mode === "tablet" ? [{ id: "board", label: "Board" }, { id: "map", label: "Map" }] : [{ id: "board", label: "Board" }, { id: "map", label: "Map" }, { id: "alerts", label: "Alerts" }];
  return (
    <div class="position-stack">
      <Tabs label="Position" tabs={tabs} selected={tab} onSelect={setTab} />
      <TabPanel label="Position" id="board" selected={tab === "board"}>
        {board}
      </TabPanel>
      <TabPanel label="Position" id="map" selected={tab === "map"}>
        <MapPanel />
      </TabPanel>
      {mode === "phone" ? (
        <TabPanel label="Position" id="alerts" selected={tab === "alerts"}>
          <AlertsList alerts={room.payload.alerts} />
        </TabPanel>
      ) : (
        <AlertsList alerts={room.payload.alerts} />
      )}
      <div class="command-dock">{command}</div>
    </div>
  );
}

export function SessionPage({ id }: { id: string }) {
  const { view, refetch } = useSession(id);
  const reduced = useReducedMotion();
  const mode = useLayoutMode();
  const [pending, setPendingSet] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<Preview>(NO_PREVIEW);
  const [selected, select] = useState<string | null>(null);
  const [commandError, setCommandError] = useState("");
  const [stripNotice, setStripNotice] = useState("");
  const [focusRequest, setFocusRequest] = useState<Room["focusRequest"]>(null);
  const [urgent, setUrgent] = useState("");
  const [polite, setPolite] = useState("");
  const commandApi = useRef<CommandApi | null>(null);

  useLayoutEffect(() => {
    const fresh = [...view.fresh].sort((a, b) => a.id - b.id);
    for (const alert of fresh) {
      if (alert.rule === "R5") setUrgent(alert.text);
      else setPolite(alert.text);
    }
    if (fresh.some((a) => a.rule === "R5")) {
      for (const region of document.querySelectorAll(".board-region")) {
        if (reduced) mark(region, "data-outline", "static", OUTLINE_MS);
        else {
          mark(region, "data-motion", "flash", FLASH_MS);
          const lit = { outlineColor: "currentColor" };
          const dark = { outlineColor: "transparent" };
          region.animate(
            [
              { ...lit, offset: 0 },
              { ...lit, offset: 0.24 },
              { ...dark, offset: 0.25 },
              { ...dark, offset: 0.49 },
              { ...lit, offset: 0.5 },
              { ...lit, offset: 0.74 },
              { ...dark, offset: 0.75 },
              { ...dark, offset: 1 },
            ],
            { duration: FLASH_MS },
          );
        }
      }
    }
  }, [view.freshSeq]);

  if (view.missing) return <NotFound />;
  const { payload, sessionInfo } = view;
  if (!payload || !sessionInfo) return <Loading />;
  const position = seatOf(payload, sessionInfo.me.id);

  const room: Room = {
    id,
    payload,
    sessionInfo,
    position,
    instructor: sessionInfo.me.instructor,
    reduced,
    glideMs: reduced ? 0 : Math.round(1000 / payload.speed),
    pending,
    setPending: (callsign, on) =>
      setPendingSet((current) => {
        const next = new Set(current);
        if (on) next.add(callsign);
        else next.delete(callsign);
        return next;
      }),
    preview,
    setPreview,
    selected,
    select,
    commandError,
    setCommandError,
    stripNotice,
    setStripNotice,
    requestFocus: (callsign, afterVersion) => setFocusRequest({ callsign, afterVersion }),
    focusRequest,
    clearFocusRequest: () => setFocusRequest(null),
    commandApi,
    refetch,
    rowsOf: (board) => payload.strips.filter((strip) => strip.board === board),
  };

  let body;
  if (sessionInfo.me.instructor) body = <Console id={id} mode={mode} position={position} connection={view.connection} />;
  else if (position) body = <PositionPage mode={mode} position={position} />;
  else body = <SeatPicker id={id} payload={payload} onTaken={refetch} />;

  return (
    <RoomContext.Provider value={room}>
      <div class="room" data-layout={mode}>
        <StatusBarSlot id={id} connection={view.connection} instructor={sessionInfo.me.instructor} mode={mode} />
        <Announcers urgent={urgent} polite={polite} />
        <div role="alert" aria-label="Strip notice" class={stripNotice ? "cell-error" : "cell-quiet"}>
          {stripNotice}
        </div>
        {body}
      </div>
    </RoomContext.Provider>
  );
}

/** On the console's tablet and phone layouts the status items live in the Clock tab instead. */
function StatusBarSlot({ id, connection, instructor, mode }: { id: string; connection: Connection; instructor: boolean; mode: LayoutMode }) {
  if (instructor && mode !== "desktop") return null;
  return <StatusBar sessionId={id} connection={connection} />;
}
