import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bay, Position, SessionStateView, StripView } from '../../shared/types.js';
import { BOARD_BAYS } from '../../shared/types.js';
import { api, ApiFailure, failureText } from '../api.js';
import { useApp } from '../app-context.js';
import { AirfieldMap } from '../components/airfield-map.js';
import { Dialog } from '../components/dialog.js';
import { ErrorCell } from '../components/forms.js';
import { Loading, NotFound } from '../components/shell.js';
import { Board, type BoardActions } from '../session/board.js';
import { useCentrelineRun } from '../session/centreline.js';
import { CommandLine } from '../session/command-line.js';
import { ClockControls, type EventDraft, type EventFeedback, EventForms } from '../session/console-controls.js';
import { AlertsList, LiveRegions, StatusItems, TabPanel, Tabs, useLayoutMode } from '../session/parts.js';

interface You {
  id: string;
  instructor: boolean;
  position: Position | null;
}

interface Preview {
  callsign: string | null;
  route: string[];
  stop: string | null;
  conflicts: { segment: string; rule: string }[];
}

const NO_PREVIEW: Preview = { callsign: null, route: [], stop: null, conflicts: [] };

function versionOf(strips: StripView[], callsign: string): number {
  return strips.find((strip) => strip.callsign === callsign)?.version ?? 0;
}

function StripDialog(props: {
  sessionId: string;
  copy: StripView;
  onClose(): void;
  onSaved(strips: StripView[]): void;
  onConflict(message: string, strips: StripView[]): void;
  returnFocus(): void;
}) {
  const [holdingPoint, setHoldingPoint] = useState(props.copy.holdingPoint ?? '');
  const [remarks, setRemarks] = useState(props.copy.remarks);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  return (
    <Dialog label={`Edit ${props.copy.callsign}`} onClose={props.onClose} returnFocus={props.returnFocus}>
      <form
        aria-label={`Edit ${props.copy.callsign}`}
        class="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setStatus('Saving...');
          setError('');
          try {
            const result = await api<{ strips: StripView[] }>(
              'PATCH',
              `/api/sessions/${props.sessionId}/strips/${props.copy.callsign}`,
              { holdingPoint, remarks, version: props.copy.version },
            );
            setStatus('');
            props.onSaved(result.strips);
          } catch (failure) {
            setStatus('');
            if (failure instanceof ApiFailure && failure.body.error === 'version_conflict') {
              props.onConflict(failure.body.message ?? '', (failure.body.strips as StripView[]) ?? []);
            } else {
              setError(failureText(failure));
            }
          }
        }}
      >
        <div class="field">
          <label for="strip-hp">Holding point</label>
          <input id="strip-hp" value={holdingPoint} onInput={(e) => setHoldingPoint(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="strip-remarks">Remarks</label>
          <input id="strip-remarks" value={remarks} onInput={(e) => setRemarks(e.currentTarget.value)} />
        </div>
        <div class="row-buttons">
          <button type="submit" class="primary">
            Save strip
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
        <p role="status" aria-label="Form status" class="form-status">
          {status}
        </p>
        <ErrorCell label="Strip error" text={error} />
      </form>
    </Dialog>
  );
}

export function SessionPage({ id }: { id: string }) {
  const { reducedMotion } = useApp();
  const mode = useLayoutMode();
  const [state, setState] = useState<SessionStateView | null>(null);
  const [you, setYou] = useState<You | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [missing, setMissing] = useState(false);
  const [lost, setLost] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, StripView[]>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [text, setTextState] = useState('');
  const [prefill, setPrefill] = useState<{ callsign: string; text: string } | null>(null);
  const [commandError, setCommandError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [readback, setReadback] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<Preview>(NO_PREVIEW);
  const [instant, setInstant] = useState(0);
  const [acceptedRun, setAcceptedRun] = useState<{ callsign: string; route: string[]; stop: string | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [urgent, setUrgent] = useState('');
  const [polite, setPolite] = useState('');
  const [flashKey, setFlashKey] = useState(0);
  const [animateAlertsFrom, setAnimateAlertsFrom] = useState(Number.MAX_SAFE_INTEGER);
  const [editing, setEditing] = useState<StripView | null>(null);
  const [seatError, setSeatError] = useState('');
  const [consoleError, setConsoleError] = useState('');
  const [positionTab, setPositionTab] = useState('Board');
  const [consoleTab, setConsoleTab] = useState('Clock');
  const [eventDraft, setEventDraft] = useState<EventDraft>({ kind: 'closure', callsign: '', windDir: '', windKt: '', note: '' });
  const [eventFeedback, setEventFeedback] = useState<EventFeedback>({ status: '', eventError: '', noteErrors: {} });

  const seq = useRef(-1);
  const alertCount = useRef(-1);
  const previewRequest = useRef(0);
  const commandInput = useRef<HTMLInputElement>(null);
  const focusTarget = useRef<string | null>(null);

  const position: Position | null =
    you && state ? ((['GND', 'TWR'] as Position[]).find((seat) => state.seats[seat]?.userId === you.id) ?? null) : null;

  const applyState = useCallback((next: SessionStateView) => {
    if (next.seq < seq.current) return;
    seq.current = next.seq;
    const previous = alertCount.current;
    alertCount.current = next.alerts.length;
    if (previous >= 0 && next.alerts.length > previous) {
      const fresh = next.alerts.slice(previous);
      const urgentAlert = fresh.filter((alert) => alert.rule === 'R5').pop();
      const politeAlert = fresh.filter((alert) => alert.rule !== 'R5').pop();
      if (urgentAlert) {
        setUrgent(urgentAlert.text);
        setFlashKey((key) => key + 1);
      }
      if (politeAlert) setPolite(politeAlert.text);
      setAnimateAlertsFrom(previous);
    }
    setOverrides((current) => {
      const kept = Object.entries(current).filter(([callsign, copies]) => copies[0]!.version > versionOf(next.strips, callsign));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
    setState(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api<SessionStateView & { you: You; history: string[] }>('GET', `/api/sessions/${encodeURIComponent(id)}/state`);
      setYou(data.you);
      setHistory(data.history);
      seq.current = -1;
      applyState(data);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
    }
  }, [id, applyState]);

  useLayoutEffect(() => {
    void load();
    let socket: WebSocket | null = null;
    let closed = false;
    let wasLost = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sessions/${encodeURIComponent(id)}/live`);
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; state: SessionStateView };
        if (message.type === 'state') applyState(message.state);
      };
      socket.onopen = () => {
        if (wasLost) {
          wasLost = false;
          setLost(false);
          void load();
        }
      };
      socket.onclose = () => {
        if (closed) return;
        wasLost = true;
        setLost(true);
        retry = setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [id, load, applyState]);

  const strips = useMemo(() => {
    if (!state) return [];
    const newer = Object.values(overrides).filter((copies) => copies[0]!.version > versionOf(state.strips, copies[0]!.callsign));
    const replaced = new Set(newer.map((copies) => copies[0]!.callsign));
    const list = state.strips.filter((strip) => !replaced.has(strip.callsign));
    for (const copies of newer) list.push(...copies);
    return list;
  }, [state, overrides]);

  const applyCopies = (copies: StripView[] | undefined) => {
    if (!copies || copies.length === 0) return;
    const callsign = copies[0]!.callsign;
    setOverrides((current) => ({ ...current, [callsign]: copies }));
  };

  const requestPreview = (value: string) => {
    const request = ++previewRequest.current;
    if (!position) return;
    api<Preview>('POST', `/api/sessions/${encodeURIComponent(id)}/preview`, { text: value })
      .then((reply) => {
        if (request === previewRequest.current) setPreview(reply);
      })
      .catch(() => undefined);
  };

  const setText = (value: string) => {
    setTextState(value);
    requestPreview(value);
  };

  const focusStrip = (callsign: string) => {
    focusTarget.current = callsign;
    setSelected(callsign);
  };

  useLayoutEffect(() => {
    const callsign = focusTarget.current;
    if (!callsign || !position) return;
    const element =
      document.querySelector<HTMLElement>(`[data-board="${position}"] li[data-strip="${callsign}"]:not([data-state="transferred"])`) ??
      document.querySelector<HTMLElement>(`[data-board="${position}"] li[data-strip="${callsign}"]`);
    if (element) {
      focusTarget.current = null;
      element.focus();
    }
  });

  const withPending = async (callsign: string, work: () => Promise<void>) => {
    setPending((current) => new Set(current).add(callsign));
    try {
      await work();
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(callsign);
        return next;
      });
    }
  };

  const move = (copy: StripView, to: Bay) =>
    withPending(copy.callsign, async () => {
      try {
        const result = await api<{ strips: StripView[] }>('POST', `/api/sessions/${encodeURIComponent(id)}/strips/${copy.callsign}/move`, {
          to,
          version: copy.version,
        });
        applyCopies(result.strips);
        setCommandError('');
        setInvalid(false);
        setNotice('');
        focusStrip(copy.callsign);
      } catch (error) {
        if (error instanceof ApiFailure && error.body.error === 'version_conflict') {
          setNotice(error.body.message ?? '');
          applyCopies(error.body.strips as StripView[]);
        } else {
          setCommandError(failureText(error));
        }
      }
    });

  const send = (value: string) => {
    const callsign = value.trim().split(/\s+/)[0]!.toUpperCase();
    const wasPrefill = prefill;
    const sentPreview = preview;
    void withPending(callsign, async () => {
      try {
        const result = await api<{ readback: string; strips: StripView[] }>('POST', `/api/sessions/${encodeURIComponent(id)}/commands`, {
          text: value,
        });
        setHistory((current) => [...current, value].slice(-50));
        previewRequest.current += 1;
        if (sentPreview.route.length > 0 && /^\S+\s+TAXI\b/i.test(value.trim())) {
          setAcceptedRun({ callsign, route: sentPreview.route, stop: sentPreview.stop });
        }
        setPreview(NO_PREVIEW);
        setInstant((n) => n + 1);
        setTextState('');
        setPrefill(null);
        setCommandError('');
        setInvalid(false);
        setNotice('');
        setReadback(result.readback);
        applyCopies(result.strips);
        if (wasPrefill) focusStrip(wasPrefill.callsign);
      } catch (error) {
        setHistory((current) => [...current, value].slice(-50));
        previewRequest.current += 1;
        setPreview(NO_PREVIEW);
        setCommandError(failureText(error));
        setInvalid(true);
      }
    });
  };

  const prefillCommand = (copy: StripView, command: string) => {
    setPrefill({ callsign: copy.callsign, text: command });
    setText(command);
    commandInput.current?.focus();
  };

  const boardOrderTarget = (copy: StripView, step: 1 | -1): Bay => {
    const bays = BOARD_BAYS[copy.board];
    const index = bays.indexOf(copy.bay);
    return bays[Math.max(0, Math.min(bays.length - 1, index + step))]!;
  };

  const actions: BoardActions = {
    forward(copy) {
      if (copy.forward?.command) prefillCommand(copy, copy.forward.command);
      else void move(copy, copy.forward?.to ?? boardOrderTarget(copy, 1));
    },
    back(copy) {
      void move(copy, copy.back?.to ?? boardOrderTarget(copy, -1));
    },
    drop(copy, bay) {
      if (copy.forward?.to === bay && copy.forward.command) prefillCommand(copy, copy.forward.command);
      else void move(copy, bay);
    },
    edit(copy) {
      setEditing(copy);
    },
    notOnFrequency(copy) {
      setCommandError(`${copy.callsign} is not on your frequency.`);
    },
    focusCommand() {
      commandInput.current?.focus();
    },
    select(callsign) {
      setSelected(callsign);
    },
  };

  const run = useCentrelineRun({ route: preview.route, stop: preview.stop, instant }, reducedMotion);

  if (missing) return <NotFound />;
  if (!state || !you) return <Loading />;

  const firstWord = text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  const frequencyCallsigns = [...new Set(strips.filter((strip) => strip.frequency === position && strip.state !== 'transferred').map((s) => s.callsign))].sort();
  const previewCallsign = position && frequencyCallsigns.includes(firstWord) ? firstWord : null;

  const lit: Record<string, 'preview' | 'accepted'> = {};
  const stopBars = new Set<string>();
  if (position) {
    for (const aircraft of state.aircraft) {
      if (aircraft.routeBy !== position) continue;
      for (const segment of aircraft.route) lit[segment] = 'accepted';
      if (aircraft.stop) stopBars.add(aircraft.stop);
    }
    const pendingRun = acceptedRun && state.aircraft.find((aircraft) => aircraft.callsign === acceptedRun.callsign);
    if (acceptedRun && pendingRun && !(pendingRun.routeBy === position && pendingRun.stop === acceptedRun.stop)) {
      for (const segment of acceptedRun.route) lit[segment] = 'accepted';
      if (acceptedRun.stop) stopBars.add(acceptedRun.stop);
    }
  }
  for (const segment of run.lit) lit[segment] = 'preview';
  if (run.stopBar) stopBars.add(run.stopBar);
  const conflicts = new Set(preview.conflicts.map((conflict) => conflict.segment));

  const glideMs = reducedMotion ? 0 : Math.round(1000 / state.speed);
  const map = (
    <AirfieldMap
      layout={state.layout}
      aircraft={state.aircraft}
      closed={state.closed}
      selected={previewCallsign ?? selected}
      glideMs={glideMs}
      lit={lit}
      conflicts={conflicts}
      stopBars={stopBars}
      onAircraft={(callsign) => {
        if (position && strips.some((strip) => strip.board === position && strip.callsign === callsign)) focusStrip(callsign);
      }}
    />
  );

  const board = (boardPosition: Position) => (
    <Board
      position={boardPosition}
      strips={strips}
      canAct={position === boardPosition && state.status !== 'ended'}
      pending={pending}
      previewCallsign={position === boardPosition ? previewCallsign : null}
      reducedMotion={reducedMotion}
      flashKey={flashKey}
      actions={actions}
    />
  );

  const commandLine = position ? (
    <CommandLine
      inputRef={commandInput}
      text={text}
      setText={(value) => {
        setText(value);
      }}
      error={commandError}
      invalid={invalid}
      readback={readback}
      callsigns={frequencyCallsigns}
      history={history}
      previewRoute={preview.route}
      previewConflicts={conflicts}
      prefilled={prefill !== null}
      onSend={send}
      onEscapePrefill={() => {
        const callsign = prefill!.callsign;
        setPrefill(null);
        setText('');
        focusStrip(callsign);
      }}
    />
  ) : null;

  const alerts = <AlertsList alerts={state.alerts} seenCount={animateAlertsFrom} reduced={reducedMotion} />;
  const debriefLink =
    state.status === 'ended' ? (
      <p class="debrief-link">
        <a href={`/sessions/${id}/debrief`} class="button-link primary">
          Open debrief
        </a>
      </p>
    ) : null;
  const live = <LiveRegions urgent={urgent} polite={polite} notice={notice} lost={lost} />;
  const dialog = editing ? (
    <StripDialog
      sessionId={id}
      copy={strips.find((strip) => strip.callsign === editing.callsign && strip.state !== 'transferred') ?? editing}
      onClose={() => setEditing(null)}
      returnFocus={() => focusStrip(editing.callsign)}
      onSaved={(copies) => {
        applyCopies(copies);
        setNotice('');
        setEditing(null);
      }}
      onConflict={(message, copies) => {
        setNotice(message);
        applyCopies(copies);
      }}
    />
  ) : null;

  const takeSeat = async (seat: Position) => {
    setSeatError('');
    try {
      await api('POST', `/api/sessions/${encodeURIComponent(id)}/seats`, { position: seat });
      await load();
    } catch (error) {
      setSeatError(failureText(error));
    }
  };

  const seatButtons = (positions: Position[]) => (
    <div class="row-buttons seat-buttons">
      {positions.map((seat) => (
        <button key={seat} type="button" class="primary" onClick={() => void takeSeat(seat)}>
          {`Take ${seat} seat`}
        </button>
      ))}
    </div>
  );

  if (!you.instructor && !position) {
    return (
      <div class="session" data-layout={mode}>
        <section class="cell">
          <h1>{state.scenarioName}</h1>
          <p>Choose a position to work.</p>
          {state.status !== 'ended' ? seatButtons(['GND', 'TWR']) : null}
          <ErrorCell label="Seat error" text={seatError} />
        </section>
        <StatusItems state={state} />
        {debriefLink}
        {live}
      </div>
    );
  }

  if (!you.instructor) {
    const tabs = mode === 'phone' ? ['Board', 'Map', 'Alerts'] : ['Board', 'Map'];
    const tab = tabs.includes(positionTab) ? positionTab : 'Board';
    return (
      <div class="session position-page" data-layout={mode} data-position={position}>
        <h1 class="visually-hidden">
          {state.scenarioName}, {position === 'GND' ? 'Ground' : 'Tower'}
        </h1>
        <StatusItems state={state} />
        {live}
        {mode === 'desktop' ? (
          <div class="position-grid">
            <div class="area-board">{board(position!)}</div>
            <div class="area-command">{commandLine}</div>
            {debriefLink}
            <div class="area-map cell">{map}</div>
            <div class="area-alerts">{alerts}</div>
          </div>
        ) : (
          <div class="position-stack">
            <Tabs label="Position" tabs={tabs} selected={tab} onSelect={setPositionTab} />
            <TabPanel label="Position" tab={tab}>
              {tab === 'Board' ? board(position!) : tab === 'Map' ? <div class="cell">{map}</div> : alerts}
            </TabPanel>
            <div class="area-command sticky-command">{commandLine}</div>
            {debriefLink}
            {mode === 'tablet' ? alerts : null}
          </div>
        )}
        {dialog}
      </div>
    );
  }

  const seatsPanel = (
    <section class="cell seats-cell" aria-labelledby="seats-heading">
      <h2 id="seats-heading">Seats</h2>
      <ul class="link-list">
        {(['GND', 'TWR'] as Position[]).map((seat) => {
          const holder = state.seats[seat];
          return (
            <li key={seat}>
              {seat}: {holder ? `${holder.name}${holder.connected ? '' : ' (disconnected)'}` : 'free'}
              {holder?.graceEnded ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api('DELETE', `/api/sessions/${encodeURIComponent(id)}/seats/${seat}`);
                      setConsoleError('');
                    } catch (error) {
                      setConsoleError(failureText(error));
                    }
                  }}
                >
                  {`Reassign ${seat} seat`}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!position && state.status !== 'ended'
        ? seatButtons((['GND', 'TWR'] as Position[]).filter((seat) => !state.seats[seat]))
        : null}
      <ErrorCell label="Seat error" text={seatError} />
    </section>
  );
  const clockPanel = (
    <section class="cell clock-cell" aria-labelledby="clock-heading">
      <h2 id="clock-heading">Clock</h2>
      <ClockControls id={id} state={state} onError={setConsoleError} />
      <ErrorCell label="Console error" text={consoleError} />
    </section>
  );
  const eventsPanel = (
    <section class="cell events-cell" aria-labelledby="events-heading">
      <h2 id="events-heading">Events</h2>
      <EventForms
        id={id}
        aircraft={state.aircraft.map((aircraft) => aircraft.callsign).sort()}
        draft={eventDraft}
        setDraft={setEventDraft}
        feedback={eventFeedback}
        setFeedback={setEventFeedback}
      />
    </section>
  );
  const readbackStatus = position ? null : (
    <div class="cell">
      <span class="label">Last readback</span>
      <p role="status" aria-label="Readback" class="readback mono">
        {state.lastReadback}
      </p>
    </div>
  );

  if (mode === 'desktop') {
    return (
      <div class="session console" data-layout={mode}>
        <h1 class="visually-hidden">{state.scenarioName}, instructor console</h1>
        <div class="console-boards">
          {board('GND')}
          {board('TWR')}
        </div>
        {commandLine}
        <StatusItems state={state} />
        {live}
        {debriefLink}
        <div class="console-grid">
          {clockPanel}
          <div class="cell area-map">{map}</div>
          {alerts}
          {eventsPanel}
          {seatsPanel}
          {readbackStatus}
        </div>
        {dialog}
      </div>
    );
  }

  const consoleTabs = ['Clock', 'Events', 'Alerts', 'Boards'];
  return (
    <div class="session console" data-layout={mode}>
      <h1 class="visually-hidden">{state.scenarioName}, instructor console</h1>
      <Tabs label="Console" tabs={consoleTabs} selected={consoleTab} onSelect={setConsoleTab} />
      <TabPanel label="Console" tab={consoleTab}>
        {consoleTab === 'Clock' ? (
          <div class="stack">
            <StatusItems state={state} />
            {clockPanel}
            {seatsPanel}
          </div>
        ) : consoleTab === 'Events' ? (
          eventsPanel
        ) : consoleTab === 'Alerts' ? (
          alerts
        ) : (
          <div class="stack">
            {board('GND')}
            {board('TWR')}
            <div class="cell">{map}</div>
          </div>
        )}
      </TabPanel>
      {commandLine}
      {live}
      {readbackStatus}
      {debriefLink}
      {dialog}
    </div>
  );
}
