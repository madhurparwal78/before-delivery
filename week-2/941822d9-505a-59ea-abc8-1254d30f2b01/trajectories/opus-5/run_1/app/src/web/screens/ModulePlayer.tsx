import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fieldErrorOf, request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { Link, navigate } from '../lib/router.js';
import { StatusGlyph } from '../components/Glyph.js';
import type { Enrolment } from '../lib/types.js';

interface ModuleDetail {
  id: string;
  title: string;
  minutes: number;
  kind: 'lesson' | 'evaluation';
  body: string | null;
  question: { prompt: string; options: string[] } | null;
}

export function ModulePlayer({
  enrolmentId,
  moduleId,
}: {
  readonly enrolmentId: string;
  readonly moduleId: string;
}): ReactNode {
  const feedback = useFeedback();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [module, setModule] = useState<ModuleDetail | null>(null);
  const [status, setStatus] = useState<'verified' | 'unverified'>('unverified');
  const [choice, setChoice] = useState<number | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const nextLink = useRef<HTMLAnchorElement>(null);
  const evaluationLink = useRef<HTMLAnchorElement>(null);
  const radioGroup = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    const enrolmentResult = await request<{ enrolment: Enrolment }>(`/api/enrolments/${enrolmentId}`);
    setEnrolment(enrolmentResult.enrolment);
    const moduleResult = await request<{ module: ModuleDetail; status: 'verified' | 'unverified' }>(
      `/api/enrolments/${enrolmentId}/modules/${moduleId}`,
    );
    setModule(moduleResult.module);
    setStatus(moduleResult.status);
    setChoice(null);
    setAnswerError(null);
  }, [enrolmentId, moduleId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const lessonsVerified =
    enrolment !== null &&
    enrolment.modules.filter((entry) => entry.kind === 'lesson').every((entry) => entry.status === 'verified');

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    if (lessonsVerified) evaluationLink.current?.focus();
    else nextLink.current?.focus();
  }, [lessonsVerified, enrolment]);

  async function check(): Promise<void> {
    if (pending || choice === null) return;
    setPending(true);
    setAnswerError(null);
    feedback.announce('Checking…');
    try {
      const result = await request<{ enrolment: Enrolment }>(
        `/api/enrolments/${enrolmentId}/modules/${moduleId}/answer`,
        { method: 'POST', body: { option_index: choice } },
      );
      setEnrolment(result.enrolment);
      setStatus('verified');
      moveFocus.current = true;
      feedback.announce('Module verified.');
    } catch (error) {
      const message = fieldErrorOf(error, 'option_index');
      if (message !== null) {
        setAnswerError(message);
        feedback.clear();
        radioGroup.current?.querySelector<HTMLInputElement>('input')?.focus();
      } else {
        feedback.report(error, () => null);
      }
    } finally {
      setPending(false);
    }
  }

  if (enrolment === null || module === null) return <p className="hint">Loading the module…</p>;

  const lessons = enrolment.modules.filter((entry) => entry.kind === 'lesson');
  const index = enrolment.modules.findIndex((entry) => entry.id === moduleId);
  const next = enrolment.modules[index + 1];

  return (
    <div className="grid">
      <div className="col-side">
        <button
          type="button"
          className="quiet disclosure-only"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((value) => !value)}
        >
          Modules
        </button>
        <nav aria-label="Course modules" className={`module-nav ${navOpen ? 'module-nav--open' : ''}`}>
          <ul className="rows">
            {enrolment.modules.map((entry) => (
              <li key={entry.id} className="row">
                <span className="row__main">
                  {entry.kind === 'evaluation' ? (
                    <Link to={`/learn/${enrolmentId}/evaluation`}>{entry.title}</Link>
                  ) : (
                    <Link to={`/learn/${enrolmentId}/${entry.id}`}>{entry.title}</Link>
                  )}
                </span>
                <span className="row__figures">
                  <StatusGlyph verified={entry.status === 'verified'} />
                </span>
              </li>
            ))}
          </ul>
        </nav>
        <p className="hint">
          {lessons.filter((entry) => entry.status === 'verified').length} of {lessons.length} lessons verified
        </p>
        <button type="button" className="quiet" onClick={() => navigate('/learning')}>
          Back to My learning
        </button>
      </div>

      <div className="col-main">
        <h1>{module.title}</h1>
        <p className="hint">
          {module.minutes} min · {status === 'verified' ? 'Verified' : 'Not yet verified'}
        </p>
        <section aria-label="Lesson" className="region">
          {(module.body ?? '').split('\n').map((paragraph, position) => (
            <p key={position}>{paragraph}</p>
          ))}
        </section>

        {module.question === null ? null : (
          <section className="region">
            <h2 style={{ fontSize: 'var(--h5)' }}>Knowledge check</h2>
            <div role="radiogroup" aria-label={module.question.prompt} ref={radioGroup}>
              <p>
                <strong>{module.question.prompt}</strong>
              </p>
              <ul className="choices">
                {module.question.options.map((option, position) => (
                  <li key={option} className="choice">
                    <label>
                      <input
                        type="radio"
                        name="answer"
                        checked={choice === position}
                        aria-describedby={answerError === null ? undefined : 'answer-error'}
                        onChange={() => setChoice(position)}
                      />
                      <span>{option}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            {answerError === null ? null : (
              <p className="field__error" id="answer-error">
                {answerError}
              </p>
            )}
            <div className="inline-actions" style={{ marginTop: '1rem' }}>
              <button type="button" disabled={pending || choice === null} onClick={() => void check()}>
                {pending ? 'Checking…' : 'Check answer'}
              </button>
              {next === undefined || next.kind === 'evaluation' ? null : (
                <Link to={`/learn/${enrolmentId}/${next.id}`} className="button button--quiet" ref={nextLink}>
                  Next module
                </Link>
              )}
              {lessonsVerified ? (
                <Link
                  to={`/learn/${enrolmentId}/evaluation`}
                  className="button button--quiet"
                  ref={evaluationLink}
                >
                  Go to post-evaluation
                </Link>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
