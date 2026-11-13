import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { announce } from "../announce";
import { get, post } from "../api";
import { FacetGroup } from "../components/Facets";
import { useDebounce, useLoad } from "../hooks";
import { useLive, useLiveReload } from "../live";
import { useMotion } from "../motion";
import { Link } from "../router";
import { Loading, NotFound, Screen } from "../shell/Page";
import { nameOf, STAGES, type StageId } from "../../shared/reference";
import type { Applicant as ApplicantRecord, JobDetail } from "../../shared/api";

const applicantLine = (count: number): string => (count === 0 ? "No applicants shown" : count === 1 ? "1 applicant shown" : `${count} applicants shown`);
const stageName = (stage: StageId): string => nameOf(STAGES, stage);

type Held = { id: string; from: StageId; target: StageId };

export function Pipeline({ id }: { id: string }) {
  const job = useLoad(() => get<JobDetail>(`/api/jobs/${id}`), [id]);
  const applicants = useLoad(() => get<{ applicants: ApplicantRecord[] }>(`/api/employer/jobs/${id}/applicants`), [id]);
  const [selected, setSelected] = useState<StageId[]>([]);
  const [held, setHeld] = useState<Held | undefined>();
  const [moved, setMoved] = useState<string | undefined>();
  const note = useRef<{ kind: "added" | "removed"; label: string } | undefined>(undefined);
  const clear = useRef<HTMLButtonElement>(null);
  const motion = useMotion(240);
  const list = applicants.data?.applicants ?? [];

  useLive("application.stage", (event) => {
    if (event.job_id !== id) return;
    if (list.some((entry) => entry.id === event.application_id)) {
      applicants.patch((data) => ({ applicants: data.applicants.map((entry) => (entry.id === event.application_id ? { ...entry, stage: event.stage } : entry)) }));
    } else {
      applicants.reload();
    }
  });
  useLiveReload(applicants.reload);

  const visible = (stage: StageId): boolean => selected.length === 0 || selected.includes(stage);
  const shown = list.filter((entry) => visible(entry.stage)).length;
  useDebounce(selected.join(","), () => {
    const last = note.current;
    note.current = undefined;
    if (last) announce(`Filter ${last.kind}: ${last.label}. ${applicantLine(shown)}.`);
  }, 300, note.current !== undefined);

  useEffect(() => {
    if (!moved) return;
    const card = document.querySelector<HTMLElement>(`[data-card="${moved}"]`);
    card?.focus();
    if (card) motion.play([card], [{ transform: "translateY(-6px)", opacity: 0.8 }, { transform: "translateY(0)", opacity: 1 }]);
  }, [moved, list.find((entry) => entry.id === moved)?.stage]);

  async function drop(candidate: ApplicantRecord, to: StageId) {
    if (to === candidate.stage) {
      announce(`Move cancelled. ${candidate.candidate_name} stays in ${stageName(candidate.stage)}.`);
      return;
    }
    const result = await post<ApplicantRecord>(`/api/employer/applications/${candidate.id}/stage`, { stage: to });
    if (result.ok) {
      applicants.patch((data) => ({ applicants: data.applicants.map((entry) => (entry.id === candidate.id ? result.data : entry)) }));
      setMoved(candidate.id);
      announce(`${candidate.candidate_name} moved to ${stageName(to)}.`);
    } else {
      announce(`${candidate.candidate_name} cannot move to ${stageName(to)}.`);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, candidate: ApplicantRecord) {
    if (!held || held.id !== candidate.id) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setHeld({ id: candidate.id, from: candidate.stage, target: candidate.stage });
        announce(`Picked up ${candidate.candidate_name}, in ${stageName(candidate.stage)}. Use Left and Right to move, Space to drop, Escape to cancel.`);
      }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const index = STAGES.findIndex((entry) => entry.id === held.target) + (event.key === "ArrowRight" ? 1 : -1);
      const next = STAGES[Math.max(0, Math.min(STAGES.length - 1, index))];
      if (!next) return;
      setHeld({ ...held, target: next.id });
      announce(`${candidate.candidate_name} over ${next.name}.`);
    } else if (event.key === " ") {
      event.preventDefault();
      setHeld(undefined);
      void drop(candidate, held.target);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setHeld(undefined);
      announce(`Move cancelled. ${candidate.candidate_name} stays in ${stageName(candidate.stage)}.`);
    }
  }

  const dragging = useRef<{ id: string; x: number; y: number; active: boolean } | undefined>(undefined);
  function pointerDown(event: PointerEvent<HTMLButtonElement>, candidate: ApplicantRecord) {
    dragging.current = { id: candidate.id, x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>, candidate: ApplicantRecord) {
    const drag = dragging.current;
    if (!drag || drag.id !== candidate.id) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.active = true;
    if (drag.active) {
      const column = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-column]");
      const target = STAGES.find((entry) => entry.id === column?.dataset["column"]);
      if (target) setHeld({ id: candidate.id, from: candidate.stage, target: target.id });
    }
  }
  function pointerUp(candidate: ApplicantRecord) {
    const drag = dragging.current;
    dragging.current = undefined;
    if (drag?.active && held?.id === candidate.id) {
      const target = held.target;
      setHeld(undefined);
      void drop(candidate, target);
    }
  }

  async function exportCsv() {
    const response = await fetch(`/api/employer/jobs/${id}/applicants.csv`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `applicants-${id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleStage(stage: StageId, present: boolean) {
    note.current = { kind: present ? "removed" : "added", label: stageName(stage) };
    setSelected(present ? selected.filter((entry) => entry !== stage) : [...selected, stage]);
  }

  if (job.failure?.status === 404 || applicants.failure?.status === 404) return <NotFound />;
  if (!job.data) return <Loading />;
  return (
    <Screen title={job.data.title}>
      <h1 className="page-title">{job.data.title}</h1>
      <div className="row">
        <FacetGroup
          label="Stage filter"
          items={STAGES.map((entry) => ({ id: entry.id, label: entry.name }))}
          selected={selected}
          onToggle={(item) => toggleStage(item.id as StageId, selected.includes(item.id as StageId))}
          afterLast={clear}
        />
        <button ref={clear} type="button" className="btn-quiet" onClick={() => { note.current = undefined; setSelected([]); }}>Clear filters</button>
        <button type="button" className="btn" onClick={() => void exportCsv()}>Export applicants CSV</button>
      </div>
      <div className={`pipeline ${selected.length > 0 ? "filtered" : ""}`}>
        {STAGES.filter((entry) => visible(entry.id)).map((stage) => {
          const cards = list.filter((entry) => entry.stage === stage.id);
          return (
            <section key={stage.id} className={`column ${held?.target === stage.id ? "target" : ""}`} data-column={stage.id}>
              <h2>{`${stage.name} (${cards.length})`}</h2>
              <ul aria-label={stage.name}>
                {cards.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={`card ${held?.id === candidate.id ? "dragging" : ""}`}
                      data-card={candidate.id}
                      data-id={candidate.id}
                      aria-label={`${candidate.candidate_name}, ${stage.name}`}
                      aria-pressed={held?.id === candidate.id}
                      {...(moved === candidate.id ? { "data-motion": "card-drop", "data-motion-ms": motion.ms, "data-state": motion.state } : {})}
                      onKeyDown={(event) => onKeyDown(event, candidate)}
                      onPointerDown={(event) => pointerDown(event, candidate)}
                      onPointerMove={(event) => pointerMove(event, candidate)}
                      onPointerUp={() => pointerUp(candidate)}
                    >
                      {candidate.candidate_name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="meta" style={{ marginTop: 24 }}>
        <Link to={`/employer`}>Back to your jobs</Link>
      </p>
    </Screen>
  );
}

export function Applicant({ id }: { id: string }) {
  const applicant = useLoad(() => get<ApplicantRecord>(`/api/employer/applications/${id}`), [id]);
  useLive("application.stage", (event) => {
    if (event.application_id === id) applicant.patch((data) => ({ ...data, stage: event.stage }));
  });
  if (applicant.failure?.status === 404) return <NotFound />;
  const data = applicant.data;
  if (!data) return <Loading />;
  return (
    <Screen title={data.candidate_name}>
      <h1 className="page-title">{data.candidate_name}</h1>
      <dl className="summary-list">
        <dt>Stage</dt>
        <dd>{stageName(data.stage)}</dd>
        <dt>Contact email</dt>
        <dd>{data.contact_email}</dd>
        <dt>Phone</dt>
        <dd>{data.phone === "" ? "Not given" : data.phone}</dd>
        <dt>Note to the employer</dt>
        <dd>{data.cover_note === "" ? "No note" : data.cover_note}</dd>
        <dt>Applied</dt>
        <dd className="figure">{data.applied_on}</dd>
      </dl>
      <div className="row">
        <a className="btn" href={`/api/files/${data.resume_file_id}`}>Download resume</a>
        <Link to={`/employer/jobs/${data.job_id}`}>Back to the pipeline</Link>
      </div>
    </Screen>
  );
}
