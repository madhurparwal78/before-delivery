import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PANES, PANE_LABEL, type Diff, type Pen, type VersionEntry } from "../../shared/types.js";
import { ApiFailure, api, messageOf } from "../api.js";
import { useAccount } from "../account.js";
import { CrossfadeStage } from "../components/crossfade-stage.js";
import { StatePanel } from "../components/panels.js";
import { Shell } from "../components/shell.js";
import { formatDate } from "../format.js";
import { Link, navigate, replaceQuery } from "../router.js";
import { useReducedMotion } from "../use-media.js";
import { NotFoundBody } from "./not-found.js";

const REST_MS = 320;
const CROSSFADE_MS = 600;
const TICK_STEPS = 12;
const MINUS = "−";

const bandHeight = (changed: number): number => 6 + 4 * Math.log2(1 + changed);
const counts = (added: number, removed: number): string => `+${added} ${MINUS}${removed}`;

function useTicker(target: number, instant: boolean): number {
  const [shown, setShown] = useState(target);
  const latest = useRef(target);
  useEffect(() => {
    if (instant || latest.current === target) {
      latest.current = target;
      setShown(target);
      return;
    }
    const start = latest.current;
    let step = 0;
    const timer = window.setInterval(() => {
      step++;
      const progress = 1 - Math.pow(1 - step / TICK_STEPS, 3);
      latest.current = Math.round(start + (target - start) * progress);
      setShown(latest.current);
      if (step >= TICK_STEPS) window.clearInterval(timer);
    }, CROSSFADE_MS / TICK_STEPS);
    return () => window.clearInterval(timer);
  }, [target, instant]);
  return shown;
}

function startingPair(count: number): { a: number; b: number } {
  const query = new URLSearchParams(location.search);
  const read = (name: string): number => {
    const found = /^v(\d+)$/.exec(query.get(name) ?? "");
    const value = found ? Number(found[1]) : 0;
    return value >= 1 && value <= count ? value : 0;
  };
  const a = read("a");
  const b = read("b");
  return a > 0 && b > 0 ? { a, b } : { a: count, b: count };
}

interface Loaded {
  pen: Pen;
  entries: VersionEntry[];
}

export function HistoryPage({ id }: { id: string }): React.JSX.Element {
  const { user } = useAccount();
  const reduced = useReducedMotion();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [marker, setMarker] = useState(1);
  const [pair, setPair] = useState({ a: 1, b: 1 });
  const [diff, setDiff] = useState<Diff | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);
  const rest = useRef<number | null>(null);
  const strata = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);

  useEffect(
    () => () => {
      if (rest.current !== null) window.clearTimeout(rest.current);
    },
    [],
  );

  useEffect(() => {
    const element = strata.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setRoom(element.clientHeight));
    observer.observe(element);
    setRoom(element.clientHeight);
    return () => observer.disconnect();
  }, [loaded !== null]);

  useEffect(() => {
    Promise.all([api.get<Pen>(`/api/pens/${id}`), api.get<{ versions: VersionEntry[] }>(`/api/pens/${id}/versions`)]).then(
      ([pen, listed]) => {
        const count = listed.versions.length;
        const start = startingPair(count);
        setLoaded({ pen, entries: listed.versions });
        setPair(start);
        setMarker(start.b);
      },
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
      },
    );
  }, [id]);

  const count = loaded?.entries.length ?? 0;

  useEffect(() => {
    if (count === 0) return;
    replaceQuery(new URLSearchParams({ a: `v${pair.a}`, b: `v${pair.b}` }));
    let current = true;
    void api.get<Diff>(`/api/pens/${id}/diff?a=${pair.a}&b=${pair.b}`).then((answer) => {
      if (current) setDiff(answer);
    });
    return () => {
      current = false;
    };
  }, [id, count, pair.a, pair.b]);

  const added = useTicker(diff?.added ?? 0, reduced);
  const removed = useTicker(diff?.removed ?? 0, reduced);

  if (missing) return <Shell><NotFoundBody /></Shell>;
  if (loaded === null) {
    return (
      <Shell>
        <StatePanel drawing={false}>Loading the core sample…</StatePanel>
      </Shell>
    );
  }
  const { pen, entries } = loaded;
  const head = entries.length;
  const isOwner = user !== null && user.handle === pen.owner;
  const sizes = entries.map((entry) => bandHeight(entry.changed_chars));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const scale = total > room && room > 0 ? room / total : 1;

  const settleOn = (version: number): void => {
    setPair((current) => ({ ...current, b: version }));
  };

  const moveTo = (version: number): void => {
    const next = Math.min(head, Math.max(1, version));
    setMarker(next);
    if (rest.current !== null) window.clearTimeout(rest.current);
    rest.current = window.setTimeout(() => settleOn(next), REST_MS);
  };

  const press = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target: Record<string, number> = { ArrowUp: marker + 1, ArrowDown: marker - 1, Home: 1, End: head };
    if (event.key === "Enter") {
      event.preventDefault();
      if (rest.current !== null) window.clearTimeout(rest.current);
      setPair({ a: marker, b: marker });
      return;
    }
    const next = target[event.key];
    if (next === undefined) return;
    event.preventDefault();
    moveTo(next);
  };

  const bandAt = (clientY: number): number => {
    const bands = [...(strata.current?.querySelectorAll<HTMLElement>("[data-version]") ?? [])];
    let best = marker;
    let distance = Infinity;
    for (const band of bands) {
      const box = band.getBoundingClientRect();
      const gap = clientY < box.top ? box.top - clientY : clientY > box.bottom ? clientY - box.bottom : 0;
      if (gap < distance) {
        distance = gap;
        best = Number(band.dataset["version"]);
      }
    }
    return best;
  };

  const drag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(bandAt(event.clientY));
  };

  const restore = async (): Promise<void> => {
    setBusy(true);
    setStatus("");
    try {
      const made = await api.post<{ number: number }>(`/api/pens/${id}/restore`, { version: pair.b, base_version: head });
      const listed = await api.get<{ versions: VersionEntry[] }>(`/api/pens/${id}/versions`);
      setLoaded({ pen, entries: listed.versions });
      setFresh(made.number);
      const land = (): void => navigate(`/pen/${id}`, { flash: `Restored version ${pair.b} as version ${made.number}` });
      if (reduced) land();
      else window.setTimeout(land, REST_MS);
    } catch (error) {
      setStatus(messageOf(error));
      setBusy(false);
    }
  };

  const selected = entries[marker - 1];

  return (
    <Shell>
      <div className="split history">
        <div className="split-stage strata-stage">
          <div className="history-preview">
            <CrossfadeStage penId={pen.head > 0 ? pen.id : null} version={pair.b} label={`Version ${pair.b} preview`} />
          </div>
          <div
            ref={strata}
            role="slider"
            aria-label="Core sample"
            aria-orientation="vertical"
            aria-valuemin={1}
            aria-valuemax={head}
            aria-valuenow={marker}
            aria-valuetext={
              selected ? `Version ${marker} of ${head}, saved ${formatDate(selected.created_at)}, ${counts(selected.added, selected.removed)}` : undefined
            }
            tabIndex={0}
            className="strata"
            onKeyDown={press}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              moveTo(bandAt(event.clientY));
            }}
            onPointerMove={drag}
          >
            {entries.map((entry, index) => (
              <div
                key={entry.number}
                className="band"
                data-version={entry.number}
                data-selected={entry.number === marker ? "true" : undefined}
                data-fresh={entry.number === fresh ? "true" : undefined}
                data-tone={entry.number % 2 === 0 ? "b" : "a"}
                style={{ height: `${(sizes[index] ?? 0) * scale}px` }}
              />
            ))}
          </div>
        </div>
        <section className="split-column">
          <h1>{pen.title}</h1>
          <div className="history-actions">
            {isOwner && pair.b !== head && (
              <button type="button" className="button primary" disabled={busy} aria-busy={busy} onClick={() => void restore()}>
                {`Restore version ${pair.b}`}
              </button>
            )}
            <Link to={`/pen/${id}`} className="button">
              Back to editor
            </Link>
          </div>
          <p role="status" aria-label="History status" className="status-line">
            {status}
          </p>
          <section aria-label="Compare" className="compare">
            <h2>{`Comparing version ${pair.a} with version ${pair.b}`}</h2>
            <p className="total tabular">{counts(added, removed)}</p>
            {PANES.map((pane) => (
              <section key={pane} aria-label={`${PANE_LABEL[pane]} changes`} className="pane-changes" data-pane={PANE_LABEL[pane]}>
                <p className="pane-counts tabular" data-label={PANE_LABEL[pane]}>{counts(diff?.panes[pane].added ?? 0, diff?.panes[pane].removed ?? 0)}</p>
                <div className="diff-rows">
                  {diff?.panes[pane].rows.map((row, index) => (
                    <div key={index} className="diff-row" data-change={row.change}>
                      {row.text}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </section>
        </section>
      </div>
    </Shell>
  );
}
