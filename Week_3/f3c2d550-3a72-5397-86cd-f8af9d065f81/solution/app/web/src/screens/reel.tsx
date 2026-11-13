import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { Paper, Reel, Reference, Sheet } from "../../../shared/api";
import type { SizeUnit } from "../../../shared/sizes";
import { api, ApiError } from "../api";
import { Segmented } from "../controls";
import { COPY, useDeck } from "../deck";
import { Dialog } from "../dialog";
import { useField } from "../field";
import { utcStamp } from "../format";
import { useDocumentTitle, useRefetch } from "../hooks";
import { measureRows, slideRowOut, slideRowsFrom } from "../motion";
import { useStopPlayer, type PlayerStop } from "../player";
import { UNIT_OPTIONS } from "./capture";
import { subjectOf } from "./library";

type Direction = "up" | "down";

interface Move {
  ids: string[];
  movedId: string;
  title: string;
  /** The button to keep focused when the move is refused; null for a removal. */
  button: Direction | null;
}

interface Accepted {
  version: number;
  ids: string[];
}

const SHEET_POLL_MS = 1_500;
const PAPER_OPTIONS = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "US Letter" },
] as const;
const STATE_WORDS = { queued: "Queued", rendering: "Rendering", ready: "Ready", failed: "Failed" } as const;

function stopFromUrl(count: number): number {
  const raw = new URLSearchParams(window.location.search).get("stop");
  const wanted = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 1;
  return wanted >= 1 && wanted <= count ? wanted - 1 : 0;
}

export function ReelScreen() {
  const { id = "" } = useParams();
  const field = useField();
  const { say, unit } = useDeck();
  const [reel, setReel] = useState<Reel | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<string[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [printing, setPrinting] = useState(false);
  const [paper, setPaper] = useState<Paper>("a4");
  const [sheetUnit, setSheetUnit] = useState<SizeUnit | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const printButton = useRef<HTMLButtonElement>(null);
  const accepted = useRef<Accepted>({ version: 0, ids: [] });
  const queue = useRef<Move[]>([]);
  const sending = useRef(false);
  const leaving = useRef(new Set<string>());
  const flip = useRef<Map<string, DOMRect> | null>(null);
  const focusLabel = useRef<string | null>(null);
  const requested = useRef(new Set<string>());
  const sheetStates = useRef(new Map<string, Sheet["state"]>());
  const initialised = useRef(false);
  const currentKey = useRef<string | null>(null);
  const snapshot = useRef("");
  const previousIds = useRef<string[]>([]);
  useDocumentTitle(reel?.name ?? "Reel");

  const byId = useMemo(() => new Map((reel?.stops ?? []).map((stop) => [stop.reference.id, stop.reference])), [reel]);
  const rows = useMemo(
    () => view.flatMap((referenceId) => {
      const reference = byId.get(referenceId);
      return reference ? [reference] : [];
    }),
    [view, byId],
  );

  const stops = useMemo<PlayerStop[]>(
    () =>
      rows
        .filter((reference) => reference.state === "stored")
        .map((reference) => ({
          key: reference.id,
          subject: subjectOf(reference, unit),
          identity: { title: reference.title, maker: reference.maker, year: reference.year },
        })),
    [rows, unit],
  );

  const player = useStopPlayer(
    stops,
    () => [...(list.current?.querySelectorAll<HTMLElement>("[data-playable]") ?? [])],
    (at) => {
      currentKey.current = stops[at]?.key ?? null;
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?stop=${at + 1}`);
    },
  );

  const applyServerReel = useCallback((next: Reel) => {
    accepted.current = { version: next.version, ids: next.stops.map((stop) => stop.reference.id) };
    setReel(next);
    setView(accepted.current.ids);
  }, []);

  const busy = () => sending.current || queue.current.length > 0 || leaving.current.size > 0;

  useRefetch(
    {
      load: () => api<Reel>("GET", `/reels/${id}`),
      onData: (next) => {
        if (!busy()) applyServerReel(next);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 404) setMissing(true);
      },
    },
    id,
  );

  useEffect(() => {
    initialised.current = false;
    snapshot.current = "";
    setReel(null);
    setMissing(false);
  }, [id]);

  useEffect(() => {
    if (!reel) return;
    const allIds = view;
    if (stops.length === 0) {
      field.show(null, COPY.emptyReel);
      currentKey.current = null;
      initialised.current = true;
      previousIds.current = allIds;
      return;
    }
    const next = JSON.stringify(stops.map((stop) => [stop.key, stop.subject]));
    if (initialised.current && next === snapshot.current) {
      previousIds.current = allIds;
      return;
    }
    snapshot.current = next;
    if (!initialised.current) {
      initialised.current = true;
      const first = stopFromUrl(stops.length);
      player.place(first, first > 0);
    } else {
      const at = stops.findIndex((stop) => stop.key === currentKey.current);
      if (at >= 0) {
        player.place(at, false);
      } else {
        const held = currentKey.current;
        const order = held !== null && allIds.includes(held) ? allIds : previousIds.current;
        const position = held === null ? -1 : order.indexOf(held);
        const playable = new Set(stops.map((stop) => stop.key));
        const after = order.slice(position + 1).find((candidate) => playable.has(candidate));
        const before = order.slice(0, Math.max(position, 0)).reverse().find((candidate) => playable.has(candidate));
        const target = after ?? before;
        player.select(Math.max(0, stops.findIndex((stop) => stop.key === target)), true, after === undefined ? -1 : 1);
      }
    }
    previousIds.current = allIds;
  }, [reel, stops, view, field, player.place, player.select]);

  useEffect(() => () => field.show(null), [field]);

  useLayoutEffect(() => {
    if (flip.current) {
      slideRowsFrom(list.current, flip.current);
      flip.current = null;
    }
    const label = focusLabel.current;
    if (!label) return;
    focusLabel.current = null;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const target =
      buttons.find((button) => button.getAttribute("aria-label") === label) ??
      buttons.find((button) => button.getAttribute("aria-label") === label.replace(/ (up|down)$/, (_, way: string) => (way === "up" ? " down" : " up")));
    target?.focus();
  }, [view]);

  const pump = useCallback(async () => {
    if (sending.current) return;
    const move = queue.current.shift();
    if (!move) return;
    sending.current = true;
    try {
      const next = await api<Reel>("PUT", `/reels/${id}/stops`, {
        json: { version: accepted.current.version, reference_ids: move.ids },
      });
      accepted.current = { version: next.version, ids: next.stops.map((stop) => stop.reference.id) };
      setReel(next);
      if (queue.current.length === 0 && leaving.current.size === 0) setView(accepted.current.ids);
      say(
        move.button === null
          ? `Removed ${move.title} from the reel.`
          : `Moved ${move.title} to stop ${move.ids.indexOf(move.movedId) + 1}.`,
      );
    } catch (error) {
      queue.current = [];
      if (error instanceof ApiError && error.code === "reel_version_conflict") {
        if (move.button) focusLabel.current = `Move ${move.title} ${move.button}`;
        try {
          applyServerReel(await api<Reel>("GET", `/reels/${id}`));
        } catch {
          say(COPY.generic);
          sending.current = false;
          return;
        }
        say(COPY.reelConflict);
      } else {
        flip.current = measureRows(list.current);
        setView(accepted.current.ids);
        say(COPY.generic);
      }
    }
    sending.current = false;
    if (queue.current.length > 0) void pump();
  }, [applyServerReel, id, say]);

  const submitMove = (move: Move) => {
    flip.current = measureRows(list.current);
    if (move.button) focusLabel.current = `Move ${move.title} ${move.button}`;
    setView(move.ids);
    queue.current.push(move);
    void pump();
  };

  const moveBy = (reference: Reference, direction: Direction) => {
    const at = view.indexOf(reference.id);
    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= view.length) return;
    const ids = [...view];
    ids.splice(at, 1);
    ids.splice(to, 0, reference.id);
    submitMove({ ids, movedId: reference.id, title: reference.title, button: direction });
  };

  const dropOn = (movedId: string, targetId: string) => {
    const from = view.indexOf(movedId);
    const to = view.indexOf(targetId);
    const moved = byId.get(movedId);
    if (from < 0 || to < 0 || from === to || !moved) return;
    const ids = [...view];
    ids.splice(from, 1);
    ids.splice(to, 0, movedId);
    submitMove({ ids, movedId, title: moved.title, button: null });
  };

  const remove = async (reference: Reference) => {
    const row = list.current?.querySelector<HTMLElement>(`[data-row="${reference.id}"]`);
    const at = view.indexOf(reference.id);
    const nextReference = byId.get(view[at + 1] ?? "");
    const nextRemove = nextReference
      ? [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
          (button) => button.getAttribute("aria-label") === `Remove ${nextReference.title} from reel`,
        )
      : undefined;
    (nextRemove ?? printButton.current)?.focus();
    const ids = view.filter((candidate) => candidate !== reference.id);
    queue.current.push({ ids, movedId: reference.id, title: reference.title, button: null });
    leaving.current.add(reference.id);
    void pump();
    if (row) await slideRowOut(row);
    leaving.current.delete(reference.id);
    flip.current = measureRows(list.current);
    setView((previous) => previous.filter((candidate) => candidate !== reference.id));
  };

  const loadSheets = useCallback(async () => {
    const listing = await api<{ sheets: Sheet[] }>("GET", `/reels/${id}/sheets`);
    for (const sheet of listing.sheets) {
      const before = sheetStates.current.get(sheet.id);
      sheetStates.current.set(sheet.id, sheet.state);
      if (!requested.current.has(sheet.id) || before === sheet.state) continue;
      if (sheet.state === "ready") say(COPY.sheetReady);
      if (sheet.state === "failed") say(COPY.sheetFailed);
    }
    setSheets(listing.sheets);
  }, [id, say]);

  useRefetch({ load: loadSheets, onData: () => undefined }, id);

  const unsettled = sheets.some((sheet) => sheet.state === "queued" || sheet.state === "rendering");
  useEffect(() => {
    if (!unsettled) return;
    const timer = window.setInterval(() => void loadSheets().catch(() => undefined), SHEET_POLL_MS);
    return () => window.clearInterval(timer);
  }, [unsettled, loadSheets]);

  const requestSheet = async () => {
    setPrinting(false);
    try {
      const sheet = await api<Sheet>("POST", `/reels/${id}/sheets`, {
        json: { paper, unit: sheetUnit ?? unit },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      requested.current.add(sheet.id);
      sheetStates.current.set(sheet.id, sheet.state);
      setSheets((previous) => [sheet, ...previous]);
      say(COPY.sheetQueued);
    } catch (error) {
      say(error instanceof ApiError && error.code === "reel_empty" ? COPY.sheetEmpty : COPY.generic);
    }
  };

  const retry = async (sheet: Sheet) => {
    try {
      const queued = await api<Sheet>("POST", `/sheets/${sheet.id}/retry`);
      requested.current.add(queued.id);
      sheetStates.current.set(queued.id, queued.state);
      setSheets((previous) => previous.map((candidate) => (candidate.id === queued.id ? queued : candidate)));
      say(COPY.sheetQueued);
    } catch {
      say(COPY.generic);
    }
  };

  if (missing) {
    return (
      <>
        <h1>Reel not found</h1>
        <p className="muted">{COPY.unknown}</p>
      </>
    );
  }
  if (!reel) return <h1>Opening</h1>;

  return (
    <>
      <h1>{reel.name}</h1>
      <button ref={printButton} type="button" className="btn primary" onClick={() => setPrinting(true)}>
        Print contact sheet
      </button>
      <ol ref={list} role="list" aria-label="Stops" className="stops">
        {rows.map((reference, at) => {
          const trashed = reference.state === "trashed";
          return (
            <li
              key={reference.id}
              data-row={reference.id}
              data-playable={trashed ? undefined : ""}
              className="stop"
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/plain", reference.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                dropOn(event.dataTransfer.getData("text/plain"), reference.id);
              }}
            >
              <span className="stop-position size-line">{at + 1}</span>
              <div className="stop-info">
                <Link className="row-name" to={`/references/${reference.id}`}>
                  {reference.title}
                </Link>
                <span className="row-meta">
                  {reference.maker && <span>{reference.maker}</span>}
                  {trashed ? <span>In the trash</span> : <span className="size-line">{reference.size_text[unit]}</span>}
                </span>
              </div>
              <div className="stop-actions">
                {at > 0 && (
                  <button type="button" className="icon-btn" aria-label={`Move ${reference.title} up`} onClick={() => moveBy(reference, "up")}>
                    <ArrowUp aria-hidden="true" />
                  </button>
                )}
                {at < rows.length - 1 && (
                  <button type="button" className="icon-btn" aria-label={`Move ${reference.title} down`} onClick={() => moveBy(reference, "down")}>
                    <ArrowDown aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="icon-btn" aria-label={`Remove ${reference.title} from reel`} onClick={() => void remove(reference)}>
                  <X aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <h2>Contact sheets</h2>
      {sheets.length === 0 && <p className="muted">No contact sheets yet. Print contact sheet makes one.</p>}
      <ul role="list" aria-label="Contact sheets" className="sheets">
        {sheets.map((sheet) => (
          <li key={sheet.id} className="sheet">
            <span className="size-line">{utcStamp(sheet.requested_at)}</span>
            <span>{sheet.paper === "a4" ? "A4" : "US Letter"}</span>
            <span>{sheet.unit}</span>
            <strong>{STATE_WORDS[sheet.state]}</strong>
            {sheet.state === "ready" && sheet.pdf_url && (
              <a className="btn" href={sheet.pdf_url} download>
                Download PDF
              </a>
            )}
            {sheet.state === "failed" && (
              <button type="button" className="btn" onClick={() => void retry(sheet)}>
                Try again
              </button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={printing} label="Print contact sheet" onClose={() => setPrinting(false)}>
        <p className="dialog-title">Print contact sheet</p>
        <div className="field-row">
          <span className="label-line">Paper</span>
          <Segmented label="Paper" name="sheet-paper" value={paper} options={PAPER_OPTIONS} onChange={setPaper} />
        </div>
        <div className="field-row">
          <span className="label-line">Sheet unit</span>
          <Segmented label="Sheet unit" name="sheet-unit" value={sheetUnit ?? unit} options={UNIT_OPTIONS} onChange={setSheetUnit} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setPrinting(false)}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void requestSheet()}>
            Request sheet
          </button>
        </div>
      </Dialog>
    </>
  );
}
