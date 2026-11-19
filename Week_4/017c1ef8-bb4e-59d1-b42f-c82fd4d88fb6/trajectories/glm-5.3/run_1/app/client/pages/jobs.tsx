import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../api.js';
import { useApp } from '../app-context.js';
import { announce } from '../main.js';
import type { Application, BoardCard, JobCard, JobDetail, JobEditor, Question } from '../types.js';
import { Dialog, Menu, MenuItem } from '../dialog.js';
import { legalMoves, stageLabel, statusText, isoToLocalInput, localInputToIso } from '../format.js';

export const JobsPage = (): JSX.Element => {
  const { navigate } = useApp();
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [location, setLocation] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [posted, setPosted] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const params = new URLSearchParams({ type: 'jobs', q: '' });
    if (location) params.set('location', location);
    if (workplace) params.set('workplace', workplace);
    if (posted) params.set('posted', posted);
    const result = await api.get<{ results: JobCard[] }>(`/api/search?${params.toString()}`);
    setJobs(result.results);
  }, [location, workplace, posted]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1 className="profile-name">Jobs</h1>
      <fieldset className="job-filters">
        <legend className="visually-hidden">Job filters</legend>
        <label>
          Location
          <input className="field" aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          Workplace
          <select className="field" aria-label="Workplace" value={workplace} onChange={(e) => setWorkplace(e.target.value)}>
            <option value="">Any</option>
            <option value="on-site">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
        </label>
        <label>
          Date posted
          <select className="field" aria-label="Date posted" value={posted} onChange={(e) => setPosted(e.target.value)}>
            <option value="">Any time</option>
            <option value="day">Past 24 hours</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
          </select>
        </label>
      </fieldset>
      <ul>
        {jobs.map((job) => (
          <li key={job.id} className="job-card" data-job-id={job.id}>
            <h3 className="profile-name">
              <a href={`/jobs/${job.id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${job.id}`); }}>{job.title}</a>
            </h3>
            <p>{job.company.name}</p>
            <p>{job.location} · {job.workplace}</p>
            <p className="entry-time">{job.posted_at}</p>
          </li>
        ))}
      </ul>
      {jobs.length === 0 && (
        <div className="big-empty">
          <p>No results for “”</p>
          <a href="/jobs">Search jobs</a>
        </div>
      )}
    </>
  );
};

export const JobPage = ({ jobId }: { jobId: string }): JSX.Element => {
  const { me, navigate, liveEvents } = useApp();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api.get<JobDetail>(`/api/jobs/${jobId}`);
      setJob(result);
    } catch { /* 404 */ }
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'application_update' || event === 'job_update' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  const save = async (): Promise<void> => {
    if (!job || job.saved) return;
    await api.put(`/api/jobs/${job.id}/save`, {});
    announce('Jobs announcements', 'Job saved.');
    await load();
  };
  const unsave = async (): Promise<void> => {
    if (!job || !job.saved) return;
    await api.delete(`/api/jobs/${job.id}/save`);
    announce('Jobs announcements', 'Job removed from saved.');
    await load();
  };

  const apply = async (): Promise<void> => {
    if (!job || !resumeId || busy) return;
    setBusy(true);
    setAnswerErrors({});
    try {
      const application = await api.post<Application>(`/api/jobs/${job.id}/applications`, {
        resume_id: resumeId, answers,
      }, `${Date.now()}-${Math.random()}`);
      announce('Jobs announcements', 'Application submitted.');
      setApplyOpen(false);
      await load();
      void application;
    } catch (err) {
      const e2 = err as { status?: number; body?: { error?: string; fields?: Record<string, string> } };
      if (e2.body?.error === 'already_applied') {
        setUploadError('You already applied to this job.');
      } else if (e2.body?.error === 'job_closed') {
        setUploadError('This job stopped accepting applications.');
      } else if (e2.body?.error === 'validation' && e2.body.fields) {
        setAnswerErrors(e2.body.fields);
        const firstKey = Object.keys(e2.body.fields)[0];
        const questionId = firstKey?.replace('answers.', '');
        const node = document.querySelector(`[data-question-id="${questionId}"] input, [data-question-id="${questionId}"] textarea, [data-question-id="${questionId}"] select`) as HTMLElement | null;
        node?.focus();
      } else {
        setUploadError('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!job) {
    return (
      <div className="big-empty">
        <h2>We couldn't find that page.</h2>
        <a href="/feed">Go to Home</a>
      </div>
    );
  }

  const open = job.open;

  return (
    <>
      <article className="job-card" data-job-id={job.id}>
        <h1 className="profile-name">{job.title}</h1>
        <p>{job.company.name}</p>
        <p>{job.location} · {job.workplace}</p>
        <p className="entry-text">{job.description}</p>
        <div className="entry-actions">
          <button type="button" className="text-button" aria-pressed={job.saved}
            onClick={() => { void (job.saved ? unsave() : save()); }}>
            {job.saved ? 'Saved' : 'Save job'}
          </button>
          {open ? (
            <button type="button" className="pink-button" onClick={() => setApplyOpen(true)}
              disabled={Boolean(job.my_application)}>Apply</button>
          ) : (
            <p>No longer accepting applications</p>
          )}
          {me?.id === job.poster_id && (
            <>
              <button type="button" className="text-button" onClick={() => navigate(`/jobs/${job.id}/applicants`)}>Applicants</button>
              <button type="button" className="text-button" onClick={() => navigate(`/jobs/${job.id}/edit`)}>Edit job</button>
            </>
          )}
        </div>
        {job.my_application && (
          <p className="count-line">Your application: {statusText(job.my_application.state)}</p>
        )}
      </article>

      <section aria-label="Hiring stages">
        <h2 aria-level={2}>Hiring stages</h2>
        <ul aria-label="Hiring stages">
          {job.stages.map((stage) => (
            <li key={stage.state}>
              {stage.label} · {stage.status_text} · Moved by{' '}
              {stage.moved_by === 'applicant' ? 'the applicant' : stage.moved_by === 'poster' ? 'the hiring team' : 'automatically when the hiring team first opens it'}
            </li>
          ))}
        </ul>
      </section>

      {applyOpen && (
        <Dialog label={`Apply to ${job.title}`} onClose={() => setApplyOpen(false)} closeButton={false}>
          <h2>Apply to {job.title}</h2>
          {uploadError && <div role="alert">{uploadError}</div>}
          <label className="label" htmlFor="resume-file">Resume (PDF)</label>
          <input
            id="resume-file"
            type="file"
            accept="application/pdf"
            disabled={uploading || Boolean(resumeId)}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              setUploadError(null);
              announce('Jobs announcements', 'Uploading…');
              const result = await uploadFile('/api/uploads/resume', file);
              setUploading(false);
              if (result.ok) {
                const body = result.data as { resume_id: string };
                setResumeId(body.resume_id);
                announce('Jobs announcements', 'Resume attached.');
              } else {
                const body = result.body as { error?: string; limit?: number };
                if (body?.error === 'resume_type') setUploadError('Upload a PDF file.');
                else if (body?.error === 'resume_too_large') setUploadError(`Resumes can be up to ${(body.limit ?? 0).toLocaleString('en-US')} bytes.`);
                else if (body?.error === 'storage_unavailable') setUploadError('Uploads are unavailable right now. Try again later.');
                else setUploadError('Upload a PDF file.');
              }
            }}
          />
          {uploading && <p aria-live="polite">Uploading…</p>}
          {job.questions.map((question) => (
            <div key={question.id} data-question-id={question.id}>
              {question.type === 'short_answer' && (
                <>
                  <label className="label" htmlFor={`q-${question.id}`}>{question.text}</label>
                  <input id={`q-${question.id}`} className="field" value={String(answers[question.id] ?? '')}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))} />
                </>
              )}
              {question.type === 'yes_no' && (
                <fieldset>
                  <legend>{question.text}</legend>
                  {['yes', 'no'].map((value) => (
                    <label key={value}>
                      <input type="radio" name={`q-${question.id}`} value={value}
                        checked={answers[question.id] === value}
                        onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: value }))} />
                      {value === 'yes' ? 'Yes' : 'No'}
                    </label>
                  ))}
                </fieldset>
              )}
              {question.type === 'single_choice' && (
                <fieldset>
                  <legend>{question.text}</legend>
                  {(question.options ?? []).map((option) => (
                    <label key={option}>
                      <input type="radio" name={`q-${question.id}`} value={option}
                        checked={answers[question.id] === option}
                        onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: option }))} />
                      {option}
                    </label>
                  ))}
                </fieldset>
              )}
              {question.type === 'number' && (
                <>
                  <label className="label" htmlFor={`q-${question.id}`}>{question.text}</label>
                  <input id={`q-${question.id}`} className="field" type="number" step="1"
                    value={String(answers[question.id] ?? '')}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value === '' ? '' : Number(e.target.value) }))} />
                </>
              )}
              {answerErrors[`answers.${question.id}`] && (
                <div role="alert">{answerErrors[`answers.${question.id}`]}</div>
              )}
            </div>
          ))}
          <div className="dialog-actions">
            <button type="button" className="pink-button" onClick={() => { void apply(); }} disabled={!resumeId || busy}>
              Submit application
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};

export const MyJobsPage = (): JSX.Element => {
  const { navigate, liveEvents } = useApp();
  const [tab, setTab] = useState<'saved' | 'applied'>('saved');
  const [jobs, setJobs] = useState<(JobCard & { my_application?: { id: string; state: string; status_text: string } })[]>([]);
  const [withdrawFor, setWithdrawFor] = useState<JobCard | null>(null);
  const [application, setApplication] = useState<Application | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await api.get<{ jobs: (JobCard & { my_application?: { id: string; state: string; status_text: string } })[] }>(`/api/me/jobs?tab=${tab}`);
    setJobs(result.jobs);
  }, [tab]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'application_update' || event === 'job_update' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  return (
    <>
      <h1 className="profile-name">My jobs</h1>
      <div role="tablist" aria-label="My jobs tabs">
        <button type="button" role="tab" aria-selected={tab === 'saved'} onClick={() => setTab('saved')}>Saved</button>
        <button type="button" role="tab" aria-selected={tab === 'applied'} onClick={() => setTab('applied')}>Applied</button>
      </div>
      {jobs.length === 0 && (
        <div className="big-empty">
          <p>{tab === 'saved' ? 'No saved jobs yet.' : 'No applications yet.'}</p>
          <a href="/jobs" onClick={(e) => { e.preventDefault(); navigate('/jobs'); }}>Search jobs</a>
        </div>
      )}
      <ul>
        {jobs.map((job) => (
          <li key={job.id} className="job-card" data-job-id={job.id}
            data-application-id={job.my_application?.id} data-state={job.my_application?.state}>
            <h3><a href={`/jobs/${job.id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${job.id}`); }}>{job.title}</a></h3>
            <p>{job.company.name}</p>
            {job.my_application && (
              <>
                <p>{statusText(job.my_application.state)}</p>
                {tab === 'applied' && (
                  <button type="button" className="text-button" onClick={() => {
                    void (async () => {
                      const app = await api.get<Application>(`/api/applications/${job.my_application!.id}`);
                      setApplication(app);
                      setWithdrawFor(job);
                    })();
                  }}>Withdraw application</button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {withdrawFor && application && (
        <Dialog label="Withdraw application?" onClose={() => setWithdrawFor(null)} closeButton={false}>
          <h2>Withdraw application?</h2>
          <ul aria-label={`History for ${withdrawFor.title}`}>
            {application.history.map((entry, index) => (
              <li key={index}>{entry.status_text} · {entry.at}</li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button type="button" className="pink-button" onClick={() => {
              void (async () => {
                try {
                  await api.post(`/api/applications/${application.id}/transition`, { to: 'withdrawn' });
                  announce('Jobs announcements', `Your application for ${withdrawFor.title} is now: Withdrawn.`);
                  setWithdrawFor(null);
                  await load();
                } catch {
                  setWithdrawFor(null);
                }
              })();
            }}>Withdraw</button>
            <button type="button" className="text-button" onClick={() => setWithdrawFor(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </>
  );
};

export const BoardPage = ({ jobId }: { jobId: string }): JSX.Element => {
  const { me, liveEvents, config, businessNow } = useApp();
  const [columns, setColumns] = useState<Record<string, BoardCard[]> | null>(null);
  const [funnel, setFunnel] = useState<{ rows: { stage: string; count: number; rate: number | null }[]; median_first_view_minutes: number | null } | null>(null);
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const [openApplication, setOpenApplication] = useState<Application | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<BoardCard | null>(null);
  const [pickedUp, setPickedUp] = useState<{ card: BoardCard; fromColumn: string; columns: string[]; index: number } | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const stageOrder = ['applied', 'viewed', 'interviewing', 'offered', 'rejected', 'withdrawn'];

  const load = useCallback(async (): Promise<void> => {
    try {
      const [board, funnelData] = await Promise.all([
        api.get<{ columns: Record<string, BoardCard[]> }>(`/api/jobs/${jobId}/applications`),
        api.get<{ rows: { stage: string; count: number; rate: number | null }[]; median_first_view_minutes: number | null }>(`/api/jobs/${jobId}/funnel`),
      ]);
      setColumns(board.columns);
      setFunnel(funnelData);
    } catch { /* not poster */ }
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'application_update' || event === 'job_update' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  const move = async (card: BoardCard, to: string): Promise<void> => {
    try {
      await api.post(`/api/applications/${card.id}/transition`, { to });
      announce('Jobs announcements', `Moved ${card.applicant.name} to ${stageLabel(to)}`);
      setMoveMenuFor(null);
      await load();
    } catch (err) {
      const e2 = err as { body?: { error?: string; from?: string } };
      if (e2.body?.error === 'invalid_transition') {
        setAlert(`This application already moved to ${stageLabel(e2.body.from ?? card.state)}.`);
        await load();
      } else {
        setAlert('Something went wrong. Try again.');
      }
    }
  };

  const legalTargets = (state: string): string[] => legalMoves[state] ?? [];

  if (!columns) {
    return (
      <div className="big-empty">
        <h2>This profile isn't available</h2>
        <a href="/feed">Go to Home</a>
      </div>
    );
  }

  const tz = config?.time_zone ?? 'UTC';

  return (
    <>
      <h1 className="profile-name">Applicants</h1>
      {alert && <div role="alert">{alert}</div>}
      {funnel && (
        <section aria-label="Hiring funnel" className="funnel">
          {funnel.rows.map((row) => (
            <p key={row.stage} className="funnel-row" data-stage={row.stage} data-count={row.count} data-rate={row.rate ?? ''}>
              {stageLabel(row.stage)} · {row.count} · {row.rate === null ? '—' : `${row.rate}%`}
            </p>
          ))}
          <p data-median-first-view={funnel.median_first_view_minutes ?? ''}>
            Median time to first view: {funnel.median_first_view_minutes === null
              ? '—'
              : funnel.median_first_view_minutes < 60
                ? `${funnel.median_first_view_minutes}m`
                : `${Math.floor(funnel.median_first_view_minutes / 60)}h ${funnel.median_first_view_minutes % 60}m`}
          </p>
        </section>
      )}
      <div className="board-columns">
        {stageOrder.map((stage) => (
          <section key={stage} className="board-column" aria-label={stageLabel(stage)}>
            <h3>{stageLabel(stage)}</h3>
            <ul role="list" aria-label={stageLabel(stage)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const cardId = e.dataTransfer.getData('text/plain');
                const card = (columns[stage] ?? []).find((c) => c.id === cardId)
                  ?? Object.values(columns).flat().find((c) => c.id === cardId);
                if (card && legalTargets(card.state).includes(stage)) void move(card, stage);
              }}
            >
              {(columns[stage] ?? []).map((card) => (
                <li
                  key={card.id}
                  className="board-card"
                  tabIndex={0}
                  data-application-id={card.id}
                  data-state={card.state}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
                  onKeyDown={(e) => {
                    if (e.key === ' ') {
                      e.preventDefault();
                      if (pickedUp?.card.id === card.id) {
                        const target = pickedUp.columns[pickedUp.index];
                        void move(card, target);
                        setPickedUp(null);
                      } else {
                        const targets = legalTargets(card.state);
                        setPickedUp({ card, fromColumn: card.state, columns: targets, index: 0 });
                        announce('Jobs announcements', `Picked up ${card.applicant.name}`);
                      }
                    } else if (e.key === 'ArrowRight' && pickedUp?.card.id === card.id) {
                      e.preventDefault();
                      setPickedUp((prev) => prev ? { ...prev, index: Math.min(prev.index + 1, prev.columns.length - 1) } : prev);
                    } else if (e.key === 'ArrowLeft' && pickedUp?.card.id === card.id) {
                      e.preventDefault();
                      setPickedUp((prev) => prev ? { ...prev, index: Math.max(prev.index - 1, 0) } : prev);
                    } else if (e.key === 'Escape' && pickedUp?.card.id === card.id) {
                      e.preventDefault();
                      setPickedUp(null);
                      announce('Jobs announcements', 'Move cancelled.');
                    }
                  }}
                >
                  <a href="#" onClick={(e) => {
                    e.preventDefault();
                    void (async () => {
                      const app = await api.get<Application>(`/api/applications/${card.id}`);
                      setOpenApplication(app);
                      setOpenCard(card);
                    })();
                  }}>{card.applicant.name}</a>
                  <button type="button" className="text-button" onClick={() => setMoveMenuFor(card)}>
                    Move {card.applicant.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {moveMenuFor && (
        <Menu label={`Move ${moveMenuFor.applicant.name}`} onClose={() => setMoveMenuFor(null)}>
          {legalTargets(moveMenuFor.state).map((target) => (
            <MenuItem key={target} label={`Move to ${stageLabel(target)}`} onSelect={() => { void move(moveMenuFor, target); }} />
          ))}
        </Menu>
      )}

      {openCard && openApplication && (
        <Dialog label={`Application from ${openCard.applicant.name}`} onClose={() => { setOpenCard(null); setOpenApplication(null); }}>
          <h2>{openCard.applicant.name}</h2>
          <a href={openApplication.resume_url ?? '#'}>Download resume</a>
          <ul aria-label="History">
            {openApplication.history.map((entry, index) => (
              <li key={index}>
                {entry.status_text} · {
                  new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(entry.at))
                } at {
                  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(entry.at)).replace(/\u202f/g, ' ')
                } · {entry.by === 'you' ? 'You' : entry.by === 'hiring_team' ? 'Hiring team' : `Automatic: ${entry.reason ?? ''}`}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      <p className="visually-hidden">{String(Boolean(me))}{businessNow().toISOString()}</p>
    </>
  );
};

export const JobEditorPage = ({ jobId }: { jobId: string }): JSX.Element => {
  const { liveEvents, config, navigate } = useApp();
  const [editor, setEditor] = useState<JobEditor | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsVersion, setQuestionsVersion] = useState(1);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [conflict, setConflict] = useState<{ field: string; by: string; current: unknown } | null>(null);
  const [questionConflict, setQuestionConflict] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const typingTimer = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api.get<JobEditor>(`/api/jobs/${jobId}/editor`);
      setEditor(result);
      setVersions({
        title: result.fields.title.version,
        location: result.fields.location.version,
        workplace: result.fields.workplace.version,
        closes_at: result.fields.closes_at.version,
        description: result.fields.description.version,
      });
      if (!dirty.title) setValues((prev) => ({ ...prev, title: result.fields.title.value }));
      if (!dirty.location) setValues((prev) => ({ ...prev, location: result.fields.location.value }));
      if (!dirty.workplace) setValues((prev) => ({ ...prev, workplace: result.fields.workplace.value }));
      if (!dirty.closes_at) setValues((prev) => ({ ...prev, closes_at: isoToLocalInput(result.fields.closes_at.value, config?.time_zone ?? 'UTC') }));
      if (!dirty.description) setValues((prev) => ({ ...prev, description: result.fields.description.value }));
      if (!dirty.questions) {
        setQuestions(result.fields.questions.value);
        setQuestionsVersion(result.fields.questions.version);
      }
    } catch {
      setEditor(null);
    }
  }, [jobId, config, dirty]);

  useEffect(() => { void load(); void api.post(`/api/jobs/${jobId}/editor/presence`, {}); }, [load, jobId]);
  useEffect(() => {
    const interval = setInterval(() => { void api.post(`/api/jobs/${jobId}/editor/presence`, {}); }, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'editor_presence' || event === 'editor_typing' || event === 'job_update') void load();
    });
  }, [liveEvents, load]);

  const saveField = async (field: string, value: unknown, version: number): Promise<void> => {
    setErrors((prev) => ({ ...prev, [field]: '' }));
    try {
      const result = await api.patch<{ version: number; value: unknown }>(`/api/jobs/${jobId}/fields/${field}`, { value, version });
      setVersions((prev) => ({ ...prev, [field]: result.version }));
      setDirty((prev) => ({ ...prev, [field]: false }));
      const labels: Record<string, string> = {
        title: 'Title', location: 'Location', workplace: 'Workplace',
        closes_at: 'Closes', description: 'Description', questions: 'Screening questions',
      };
      announce('Jobs announcements', `${labels[field] ?? field} saved.`);
      await load();
    } catch (err) {
      const e2 = err as { body?: { error?: string; current_version?: number; current?: unknown; by?: { name?: string }; fields?: Record<string, string>; limit?: number } };
      if (e2.body?.error === 'field_conflict') {
        setConflict({ field, by: e2.body.by?.name ?? 'Someone', current: e2.body.current });
        setVersions((prev) => ({ ...prev, [field]: e2.body!.current_version ?? version }));
      } else if (e2.body?.error === 'questions_locked') {
        setErrors((prev) => ({ ...prev, questions: "Questions can't change after someone has applied." }));
      } else if (e2.body?.error === 'too_many_questions') {
        setErrors((prev) => ({ ...prev, questions: 'A job can have up to 10 questions.' }));
      } else if (e2.body?.error === 'validation' && e2.body.fields) {
        setErrors((prev) => ({ ...prev, ...e2.body!.fields }));
      } else if (field === 'closes_at') {
        setErrors((prev) => ({ ...prev, closes_at: 'Use YYYY-MM-DD HH:MM.' }));
      } else {
        setErrors((prev) => ({ ...prev, [field]: 'Something went wrong. Try again.' }));
      }
    }
  };

  const typingSignal = (field: string): void => {
    const now = Date.now();
    if (typingTimer.current && now - typingTimer.current < 1000) return;
    typingTimer.current = now;
    void api.post(`/api/jobs/${jobId}/editor/typing`, { field }).catch(() => undefined);
  };

  const saveQuestions = async (list: Question[]): Promise<void> => {
    setErrors((prev) => ({ ...prev, questions: '' }));
    try {
      const result = await api.patch<{ version: number; value: Question[] }>(`/api/jobs/${jobId}/fields/questions`, {
        value: list.map((q) => ({
          id: q.id, type: q.type, text: q.text, required: q.required, knock_out: q.knock_out ?? false,
          ideal: q.ideal ?? null, options: q.options ?? null, accepted: q.accepted ?? null,
          minimum: q.minimum ?? null, maximum: q.maximum ?? null,
        })),
        version: questionsVersion,
      });
      setQuestions(result.value);
      setQuestionsVersion(result.version);
      announce('Jobs announcements', 'Screening questions saved.');
    } catch (err) {
      const e2 = err as { body?: { error?: string; fields?: Record<string, string> } };
      if (e2.body?.error === 'field_conflict') {
        setQuestionConflict(true);
        setQuestionsVersion((e2.body as { current_version?: number }).current_version ?? questionsVersion);
      } else if (e2.body?.error === 'questions_locked') {
        setErrors((prev) => ({ ...prev, questions: "Questions can't change after someone has applied." }));
      } else if (e2.body?.error === 'too_many_questions') {
        setErrors((prev) => ({ ...prev, questions: 'A job can have up to 10 questions.' }));
      } else if (e2.body?.error === 'validation' && e2.body.fields) {
        setErrors((prev) => ({ ...prev, ...e2.body!.fields }));
      }
    }
  };

  if (!editor) {
    return (
      <div className="big-empty">
        <h2>This profile isn't available</h2>
        <a href="/feed">Go to Home</a>
      </div>
    );
  }

  const editingText = editor.editing.length === 0
    ? 'Only you are editing'
    : editor.editing.length === 1
      ? `${editor.editing[0].name} is also editing`
      : editor.editing.length === 2
        ? `${editor.editing[0].name} and ${editor.editing[1].name} are also editing`
        : `${editor.editing[0].name} and ${editor.editing.length} others are also editing`;

  const field = (name: string, label: string, node: React.ReactNode): JSX.Element => (
    <div>
      <label className="label" htmlFor={`job-${name}`}>{label}</label>
      {node}
      <span data-field-note data-field={name} className="message-status">{errors[name] ?? ''}</span>
    </div>
  );

  return (
    <>
      <h1 className="profile-name">Edit job</h1>
      <p role="status" aria-label="Editing now">{editingText}</p>
      {field('title', 'Title', (
        <input id="job-title" className="field" value={values.title ?? ''}
          onChange={(e) => { setValues((prev) => ({ ...prev, title: e.target.value })); setDirty((prev) => ({ ...prev, title: true })); typingSignal('title'); }}
          onBlur={() => { if (dirty.title) void saveField('title', values.title, versions.title); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && dirty.title) void saveField('title', values.title, versions.title); }} />
      ))}
      {field('location', 'Location', (
        <input id="job-location" className="field" value={values.location ?? ''}
          onChange={(e) => { setValues((prev) => ({ ...prev, location: e.target.value })); setDirty((prev) => ({ ...prev, location: true })); typingSignal('location'); }}
          onBlur={() => { if (dirty.location) void saveField('location', values.location, versions.location); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && dirty.location) void saveField('location', values.location, versions.location); }} />
      ))}
      {field('workplace', 'Workplace', (
        <select id="job-workplace" className="field" value={values.workplace ?? 'on-site'}
          onChange={(e) => { setValues((prev) => ({ ...prev, workplace: e.target.value })); setDirty((prev) => ({ ...prev, workplace: true })); }}
          onBlur={() => { if (dirty.workplace) void saveField('workplace', values.workplace, versions.workplace); }}>
          <option value="on-site">On-site</option>
          <option value="hybrid">Hybrid</option>
          <option value="remote">Remote</option>
        </select>
      ))}
      {field('closes_at', 'Closes', (
        <input id="job-closes" className="field" placeholder="YYYY-MM-DD HH:MM" value={values.closes_at ?? ''}
          onChange={(e) => { setValues((prev) => ({ ...prev, closes_at: e.target.value })); setDirty((prev) => ({ ...prev, closes_at: true })); typingSignal('closes_at'); }}
          onBlur={() => {
            if (!dirty.closes_at) return;
            const iso = localInputToIso(values.closes_at ?? '', config?.time_zone ?? 'UTC');
            if (iso === null) { setErrors((prev) => ({ ...prev, closes_at: 'Use YYYY-MM-DD HH:MM.' })); return; }
            void saveField('closes_at', iso, versions.closes_at);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty.closes_at) {
              const iso = localInputToIso(values.closes_at ?? '', config?.time_zone ?? 'UTC');
              if (iso === null) { setErrors((prev) => ({ ...prev, closes_at: 'Use YYYY-MM-DD HH:MM.' })); return; }
              void saveField('closes_at', iso, versions.closes_at);
            }
          }} />
      ))}
      {field('description', 'Description', (
        <textarea id="job-description" className="field" rows={5} value={values.description ?? ''}
          onChange={(e) => { setValues((prev) => ({ ...prev, description: e.target.value })); setDirty((prev) => ({ ...prev, description: true })); typingSignal('description'); }}
          onBlur={() => { if (dirty.description) void saveField('description', values.description, versions.description); }} />
      ))}

      {conflict && (
        <div role="alert">
          <p>{conflict.by} changed this field while you were editing.</p>
          <div className="dialog-actions">
            <button type="button" className="text-button" onClick={() => { void saveField(conflict.field, conflict.current, versions[conflict.field]); setConflict(null); }}>Use theirs</button>
            <button type="button" className="pink-button" onClick={() => {
              const value = values[conflict.field];
              void saveField(conflict.field, conflict.field === 'closes_at' ? localInputToIso(value, config?.time_zone ?? 'UTC') : value, versions[conflict.field]);
              setConflict(null);
            }}>Keep mine</button>
          </div>
        </div>
      )}

      <section aria-label="Screening questions" role="region">
        <h2 aria-level={2}>Screening questions</h2>
        {errors.questions && <div role="alert">{errors.questions}</div>}
        {questionConflict && (
          <div role="alert">
            <p>Someone changed this section since you opened it.</p>
            <div className="dialog-actions">
              <button type="button" className="text-button" onClick={() => { setQuestionConflict(false); void load(); }}>Load latest</button>
              <button type="button" className="pink-button" onClick={() => { setQuestionConflict(false); void saveQuestions(questions); }}>Save mine anyway</button>
            </div>
          </div>
        )}
        <button type="button" className="text-button" onClick={() => setAddOpen(true)}>Add question</button>
        {addOpen && (
          <Menu label="Question types" onClose={() => setAddOpen(false)}>
            <MenuItem label="Short answer" onSelect={() => {
              setQuestions((prev) => [...prev, { id: '', type: 'short_answer', text: '', required: false, knock_out: false, ideal: null, options: null, accepted: null, minimum: null, maximum: null }]);
              setAddOpen(false);
            }} />
            <MenuItem label="Yes or no" onSelect={() => {
              setQuestions((prev) => [...prev, { id: '', type: 'yes_no', text: '', required: false, knock_out: false, ideal: null, options: null, accepted: null, minimum: null, maximum: null }]);
              setAddOpen(false);
            }} />
            <MenuItem label="Single choice" onSelect={() => {
              setQuestions((prev) => [...prev, { id: '', type: 'single_choice', text: '', required: false, knock_out: false, ideal: null, options: ['', ''], accepted: null, minimum: null, maximum: null }]);
              setAddOpen(false);
            }} />
            <MenuItem label="Number" onSelect={() => {
              setQuestions((prev) => [...prev, { id: '', type: 'number', text: '', required: false, knock_out: false, ideal: null, options: null, accepted: null, minimum: null, maximum: null }]);
              setAddOpen(false);
            }} />
          </Menu>
        )}
        <ul aria-label="Questions">
          {questions.map((question, index) => (
            <li
              key={`${question.id}-${index}`}
              className="entry"
              tabIndex={0}
              data-question-id={question.id || `new-${index}`}
              data-question-type={question.type}
              data-position={index + 1}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData('text/plain'));
                const next = [...questions];
                const [moved] = next.splice(from, 1);
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const after = (e.clientY - rect.top) > rect.height / 2;
                const target = after ? index + 1 : index;
                next.splice(from < target ? target - 1 : target, 0, moved);
                announce('Jobs announcements', `${moved.text || 'Question'} moved to position ${(from < target ? target : target) + 1} of ${questions.length}.`);
                setQuestions(next);
                void saveQuestions(next);
              }}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (index === 0) return;
                  const next = [...questions];
                  const [moved] = next.splice(index, 1);
                  next.splice(index - 1, 0, moved);
                  announce('Jobs announcements', `Question moved to position ${index} of ${questions.length}.`);
                  setQuestions(next);
                  void saveQuestions(next);
                } else if (e.altKey && e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (index === questions.length - 1) return;
                  const next = [...questions];
                  const [moved] = next.splice(index, 1);
                  next.splice(index + 1, 0, moved);
                  announce('Jobs announcements', `Question moved to position ${index + 2} of ${questions.length}.`);
                  setQuestions(next);
                  void saveQuestions(next);
                }
              }}
            >
              <label className="label" htmlFor={`question-${index}`}>Question text</label>
              <input id={`question-${index}`} className="field" value={question.text}
                onChange={(e) => {
                  const next = [...questions];
                  next[index] = { ...question, text: e.target.value };
                  setQuestions(next);
                }}
                onBlur={() => { void saveQuestions(questions); }} />
              <label>
                <input type="checkbox" checked={question.required}
                  onChange={(e) => {
                    const next = [...questions];
                    next[index] = { ...question, required: e.target.checked };
                    setQuestions(next);
                    void saveQuestions(next);
                  }} />
                Required
              </label>
              <label>
                <input type="checkbox" checked={question.knock_out ?? false}
                  onChange={(e) => {
                    const next = [...questions];
                    next[index] = { ...question, knock_out: e.target.checked };
                    setQuestions(next);
                    void saveQuestions(next);
                  }} />
                Knock-out
              </label>
              {question.type === 'yes_no' && (
                <fieldset>
                  <legend>Ideal answer</legend>
                  {['yes', 'no'].map((value) => (
                    <label key={value}>
                      <input type="radio" name={`ideal-${index}`} value={value}
                        checked={question.ideal === value}
                        onChange={() => {
                          const next = [...questions];
                          next[index] = { ...question, ideal: value };
                          setQuestions(next);
                          void saveQuestions(next);
                        }} />
                      {value === 'yes' ? 'Yes' : 'No'}
                    </label>
                  ))}
                </fieldset>
              )}
              {question.type === 'single_choice' && (
                <>
                  {(question.options ?? []).map((option, optionIndex) => (
                    <div key={optionIndex}>
                      <label className="label" htmlFor={`option-${index}-${optionIndex}`}>Option {optionIndex + 1}</label>
                      <input id={`option-${index}-${optionIndex}`} className="field" value={option}
                        onChange={(e) => {
                          const next = [...questions];
                          const options = [...(question.options ?? [])];
                          options[optionIndex] = e.target.value;
                          next[index] = { ...question, options };
                          setQuestions(next);
                        }}
                        onBlur={() => { void saveQuestions(questions); }} />
                      <label>
                        <input type="checkbox"
                          checked={(question.accepted ?? []).some((a) => a === option || (question.options ?? [])[question.accepted?.indexOf(a) ?? -1] === option)}
                          onChange={(e) => {
                            const next = [...questions];
                            const options = question.options ?? [];
                            const accepted = new Set(question.accepted ?? []);
                            if (e.target.checked) accepted.add(options[optionIndex]);
                            else accepted.delete(options[optionIndex]);
                            next[index] = { ...question, accepted: options.filter((o) => accepted.has(o)) };
                            setQuestions(next);
                            void saveQuestions(next);
                          }} />
                        Accept {option}
                      </label>
                    </div>
                  ))}
                  <button type="button" className="text-button" onClick={() => {
                    const next = [...questions];
                    next[index] = { ...question, options: [...(question.options ?? []), ''] };
                    setQuestions(next);
                  }}>Add option</button>
                </>
              )}
              {question.type === 'number' && (
                <>
                  <label className="label" htmlFor={`minimum-${index}`}>Minimum</label>
                  <input id={`minimum-${index}`} className="field" type="number" step="1"
                    value={question.minimum ?? ''}
                    onChange={(e) => {
                      const next = [...questions];
                      next[index] = { ...question, minimum: e.target.value === '' ? null : Number(e.target.value) };
                      setQuestions(next);
                    }}
                    onBlur={() => { void saveQuestions(questions); }} />
                  <label className="label" htmlFor={`maximum-${index}`}>Maximum</label>
                  <input id={`maximum-${index}`} className="field" type="number" step="1"
                    value={question.maximum ?? ''}
                    onChange={(e) => {
                      const next = [...questions];
                      next[index] = { ...question, maximum: e.target.value === '' ? null : Number(e.target.value) };
                      setQuestions(next);
                    }}
                    onBlur={() => { void saveQuestions(questions); }} />
                </>
              )}
              {Object.entries(errors).filter(([key]) => key.startsWith(`questions.${index + 1}.`)).map(([key, message]) => (
                <div key={key} role="alert">{message}</div>
              ))}
              <button type="button" className="text-button" onClick={() => {
                const next = questions.filter((_, i) => i !== index);
                setQuestions(next);
                void saveQuestions(next);
                requestAnimationFrame(() => {
                  const cards = document.querySelectorAll<HTMLElement>('[data-question-id]');
                  (cards[index] ?? document.querySelector<HTMLElement>('[aria-label="Add question"]'))?.focus();
                });
              }}>Remove question</button>
            </li>
          ))}
        </ul>
      </section>
      <button type="button" className="text-button" onClick={() => navigate(`/jobs/${jobId}`)}>Done</button>
    </>
  );
};
