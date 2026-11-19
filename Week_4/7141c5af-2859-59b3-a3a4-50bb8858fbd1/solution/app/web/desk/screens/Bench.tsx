import { type JSX, render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { addDays, dateCopy, datetimeCopy } from "../../../server/domain/time.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, api, get, post } from "../lib/api.ts";
import { Dialog, type DialogControl, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Field, Problems, SelectField, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { EASE, MOVE_MS, reducedMotion, STEP_MS } from "../lib/motion.ts";
import { Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

type Bench = "frame" | "cover";

interface Job {
  id: string;
  pieceId: string;
  pieceTitle: string;
  bench: Bench;
  day: string;
  dayLabel: string;
  glue: { laidAt: string; curesAt: string; state: string; label: string } | null;
}

interface Week {
  week: string;
  jobs: Job[];
}

const BENCHES: readonly { value: Bench; label: string }[] = [
  { value: "frame", label: "Frame bench" },
  { value: "cover", label: "Cover bench" },
];
const WORKING_DAYS = 5;
const DRAG_START_PX = 4;

const benchName = (bench: Bench): string => (bench === "frame" ? "Frame bench" : "Cover bench");
const cellKey = (bench: string, day: string): string => `${bench}|${day}`;
const jobCell = (job: Job): string => cellKey(job.bench, job.day);

type Arrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
const isArrow = (key: string): key is Arrow => key.startsWith("Arrow");

function patchJob(job: Job, bench: Bench, day: string): Promise<unknown> {
  return api("PATCH", `/api/bench-jobs/${job.id}`, { bench, day });
}

function movedCopy(job: Job, bench: Bench, day: string): string {
  return copy("F-64", { job: job.pieceTitle, bench: benchName(bench), date: dateCopy(day) });
}

/** A job's own text and buttons, the same in the week grid and the agenda. */
function CardBody({ job, tabbable, onMove, onGlue }: { job: Job; tabbable: boolean; onMove: (from: HTMLElement) => void; onGlue: (from: HTMLElement) => void }): JSX.Element {
  const tabIndex = tabbable ? 0 : -1;
  return (
    <>
      <strong class="job-title">{job.pieceTitle}</strong>
      <span class="job-meta">
        {job.dayLabel} · {benchName(job.bench)}
      </span>
      {job.glue ? <span class="job-glue">{job.glue.label}</span> : null}
      <span class="job-actions">
        <button type="button" class="button" tabIndex={tabIndex} onClick={(event) => onMove(event.currentTarget)}>
          <span>
            Move <span class="visually-hidden">{job.pieceTitle} </span>to…
          </span>
        </button>
        <button type="button" class="button" tabIndex={tabIndex} onClick={(event) => onGlue(event.currentTarget)}>
          Glue laid
        </button>
      </span>
    </>
  );
}

interface GridProps {
  days: readonly string[];
  jobs: readonly Job[];
  reload: () => Promise<void>;
  onMove: (job: Job, from: HTMLElement) => void;
  onGlue: (job: Job, from: HTMLElement) => void;
}

interface Drag {
  job: Job;
  host: HTMLElement;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

/**
 * The week. A card keeps one element for its whole life, moving between cells, so its cell's
 * contents are placed by hand: each card is its own small render root inside a host element.
 */
function WeekGrid({ days, jobs, reload, onMove, onGlue }: GridProps): JSX.Element {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const hosts = useRef(new Map<string, HTMLElement>());
  const drag = useRef<Drag | null>(null);
  const moving = useRef(false);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const firstDay = days[0] as string;
  const inWeek = activeKey !== null && days.includes(activeKey.split("|")[1] as string);
  const active = inWeek ? (activeKey as string) : jobs[0] ? jobCell(jobs[0]) : cellKey("frame", firstDay);
  const occupied = new Set(jobs.map(jobCell));

  const glideHome = (host: HTMLElement, dx: number, dy: number): void => {
    host.style.transform = "";
    if (!reducedMotion()) host.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: MOVE_MS, easing: EASE });
  };

  const finishDrag = (host: HTMLElement): void => {
    host.classList.remove("job-card--dragging");
    drag.current = null;
  };

  const cellAt = (x: number, y: number): string | null => {
    for (const [key, cell] of cells.current) {
      const box = cell.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return key;
    }
    return null;
  };

  const drop = async (held: Drag, x: number, y: number): Promise<void> => {
    const target = cellAt(x, y);
    if (target === null || target === jobCell(held.job)) {
      glideHome(held.host, held.dx, held.dy);
      finishDrag(held.host);
      return;
    }
    const [bench, day] = target.split("|") as [Bench, string];
    try {
      await patchJob(held.job, bench, day);
    } catch (error) {
      glideHome(held.host, held.dx, held.dy);
      finishDrag(held.host);
      if (error instanceof ApiFailure) announce(error.message);
      return;
    }
    const from = held.host.getBoundingClientRect();
    (cells.current.get(target) as HTMLElement).appendChild(held.host);
    held.host.style.transform = "";
    const to = held.host.getBoundingClientRect();
    if (!reducedMotion()) held.host.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }], { duration: STEP_MS, easing: EASE });
    await reload();
    finishDrag(held.host);
    announce(movedCopy(held.job, bench, day));
  };

  const startDrag = (event: PointerEvent, host: HTMLElement, id: string): void => {
    const job = jobsRef.current.find((item) => item.id === id);
    if (!job || drag.current || event.pointerType !== "mouse" || event.button !== 0 || (event.target as Element).closest("button")) return;
    const held: Drag = { job, host, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 };
    drag.current = held;
    host.setPointerCapture(event.pointerId);

    const stop = (): void => {
      host.removeEventListener("pointermove", follow);
      host.removeEventListener("pointerup", release);
      removeEventListener("keydown", escape, true);
    };
    const follow = (move: PointerEvent): void => {
      held.dx = move.clientX - held.startX;
      held.dy = move.clientY - held.startY;
      host.classList.add("job-card--dragging");
      host.style.transform = `translate(${held.dx}px, ${held.dy}px)`;
    };
    const release = (up: PointerEvent): void => {
      stop();
      if (Math.hypot(held.dx, held.dy) < DRAG_START_PX) {
        host.style.transform = "";
        finishDrag(host);
      } else void drop(held, up.clientX, up.clientY);
    };
    const escape = (key: KeyboardEvent): void => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      stop();
      glideHome(host, held.dx, held.dy);
      finishDrag(host);
    };
    host.addEventListener("pointermove", follow);
    host.addEventListener("pointerup", release);
    addEventListener("keydown", escape, true);
  };

  useLayoutEffect(() => {
    const seen = new Set<string>();
    for (const job of jobs) {
      seen.add(job.id);
      let host = hosts.current.get(job.id);
      if (!host) {
        const made = document.createElement("div");
        made.className = "job-card job-card--grid";
        made.dataset.part = "job-card";
        made.dataset.job = job.id;
        made.setAttribute("role", "group");
        made.addEventListener("pointerdown", (event) => startDrag(event, made, job.id));
        hosts.current.set(job.id, made);
        host = made;
      }
      const tabbable = jobCell(job) === active;
      host.tabIndex = tabbable ? 0 : -1;
      host.setAttribute("aria-label", `${job.pieceTitle}, ${benchName(job.bench)}, ${job.dayLabel}`);
      render(<CardBody job={job} tabbable={tabbable} onMove={(from) => onMove(job, from)} onGlue={(from) => onGlue(job, from)} />, host);
      const cell = cells.current.get(jobCell(job));
      if (cell && host.parentElement !== cell && drag.current?.job.id !== job.id) {
        const focused = host.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
        cell.appendChild(host);
        focused?.focus({ preventScroll: true });
      }
    }
    for (const [id, host] of hosts.current) {
      if (seen.has(id)) continue;
      render(null, host);
      host.remove();
      hosts.current.delete(id);
    }
  });

  const focusCell = (key: string): void => {
    const job = jobsRef.current.find((item) => jobCell(item) === key);
    (job ? hosts.current.get(job.id) : cells.current.get(key))?.focus();
  };

  const altMove = async (job: Job, arrow: Arrow): Promise<void> => {
    if (moving.current) return;
    const index = days.indexOf(job.day);
    const sideways = arrow === "ArrowLeft" || arrow === "ArrowRight";
    const day = sideways ? days[index + (arrow === "ArrowLeft" ? -1 : 1)] : job.day;
    if (day === undefined) {
      announce(copy("F-65"));
      return;
    }
    const bench: Bench = sideways ? job.bench : job.bench === "frame" ? "cover" : "frame";
    moving.current = true;
    try {
      await patchJob(job, bench, day);
      await reload();
      announce(movedCopy(job, bench, day));
    } catch (error) {
      if (error instanceof ApiFailure) announce(error.message);
    } finally {
      moving.current = false;
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (!isArrow(event.key) || target.closest("button")) return;
    const key = target.closest<HTMLElement>("[data-cell]")?.dataset.cell;
    if (!key) return;
    event.preventDefault();
    if (event.altKey) {
      const job = jobsRef.current.find((item) => jobCell(item) === key);
      if (job) void altMove(job, event.key);
      return;
    }
    const [bench, day] = key.split("|") as [Bench, string];
    const index = days.indexOf(day);
    if (event.key === "ArrowLeft" && days[index - 1]) focusCell(cellKey(bench, days[index - 1] as string));
    if (event.key === "ArrowRight" && days[index + 1]) focusCell(cellKey(bench, days[index + 1] as string));
    if (event.key === "ArrowUp" && bench === "cover") focusCell(cellKey("frame", day));
    if (event.key === "ArrowDown" && bench === "frame") focusCell(cellKey("cover", day));
  };

  return (
    <table
      class="bench-grid"
      role="grid"
      aria-label="Bench week"
      onKeyDown={onKeyDown}
      onFocusIn={(event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]")?.dataset.cell;
        if (key) setActiveKey(key);
      }}
    >
      <thead>
        <tr>
          <td />
          {days.map((day) => (
            <th key={day} scope="col">
              {dateCopy(day)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {BENCHES.map((bench) => (
          <tr key={bench.value}>
            <th scope="row">{bench.label}</th>
            {days.map((day) => {
              const key = cellKey(bench.value, day);
              return (
                <td
                  key={key}
                  role="gridcell"
                  class="bench-cell"
                  data-cell={key}
                  aria-label={occupied.has(key) ? undefined : `${bench.label}, ${dateCopy(day)}`}
                  tabIndex={occupied.has(key) ? undefined : key === active ? 0 : -1}
                  ref={(node) => {
                    if (node) cells.current.set(key, node);
                    else cells.current.delete(key);
                  }}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MoveDialog({ job, control, reload }: { job: Job; control: DialogControl; reload: () => Promise<void> }): JSX.Element {
  const form = useForm({ day: job.day, bench: job.bench as string }, control);
  return (
    <Dialog control={control} title={`Move ${job.pieceTitle} to…`}>
      <Problems form={form} firstField="day" />
      <Field form={form} name="day" label="Day" />
      <SelectField form={form} name="bench" label="Bench" choices={BENCHES} />
      <AsyncButton
        label="Move"
        primary
        onPress={async () => {
          const { day, bench } = form.values;
          const saved = await form.submit(() => patchJob(job, bench as Bench, day).then(reload));
          if (!saved) return;
          control.done();
          announce(movedCopy(job, bench as Bench, day));
        }}
      />
    </Dialog>
  );
}

function GlueDialog({ job, control, reload }: { job: Job; control: DialogControl; reload: () => Promise<void> }): JSX.Element {
  const form = useForm({ date: "", time: "" }, control);
  return (
    <Dialog control={control} title="Glue laid">
      <Problems form={form} firstField="date" />
      <Field form={form} name="date" label="Date" />
      <Field form={form} name="time" label="Time" />
      <AsyncButton
        label="Save glue time"
        primary
        onPress={async () => {
          let cures = "";
          const saved = await form.submit(async () => {
            const answer = await post<{ job: Job }>(`/api/bench-jobs/${job.id}/glue`, form.values);
            cures = answer.job.glue?.curesAt ?? "";
            await reload();
          });
          if (!saved) return;
          control.done();
          announce(copy("F-69", { job: job.pieceTitle, datetime: datetimeCopy(new Date(cures)) }));
        }}
      />
    </Dialog>
  );
}

interface JobControls {
  move: DialogControl;
  glue: DialogControl;
}

/** Each job's two dialogs, mounted for as long as the job is on the week. */
function JobDialogs({ job, reload, controls }: { job: Job; reload: () => Promise<void>; controls: Map<string, JobControls> }): JSX.Element {
  const move = useDialog(`Move ${job.pieceTitle} to…`);
  const glue = useDialog(`Glue laid on ${job.id}`);
  controls.set(job.id, { move, glue });
  useEffect(() => () => void controls.delete(job.id), [job.id]);
  return (
    <>
      <MoveDialog key={`${job.bench}|${job.day}`} job={job} control={move} reload={reload} />
      <GlueDialog job={job} control={glue} reload={reload} />
    </>
  );
}

interface PieceChoice {
  id: string;
  title: string;
}

async function allPieces(): Promise<PieceChoice[]> {
  const pieces: PieceChoice[] = [];
  let cursor: string | null = "";
  while (cursor !== null) {
    const page: { pieces: PieceChoice[]; nextCursor: string | null } = await get(`/api/pieces${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    pieces.push(...page.pieces);
    cursor = page.nextCursor;
  }
  return pieces;
}

function AddJobDialog({ control, pieces, reload }: { control: DialogControl; pieces: readonly PieceChoice[]; reload: () => Promise<void> }): JSX.Element {
  const form = useForm({ pieceId: "", bench: "frame", day: "" }, control);
  const pieceId = form.values.pieceId || pieces[0]?.id || "";
  return (
    <Dialog control={control} title="Add job">
      <Problems form={form} firstField="pieceId" />
      <SelectField form={{ ...form, values: { ...form.values, pieceId } }} name="pieceId" label="Piece" choices={pieces.map((piece) => ({ value: piece.id, label: piece.title }))} />
      <SelectField form={form} name="bench" label="Bench" choices={BENCHES} />
      <Field form={form} name="day" label="Day" />
      <AsyncButton
        label="Save job"
        primary
        onPress={async () => {
          const { bench, day } = form.values;
          const saved = await form.submit(() => post("/api/bench-jobs", { pieceId, bench, day }).then(reload));
          if (!saved) return;
          form.replace({ pieceId: "", bench: "frame", day: "" });
          control.done();
          const title = pieces.find((piece) => piece.id === pieceId)?.title ?? "";
          announce(copy("F-107", { job: title, bench: benchName(bench as Bench), date: dateCopy(day) }));
        }}
      />
    </Dialog>
  );
}

export function BenchScreen({ query }: ScreenProps): JSX.Element {
  const week = query.get("week");
  const live = useLive(() => get<Week>(`/api/bench-jobs${week ? `?week=${encodeURIComponent(week)}` : ""}`), [week]);
  const add = useDialog("Add job");
  const [pieces, setPieces] = useState<PieceChoice[]>([]);
  const controls = useRef(new Map<string, JobControls>());

  useEffect(() => {
    void allPieces().then(setPieces);
  }, []);

  const data = live.data;
  const days = data ? Array.from({ length: WORKING_DAYS }, (_, offset) => addDays(data.week, offset)) : [];
  const jobs = data?.jobs ?? [];
  const showMove = (job: Job, from: HTMLElement): void => controls.current.get(job.id)?.move.show(from);
  const showGlue = (job: Job, from: HTMLElement): void => controls.current.get(job.id)?.glue.show(from);

  return (
    <>
      <Heading text="Bench" ready={data !== undefined}>
        <MainAction>
          <button type="button" class="button button--primary" onClick={(event) => add.show(event.currentTarget)}>
            Add job
          </button>
        </MainAction>
      </Heading>
      {data ? (
        <div class="bento">
          <section class="tile t-nine bench-week" aria-label="This week">
            <WeekNav week={data.week} />
            <WeekGrid days={days} jobs={jobs} reload={live.reload} onMove={showMove} onGlue={showGlue} />
            {jobs.length === 0 ? <p class="muted">No jobs this week.</p> : null}
          </section>
          <MintTile label="Jobs this week" figure={String(jobs.length)} />
          <section class="tile t-full bench-agenda" aria-label="Agenda">
            <WeekNav week={data.week} />
            {jobs.length === 0 ? <p class="muted">No jobs this week.</p> : null}
            <ul class="agenda-list">
              {jobs.map((job) => (
                <li key={job.id} class="job-card" data-part="job-card" data-job={job.id}>
                  <CardBody job={job} tabbable onMove={(from) => showMove(job, from)} onGlue={(from) => showGlue(job, from)} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <Loading height={320} />
      )}
      {jobs.map((job) => (
        <JobDialogs key={job.id} job={job} reload={live.reload} controls={controls.current} />
      ))}
      <AddJobDialog control={add} pieces={pieces} reload={live.reload} />
    </>
  );
}

function WeekNav({ week }: { week: string }): JSX.Element {
  return (
    <nav class="week-nav" aria-label="Weeks">
      <a class="link-row" href={`/bench?week=${addDays(week, -7)}`}>
        Earlier week
      </a>
      <span>{dateCopy(week)}</span>
      <a class="link-row" href={`/bench?week=${addDays(week, 7)}`}>
        Later week
      </a>
    </nav>
  );
}
