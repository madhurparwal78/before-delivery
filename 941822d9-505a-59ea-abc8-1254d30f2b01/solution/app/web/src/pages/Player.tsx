import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, type Enrolment } from "../api";
import { Alert, describeFailure, FieldError, useFeedback } from "../ui/feedback";
import { StatusGlyph } from "../ui/icons";
import { Link, navigate, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";
import { ProgressBar } from "./Learning";

interface LessonModule {
  id: string;
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
  body: string | null;
  question: { prompt: string; options: string[] } | null;
}

const INACTIVE_COPY: Record<string, string> = {
  enrolment_inactive: "This enrolment is no longer active, so its modules can't be answered.",
};

const moduleHref = (enrolment: Enrolment, module: Enrolment["modules"][number]): string =>
  module.kind === "evaluation" ? `/learn/${enrolment.id}/evaluation` : `/learn/${enrolment.id}/${module.id}`;

/** The module player frame: module navigation (a "Modules" disclosure below 1024px) and the main column. */
export function LearnFrame({ enrolment, current, justVerified, children }: { enrolment: Enrolment; current: string; justVerified?: string | null; children: ReactNode }) {
  return (
    <div className="player">
      <details className="player-nav" open={window.matchMedia("(min-width: 1024px)").matches}>
        <summary>Modules</summary>
        <nav aria-label="Course modules">
          <p className="eyebrow" style={{ padding: "var(--s2) 0" }}>
            {enrolment.course_title}
          </p>
          <ol>
            {enrolment.modules.map((m, index) => (
              <li key={m.id}>
                <Link to={moduleHref(enrolment, m)} aria-current={current === m.id || (current === "evaluation" && m.kind === "evaluation") ? "page" : undefined}>
                  <span className="module-title">
                    {index + 1}. {m.title}
                  </span>
                  <StatusGlyph verified={m.status === "verified"} justVerified={justVerified === m.id} />
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </details>
      <div className="stack">
        <ProgressBar label={`${enrolment.course_title} progress`} percent={enrolment.progress_percent} />
        {children}
      </div>
    </div>
  );
}

export function Player({ enrolmentId, moduleId }: { enrolmentId: string; moduleId: string }) {
  const { announce } = useFeedback();
  const page = useLoad(async () => {
    const [{ enrolment }, lesson] = await Promise.all([
      api<{ enrolment: Enrolment }>("GET", `/api/enrolments/${encodeURIComponent(enrolmentId)}`),
      api<{ module: LessonModule; status: "verified" | "unverified" }>("GET", `/api/enrolments/${encodeURIComponent(enrolmentId)}/modules/${encodeURIComponent(moduleId)}`),
    ]);
    return { enrolment, lesson };
  });
  const [choice, setChoice] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [alert, setAlert] = useState<string | null>(null);
  const [justVerified, setJustVerified] = useState<string | null>(null);
  const focusNext = useRef(false);
  const nextRef = useRef<HTMLAnchorElement>(null);
  const evaluationRef = useRef<HTMLAnchorElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusNext.current) return;
    const target = evaluationRef.current ?? nextRef.current;
    if (target) {
      focusNext.current = false;
      target.focus();
    }
  });

  useEffect(() => {
    if (page.data?.lesson.module.kind === "evaluation") navigate(`/learn/${enrolmentId}/evaluation`, true);
  }, [page.data, enrolmentId]);

  if (!page.data) return page.failure ? <Alert>{page.failure}</Alert> : <p aria-busy="true" className="muted">Loading the lesson…</p>;
  const { enrolment, lesson } = page.data;
  const module = lesson.module;
  const verified = enrolment.modules.find((m) => m.id === module.id)?.status === "verified";
  const index = enrolment.modules.findIndex((m) => m.id === module.id);
  const next = enrolment.modules[index + 1];
  const allLessonsVerified = enrolment.modules.every((m) => m.kind !== "lesson" || m.status === "verified");

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setAlert(null);
    try {
      await api("POST", `/api/enrolments/${enrolment.id}/modules/${module.id}/answer`, { option_index: choice });
      setFieldError(undefined);
      setJustVerified(module.id);
      announce("Module verified.");
      await page.reload();
      focusNext.current = true;
    } catch (error) {
      const failure = describeFailure(error, INACTIVE_COPY);
      setFieldError(failure.fields.option_index);
      setAlert(failure.alert);
      const group = groupRef.current;
      (group?.querySelector<HTMLInputElement>("input:checked") ?? group?.querySelector<HTMLInputElement>("input"))?.focus();
    } finally {
      setPending(false);
    }
  };

  const paragraphs = (module.body ?? "").split(/\n\s*\n/).filter(Boolean);
  return (
    <LearnFrame enrolment={enrolment} current={module.id} justVerified={justVerified}>
      <div className="lesson">
        <div className="stack">
          <p className="eyebrow">
            Module {index + 1} of {enrolment.modules.length} · <span className="fig">{module.minutes} min</span>
          </p>
          <PageHeading>{module.title}</PageHeading>
        </div>
        <section aria-label="Lesson" className="stack">
          <div className="prose">
            {paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
          {alert && <Alert>{alert}</Alert>}
          {module.question && !verified && (
            <form className="check" onSubmit={check} noValidate>
              <p className="eyebrow">Knowledge check</p>
              <p id="prompt" className="check-prompt">
                {module.question.prompt}
              </p>
              <div
                ref={groupRef}
                role="radiogroup"
                aria-labelledby="prompt"
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "answer-error" : undefined}
                className="choices"
              >
                {module.question.options.map((option, i) => (
                  <label key={option} className="choice">
                    <input type="radio" name="answer" checked={choice === i} onChange={() => setChoice(i)} />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
              <FieldError id="answer-error" message={fieldError} />
              <div>
                <button type="submit" className={`btn${pending ? " busy" : ""}`} disabled={pending}>
                  {pending ? "Checking…" : "Check answer"}
                </button>
              </div>
            </form>
          )}
          {verified && (
            <p className="check">
              <StatusGlyph verified /> <span>You verified this module.</span>
            </p>
          )}
        </section>
        <div className="next-links">
          {next?.kind === "lesson" && (
            <Link ref={nextRef} to={moduleHref(enrolment, next)} className="btn secondary">
              Next module
            </Link>
          )}
          {allLessonsVerified && (
            <Link ref={evaluationRef} to={`/learn/${enrolment.id}/evaluation`} className="btn">
              Go to post-evaluation
            </Link>
          )}
        </div>
      </div>
    </LearnFrame>
  );
}
