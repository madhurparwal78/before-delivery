// The programme desk: works rail, programme header, bar ruler and parts table. Every figure comes
// from the server; of several saves in flight only the latest one's answer is rendered.

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Menu, Plus, Send, Undo2, Scissors, Users } from "lucide-react";
import {
  PROGRAMME_STATUS_LABELS,
  SECTION_KEYS,
  clockText,
  type Cut,
  type Part,
  type ProgrammeDetail,
  type ProgrammeStatus,
  type ProgrammeSummary,
  type SectionKey,
  type User,
  type WorkDetail,
  type WorkSummary,
} from "../../shared/api";
import { dateLabel, dateTimeLabel } from "../../shared/london";
import { call, freshKey, get, uploadReason, uploadScan } from "../api";
import { AddWorkDialog, CountInputs, NewProgrammeDialog, NoticesDialog, PublishDialog } from "../desk/Dialogs";
import { PartsTable, type UploadProgress } from "../desk/PartsTable";
import { RailContent } from "../desk/Rail";
import { Ruler, type RulerSelection, type Span } from "../desk/Ruler";
import { spliceAt, type SpliceState } from "../desk/splice";
import { navigate } from "../router";
import { useStatus } from "../status";
import { Figure } from "../ui/Figure";
import { Modal, prefersReducedMotion } from "../ui/Modal";

const CLOSED_COPY = "This programme is closed. Its counts and cuts can't change.";

const TRANSITIONS: Record<ProgrammeStatus, { to: ProgrammeStatus; label: string }[]> = {
  draft: [{ to: "in_preparation", label: "Start preparation" }],
  in_preparation: [{ to: "draft", label: "Return to draft" }],
  published: [{ to: "in_performance", label: "Start performances" }],
  in_performance: [{ to: "closed", label: "Close programme" }],
  closed: [],
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function withSummary(detail: ProgrammeDetail, summary: ProgrammeSummary): ProgrammeDetail {
  return { ...detail, ...summary, works: detail.works };
}

function withWork(detail: ProgrammeDetail, work: WorkSummary): ProgrammeDetail {
  const { id, programme_id, catalogue_work_id, title, composer, bars, running_time_seconds, running_time, copies, parts_to_mark } = work;
  const summary: WorkSummary = { id, programme_id, catalogue_work_id, title, composer, bars, running_time_seconds, running_time, copies, parts_to_mark };
  return { ...detail, works: detail.works.map((w) => (w.id === work.id ? summary : w)) };
}

function replaceListed(list: ProgrammeSummary[] | null, summary: ProgrammeSummary): ProgrammeSummary[] | null {
  return list?.map((p) => (p.id === summary.id ? summary : p)) ?? null;
}

interface SpliceRun {
  kind: "cut" | "restore";
  span: Span;
  cuts: Span[];
  state: SpliceState;
}

const spansOf = (work: WorkDetail): Span[] => work.cuts.map((cut) => ({ from: cut.from_bar, to: cut.to_bar }));

interface DeskProps {
  user: User;
  programmeId: string | null;
  workId: string | null;
}

export function Desk({ user, programmeId, workId }: DeskProps) {
  const { status, refresh } = useStatus();
  const principal = user.role === "principal_librarian";
  const storeDown = status?.storage === "down";

  const [programmes, setProgrammes] = useState<ProgrammeSummary[] | null>(null);
  const [programme, setProgramme] = useState<ProgrammeDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [deskStatus, setDeskStatus] = useState("");
  const [rulerStatus, setRulerStatus] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SectionKey, string>>>({});
  const [countErrors, setCountErrors] = useState<Partial<Record<SectionKey, string>>>({});
  const [selection, setSelection] = useState<RulerSelection>({ caret: 1, anchor: null });
  const [splice, setSplice] = useState<SpliceRun | null>(null);
  const [dialog, setDialog] = useState<"new" | "add" | "publish" | "notices" | "drawer" | null>(null);
  const [restoring, setRestoring] = useState<{ cut: Cut; opener: HTMLButtonElement } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [cutPending, setCutPending] = useState(false);

  const slider = useRef<HTMLDivElement>(null);
  const markButton = useRef<HTMLButtonElement>(null);
  const version = useRef(0);
  const inflight = useRef(0);
  const countSeq = useRef(0);
  const holdSeq = useRef(new Map<string, number>());
  const sessionCuts = useRef(new Map<string, string[]>());
  const publishKey = useRef<string | null>(null);
  const splicing = useRef(false);
  const restoreChosen = useRef(false);

  const selectedWorkId = programme ? (workId && programme.works.some((w) => w.id === workId) ? workId : (programme.works[0]?.id ?? null)) : null;

  /** Re-reads the list, the programme and the selected work and renders them together. */
  const reread = useCallback(async (): Promise<void> => {
    if (!programmeId) return;
    const started = version.current;
    const [list, detail] = await Promise.all([
      get<{ programmes: ProgrammeSummary[] }>("/api/programmes"),
      get<ProgrammeDetail>(`/api/programmes/${programmeId}`),
    ]);
    const chosen = detail.ok ? (workId && detail.data.works.some((w) => w.id === workId) ? workId : detail.data.works[0]?.id) : undefined;
    const detailWork = chosen ? await get<WorkDetail>(`/api/works/${chosen}`) : null;
    if (inflight.current > 0 || version.current !== started || splicing.current) return;
    if (list.ok) setProgrammes(list.data.programmes);
    if (detail.ok) {
      setProgramme(detail.data);
      setMissing(false);
    } else if (detail.status === 404) {
      setMissing(true);
    }
    if (detailWork?.ok) setWork(detailWork.data);
    else if (detail.ok && !chosen) setWork(null);
  }, [programmeId, workId]);

  useEffect(() => {
    if (programmeId) return;
    void get<{ programmes: ProgrammeSummary[] }>("/api/programmes").then((answer) => {
      if (!answer.ok) return;
      setProgrammes(answer.data.programmes);
      const open = answer.data.programmes.find((p) => p.status !== "closed") ?? answer.data.programmes[0];
      if (open) navigate(`/desk/${open.id}`, true);
    });
  }, [programmeId]);

  useEffect(() => {
    void reread();
  }, [reread, refresh]);

  useEffect(() => {
    setSelection({ caret: 1, anchor: null });
    setRulerStatus("");
  }, [selectedWorkId]);

  useEffect(() => {
    const clear = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (slider.current?.parentElement?.contains(target) || markButton.current?.contains(target)) return;
      setSelection((current) => (current.anchor === null ? current : { ...current, anchor: null }));
    };
    document.addEventListener("pointerdown", clear);
    return () => document.removeEventListener("pointerdown", clear);
  }, []);

  /** Applies the answer to a save: the programme, its list entry and optionally the work, in one render. */
  const applySaved = (detail: ProgrammeDetail | null, summary: ProgrammeSummary | null, nextWork: WorkDetail | null): void => {
    version.current += 1;
    const merged = detail ?? (programme && summary ? withSummary(programme, summary) : programme);
    const withWorkSummary = merged && nextWork ? withWork(merged, nextWork) : merged;
    if (withWorkSummary) {
      setProgramme(withWorkSummary);
      setProgrammes((list) => replaceListed(list, withWorkSummary));
    }
    if (nextWork) setWork(nextWork);
  };

  const closedOr = (fallback: string, code: string | undefined): string => (code === "programme_closed" ? CLOSED_COPY : fallback);

  const saveStringCount = async (): Promise<void> => {
    if (!programme) return;
    const seq = ++countSeq.current;
    inflight.current += 1;
    setDeskStatus("Saving string count");
    const body = Object.fromEntries(
      SECTION_KEYS.map((section) => {
        const text = (drafts[section] ?? String(programme.string_count[section])).trim();
        return [section, /^\d+$/.test(text) ? Number(text) : text];
      }),
    );
    const answer = await call<ProgrammeDetail>("PUT", `/api/programmes/${programme.id}/string-count`, body);
    const nextWork = answer.ok && selectedWorkId ? await get<WorkDetail>(`/api/works/${selectedWorkId}`) : null;
    inflight.current -= 1;
    if (seq !== countSeq.current) return;
    if (answer.ok) {
      applySaved(answer.data, null, nextWork?.ok ? nextWork.data : null);
      setDrafts({});
      setCountErrors({});
      const count = SECTION_KEYS.map((section) => answer.data.string_count[section]).join("-");
      setDeskStatus(`String count saved: ${count}. Short ${answer.data.copies.shortfall}.`);
    } else if (answer.status === 422) {
      setCountErrors(answer.error?.errors ?? {});
      setDeskStatus("String count not saved. Check the highlighted sections.");
    } else {
      setDeskStatus(closedOr(answer.error?.message ?? "String count not saved.", answer.error?.error));
    }
  };

  const saveHoldings = async (part: Part, value: string): Promise<void> => {
    if (!work) return;
    const label = `${work.title} — ${part.name}`;
    const seq = (holdSeq.current.get(part.id) ?? 0) + 1;
    holdSeq.current.set(part.id, seq);
    inflight.current += 1;
    setDeskStatus(`Saving copies for ${label}`);
    const copies = /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    const answer = await call<{ part: Part; work: WorkSummary; programme: ProgrammeSummary }>("PUT", `/api/parts/${part.id}/holdings`, {
      copies_on_hand: copies,
    });
    inflight.current -= 1;
    if (seq !== holdSeq.current.get(part.id)) return;
    if (answer.ok) {
      const saved = answer.data;
      version.current += 1;
      setWork((current) =>
        current && current.id === saved.work.id
          ? { ...current, ...saved.work, parts: current.parts.map((p) => (p.id === saved.part.id ? saved.part : p)) }
          : current,
      );
      setProgramme((current) => (current ? withWork(withSummary(current, saved.programme), saved.work) : current));
      setProgrammes((list) => replaceListed(list, saved.programme));
      setDeskStatus(`Copies on hand saved for ${label}: ${saved.part.copies.on_hand}.`);
    } else {
      setDeskStatus(closedOr("Copies on hand must be a whole number from 0 to 99.", answer.error?.error));
    }
  };

  const rereadAfterChange = async (): Promise<void> => {
    version.current += 1;
    await reread();
  };

  const recordMarked = async (part: Part): Promise<void> => {
    if (!work) return;
    const label = `${work.title} — ${part.name}`;
    setDeskStatus("Recording");
    const lines: string[] = [];
    for (const cutId of part.cuts_to_mark) {
      const cut = work.cuts.find((c) => c.id === cutId);
      const answer = await call<{ part: Part }>("POST", `/api/parts/${part.id}/marks`, { cut_id: cutId });
      const span = cut ? `${cut.from_bar}–${cut.to_bar}` : "";
      if (answer.ok) lines.push(`${label} carries cut ${span}.`);
      else if (answer.status === 404) lines.push("That cut was restored before the mark was recorded.");
      else if (answer.status === 422) lines.push(`${label} doesn't play in bars ${span}.`);
      else lines.push(closedOr(answer.error?.message ?? "The mark was not recorded.", answer.error?.error));
    }
    setDeskStatus(lines.join("\n"));
    await rereadAfterChange();
  };

  const uploadMarked = async (part: Part, file: File): Promise<void> => {
    if (!work) return;
    const label = `${work.title} — ${part.name}`;
    setUpload({ partId: part.id, fraction: 0 });
    setUploadStatus(`Uploading scan for ${label}`);
    const answer = await uploadScan(part.id, "marked_part", file, (fraction) => setUpload({ partId: part.id, fraction }));
    setUpload(null);
    if (answer.ok) {
      setUploadStatus(`Scan filed for ${label}.`);
      await rereadAfterChange();
    } else {
      setUploadStatus(`Scan not filed for ${label}: ${uploadReason(answer.status, file.size)}.`);
    }
  };

  /** Plays the splice on the page clock, then calls `land` with the end state. */
  const playSplice = (run: Omit<SpliceRun, "state">, fromSeconds: number, toSeconds: number, land: () => void): void => {
    splicing.current = true;
    let begin: number | null = null;
    const step = (now: number): void => {
      begin ??= now;
      const state = spliceAt(run.kind, run.span, fromSeconds, toSeconds, now - begin);
      if (state.done) {
        splicing.current = false;
        flushSync(() => {
          setSplice(null);
          land();
        });
        return;
      }
      flushSync(() => setSplice({ ...run, state }));
      requestAnimationFrame(step);
    };
    setSplice({ ...run, state: spliceAt(run.kind, run.span, fromSeconds, toSeconds, 0) });
    requestAnimationFrame(step);
  };

  const commitCut = async (span: Span, viaButton: boolean): Promise<void> => {
    if (!work || !programme || cutPending || splicing.current) return;
    const text = `${span.from}–${span.to}`;
    setCutPending(true);
    setRulerStatus(`Marking cut ${text}`);
    inflight.current += 1;
    const answer = await call<{ cut: Cut; work: WorkDetail; programme: ProgrammeSummary }>("POST", `/api/works/${work.id}/cuts`, {
      from_bar: span.from,
      to_bar: span.to,
    });
    inflight.current -= 1;
    setCutPending(false);
    if (!answer.ok) {
      const code = answer.error?.error;
      if (code === "cut_overlaps") setRulerStatus(`Bars ${text} overlap an existing cut.`);
      else if (code === "cut_removes_whole_work") setRulerStatus("A cut can't remove every bar of a work.");
      else if (code === "programme_closed") setDeskStatus(CLOSED_COPY);
      else setRulerStatus(answer.error?.message ?? `Bars ${text} were not cut.`);
      return;
    }
    const { cut, work: nextWork, programme: summary } = answer.data;
    sessionCuts.current.set(nextWork.id, [...(sessionCuts.current.get(nextWork.id) ?? []), cut.id]);
    const after = cut.to_bar < nextWork.bars ? cut.to_bar + 1 : Math.max(cut.from_bar - 1, 1);
    setSelection({ caret: after, anchor: null });
    const done = `Cut bars ${text} · −${cut.saved} · ${plural(cut.parts_to_mark, "part to mark", "parts to mark")}`;
    version.current += 1;
    const land = (): void => {
      applySaved(null, summary, nextWork);
      setRulerStatus(done);
      if (viaButton) slider.current?.focus();
    };
    if (prefersReducedMotion()) {
      land();
      return;
    }
    playSplice({ kind: "cut", span, cuts: spansOf(nextWork) }, programme.running_time_seconds, summary.running_time_seconds, land);
  };

  const restoreCut = async (cut: Cut): Promise<void> => {
    if (!work || !programme || splicing.current) return;
    const text = `${cut.from_bar}–${cut.to_bar}`;
    setRulerStatus(`Restoring bars ${text}`);
    inflight.current += 1;
    const answer = await call<{ work: WorkDetail; programme: ProgrammeSummary }>("DELETE", `/api/cuts/${cut.id}`);
    inflight.current -= 1;
    if (!answer.ok) {
      if (answer.status === 404) setRulerStatus("That cut was already restored.");
      else if (answer.error?.error === "programme_closed") setDeskStatus(CLOSED_COPY);
      else setRulerStatus(answer.error?.message ?? `Bars ${text} were not restored.`);
      await rereadAfterChange();
      return;
    }
    const { work: nextWork, programme: summary } = answer.data;
    sessionCuts.current.set(nextWork.id, (sessionCuts.current.get(nextWork.id) ?? []).filter((id) => id !== cut.id));
    const fromSeconds = programme.running_time_seconds;
    const done = `Restored bars ${text} · +${cut.saved}`;
    applySaved(null, summary, nextWork);
    if (prefersReducedMotion()) {
      setRulerStatus(done);
      return;
    }
    const span = { from: cut.from_bar, to: cut.to_bar };
    playSplice({ kind: "restore", span, cuts: [...spansOf(nextWork), span] }, fromSeconds, summary.running_time_seconds, () =>
      setRulerStatus(done),
    );
  };

  const undoCut = (): void => {
    if (!work) return;
    const ids = sessionCuts.current.get(work.id) ?? [];
    const last = [...ids].reverse().map((id) => work.cuts.find((cut) => cut.id === id)).find((cut) => cut !== undefined);
    if (last) void restoreCut(last);
  };

  const transition = async (to: ProgrammeStatus): Promise<void> => {
    if (!programme) return;
    setDeskStatus("Updating programme");
    const answer = await call<ProgrammeDetail>("POST", `/api/programmes/${programme.id}/transition`, { to });
    if (answer.ok) {
      applySaved(answer.data, null, null);
      setDeskStatus(`Programme ${answer.data.number} is now ${PROGRAMME_STATUS_LABELS[answer.data.status]}.`);
    } else {
      setDeskStatus(answer.error?.message ?? "The programme was not updated.");
      await rereadAfterChange();
    }
  };

  const openPublish = async (): Promise<void> => {
    if (!programme) return;
    setDialog("publish");
    const answer = await get<ProgrammeDetail>(`/api/programmes/${programme.id}`);
    if (answer.ok) setProgramme(answer.data);
  };

  const publish = async (): Promise<void> => {
    if (!programme) return;
    publishKey.current ??= freshKey();
    setPublishing(true);
    setDeskStatus("Publishing folders");
    const answer = await call<{ programme: ProgrammeDetail; notices: { sent: number; queued: number } }>(
      "POST",
      `/api/programmes/${programme.id}/publish`,
      undefined,
      { "Idempotency-Key": publishKey.current },
    );
    setPublishing(false);
    if (answer.ok) {
      publishKey.current = null;
      applySaved(answer.data.programme, null, null);
      setDialog(null);
      setDeskStatus(`Folders published. Player notices: ${answer.data.notices.sent} sent, ${answer.data.notices.queued} queued.`);
      await rereadAfterChange();
      return;
    }
    if (answer.status !== 0) publishKey.current = null;
    setDeskStatus(answer.error?.message ?? "Folders were not published. Try again.");
    const fresh = await get<ProgrammeDetail>(`/api/programmes/${programme.id}`);
    if (fresh.ok) setProgramme(fresh.data);
  };

  if (missing) {
    return (
      <main className="page">
        <h1 className="page__title">That programme isn't on the desk.</h1>
        <p>Choose a programme from the rail, or open the desk again.</p>
      </main>
    );
  }

  // On a phone the rail sits below the header, so it waits for the programme rather than being pushed down by it.
  const rail = programmes && programme ? <RailContent programmes={programmes} current={programme} selectedWorkId={selectedWorkId} /> : null;
  const shownSeconds = splice ? splice.state.seconds : (programme?.running_time_seconds ?? 0);
  const landed = splice?.kind === "restore" && !splice.state.spliced;
  const rulerCuts = splice
    ? splice.cuts.filter((c) => !(landed && c.from === splice.span.from && c.to === splice.span.to))
    : work
      ? spansOf(work)
      : [];
  const finalDate = programme?.final_performance_date;
  const selected = selection.anchor === null ? null : { from: Math.min(selection.anchor, selection.caret), to: Math.max(selection.anchor, selection.caret) };
  const undoable = work ? (sessionCuts.current.get(work.id) ?? []).some((id) => work.cuts.some((cut) => cut.id === id)) : false;

  return (
    <div className="desk">
      <aside className="rail" aria-label="Programmes and works">
        {rail}
      </aside>
      <div className="desk__toolbar">
        <button type="button" className="button drawer-button" onClick={() => setDialog("drawer")}>
          <Menu aria-hidden="true" />
          Programmes and works
        </button>
      </div>
      <section className="header" aria-label="Programme header">
        {programme ? (
          <>
            <div className="header__top">
              <div className="header__titles">
                <p className="header__eyebrow">
                  <span className="mono">Programme {programme.number}</span>
                  <span className="badge">{PROGRAMME_STATUS_LABELS[programme.status]}</span>
                </p>
                <h1 className="header__title">{programme.title}</h1>
                <p className="header__dates">
                  <span>
                    First rehearsal <span className="mono">{dateTimeLabel(programme.first_rehearsal)}</span>
                  </span>
                  {finalDate && (
                    <span>
                      Final performance <span className="mono">{dateLabel(finalDate)}</span>
                    </span>
                  )}
                </p>
              </div>
              <div className="header__actions">
                {principal && (
                  <>
                    <button type="button" className="button" onClick={() => setDialog("new")}>
                      <Plus aria-hidden="true" />
                      New programme
                    </button>
                    <button type="button" className="button" onClick={() => setDialog("add")}>
                      <Plus aria-hidden="true" />
                      Add work
                    </button>
                    {TRANSITIONS[programme.status].map((edge) => (
                      <button key={edge.to} type="button" className="button" onClick={() => void transition(edge.to)}>
                        {edge.label}
                      </button>
                    ))}
                    {programme.status === "in_preparation" && (
                      <button type="button" className="button button--primary" onClick={() => void openPublish()}>
                        <Send aria-hidden="true" />
                        Publish folders
                      </button>
                    )}
                  </>
                )}
                <a
                  className="link-button"
                  href={`/desk/${programme.id}#player-notices`}
                  onClick={(event) => {
                    event.preventDefault();
                    setDialog("notices");
                  }}
                >
                  <Users aria-hidden="true" />
                  Player notices
                </a>
              </div>
            </div>
            <div className="header__figures">
              <div role="group" aria-label="Running time" className="stat">
                <span className="stat__label">Running time</span>
                <span className="stat__value mono">{clockText(shownSeconds)}</span>
              </div>
              <div role="group" aria-label="Programme copies" className="stat stat--copies">
                <span className="stat__label">Programme copies</span>
                <span className="stat__figures">
                  <Figure label="Needed" value={programme.copies.needed} />
                  <Figure label="On hand" value={programme.copies.on_hand} />
                  <Figure label="Short" value={programme.copies.shortfall} caution />
                </span>
              </div>
              <form
                className="stat stat--count"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveStringCount();
                }}
              >
                <span className="stat__label">String count</span>
                <div className="stat__count">
                  <CountInputs
                    values={Object.fromEntries(
                      SECTION_KEYS.map((section) => [section, drafts[section] ?? String(programme.string_count[section])]),
                    ) as Record<SectionKey, string>}
                    onChange={(section, value) => setDrafts((current) => ({ ...current, [section]: value }))}
                    errors={countErrors}
                  />
                  {principal && (
                    <button type="submit" className="button button--primary">
                      Save string count
                    </button>
                  )}
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="placeholder" aria-hidden="true">
            <span />
            <span />
          </div>
        )}
      </section>
      <p className="desk__status" role="status" aria-label="Desk status">
        {deskStatus}
      </p>
      <section className="ruler-pane" aria-label={work ? `Bar ruler of ${work.title}` : "Bar ruler"}>
        {work && (
          <>
            <div className="pane-heading">
              <h2 className="pane-heading__title">{work.title}</h2>
              <span className="pane-heading__meta">
                {work.composer} · <span className="mono">{work.bars}</span> bars · <span className="mono">{work.running_time}</span>
              </span>
              <span className="pane-heading__actions">
                {principal && (
                  <>
                    <button
                      ref={markButton}
                      type="button"
                      className="button button--primary"
                      disabled={selected === null || cutPending}
                      onClick={() => selected && void commitCut(selected, true)}
                    >
                      <Scissors aria-hidden="true" />
                      {selected ? `Mark cut ${selected.from}–${selected.to}` : "Mark cut"}
                    </button>
                    <button type="button" className="button" disabled={!undoable} onClick={undoCut}>
                      <Undo2 aria-hidden="true" />
                      Undo cut
                    </button>
                  </>
                )}
              </span>
            </div>
            <Ruler
              work={work}
              cuts={rulerCuts}
              frame={splice?.state.frame ?? null}
              selection={selection}
              onSelection={setSelection}
              onCommit={(span) => principal && void commitCut(span, false)}
              onRestore={(cut, opener) => {
                if (!principal) return;
                restoreChosen.current = false;
                setRestoring({ cut, opener });
              }}
              sliderRef={slider}
            />
            <p className="ruler-status" role="status" aria-label="Ruler status">
              {rulerStatus}
            </p>
          </>
        )}
      </section>
      {work ? (
        <PartsTable
          work={work}
          storeDown={storeDown}
          upload={upload}
          uploadStatus={uploadStatus}
          onHoldings={(part, value) => void saveHoldings(part, value)}
          onRecordMarked={(part) => void recordMarked(part)}
          onUpload={(part, file) => void uploadMarked(part, file)}
        />
      ) : (
        <section className="parts-pane" aria-label="Parts">
          {programme && programme.works.length === 0 && <p className="empty-line">This programme has no works yet. Add a work from the catalogue.</p>}
        </section>
      )}
      <Modal open={dialog === "drawer"} title="Programmes and works" variant="drawer" onDismiss={() => setDialog(null)}>
        <button type="button" className="button drawer__close" onClick={() => setDialog(null)}>
          Close
        </button>
        {programmes && (
          <RailContent programmes={programmes} current={programme} selectedWorkId={selectedWorkId} onChoose={() => setDialog(null)} />
        )}
      </Modal>
      <NewProgrammeDialog
        open={dialog === "new"}
        onClose={() => setDialog(null)}
        setDeskStatus={setDeskStatus}
        onCreated={(created) => {
          setDialog(null);
          setProgrammes((list) => (list ? [...list.filter((p) => p.id !== created.id), created] : [created]));
          navigate(`/desk/${created.id}`);
        }}
      />
      {programme && (
        <>
          <AddWorkDialog
            open={dialog === "add"}
            programme={programme}
            onClose={() => setDialog(null)}
            setDeskStatus={setDeskStatus}
            onAdded={() => {
              setDialog(null);
              void rereadAfterChange();
            }}
          />
          <PublishDialog
            open={dialog === "publish"}
            programme={programme}
            pending={publishing}
            onClose={() => setDialog(null)}
            onPublish={() => void publish()}
          />
          <NoticesDialog open={dialog === "notices"} programmeId={programme.id} onClose={() => setDialog(null)} />
        </>
      )}
      <Modal
        open={restoring !== null}
        title={restoring ? `Restore bars ${restoring.cut.from_bar}–${restoring.cut.to_bar}` : "Restore bars"}
        onDismiss={() => setRestoring(null)}
        returnFocus={() => (restoreChosen.current ? slider.current : null)}
      >
        {restoring && (
          <>
            <p>
              Put bars <span className="mono">{restoring.cut.from_bar}–{restoring.cut.to_bar}</span> back into {work?.title}. This
              adds <span className="mono">{restoring.cut.saved}</span> to the running time and removes the cut's marks.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  const cut = restoring.cut;
                  restoreChosen.current = true;
                  setRestoring(null);
                  void restoreCut(cut);
                }}
              >
                Restore bars
              </button>
              <button type="button" className="button" onClick={() => setRestoring(null)}>
                Keep cut
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
