import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, get, post, isDefect, type Answer, type Defect, type Dive, type AnyDefect, type Pen, type Proposal } from "../api";
import { Editor } from "../editor";
import type { WallPoint } from "../engine/twin";
import { clock } from "../format";
import { rememberPen } from "../recent";
import { useLive } from "../shell";
import { Stage, useStageKeys, type StageHandle } from "../stage";
import { Link, RowBody, RowDetail, Tabs, dialogsOpen, navigate, useInterval, useLayout, useReducedMotion } from "../ui";

interface EditorSession {
  key: number;
  mode: "edit" | "new";
  defectId?: string;
  wallPoint?: WallPoint;
  opener: HTMLElement | null;
  closing: boolean;
}

function parseAddress(): { view: "cylinder" | "flat"; defect: string | null } {
  const query = new URLSearchParams(location.search);
  return { view: query.get("view") === "flat" ? "flat" : "cylinder", defect: query.get("defect") };
}

export function WorkspacePage({ penId }: { penId: string }) {
  const [pens, setPens] = useState<Pen[]>([]);
  useEffect(() => {
    get<{ pens: Pen[] }>("/api/pens", { silent: true }).then((reply) => setPens(reply.pens), () => undefined);
  }, []);
  useLive((event) => {
    if (event.type === "farm.erased" || event.type === "resync") get<{ pens: Pen[] }>("/api/pens", { silent: true }).then((reply) => setPens(reply.pens), () => undefined);
  });
  return <WorkspaceBody key={penId} penId={penId} pens={pens} />;
}

function useDiveClock(penId: string): string | null {
  const [dive, setDive] = useState<{ elapsed: number; at: number } | null>(null);
  const [, tick] = useState(0);
  const load = useCallback(async () => {
    try {
      const reply = await get<{ dives: Dive[] }>("/api/dives", { silent: true });
      const running = reply.dives.find((d) => d.pen_id === penId && d.status === "started");
      setDive(running ? { elapsed: running.elapsed_s ?? 0, at: performance.now() } : null);
    } catch {
      /* the next refresh tries again */
    }
  }, [penId]);
  useEffect(() => { void load(); }, [load]);
  useLive((event) => { if (event.type === "dive.changed" || event.type === "resync") void load(); });
  useInterval(() => void load(), 30000);
  useInterval(() => tick((n) => n + 1), 1000, dive !== null);
  return dive ? clock(dive.elapsed + (performance.now() - dive.at) / 1000) : null;
}

function WorkspaceBody({ penId, pens }: { penId: string; pens: Pen[] }) {
  const layout = useLayout();
  const reduced = useReducedMotion();
  const initial = useRef(parseAddress());
  const stage = useRef<StageHandle>(null);
  const [pen, setPen] = useState<Pen | null>(null);
  const [selected, setSelected] = useState<string | null>(initial.current.defect);
  const [settled, setSettled] = useState<"cylinder" | "flat">(initial.current.view);
  const [marking, setMarking] = useState(false);
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [panelTab, setPanelTab] = useState("Defects");
  const alive = useRef(true);
  const keySeq = useRef(0);
  const lastFocus = useRef<string | null>(null);
  const placeholderFocus = useRef<string | null>(null);
  const diveClock = useDiveClock(penId);

  useEffect(() => { rememberPen(penId); }, [penId]);

  const load = useCallback(async () => {
    try {
      const reply = await get<{ pen: Pen }>(`/api/pens/${penId}`, { silent: true });
      if (alive.current) setPen(reply.pen);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404 && alive.current) navigate("/", true);
    }
  }, [penId]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const defects: AnyDefect[] = useMemo(() => pen?.defects ?? [], [pen]);
  const live: Defect[] = useMemo(() => defects.filter(isDefect), [defects]);
  const hasLocks = live.some((d) => d.lock);
  useInterval(() => void load(), 3000, hasLocks);

  useLive((event) => {
    if (event.type === "resync") void load();
    else if (event.pen_id === penId) {
      void load();
      if (event.defect_id) setHistoryTick((n) => n + 1);
    } else if (event.type === "import.created" && event.pen_ids?.includes(penId)) void load();
    else if (event.type === "farm.erased" && event.farm_id === pen?.farm_id) navigate("/", true);
  });

  const validSelected = pen && selected && live.some((d) => d.id === selected) ? selected : null;
  useEffect(() => { if (pen && selected && !validSelected) setSelected(null); }, [pen, selected, validSelected]);

  useEffect(() => {
    const defect = pen ? validSelected : initial.current.defect;
    const url = `/pens/${penId}?view=${settled}${defect ? `&defect=${defect}` : ""}`;
    if (location.pathname + location.search !== url) history.replaceState(history.state, "", url);
  }, [penId, settled, validSelected, pen]);

  // ---- selection and the camera
  const selectDefect = useCallback((id: string | null, fly: boolean) => {
    setSelected(id);
    if (id && fly) stage.current?.flyTo(id);
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    const ids = live.map((d) => d.id);
    if (!ids.length) return;
    const at = validSelected ? ids.indexOf(validSelected) : -1;
    const next = at < 0 ? (direction > 0 ? 0 : ids.length - 1) : (at + direction + ids.length) % ids.length;
    selectDefect(ids[next], true);
  }, [live, validSelected, selectDefect]);

  // ---- editor sessions
  const rowFor = (id: string) => document.querySelector<HTMLElement>(`[data-row="${id}"]`);
  const openEditor = useCallback((id: string, opener?: HTMLElement | null) => {
    const from = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setEditor((cur) => {
      if (cur && !cur.closing && cur.mode === "edit" && cur.defectId === id) return cur;
      keySeq.current += 1;
      return { key: keySeq.current, mode: "edit", defectId: id, opener: from, closing: false };
    });
  }, []);
  const closeEditor = useCallback((returnFocus = true) => {
    if (!editor || editor.closing) return;
    const session = editor;
    setEditor({ ...session, closing: true });
    if (returnFocus) {
      const target = session.opener && session.opener.isConnected && session.opener !== document.body ? session.opener : session.defectId ? rowFor(session.defectId) : null;
      target?.focus();
    }
    if (reduced) setEditor(null);
    else window.setTimeout(() => setEditor((cur) => (cur && cur.key === session.key && cur.closing ? null : cur)), 250);
  }, [editor, reduced]);

  const toggleMarking = useCallback(() => setMarking((on) => !on), []);
  const onWall = useCallback((point: WallPoint) => {
    setMarking(false);
    keySeq.current += 1;
    setEditor({ key: keySeq.current, mode: "new", wallPoint: point, opener: document.querySelector<HTMLElement>(".stage-button[aria-pressed]"), closing: false });
  }, []);

  useStageKeys({ stage, step, edit: () => { if (validSelected) openEditor(validSelected); }, mark: toggleMarking });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialogsOpen()) return;
      if (marking) setMarking(false);
      else if (editor && !editor.closing) closeEditor();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [marking, editor, closeEditor]);

  useLayoutEffect(() => {
    if (!pen) return;
    if (placeholderFocus.current) {
      rowFor(placeholderFocus.current)?.focus();
      placeholderFocus.current = null;
      return;
    }
    const last = lastFocus.current;
    if (last && (!document.activeElement || document.activeElement === document.body)) {
      if (defects.find((d) => d.id === last)?.removed) rowFor(last)?.focus();
    }
  }, [pen, defects]);

  const editorDefect = editor?.mode === "edit" ? live.find((d) => d.id === editor.defectId) : undefined;
  const flat = settled === "flat";

  const stageNode = (
    <Stage
      ref={stage}
      penName={pen?.name ?? pens.find((p) => p.id === penId)?.name ?? ""}
      geo={pen}
      defects={live}
      selectedId={validSelected}
      focusIds={focusIds}
      diveClock={diveClock}
      marking={marking}
      readOnly={false}
      loading={!pen}
      initialView={initial.current.view}
      onSelect={(id) => selectDefect(id, false)}
      onEnter={(id, el) => openEditor(id, el)}
      onWall={onWall}
      onMark={toggleMarking}
      onSettled={setSettled}
    />
  );

  const penList = (strip: boolean) => (
    <ul role="list" aria-label="Pens" className={strip ? "pen-list pen-strip" : "pen-list"}>
      {pens.map((p) => (
        <li key={p.id}><Link to={`/pens/${p.id}`} aria-current={p.id === penId ? "page" : undefined}>{p.name}</Link></li>
      ))}
    </ul>
  );

  const copilot = (
    <CopilotPanel key="copilot" penId={penId} defects={defects} onFocus={setFocusIds} onShow={(id) => selectDefect(id, true)} onPen={setPen} />
  );

  const defectsPanel = (
    <section aria-label="Defects" className="defects-panel">
      <div className="defects-list-wrap">
        {!pen ? <div className="skeleton rows-skeleton" aria-hidden="true" /> : defects.length === 0 ? (
          <h2 className="statement">No defects marked on this pen</h2>
        ) : (
          <ul role="list" aria-label="Defect list" className="defect-list">
            {defects.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={d.id === validSelected ? "row selected" : "row"}
                  data-row={d.id}
                  data-defect={d.id}
                  aria-label={d.removed ? `${d.id}, Defect removed` : `${d.id}, ${d.type}`}
                  aria-describedby={d.removed ? undefined : `row-detail-${d.id}`}
                  onClick={() => { if (!d.removed) selectDefect(d.id, true); }}
                  onDoubleClick={(event) => { if (!d.removed) openEditor(d.id, event.currentTarget); }}
                >
                  {d.removed ? <span>{d.id} Defect removed</span> : <RowBody defect={d} flat={flat} showLock />}
                </button>
                {!d.removed && <RowDetail defect={d} flat={flat} showLock />}
              </li>
            ))}
          </ul>
        )}
      </div>
      {editor && pen && (editor.mode === "new" || editorDefect) && (
        <Editor
          key={editor.key}
          mode={editor.mode}
          defect={editorDefect}
          wallPoint={editor.wallPoint}
          pen={pen}
          closing={editor.closing}
          historyTick={historyTick}
          onPen={setPen}
          onCreated={(defect) => selectDefect(defect.id, false)}
          onClose={() => closeEditor()}
          onDeleted={(id) => { placeholderFocus.current = id; closeEditor(false); }}
        />
      )}
    </section>
  );

  return (
    <div
      className={`workspace workspace-${layout}`}
      onFocusCapture={(event) => { lastFocus.current = (event.target as HTMLElement).closest<HTMLElement>("[data-defect]")?.dataset.defect ?? null; }}
    >
      {layout === "phone" ? (
        <>
          <label className="pen-picker">
            <span className="visually-hidden">Pen</span>
            <select aria-label="Pen" value={penId} onChange={(e) => navigate(`/pens/${e.target.value}`)}>
              {pens.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {stageNode}
          <Tabs label="Pen panels" tabs={["Defects", "Copilot", "Pens"]} selected={panelTab} onSelect={setPanelTab} idPrefix="pen"
            panels={{ Defects: defectsPanel, Copilot: copilot, Pens: penList(false) }} />
        </>
      ) : (
        <>
          <div className="ws-pens">{penList(layout === "tablet")}</div>
          <div className="ws-stage">{stageNode}</div>
          <div className="ws-copilot">{copilot}</div>
          <div className="ws-defects">{defectsPanel}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- copilot
function CopilotPanel({ penId, defects, onFocus, onShow, onPen }: {
  penId: string; defects: AnyDefect[]; onFocus: (ids: string[]) => void; onShow: (id: string) => void; onPen: (pen: Pen) => void;
}) {
  const [question, setQuestion] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [applying, setApplying] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const ask = async () => {
    const mine = ++seq.current;
    setLines(["Asking copilot…"]);
    setAnswer(null);
    onFocus([]);
    try {
      const reply = await post<{ answer: Answer }>(`/api/pens/${penId}/copilot`, { question });
      if (!alive.current || mine !== seq.current) return;
      setAnswer(reply.answer);
      setApplied([]);
      setLines(["Copilot answered", ...(reply.answer.dropped_ids.length ? [`Ignored unknown defects: ${reply.answer.dropped_ids.join(", ")}`] : [])]);
      onFocus(reply.answer.focus);
      if (reply.answer.focus[0]) onShow(reply.answer.focus[0]);
    } catch (error) {
      if (!alive.current || mine !== seq.current) return;
      setLines(error instanceof ApiFailure ? [error.fields?.question ?? error.message] : []);
      onFocus([]);
    }
  };

  const apply = async (proposal: Proposal) => {
    if (applying.includes(proposal.id)) return;
    setApplying((list) => [...list, proposal.id]);
    setLines(["Applying repair…"]);
    try {
      const reply = await post<{ defect: Defect; pen: Pen }>(`/api/proposals/${proposal.id}/apply`);
      if (!alive.current) return;
      onPen(reply.pen);
      setApplied((list) => [...list, proposal.id]);
      setLines([`Repair recorded for ${reply.defect.id}`]);
    } catch (error) {
      if (alive.current && error instanceof ApiFailure) setLines([error.message]);
    } finally {
      if (alive.current) setApplying((list) => list.filter((id) => id !== proposal.id));
    }
  };

  const proposalState = (p: Proposal): string | null => {
    const defect = defects.find((d) => d.id === p.defect_id);
    if (defect?.removed) return `${p.defect_id} was removed`;
    if (applied.includes(p.id)) return `Applied to ${p.defect_id}`;
    if (defect && !defect.removed && defect.status === "repaired") return `${p.defect_id} is already repaired`;
    return null;
  };

  return (
    <section aria-label="Copilot" className="copilot">
      <h2>Copilot</h2>
      <div className="ask-row">
        <input type="text" aria-label="Ask the copilot" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void ask(); } }} autoComplete="off" />
        <button type="button" className="btn" onClick={() => void ask()}>Ask</button>
      </div>
      <p role="status" aria-label="Copilot status" className="copilot-status">
        {lines.map((line) => <span key={line} className="block">{line}</span>)}
      </p>
      {answer && (
        <div className="answer">
          {answer.text && <p>{answer.text}</p>}
          <div className="answer-focus">
            {answer.focus.map((id) => <button key={id} type="button" className="btn" onClick={() => onShow(id)}>Show {id}</button>)}
          </div>
          <ul role="list" className="proposals plain">
            {answer.proposals.map((p) => {
              const state = proposalState(p);
              return (
                <li key={p.id}>
                  <span>{`${p.defect_id}: ${p.method.replace("_", " ")} — ${p.note}`}</span>
                  {state ? <span className="muted">{state}</span> : (
                    <button type="button" className="btn" disabled={applying.includes(p.id)} aria-busy={applying.includes(p.id)} onClick={() => void apply(p)}>
                      Apply repair to {p.defect_id}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

