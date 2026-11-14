import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import type { Position } from "../../shared/wire.ts";
import { NO_PREVIEW, useRoom } from "./room.tsx";

const HISTORY_LIMIT = 50;

const historyKey = (session: string, position: Position): string => `runup-history:${session}:${position}`;

function readHistory(session: string, position: Position): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(historyKey(session, position)) ?? "[]");
    return Array.isArray(stored) ? stored.filter((line): line is string => typeof line === "string") : [];
  } catch {
    return [];
  }
}

interface PreviewReply {
  callsign: string | null;
  route: string[];
  stop: string | null;
  conflicts: { segment: string; rule: string }[];
}

/** The seat's command line: typed clearances, completion, history, and the live route preview. */
export function CommandLine({ position }: { position: Position }) {
  const room = useRoom();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const prefilled = useRef<string | null>(null);
  const latest = useRef(0);
  const history = useRef<string[]>(readHistory(room.id, position));
  const cursor = useRef<{ index: number; draft: string } | null>(null);
  const cycle = useRef<{ matches: string[]; index: number; shown: string } | null>(null);

  const requestPreview = (text: string): void => {
    const mine = ++latest.current;
    if (text.trim() === "") {
      room.setPreview(NO_PREVIEW);
      return;
    }
    api<PreviewReply>("POST", `/api/sessions/${room.id}/preview`, { text })
      .then((reply) => {
        if (mine !== latest.current) return;
        room.setPreview({ callsign: reply.callsign, route: reply.route, stop: reply.stop, conflicts: reply.conflicts.map((c) => c.segment) });
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
      });
  };

  const change = (text: string): void => {
    setValue(text);
    cursor.current = null;
    requestPreview(text);
  };

  useLayoutEffect(() => {
    room.commandApi.current = {
      prefill: (line, callsign) => {
        prefilled.current = callsign;
        setValue(line);
        requestPreview(line);
        input.current?.focus();
      },
      focus: () => input.current?.focus(),
    };
    return () => {
      room.commandApi.current = null;
    };
  });

  const remember = (line: string): void => {
    history.current = [...history.current, line].slice(-HISTORY_LIMIT);
    window.localStorage.setItem(historyKey(room.id, position), JSON.stringify(history.current));
  };

  const send = async (): Promise<void> => {
    const text = value.trim();
    if (text === "") return;
    remember(text);
    const callsign = text.split(/\s+/)[0]?.toUpperCase() ?? "";
    const stripView = room.payload.strips.find((strip) => strip.callsign === callsign && strip.board === position);
    room.setPending(callsign, true);
    try {
      await api("POST", `/api/sessions/${room.id}/commands`, { text });
      room.setCommandError("");
      latest.current += 1;
      room.setPreview(NO_PREVIEW);
      setValue("");
      cursor.current = null;
      if (prefilled.current !== null && stripView) room.requestFocus(callsign, stripView.version);
      else input.current?.focus();
      prefilled.current = null;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      room.setCommandError(error.message);
      latest.current += 1;
      room.setPreview(NO_PREVIEW);
    } finally {
      room.setPending(callsign, false);
    }
  };

  const walkHistory = (direction: -1 | 1): void => {
    const lines = history.current;
    if (lines.length === 0) return;
    const state = cursor.current ?? { index: lines.length, draft: value };
    const index = Math.max(0, Math.min(lines.length, state.index + direction));
    cursor.current = { index, draft: state.draft };
    const text = index === lines.length ? state.draft : (lines[index] ?? "");
    setValue(text);
    requestPreview(text);
  };

  const complete = (event: KeyboardEvent): void => {
    const running = cycle.current;
    if (running && value === running.shown) {
      event.preventDefault();
      const next = (running.index + 1) % running.matches.length;
      const shown = `${running.matches[next]} `;
      cycle.current = { ...running, index: next, shown };
      change(shown);
      return;
    }
    if (value === "" || /\s/.test(value)) return;
    const word = value.toUpperCase();
    const matches = [...new Set(room.payload.strips.filter((strip) => strip.frequency === position).map((strip) => strip.callsign))]
      .filter((callsign) => callsign.startsWith(word))
      .sort();
    const first = matches[0];
    if (first === undefined || (matches.length === 1 && first === word)) return;
    event.preventDefault();
    const shown = `${first} `;
    cycle.current = { matches, index: 0, shown };
    change(shown);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      walkHistory(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      walkHistory(1);
    } else if (event.key === "Tab" && !event.shiftKey) complete(event);
    else if (event.key === "Escape" && prefilled.current !== null) {
      event.preventDefault();
      const callsign = prefilled.current;
      prefilled.current = null;
      change("");
      document.querySelector<HTMLElement>(`[data-board="${position}"] [data-strip="${callsign}"]`)?.focus();
    }
  };

  return (
    <div class="command-cell">
      <form
        class="command-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label for="command">Command</label>
        <input
          id="command"
          ref={input}
          type="text"
          class="mono"
          value={value}
          autoComplete="off"
          autoCapitalize="characters"
          spellcheck={false}
          aria-invalid={room.commandError ? "true" : undefined}
          aria-describedby="command-error"
          onInput={(event) => change(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit">Send</button>
      </form>
      <div id="command-error" role="alert" aria-label="Command error" class={room.commandError ? "cell-error" : "cell-quiet"}>
        {room.commandError}
      </div>
      <Readback position={room.instructor ? null : position} />
      <ul aria-label="Route preview" class="route-preview mono">
        {room.preview.route.map((segment) => (
          <li key={segment}>{room.preview.conflicts.includes(segment) ? `${segment} R4` : segment}</li>
        ))}
      </ul>
      <details class="grammar-help">
        <summary>Command forms</summary>
        <ul class="mono">
          {room.sessionInfo.forms[position].map((form) => (
            <li key={form}>{form}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** The readback of the latest accepted clearance: the sending seat sees its own, the instructor sees both. */
export function Readback({ position }: { position: Position | null }) {
  const room = useRoom();
  const readback = room.payload.lastReadback;
  const shown = readback && (position === null || readback.position === position) ? readback.text : "";
  return (
    <p role="status" aria-label="Readback" class="readback mono">
      {shown}
    </p>
  );
}
