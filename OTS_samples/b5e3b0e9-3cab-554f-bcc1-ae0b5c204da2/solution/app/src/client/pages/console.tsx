import { useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import { Board } from "../components/board.tsx";
import { CommandLine, Readback } from "../components/commandline.tsx";
import { FormFeedback, TextField, useForm } from "../components/forms.tsx";
import { MapPanel } from "../components/mappanel.tsx";
import { useRoom } from "../components/room.tsx";
import { AlertsList, StatusBar } from "../components/status.tsx";
import { TabPanel, Tabs } from "../components/tabs.tsx";
import type { LayoutMode } from "../layoutmode.ts";
import type { SessionView } from "../session.ts";
import type { Position } from "../../shared/wire.ts";

const EVENTS = [
  { label: "Close runway", kind: "closure" },
  { label: "Reopen runway", kind: "reopen" },
  { label: "Go-around", kind: "go-around" },
  { label: "Emergency", kind: "emergency" },
  { label: "End emergency", kind: "end-emergency" },
  { label: "Wind change", kind: "wind" },
] as const;

function ClockControls({ id }: { id: string }) {
  const { payload } = useRoom();
  const [message, setMessage] = useState("");
  const call = async (path: string, body?: unknown): Promise<void> => {
    try {
      await api("POST", `/api/sessions/${id}/${path}`, body);
      setMessage("");
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setMessage(error.message);
    }
  };
  const ended = payload.status === "ended";
  return (
    <section class="cell clock-controls">
      <h2>Clock</h2>
      <div class="actions">
        {payload.status === "paused" ? (
          <button type="button" onClick={() => void call("resume")}>
            Resume
          </button>
        ) : (
          <button type="button" disabled={ended} onClick={() => void call("pause")}>
            Pause
          </button>
        )}
        <button type="button" disabled={ended} onClick={() => void call("end")}>
          End exercise
        </button>
      </div>
      <div role="radiogroup" aria-label="Speed" class="speed">
        {([1, 2, 4] as const).map((speed) => (
          <label key={speed} class="radio">
            <input type="radio" name="speed" value={speed} checked={payload.speed === speed} disabled={ended} onChange={() => void call("speed", { speed })} />
            {speed}x
          </label>
        ))}
      </div>
      <div role="alert" aria-label="Clock error" class={message ? "cell-error" : "cell-quiet"}>
        {message}
      </div>
    </section>
  );
}

function EventForm({ id }: { id: string }) {
  const room = useRoom();
  const form = useForm();
  const [kind, setKind] = useState<(typeof EVENTS)[number]["kind"]>("closure");
  const [callsign, setCallsign] = useState("");
  const [direction, setDirection] = useState("");
  const [speed, setSpeed] = useState("");
  const [failure, setFailure] = useState("");
  const aircraft = room.payload.aircraft.map((a) => a.callsign).sort();
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Injecting...");
    setFailure("");
    const body =
      kind === "wind"
        ? { kind, windDir: Number(direction), windKt: Number(speed) }
        : kind === "go-around" || kind === "emergency"
          ? { kind, callsign: callsign || aircraft[0] }
          : { kind, runway: room.payload.runwayInUse };
    try {
      await api("POST", `/api/sessions/${id}/events`, body);
      form.succeed("Event injected.");
    } catch (error) {
      form.reset();
      setFailure(error instanceof Error ? error.message : "Something went wrong.");
    }
  };
  return (
    <form aria-label="Inject event" class="cell event-form" onSubmit={(event) => void submit(event)}>
      <h2>Events</h2>
      <div class="field">
        <label for="field-event">Event</label>
        <select id="field-event" value={kind} onChange={(event) => setKind(event.currentTarget.value as typeof kind)}>
          {EVENTS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {(kind === "go-around" || kind === "emergency") && (
        <div class="field">
          <label for="field-aircraft">Aircraft</label>
          <select id="field-aircraft" value={callsign || aircraft[0] || ""} onChange={(event) => setCallsign(event.currentTarget.value)}>
            {aircraft.map((cs) => (
              <option key={cs} value={cs}>
                {cs}
              </option>
            ))}
          </select>
        </div>
      )}
      {kind === "wind" && (
        <div class="field-pair">
          <TextField name="windDir" label="Wind direction" value={direction} onInput={setDirection} inputMode="numeric" />
          <TextField name="windKt" label="Wind speed" value={speed} onInput={setSpeed} inputMode="numeric" />
        </div>
      )}
      <button type="submit">Inject</button>
      <FormFeedback form={form} />
      <div role="alert" aria-label="Event error" class={failure ? "cell-error" : "cell-quiet"}>
        {failure}
      </div>
    </form>
  );
}

function NoteForm({ id }: { id: string }) {
  const form = useForm();
  const [text, setText] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Pinning...");
    try {
      await api("POST", `/api/sessions/${id}/notes`, { text });
      setText("");
      form.succeed("Note pinned.");
    } catch (error) {
      form.fail(error);
    }
  };
  return (
    <form aria-label="Pin note" class="cell note-form" onSubmit={(event) => void submit(event)}>
      <TextField name="text" label="Note" value={text} onInput={setText} error={form.state.errors.text} />
      <button type="submit">Pin note</button>
      <FormFeedback form={form} fields={{ text: "Note" }} />
    </form>
  );
}

function Seats({ id }: { id: string }) {
  const { payload } = useRoom();
  const free = async (position: Position): Promise<void> => {
    try {
      await api("DELETE", `/api/sessions/${id}/seats/${position}`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  };
  return (
    <section class="cell seats">
      <h2>Seats</h2>
      {(["GND", "TWR"] as const).map((position) => {
        const seat = payload.seats[position];
        return (
          <div key={position} class="seat-row">
            <span>
              {position}: {seat ? `${seat.name}, ${seat.connected ? "connected" : "disconnected"}` : "free"}
            </span>
            {seat?.graceEnded && (
              <button type="button" onClick={() => void free(position)}>
                Reassign {position} seat
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

interface ConsoleProps {
  id: string;
  mode: LayoutMode;
  position: Position | null;
  connection: SessionView["connection"];
}

export function Console({ id, mode, position, connection }: ConsoleProps) {
  const room = useRoom();
  const [tab, setTab] = useState("clock");
  const ground = <Board board="GND" strips={room.rowsOf("GND")} />;
  const tower = <Board board="TWR" strips={room.rowsOf("TWR")} />;
  const seatLine = position ? <CommandLine position={position} /> : <Readback position={null} />;
  const controls = (
    <>
      <ClockControls id={id} />
      <Seats id={id} />
    </>
  );
  if (mode === "desktop") {
    return (
      <div class="console-grid">
        <div class="console-boards">
          {ground}
          {tower}
        </div>
        <div class="console-lower">
          <div class="cell console-map">
            <MapPanel />
          </div>
          <div class="console-side">
            {seatLine}
            {controls}
            <EventForm id={id} />
            <NoteForm id={id} />
            <AlertsList alerts={room.payload.alerts} />
          </div>
        </div>
      </div>
    );
  }
  const tabs = [
    { id: "clock", label: "Clock" },
    { id: "events", label: "Events" },
    { id: "alerts", label: "Alerts" },
    { id: "boards", label: "Boards" },
  ];
  return (
    <div class="console-stack">
      <Tabs label="Console" tabs={tabs} selected={tab} onSelect={setTab} />
      <TabPanel label="Console" id="clock" selected={tab === "clock"}>
        <StatusBar sessionId={id} connection={connection} />
        {controls}
        {seatLine}
      </TabPanel>
      <TabPanel label="Console" id="events" selected={tab === "events"}>
        <EventForm id={id} />
        <NoteForm id={id} />
      </TabPanel>
      <TabPanel label="Console" id="alerts" selected={tab === "alerts"}>
        <AlertsList alerts={room.payload.alerts} />
      </TabPanel>
      <TabPanel label="Console" id="boards" selected={tab === "boards"}>
        {ground}
        {tower}
        <div class="cell">
          <MapPanel />
        </div>
      </TabPanel>
    </div>
  );
}
