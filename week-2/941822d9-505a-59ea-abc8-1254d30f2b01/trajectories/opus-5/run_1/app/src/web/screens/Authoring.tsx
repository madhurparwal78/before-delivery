import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fieldErrorOf, request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { COURSE_STATE_LABELS, formatInstantDate } from '../lib/format.js';
import type { Course, CourseHistoryEntry, User } from '../lib/types.js';

interface ModuleDraft {
  title: string;
  minutes: number;
  kind: 'lesson' | 'evaluation';
  body: string;
  prompt: string;
  options: string[];
  answerIndex: number;
}

const EMPTY_MODULE: ModuleDraft = {
  title: '',
  minutes: 30,
  kind: 'lesson',
  body: '',
  prompt: '',
  options: ['', '', '', '', ''],
  answerIndex: 0,
};

function authoringCopy(code: string, payload: Record<string, unknown>): string | null {
  switch (code) {
    case 'stale_version':
      return 'Someone else saved this course a moment ago. Reload to see their changes before saving again.';
    case 'course_not_editable':
      return 'This course can\u2019t be edited in its current state.';
    case 'invalid_transition':
      return `This course can\u2019t move from ${
        COURSE_STATE_LABELS[String(payload['from'])] ?? String(payload['from'])
      } to ${COURSE_STATE_LABELS[String(payload['to'])] ?? String(payload['to'])}.`;
    default:
      return null;
  }
}

function toDraft(course: Course): ModuleDraft[] {
  return (course.modules ?? []).map((module) => ({
    title: module.title,
    minutes: module.minutes,
    kind: module.kind,
    body: module.body ?? '',
    prompt: module.question?.prompt ?? '',
    options: [...(module.question?.options ?? []), '', '', '', '', ''].slice(0, 5),
    answerIndex: module.question?.answer_index ?? 0,
  }));
}

function bodyFor(title: string, summary: string, format: string, price: string, modules: ModuleDraft[]) {
  return {
    title,
    summary,
    format,
    list_price: price,
    modules: modules.map((module) =>
      module.kind === 'evaluation'
        ? { title: module.title, minutes: module.minutes, kind: module.kind }
        : {
            title: module.title,
            minutes: module.minutes,
            kind: module.kind,
            body: module.body,
            question: {
              prompt: module.prompt,
              options: module.options.filter((option) => option.trim() !== ''),
              answer_index: module.answerIndex,
            },
          },
    ),
  };
}

export function Authoring({ user }: { readonly user: User }): ReactNode {
  const feedback = useFeedback();
  const [courses, setCourses] = useState<Course[]>([]);
  const [editing, setEditing] = useState<Course | null>(null);
  const [version, setVersion] = useState(1);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [format, setFormat] = useState<'self_paced' | 'cohort'>('self_paced');
  const [price, setPrice] = useState('0.00');
  const [modules, setModules] = useState<ModuleDraft[]>([{ ...EMPTY_MODULE }]);
  const [history, setHistory] = useState<CourseHistoryEntry[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const loadCourses = useCallback(async (): Promise<Course[]> => {
    const result = await request<{ courses: Course[] }>('/api/courses');
    const mine = result.courses.filter(
      (course) => user.role === 'planner' || course.author.id === user.id,
    );
    setCourses(mine);
    return mine;
  }, [user.id, user.role]);

  const openCourse = useCallback(async (courseId: string): Promise<void> => {
    const result = await request<{ course: Course }>(`/api/courses/${courseId}`);
    setEditing(result.course);
    setVersion(result.course.version);
    setTitle(result.course.title);
    setSummary(result.course.summary);
    setFormat(result.course.format);
    setPrice(result.course.list_price);
    setModules(toDraft(result.course));
    setErrors({});
    try {
      const historyResult = await request<{ history: CourseHistoryEntry[] }>(
        `/api/courses/${courseId}/history`,
      );
      setHistory(historyResult.history);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadCourses().catch(() => undefined);
  }, [loadCourses]);

  function collectErrors(error: unknown): boolean {
    const found: Record<string, string> = {};
    for (const field of ['title', 'summary', 'format', 'list_price', 'modules', 'minutes', 'question', 'note']) {
      const message = fieldErrorOf(error, field);
      if (message !== null) found[field] = message;
    }
    if (Object.keys(found).length === 0) return false;
    setErrors(found);
    feedback.clear();
    return true;
  }

  async function save(): Promise<void> {
    if (pending) return;
    setPending(true);
    setErrors({});
    feedback.announce('Saving…');
    try {
      const body = bodyFor(title, summary, format, price, modules);
      if (editing === null) {
        const created = await request<{ course: Course }>('/api/courses', { method: 'POST', body });
        await loadCourses();
        await openCourse(created.course.id);
      } else {
        const saved = await request<{ course: Course }>(`/api/courses/${editing.id}`, {
          method: 'PATCH',
          body,
          ifMatch: version,
        });
        setVersion(saved.course.version);
        setEditing(saved.course);
        await loadCourses();
      }
      feedback.announce('Draft saved.');
    } catch (error) {
      if (!collectErrors(error)) feedback.report(error, authoringCopy);
    } finally {
      setPending(false);
    }
  }

  async function submitForReview(): Promise<void> {
    if (editing === null || pending) return;
    setPending(true);
    setErrors({});
    feedback.announce('Saving…');
    try {
      const moved = await request<{ course: Course }>(`/api/courses/${editing.id}/transitions`, {
        method: 'POST',
        body: { to: 'in_review' },
        ifMatch: version,
      });
      setVersion(moved.course.version);
      setEditing(moved.course);
      await loadCourses();
      const historyResult = await request<{ history: CourseHistoryEntry[] }>(
        `/api/courses/${editing.id}/history`,
      );
      setHistory(historyResult.history);
      feedback.announce(`Course moved to ${COURSE_STATE_LABELS['in_review']}.`);
    } catch (error) {
      if (!collectErrors(error)) feedback.report(error, authoringCopy);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1>Authoring</h1>
      <div className="grid">
        <div className="col-side">
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setVersion(1);
              setTitle('');
              setSummary('');
              setFormat('self_paced');
              setPrice('0.00');
              setModules([{ ...EMPTY_MODULE }, { ...EMPTY_MODULE, kind: 'evaluation', title: 'Post-evaluation', minutes: 10 }]);
              setHistory([]);
              setErrors({});
            }}
          >
            New course
          </button>
          <ul className="rows">
            {courses.map((course) => (
              <li key={course.id} className="row">
                <span className="row__main">
                  <button type="button" className="linkish" onClick={() => void openCourse(course.id)}>
                    {course.title}
                  </button>
                  <div className="hint">
                    {COURSE_STATE_LABELS[course.state]} · version {course.version}
                  </div>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="col-main">
          <h2 style={{ fontSize: 'var(--h4)' }}>{editing === null ? 'New course' : editing.title}</h2>
          <div className="field">
            <label htmlFor="course-title">Course title</label>
            <input
              id="course-title"
              type="text"
              value={title}
              aria-describedby={errors['title'] === undefined ? undefined : 'course-title-error'}
              onChange={(event) => setTitle(event.target.value)}
            />
            {errors['title'] === undefined ? null : (
              <p className="field__error" id="course-title-error">
                {errors['title']}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="course-summary">Summary</label>
            <textarea
              id="course-summary"
              value={summary}
              aria-describedby={errors['summary'] === undefined ? undefined : 'course-summary-error'}
              onChange={(event) => setSummary(event.target.value)}
            />
            {errors['summary'] === undefined ? null : (
              <p className="field__error" id="course-summary-error">
                {errors['summary']}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="course-format">Format</label>
            <select
              id="course-format"
              value={format}
              onChange={(event) => setFormat(event.target.value === 'cohort' ? 'cohort' : 'self_paced')}
            >
              <option value="self_paced">Self-paced</option>
              <option value="cohort">Live cohort</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="course-price">List price (USD)</label>
            <input
              id="course-price"
              type="text"
              inputMode="decimal"
              value={price}
              aria-describedby={errors['list_price'] === undefined ? undefined : 'course-price-error'}
              onChange={(event) => setPrice(event.target.value)}
            />
            {errors['list_price'] === undefined ? null : (
              <p className="field__error" id="course-price-error">
                {errors['list_price']}
              </p>
            )}
          </div>

          {errors['modules'] === undefined ? null : <p className="field__error">{errors['modules']}</p>}
          {errors['minutes'] === undefined ? null : <p className="field__error">{errors['minutes']}</p>}
          {errors['question'] === undefined ? null : <p className="field__error">{errors['question']}</p>}

          {modules.map((module, index) => (
            <fieldset key={index} style={{ border: '1px solid var(--rule)', borderRadius: 4, marginBottom: '1.5rem' }}>
              <legend className="total-label">Module {index + 1}</legend>
              <div className="field">
                <label htmlFor={`module-title-${index}`}>Module title</label>
                <input
                  id={`module-title-${index}`}
                  type="text"
                  value={module.title}
                  onChange={(event) =>
                    setModules((list) =>
                      list.map((entry, position) =>
                        position === index ? { ...entry, title: event.target.value } : entry,
                      ),
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`module-minutes-${index}`}>Minutes</label>
                <input
                  id={`module-minutes-${index}`}
                  type="number"
                  min={5}
                  max={240}
                  value={module.minutes}
                  onChange={(event) =>
                    setModules((list) =>
                      list.map((entry, position) =>
                        position === index
                          ? { ...entry, minutes: Number.parseInt(event.target.value, 10) || 0 }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`module-kind-${index}`}>Module kind</label>
                <select
                  id={`module-kind-${index}`}
                  value={module.kind}
                  onChange={(event) =>
                    setModules((list) =>
                      list.map((entry, position) =>
                        position === index
                          ? { ...entry, kind: event.target.value === 'evaluation' ? 'evaluation' : 'lesson' }
                          : entry,
                      ),
                    )
                  }
                >
                  <option value="lesson">Lesson</option>
                  <option value="evaluation">Post-evaluation</option>
                </select>
              </div>
              {module.kind === 'evaluation' ? null : (
                <>
                  <div className="field">
                    <label htmlFor={`module-body-${index}`}>Lesson text</label>
                    <textarea
                      id={`module-body-${index}`}
                      value={module.body}
                      onChange={(event) =>
                        setModules((list) =>
                          list.map((entry, position) =>
                            position === index ? { ...entry, body: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`module-question-${index}`}>Question</label>
                    <input
                      id={`module-question-${index}`}
                      type="text"
                      value={module.prompt}
                      onChange={(event) =>
                        setModules((list) =>
                          list.map((entry, position) =>
                            position === index ? { ...entry, prompt: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </div>
                  {module.options.map((option, optionIndex) => (
                    <div className="field" key={optionIndex}>
                      <label htmlFor={`module-option-${index}-${optionIndex}`}>Option {optionIndex + 1}</label>
                      <input
                        id={`module-option-${index}-${optionIndex}`}
                        type="text"
                        value={option}
                        onChange={(event) =>
                          setModules((list) =>
                            list.map((entry, position) =>
                              position === index
                                ? {
                                    ...entry,
                                    options: entry.options.map((value, slot) =>
                                      slot === optionIndex ? event.target.value : value,
                                    ),
                                  }
                                : entry,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <div className="field">
                    <label htmlFor={`module-correct-${index}`}>Correct option</label>
                    <select
                      id={`module-correct-${index}`}
                      value={module.answerIndex}
                      onChange={(event) =>
                        setModules((list) =>
                          list.map((entry, position) =>
                            position === index
                              ? { ...entry, answerIndex: Number.parseInt(event.target.value, 10) }
                              : entry,
                          ),
                        )
                      }
                    >
                      {module.options.map((_, optionIndex) => (
                        <option key={optionIndex} value={optionIndex}>
                          Option {optionIndex + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </fieldset>
          ))}

          <div className="inline-actions">
            <button
              type="button"
              className="quiet"
              onClick={() => setModules((list) => [...list.slice(0, -1), { ...EMPTY_MODULE }, ...list.slice(-1)])}
            >
              Add module
            </button>
            <button type="button" disabled={pending} onClick={() => void save()}>
              {pending ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={pending || editing === null}
              onClick={() => void submitForReview()}
            >
              Submit for review
            </button>
          </div>

          <h3 style={{ fontSize: 'var(--h5)', marginTop: '2rem' }}>Review history</h3>
          <ol className="rows" aria-label="Review history">
            {history.map((entry, index) => (
              <li key={index} className="row">
                <span className="row__main">
                  {COURSE_STATE_LABELS[entry.from]} → {COURSE_STATE_LABELS[entry.to]} by {entry.by.display_name}{' '}
                  on {formatInstantDate(entry.at)}
                  {entry.note === null ? null : <div className="hint">{entry.note}</div>}
                </span>
              </li>
            ))}
          </ol>
          {history.length === 0 ? <p className="hint">No review steps yet.</p> : null}
        </div>
      </div>
    </>
  );
}
