import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, PanelLeft, Save, Send } from 'lucide-react';
import type {
  Cut,
  Part,
  ProgrammeDetail,
  ProgrammeStatus,
  ProgrammeSummary,
  StringCount,
  WorkDetail,
  WorkSummary,
} from '../../../shared/api.js';
import { EN_DASH, MINUS_SIGN, MIDDLE_DOT, formatRunningTime, formatStringCount } from '../../../shared/format.js';
import { displayBusinessDate, displayInstant } from '../../../shared/london.js';
import { ApiFailure, api, newIdempotencyKey } from '../api.js';
import { STORE_OFFLINE_BANNER, useApp } from '../app.js';
import { Modal, useReducedMotion } from '../ui.js';
import { uploadFailureReason } from '../upload-reason.js';
import type { SpliceAnimation } from './bar-ruler.js';
import { BarRuler } from './bar-ruler.js';
import { AddWorkDialog, NewProgrammeDialog, NoticesDialog, PublishDialog, StringCountFields } from './desk-dialogs.js';
import { PartsTable, STORE_OFFLINE_DESCRIPTION_ID } from './parts-table.js';

const STATUS_LABELS: Record<ProgrammeStatus, string> = {
  draft: 'Draft',
  in_preparation: 'In preparation',
  published: 'Published',
  in_performance: 'In performance',
  closed: 'Closed',
};

const EDGE_BUTTONS: { to: ProgrammeStatus; from: ProgrammeStatus; label: string }[] = [
  { from: 'draft', to: 'in_preparation', label: 'Start preparation' },
  { from: 'in_preparation', to: 'draft', label: 'Return to draft' },
  { from: 'published', to: 'in_performance', label: 'Start performances' },
  { from: 'in_performance', to: 'closed', label: 'Close programme' },
];

const SECTION_KEYS: (keyof StringCount)[] = ['violin_1', 'violin_2', 'viola', 'cello', 'bass'];

interface DeskData {
  programmes: ProgrammeSummary[];
  programme: ProgrammeDetail;
  work: WorkDetail | null;
}

type DialogName = 'new-programme' | 'add-work' | 'publish' | 'notices' | 'drawer' | null;

function workSummaryOf(work: WorkDetail): WorkSummary {
  return {
    id: work.id,
    programme_id: work.programme_id,
    catalogue_work_id: work.catalogue_work_id,
    title: work.title,
    composer: work.composer,
    bars: work.bars,
    running_time_seconds: work.running_time_seconds,
    running_time: work.running_time,
    copies: work.copies,
    parts_to_mark: work.parts_to_mark,
  };
}

function useLayout(): 'wide' | 'medium' | 'narrow' {
  const [layout, setLayout] = useState<'wide' | 'medium' | 'narrow'>(() => readLayout());
  useEffect(() => {
    const listener = (): void => setLayout(readLayout());
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);
  return layout;
}

function readLayout(): 'wide' | 'medium' | 'narrow' {
  if (typeof window === 'undefined') return 'wide';
  if (window.innerWidth >= 1280) return 'wide';
  if (window.innerWidth >= 768) return 'medium';
  return 'narrow';
}

export function Desk({ programmeId }: { programmeId: string | null }): JSX.Element {
  const { user, status, statusTick, visibilityTick, navigate, path } = useApp();
  const reducedMotion = useReducedMotion();
  const layout = useLayout();

  const [data, setData] = useState<DeskData | null>(null);
  const [deskStatus, setDeskStatus] = useState<string[]>([]);
  const [rulerStatus, setRulerStatus] = useState<string[]>([]);
  const [animation, setAnimation] = useState<SpliceAnimation | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [typedCounts, setTypedCounts] = useState<Partial<Record<keyof StringCount, string>>>({});
  const [countErrors, setCountErrors] = useState<Partial<Record<keyof StringCount, string>>>({});
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState('');

  const inFlight = useRef(0);
  const saveSequence = useRef(0);
  const animating = useRef(false);
  const publishKey = useRef<string | null>(null);
  const undoStacks = useRef<Record<string, string[]>>({});
  const rulerFocus = useRef<(() => void) | null>(null);

  const principal = user.role === 'principal_librarian';
  const selectedWorkId = new URLSearchParams(path.split('?')[1] ?? '').get('work');

  const busy = useCallback(() => inFlight.current > 0 || animating.current, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      try {
        const listed = await api.programmes();
        const target =
          programmeId ??
          listed.programmes.find((entry) => entry.status !== 'closed')?.id ??
          listed.programmes[0]?.id ??
          null;
        if (target === null) {
          setData(null);
          return;
        }
        const programme = await api.programme(target);
        const workId =
          selectedWorkId !== null && programme.works.some((work) => work.id === selectedWorkId)
            ? selectedWorkId
            : (programme.works[0]?.id ?? null);
        const work = workId === null ? null : await api.work(workId);
        if (mode === 'refresh' && busy()) return;
        setData({ programmes: listed.programmes, programme, work });
      } catch {
        /* a failed read leaves the screen as it is */
      }
    },
    [programmeId, selectedWorkId, busy],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  useEffect(() => {
    if (statusTick > 0) void load('refresh');
  }, [statusTick, load]);

  useEffect(() => {
    if (visibilityTick > 0) void load('refresh');
  }, [visibilityTick, load]);

  function begin(): number {
    inFlight.current += 1;
    saveSequence.current += 1;
    return saveSequence.current;
  }

  function end(ticket: number): boolean {
    inFlight.current -= 1;
    return ticket === saveSequence.current;
  }

  const applyProgramme = useCallback((programme: ProgrammeDetail, work: WorkDetail | null) => {
    setData((current) => {
      if (!current) return current;
      return {
        programmes: current.programmes.map((entry) => (entry.id === programme.id ? programme : entry)),
        programme,
        work: work ?? current.work,
      };
    });
  }, []);

  const applySummary = useCallback((summary: ProgrammeSummary, work: WorkDetail | null) => {
    setData((current) => {
      if (!current) return current;
      const works = work
        ? current.programme.works.map((entry) => (entry.id === work.id ? workSummaryOf(work) : entry))
        : current.programme.works;
      return {
        programmes: current.programmes.map((entry) =>
          entry.id === summary.id ? { ...entry, ...summary } : entry,
        ),
        programme: { ...current.programme, ...summary, works },
        work: work ?? current.work,
      };
    });
  }, []);

  async function refreshFigures(): Promise<void> {
    if (!data) return;
    try {
      const [listed, programme] = await Promise.all([api.programmes(), api.programme(data.programme.id)]);
      const work = data.work ? await api.work(data.work.id) : null;
      setData({ programmes: listed.programmes, programme, work });
    } catch {
      /* a failed read leaves the screen as it is */
    }
  }

  async function saveStringCount(): Promise<void> {
    if (!data) return;
    const counts: StringCount = {
      violin_1: Number(typedCounts.violin_1 ?? data.programme.string_count.violin_1),
      violin_2: Number(typedCounts.violin_2 ?? data.programme.string_count.violin_2),
      viola: Number(typedCounts.viola ?? data.programme.string_count.viola),
      cello: Number(typedCounts.cello ?? data.programme.string_count.cello),
      bass: Number(typedCounts.bass ?? data.programme.string_count.bass),
    };
    setDeskStatus(['Saving string count']);
    setCountErrors({});
    const ticket = begin();
    try {
      const programme = await api.saveStringCount(data.programme.id, counts);
      const work = data.work ? await api.work(data.work.id) : null;
      if (!end(ticket)) return;
      applyProgramme(programme, work);
      setTypedCounts({});
      setDeskStatus([
        `String count saved: ${formatStringCount(programme.string_count)}. Short ${programme.copies.shortfall}.`,
      ]);
    } catch (failure) {
      if (!end(ticket)) return;
      if (failure instanceof ApiFailure && failure.status === 422) {
        const errors: Partial<Record<keyof StringCount, string>> = {};
        for (const key of SECTION_KEYS) {
          const message = failure.fieldError(key);
          if (message !== undefined) errors[key] = message;
        }
        setCountErrors(errors);
        setDeskStatus(['String count not saved. Check the highlighted sections.']);
        return;
      }
      setDeskStatus([failure instanceof ApiFailure ? failure.body.message : 'String count not saved.']);
    }
  }

  const partLabel = (part: Part): string => `${data?.work?.title ?? ''} \u2014 ${part.name}`;

  async function saveHoldings(part: Part, copiesOnHand: number): Promise<void> {
    const label = partLabel(part);
    setDeskStatus([`Saving copies for ${label}`]);
    const ticket = begin();
    try {
      const answer = await api.saveHoldings(part.id, copiesOnHand);
      if (!end(ticket)) return;
      setData((current) => {
        if (!current) return current;
        return {
          programmes: current.programmes.map((entry) =>
            entry.id === answer.programme.id ? { ...entry, ...answer.programme } : entry,
          ),
          programme: {
            ...current.programme,
            ...answer.programme,
            works: current.programme.works.map((entry) =>
              entry.id === answer.work.id ? answer.work : entry,
            ),
          },
          work:
            current.work && current.work.id === answer.work.id
              ? {
                  ...current.work,
                  copies: answer.work.copies,
                  parts_to_mark: answer.work.parts_to_mark,
                  running_time: answer.work.running_time,
                  running_time_seconds: answer.work.running_time_seconds,
                  parts: current.work.parts.map((entry) => (entry.id === answer.part.id ? answer.part : entry)),
                }
              : current.work,
        };
      });
      setDeskStatus([`Copies on hand saved for ${label}: ${answer.part.copies.on_hand}.`]);
    } catch (failure) {
      if (!end(ticket)) return;
      if (failure instanceof ApiFailure) {
        setDeskStatus([failure.fieldError('copies_on_hand') ?? failure.body.message]);
        return;
      }
      setDeskStatus([`Copies on hand not saved for ${label}.`]);
    }
  }

  async function recordMarked(part: Part): Promise<void> {
    if (!data?.work) return;
    const cuts = data.work.cuts.filter((cut) => part.cuts_to_mark.includes(cut.id));
    setDeskStatus(['Recording']);
    const lines: string[] = [];
    for (const cut of cuts) {
      try {
        await api.recordMark(part.id, cut.id);
        lines.push(`${partLabel(part)} carries cut ${cut.from_bar}${EN_DASH}${cut.to_bar}.`);
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          lines.push(failure.fieldError('cut_id') ?? failure.body.message);
        } else {
          lines.push(`${partLabel(part)} was not recorded.`);
        }
      }
    }
    setDeskStatus(lines);
    await refreshFigures();
  }

  function playSplice(
    direction: 'cut' | 'restore',
    span: { from_bar: number; to_bar: number },
    nextWork: WorkDetail,
    nextProgramme: ProgrammeSummary,
    statusLine: string,
    returnFocusToRuler: boolean,
  ): void {
    const finish = (): void => {
      animating.current = false;
      setAnimation(null);
      applySummary(nextProgramme, nextWork);
      setRulerStatus([statusLine]);
      if (returnFocusToRuler) rulerFocus.current?.();
    };

    if (reducedMotion) {
      finish();
      return;
    }

    const fromSeconds = data?.programme.running_time_seconds ?? nextProgramme.running_time_seconds;
    const toSeconds = nextProgramme.running_time_seconds;
    animating.current = true;
    setAnimation({ direction, ...span, phase: 'hatch', displayedSeconds: fromSeconds });
    window.setTimeout(() => {
      setAnimation((current) => (current ? { ...current, phase: 'collapse' } : current));
    }, 100);
    window.setTimeout(() => {
      const started = performance.now();
      const step = (now: number): void => {
        const share = Math.min(1, (now - started) / 330);
        const exact = fromSeconds + (toSeconds - fromSeconds) * share;
        const value = direction === 'cut' ? Math.ceil(exact) : Math.floor(exact);
        setAnimation((current) => (current ? { ...current, phase: 'count', displayedSeconds: value } : current));
        if (share < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        finish();
      };
      window.requestAnimationFrame(step);
    }, 430);
  }

  async function commitCut(fromBar: number, toBar: number, returnFocusToRuler: boolean): Promise<void> {
    if (!data?.work) return;
    const workId = data.work.id;
    setRulerStatus([`Marking cut ${fromBar}${EN_DASH}${toBar}`]);
    const ticket = begin();
    try {
      const answer = await api.createCut(workId, fromBar, toBar);
      if (!end(ticket)) return;
      const parts = answer.cut.parts_to_mark;
      const line =
        `Cut bars ${fromBar}${EN_DASH}${toBar} ${MIDDLE_DOT} ${MINUS_SIGN}${answer.cut.saved} ` +
        `${MIDDLE_DOT} ${parts} ${parts === 1 ? 'part' : 'parts'} to mark`;
      undoStacks.current[workId] = [...(undoStacks.current[workId] ?? []), answer.cut.id];
      playSplice('cut', { from_bar: fromBar, to_bar: toBar }, answer.work, answer.programme, line, returnFocusToRuler);
    } catch (failure) {
      if (!end(ticket)) return;
      if (failure instanceof ApiFailure && failure.body.error === 'programme_closed') {
        setDeskStatus([failure.body.message]);
        setRulerStatus([]);
        return;
      }
      setRulerStatus([failure instanceof ApiFailure ? failure.body.message : 'That cut was not marked.']);
    }
  }

  async function restoreCut(cut: Cut): Promise<void> {
    if (!data?.work) return;
    const workId = data.work.id;
    setRulerStatus([`Restoring bars ${cut.from_bar}${EN_DASH}${cut.to_bar}`]);
    const ticket = begin();
    try {
      const answer = await api.deleteCut(cut.id);
      if (!end(ticket)) return;
      undoStacks.current[workId] = (undoStacks.current[workId] ?? []).filter((id) => id !== cut.id);
      playSplice(
        'restore',
        { from_bar: cut.from_bar, to_bar: cut.to_bar },
        answer.work,
        answer.programme,
        `Restored bars ${cut.from_bar}${EN_DASH}${cut.to_bar} ${MIDDLE_DOT} +${cut.saved}`,
        true,
      );
    } catch (failure) {
      if (!end(ticket)) return;
      if (failure instanceof ApiFailure && failure.body.error === 'programme_closed') {
        setDeskStatus([failure.body.message]);
        setRulerStatus([]);
        return;
      }
      setRulerStatus([failure instanceof ApiFailure ? failure.body.message : 'That cut was not restored.']);
    }
  }

  async function uploadScan(part: Part, file: File): Promise<void> {
    const label = partLabel(part);
    setUploadStatus(`Uploading scan for ${label}`);
    setUploadProgress(0);
    try {
      await api.uploadScan(part.id, 'marked_part', file, {
        onProgress: (share) => setUploadProgress(share),
        idempotencyKey: newIdempotencyKey(),
      });
      setUploadStatus(`Scan filed for ${label}.`);
      await refreshFigures();
    } catch (failure) {
      setUploadStatus(`Scan not filed for ${label}: ${uploadFailureReason(failure)}.`);
    } finally {
      setUploadProgress(null);
    }
  }

  async function changeStatus(to: ProgrammeStatus): Promise<void> {
    if (!data) return;
    setDeskStatus(['Updating programme']);
    try {
      const programme = await api.transitionProgramme(data.programme.id, to);
      applyProgramme(programme, null);
      setDeskStatus([`Programme ${programme.number} is now ${STATUS_LABELS[programme.status]}.`]);
    } catch (failure) {
      setDeskStatus([failure instanceof ApiFailure ? failure.body.message : 'The programme was not updated.']);
    }
  }

  async function publish(): Promise<void> {
    if (!data) return;
    setDeskStatus(['Publishing folders']);
    if (publishKey.current === null) publishKey.current = newIdempotencyKey();
    try {
      const answer = await api.publish(data.programme.id, publishKey.current);
      publishKey.current = null;
      applyProgramme(answer.programme, null);
      setDeskStatus([
        `Folders published. Player notices: ${answer.notices.sent} sent, ${answer.notices.queued} queued.`,
      ]);
      setDialog(null);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        publishKey.current = null;
        setDeskStatus([failure.body.message]);
        await refreshFigures();
        return;
      }
      setDeskStatus(['Folders were not published.']);
    }
  }

  async function addWork(catalogueWorkId: string, title: string): Promise<void> {
    if (!data) return;
    setDeskStatus(['Adding work']);
    setDialog(null);
    try {
      await api.addWork(data.programme.id, catalogueWorkId);
      setDeskStatus([`${title} added to Programme ${data.programme.number}.`]);
      await refreshFigures();
    } catch (failure) {
      setDeskStatus([failure instanceof ApiFailure ? failure.body.message : `${title} was not added.`]);
    }
  }

  const rail = useMemo(() => {
    if (!data) return null;
    return (
      <WorksRail
        programmes={data.programmes}
        programme={data.programme}
        selectedWorkId={data.work?.id ?? null}
        onOpenProgramme={(id) => {
          navigate(`/desk/${id}`);
          setDialog(null);
        }}
        onSelectWork={(id) => {
          navigate(`/desk/${data.programme.id}?work=${id}`);
          setDialog(null);
        }}
      />
    );
  }, [data, navigate]);

  if (!data) {
    return (
      <main className="desk">
        <p className="loading">Opening the programme desk</p>
      </main>
    );
  }

  const programme = data.programme;
  const runningTime = animation ? formatRunningTime(animation.displayedSeconds) : programme.running_time;
  const undoStack = data.work ? (undoStacks.current[data.work.id] ?? []) : [];
  const lastCommittedId = undoStack[undoStack.length - 1];
  const undoableCut = data.work?.cuts.find((cut) => cut.id === lastCommittedId) ?? null;

  return (
    <main className={`desk desk-${layout}`}>
      {status.storage === 'down' ? (
        <span className="visually-hidden" id={STORE_OFFLINE_DESCRIPTION_ID}>
          {STORE_OFFLINE_BANNER}
        </span>
      ) : null}

      {layout === 'wide' ? <div className="rail-column">{rail}</div> : null}

      <div className="desk-main">
        <section className="programme-header" aria-label="Programme header">
          {layout === 'medium' ? (
            <button type="button" className="drawer-button" onClick={() => setDialog('drawer')}>
              <PanelLeft className="icon" aria-hidden="true" focusable="false" />
              Programmes and works
            </button>
          ) : null}
          <div className="header-title">
            <h1>{programme.title}</h1>
            <span className="mono programme-number">{programme.number}</span>
            <span className="status-label">{STATUS_LABELS[programme.status]}</span>
          </div>
          <div className="header-dates mono">
            <span>First rehearsal {displayInstant(programme.first_rehearsal)}</span>
            <span>Final performance {displayBusinessDate(programme.final_performance_date)}</span>
          </div>
          <div className="header-figures">
            <div role="group" aria-label="Running time" className="mono">
              {runningTime}
            </div>
            <div role="group" aria-label="Programme copies" className="mono">
              <span>Needed {programme.copies.needed}</span>
              <span>On hand {programme.copies.on_hand}</span>
              <span>
                <span className="short-word">Short</span>{' '}
                <span className={programme.copies.shortfall > 0 ? 'short-value' : undefined}>
                  {programme.copies.shortfall}
                </span>
              </span>
            </div>
          </div>

          <div className="header-counts">
            <StringCountFields
              idPrefix="header"
              values={{
                violin_1: typedCounts.violin_1 ?? String(programme.string_count.violin_1),
                violin_2: typedCounts.violin_2 ?? String(programme.string_count.violin_2),
                viola: typedCounts.viola ?? String(programme.string_count.viola),
                cello: typedCounts.cello ?? String(programme.string_count.cello),
                bass: typedCounts.bass ?? String(programme.string_count.bass),
              }}
              descriptions={countErrors}
              onChange={(key, value) => setTypedCounts((current) => ({ ...current, [key]: value }))}
            />
            <button type="button" className="primary" onClick={() => void saveStringCount()}>
              <Save className="icon" aria-hidden="true" focusable="false" />
              Save string count
            </button>
          </div>

          <div className="header-actions">
            {principal ? (
              <>
                <button type="button" onClick={() => setDialog('new-programme')}>
                  <FilePlus2 className="icon" aria-hidden="true" focusable="false" />
                  New programme
                </button>
                <button type="button" onClick={() => setDialog('add-work')}>
                  Add work
                </button>
                {EDGE_BUTTONS.filter((edge) => edge.from === programme.status).map((edge) => (
                  <button key={edge.to} type="button" onClick={() => void changeStatus(edge.to)}>
                    {edge.label}
                  </button>
                ))}
                {programme.status === 'in_preparation' ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setDialog('publish');
                      void refreshFigures();
                    }}
                  >
                    <Send className="icon" aria-hidden="true" focusable="false" />
                    Publish folders
                  </button>
                ) : null}
              </>
            ) : null}
            <button type="button" role="link" className="as-link" onClick={() => setDialog('notices')}>
              Player notices
            </button>
          </div>

          <p className="desk-status" role="status" aria-label="Desk status">
            {deskStatus.map((line, index) => (
              <span key={`${index}-${line}`} className="status-line">
                {line}
              </span>
            ))}
          </p>
        </section>

        {layout === 'narrow' ? <div className="rail-inline">{rail}</div> : null}

        {data.work ? (
          <BarRuler
            work={data.work}
            animation={animation}
            statusLines={rulerStatus}
            mayEdit={principal}
            undoableCut={undoableCut}
            onCommitCut={(fromBar, toBar, returnFocusToRuler) =>
              void commitCut(fromBar, toBar, returnFocusToRuler)
            }
            onRestoreCut={(cut) => void restoreCut(cut)}
            rulerFocusRef={rulerFocus}
          />
        ) : (
          <section className="ruler-pane">
            <p>This programme has no works yet.</p>
          </section>
        )}

        {data.work ? (
          <PartsTable
            work={data.work}
            mayEditHoldings
            mayUpload
            storageDown={status.storage === 'down'}
            onSaveHoldings={saveHoldings}
            onRecordMarked={(part) => void recordMarked(part)}
            onUploadScan={(part, file) => void uploadScan(part, file)}
            uploadProgress={uploadProgress}
            uploadStatus={uploadStatus}
          />
        ) : null}
      </div>

      {dialog === 'drawer' ? (
        <Modal name="Programmes and works" variant="drawer" onClose={() => setDialog(null)}>
          {rail}
        </Modal>
      ) : null}
      {dialog === 'new-programme' ? (
        <NewProgrammeDialog
          onClose={() => setDialog(null)}
          onPending={() => setDeskStatus(['Creating programme'])}
          onFailed={(message) => setDeskStatus([message])}
          onCreated={(created) => {
            setDialog(null);
            setDeskStatus([`Programme ${created.number} created.`]);
            navigate(`/desk/${created.id}`);
          }}
        />
      ) : null}
      {dialog === 'add-work' ? (
        <AddWorkDialog onClose={() => setDialog(null)} onAdd={(id, title) => void addWork(id, title)} />
      ) : null}
      {dialog === 'publish' ? (
        <PublishDialog programme={programme} onClose={() => setDialog(null)} onPublish={() => void publish()} />
      ) : null}
      {dialog === 'notices' ? (
        <NoticesDialog programmeId={programme.id} onClose={() => setDialog(null)} />
      ) : null}
    </main>
  );
}

function WorksRail({
  programmes,
  programme,
  selectedWorkId,
  onOpenProgramme,
  onSelectWork,
}: {
  programmes: ProgrammeSummary[];
  programme: ProgrammeDetail;
  selectedWorkId: string | null;
  onOpenProgramme: (id: string) => void;
  onSelectWork: (id: string) => void;
}): JSX.Element {
  return (
    <aside className="rail" aria-label="Programmes and works">
      {programmes.map((entry) => (
        <div className="rail-programme" key={entry.id}>
          <a
            href={`/desk/${entry.id}`}
            aria-label={`Programme ${entry.number} ${MIDDLE_DOT} ${entry.title}`}
            className={entry.id === programme.id ? 'current' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onOpenProgramme(entry.id);
            }}
          >
            <span className="display rail-number">{entry.number}</span>
            <span className="rail-title">{`Programme ${entry.number} ${MIDDLE_DOT} ${entry.title}`}</span>
            <span className="status-label">{STATUS_LABELS[entry.status]}</span>
          </a>
          {entry.id === programme.id ? (
            <ul aria-label="Works in programme" className="rail-works">
              {programme.works.map((work) => (
                <li key={work.id}>
                  <a
                    href={`/desk/${programme.id}?work=${work.id}`}
                    className={work.id === selectedWorkId ? 'current' : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                      event.preventDefault();
                      onSelectWork(work.id);
                    }}
                  >
                    {work.title}
                  </a>
                  <span className="rail-figures mono">
                    <span>Needed {work.copies.needed}</span>
                    <span>On hand {work.copies.on_hand}</span>
                    <span>
                      <span className="short-word">Short</span>{' '}
                      <span className={work.copies.shortfall > 0 ? 'short-value' : undefined}>
                        {work.copies.shortfall}
                      </span>
                    </span>
                    <span>{work.parts_to_mark} to mark</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </aside>
  );
}
