// The farm manager's read-only report link page: the same stage, no editing controls, re-checked every 15 s.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiFailure, get, type Defect, type Grade, type Grid, type AnyDefect } from "../api";
import { gradeLine, utcDate, utcStamp, remaining } from "../format";
import { ShortcutsDialog, isTyping } from "../shell";
import { Stage, useStageKeys, type StageHandle } from "../stage";
import { RowBody, RowDetail, Tabs, Wordmark, dialogsOpen, useInterval, useLayout } from "../ui";

interface PublicReport {
  pen: { name: string; site_name: string; farm_name: string; circumference_m: number; net_depth_m: number; grid: Grid };
  grade: Grade;
  open_defects: number;
  defects: AnyDefect[];
  latest_revision: { number: number; published_at: string } | null;
  link: { status: string; expires_at: string; expires_in_s: number };
}

type State = { kind: "loading" } | { kind: "ok"; data: PublicReport } | { kind: "inactive" } | { kind: "missing" };

export function SharePage({ token }: { token: string }) {
  const layout = useLayout();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState("Defects");
  const [shortcuts, setShortcuts] = useState(false);
  const [flat, setFlat] = useState(false);
  const stage = useRef<StageHandle>(null);
  const lastFocus = useRef<string | null>(null);
  const before = useRef<string[]>([]);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await get<PublicReport>(`/api/share/${token}`, { silent: true });
      if (alive.current) setState({ kind: "ok", data });
    } catch (error) {
      if (!alive.current || !(error instanceof ApiFailure)) return;
      if (error.status === 410) setState({ kind: "inactive" });
      else if (error.status === 404) setState({ kind: "missing" });
    }
  }, [token]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useInterval(() => void load(), 15000);

  const data = state.kind === "ok" ? state.data : null;
  const defects = data?.defects ?? [];
  const live = defects.filter((d): d is Defect => !d.removed);
  const liveIds = live.map((d) => d.id).join("|");
  const shown = selected && live.some((d) => d.id === selected) ? selected : null;
  useEffect(() => { if (selected && !shown && data) setSelected(null); }, [selected, shown, data]);

  useLayoutEffect(() => {
    const last = lastFocus.current;
    const ids = live.map((d) => d.id);
    if (last && !ids.includes(last) && before.current.includes(last) && (!document.activeElement || document.activeElement === document.body)) {
      const old = before.current;
      const at = old.indexOf(last);
      const next = old.slice(at + 1).find((id) => ids.includes(id)) ?? [...old.slice(0, at)].reverse().find((id) => ids.includes(id));
      if (next) document.querySelector<HTMLElement>(`.pin[data-defect="${next}"]`)?.focus();
    }
    before.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIds]);

  const select = useCallback((id: string | null, fly: boolean) => {
    setSelected(id);
    if (id && fly) stage.current?.flyTo(id);
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    const ids = live.map((d) => d.id);
    if (!ids.length) return;
    const at = shown ? ids.indexOf(shown) : -1;
    select(ids[at < 0 ? (direction > 0 ? 0 : ids.length - 1) : (at + direction + ids.length) % ids.length], true);
  }, [live, shown, select]);
  useStageKeys({ stage, step });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping(document.activeElement) && !dialogsOpen()) {
        event.preventDefault();
        setShortcuts(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const bar = (
    <header className="topbar topbar-share">
      <span className="home"><Wordmark /></span>
      <span className="read-only">Read-only report</span>
    </header>
  );

  if (state.kind === "inactive" || state.kind === "missing") {
    return (
      <div className="app">
        {bar}
        <main className="page boot-message"><h1 className="statement">{state.kind === "inactive" ? "This report link is no longer active" : "This report link does not exist"}</h1></main>
      </div>
    );
  }

  const condition = data && (
    <section aria-label="Condition" className="share-condition">
      <h2>Condition</h2>
      <p className="grade-line num">{gradeLine(data.grade, data.open_defects)}</p>
      <p className="num">{data.latest_revision ? `Revision ${data.latest_revision.number} · ${utcDate(data.latest_revision.published_at)}` : "No revision published yet"}</p>
      <p className="num">{`Link expires ${utcStamp(data.link.expires_at)} (${remaining(data.link.expires_in_s)})`}</p>
    </section>
  );

  const list = (
    <section aria-label="Defects" className="defects-panel">
      <ul role="list" aria-label="Defect list" className="defect-list">
        {defects.map((d) => (
          <li key={d.id}>
            <button type="button" className={d.id === shown ? "row selected" : "row"} data-defect={d.id}
              aria-label={d.removed ? `${d.id}, Defect removed` : `${d.id}, ${d.type}`} aria-describedby={d.removed ? undefined : `row-detail-${d.id}`} onClick={() => { if (!d.removed) select(d.id, true); }}>
              {d.removed ? <span>{d.id} Defect removed</span> : <RowBody defect={d} flat={flat} />}
            </button>
            {!d.removed && <RowDetail defect={d} flat={flat} />}
          </li>
        ))}
      </ul>
    </section>
  );

  const stageNode = (
    <Stage
      ref={stage}
      penName={data?.pen.name ?? ""}
      geo={data ? { circumference_m: data.pen.circumference_m, net_depth_m: data.pen.net_depth_m, grid: data.pen.grid } : null}
      defects={live}
      selectedId={shown}
      focusIds={[]}
      diveClock={null}
      marking={false}
      readOnly
      loading={!data}
      initialView="cylinder"
      onSelect={(id) => select(id, false)}
      onSettled={(view) => setFlat(view === "flat")}
    />
  );

  return (
    <div className="app" onFocusCapture={(event) => { lastFocus.current = (event.target as HTMLElement).closest<HTMLElement>("[data-defect]")?.dataset.defect ?? null; }}>
      {bar}
      <main className={`page share share-${layout}`}>
        {layout === "phone" ? (
          <>
            <div className="share-stage">{stageNode}</div>
            <Tabs label="Report panels" tabs={["Defects", "Condition"]} selected={panelTab} onSelect={setPanelTab} idPrefix="report" panels={{ Defects: list, Condition: condition }} />
          </>
        ) : (
          <>
            <div className="share-stage">{stageNode}</div>
            <div className="share-side">{condition}{list}</div>
          </>
        )}
      </main>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}
