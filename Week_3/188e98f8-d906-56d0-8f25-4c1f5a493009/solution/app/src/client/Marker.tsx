import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Answer } from "../shared/api-types";
import { STATUS_WORD, answersLeft, finishing, markedAnswer, roundMarked } from "./copy";
import { COPY } from "./copy";
import { Unreachable, errorCode, get, post, put, request } from "./api";
import type { Reply } from "./api";
import type { Round } from "../shared/api-types";
import { Dialog } from "./dialog";
import { focusQuietly } from "./focus";
import { useLeague, usePolling } from "./league";
import { useMessages } from "./messages";
import { Link, useLandAtTop } from "./router";
import { Page } from "./ui";

type Points = 0 | 1;

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path d="M3 9.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path d="M4 4l10 10M14 4L4 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

interface PaneProps {
  round: Round;
  initial: Answer[];
  open: boolean;
  onClose: () => void;
  onFinished: () => void;
  heading: () => HTMLElement | null;
}

function MarkingPane({ round, initial, open, onClose, onFinished, heading }: PaneProps) {
  const messages = useMessages();
  const { takeRound } = useLeague();
  const [rows, setRows] = useState<Answer[]>(initial);
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(new Set<number>());
  const finished = useRef(false);
  const wasOpen = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      finished.current = false;
      setRows(initial);
      setCurrent((initial.find((row) => row.mark === null) ?? initial[0])?.id ?? null);
    }
    wasOpen.current = open;
  }, [open]);

  const read = useCallback(async () => {
    if (!open) return;
    const reply = await get<{ answers: Answer[] }>(`/api/rounds/${round.number}/answers`);
    if (!reply.ok) return;
    setRows((existing) => {
      const mine = new Map(existing.map((row) => [row.id, row]));
      return reply.data.answers.map((fresh) => (saving.current.has(fresh.id) ? (mine.get(fresh.id) ?? fresh) : fresh));
    });
  }, [open, round.number]);
  usePolling(read, [read]);

  useLayoutEffect(() => {
    if (current === null) return;
    panel.current?.querySelector<HTMLElement>(`[data-row="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const nextUnmarked = (from: number, list: Answer[]): number | null => {
    const order = [...list.slice(from + 1), ...list.slice(0, from)];
    return order.find((row) => row.mark === null)?.id ?? null;
  };

  const mark = async (row: Answer, points: Points, advance: boolean) => {
    saving.current.add(row.id);
    const updated = rowsRef.current.map((entry) => (entry.id === row.id ? { ...entry, mark: points } : entry));
    setRows(updated);
    setCurrent(advance ? (nextUnmarked(updated.findIndex((entry) => entry.id === row.id), updated) ?? row.id) : row.id);
    try {
      const reply = await put<{ answer: Answer }>(`/api/rounds/${round.number}/marks`, { answer_id: row.id, points });
      if (reply.ok) messages.say(markedAnswer(row.team_name, row.question, points === 1));
      else {
        setRows((existing) => existing.map((entry) => (entry.id === row.id ? row : entry)));
        messages.say(COPY.unreachable, "error");
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      setRows((existing) => existing.map((entry) => (entry.id === row.id ? row : entry)));
      messages.say(COPY.unreachable, "error");
    } finally {
      saving.current.delete(row.id);
    }
  };

  const shortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = rows.findIndex((row) => row.id === current);
    const row = rows[index];
    switch (event.key.toLowerCase()) {
      case "c":
        if (row !== undefined) void mark(row, 1, true);
        break;
      case "x":
        if (row !== undefined) void mark(row, 0, true);
        break;
      case "j":
        setCurrent(rows[Math.min(index + 1, rows.length - 1)]?.id ?? current);
        break;
      case "k":
        setCurrent(rows[Math.max(index - 1, 0)]?.id ?? current);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const finish = async () => {
    messages.pending(finishing(round.number));
    setBusy(true);
    try {
      const reply: Reply<unknown> = await post(`/api/rounds/${round.number}/marked`);
      if (reply.ok) {
        takeRound((reply.data as { round: Round }).round);
        messages.say(roundMarked(round.number));
        finished.current = true;
        onFinished();
      } else if (errorCode(reply) === "unmarked_answers") {
        messages.say(answersLeft(round.number, (reply.data as { count: number }).count), "error");
      } else {
        messages.say(COPY.unreachable, "error");
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      messages.say(COPY.unreachable, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      label={`Mark round ${round.number}`}
      onRequestClose={onClose}
      onShortcut={shortcut}
      closeFocus={() => (finished.current ? heading() : null)}
      initialFocus={(box) => {
        const row = box.querySelector<HTMLElement>(`[data-row="${current}"]`);
        return row?.querySelector<HTMLElement>("input:checked") ?? row?.querySelector<HTMLElement>("input") ?? null;
      }}
    >
      <div className="panel-body mark-list" ref={panel}>
        {rows.map((row) => (
          <div key={row.id} className="mark-row" data-row={row.id} data-current={row.id === current}>
            <div className="mark-info">
              <span className="mark-who">
                {row.team_name} · Q{row.question}
              </span>
              <span className="mark-answer">{row.text}</span>
            </div>
            <div role="radiogroup" aria-label={`${row.team_name}, question ${row.question}`} className="choices">
              <label className="choice" data-kind="correct">
                <input
                  type="radio"
                  name={`mark-${row.id}`}
                  checked={row.mark === 1}
                  onChange={() => void mark(row, 1, false)}
                />
                <Check />
                <span>Correct</span>
              </label>
              <label className="choice" data-kind="wrong">
                <input
                  type="radio"
                  name={`mark-${row.id}`}
                  checked={row.mark === 0}
                  onChange={() => void mark(row, 0, false)}
                />
                <Cross />
                <span>Wrong</span>
              </label>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-actions">
        <button type="button" className="btn" onClick={() => void finish()} aria-busy={busy}>
          Finish marking
        </button>
        <button type="button" className="btn quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function Marker() {
  useLandAtTop();
  const heading = useRef<HTMLHeadingElement>(null);
  const { rounds } = useLeague();
  const [loaded, setLoaded] = useState<Record<number, Answer[]>>({});
  const [marking, setMarking] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const closedRef = useRef<number[]>([]);
  closedRef.current = (rounds ?? []).filter((round) => round.status === "closed").map((round) => round.number);

  useLayoutEffect(() => focusQuietly(heading.current), []);

  const read = useCallback(async () => {
    const entries = await Promise.all(
      closedRef.current.map(async (number) => {
        const reply = await request<{ answers: Answer[] }>("GET", `/api/rounds/${number}/answers`);
        return reply.ok ? ([number, reply.data.answers] as const) : null;
      }),
    );
    setLoaded((existing) => ({ ...existing, ...Object.fromEntries(entries.filter((entry) => entry !== null)) }));
  }, []);
  usePolling(read, []);
  const closedKey = closedRef.current.join(",");
  useEffect(() => {
    void read();
  }, [closedKey, read]);

  const round = rounds?.find((entry) => entry.number === marking) ?? null;
  return (
    <Page>
      <h1 tabIndex={-1} ref={heading}>
        Marking
      </h1>
      <p>
        <Link to="/archive" className="back-link">
          Answer archive
        </Link>
      </p>
      <ul className="mat round-list">
        {(rounds ?? []).map((entry) => (
          <li key={entry.number}>
            <span className="round-name">
              Round {entry.number}: {entry.title}
            </span>
            <span className="round-state">{STATUS_WORD[entry.status]}</span>
            {entry.status === "closed" && loaded[entry.number] !== undefined && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setMarking(entry.number);
                  setOpen(true);
                }}
              >
                Mark round {entry.number}
              </button>
            )}
          </li>
        ))}
      </ul>
      {round !== null && (
        <MarkingPane
          round={round}
          initial={loaded[round.number] ?? []}
          open={open}
          onClose={() => setOpen(false)}
          onFinished={() => setOpen(false)}
          heading={() => heading.current}
        />
      )}
    </Page>
  );
}
