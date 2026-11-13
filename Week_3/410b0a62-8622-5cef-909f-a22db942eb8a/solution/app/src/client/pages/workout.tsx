import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Download, Pencil, Trash2 } from 'lucide-react';
import { COMPLIANCE_LABELS } from '../../shared/compliance.js';
import { longDayLabel } from '../../shared/dates.js';
import { formatDuration, formatIf, formatPace, formatTss, formatWhole, plainNumber } from '../../shared/format.js';
import { flattenParts, partLabel, stepsDuration, stepsIf, stepsTss, type Part } from '../../shared/steps.js';
import { paceOfSpeed, thresholdInForce, thresholdKindFor } from '../../shared/thresholds.js';
import type { AthleteDetail, Comment, Threshold, Workout, WorkoutDetail } from '../../shared/types.js';
import { ApiFailure, del, failureMessage, fieldErrors, get, isNotFound, post } from '../api.js';
import { useLoaded } from '../hooks.js';
import { useLive } from '../live.js';
import { Link, navigate } from '../router.js';
import { useMe } from '../session.js';
import { NotFound } from '../shell.js';
import { Dialog, Field, Panel, Pill, Skeleton } from '../ui.js';

function Stat({ label, value, attrs }: { label: string; value: ReactNode; attrs?: Record<string, string> }) {
  return (
    <div className="stat" {...attrs}>
      <span className="stat-label">{label}</span> <strong className="stat-value">{value}</strong>
    </div>
  );
}

/** A step target as the watts or pace it works out to on the workout's day. */
function targetText(workout: Workout, history: readonly Threshold[], percent: number): string {
  const threshold = thresholdInForce(history, thresholdKindFor(workout.sport), workout.date);
  if (!threshold) return `${percent}%`;
  return workout.sport === 'bike'
    ? `${percent}% · ${formatWhole((threshold.value * percent) / 100)} W`
    : `${percent}% · ${formatPace(threshold.value / (percent / 100))} /km`;
}

function PartRow({ part, workout, history }: { part: Part; workout: Workout; history: readonly Threshold[] }) {
  const repeat = part.repeat !== null ? ` ×${part.repeat}` : '';
  return (
    <li className="step-row">
      <span>{partLabel(part)}</span>
      <span>{formatDuration(part.duration_s)}</span>
      <span>{targetText(workout, history, part.target_pct)}</span>
      {repeat && <span className="step-repeat">{repeat.trim()}</span>}
    </li>
  );
}

function Numbers({ detail }: { detail: WorkoutDetail }) {
  const { workout } = detail;
  const planned = workout.kind === 'planned';
  const tss = planned ? workout.planned_tss : workout.tss;
  const intensity = planned ? workout.planned_if : workout.if;
  const manual = workout.source === 'manual';
  const measure =
    workout.np_w !== null ? (
      <Stat label={manual ? 'Average power' : 'Normalised power'} value={`${formatWhole(workout.np_w)} W`} />
    ) : workout.ns_mps !== null ? (
      <Stat label={manual ? 'Average pace' : 'Normalised pace'} value={`${formatPace(paceOfSpeed(workout.ns_mps))} /km`} />
    ) : null;
  const attrs: Record<string, string> = { 'data-duration-s': String(workout.duration_s) };
  if (workout.np_w !== null && !manual) attrs['data-np'] = formatWhole(workout.np_w);
  if (intensity !== null) attrs['data-if'] = formatIf(intensity);
  if (tss !== null) attrs['data-tss'] = formatTss(tss);
  return (
    <div role="group" aria-label="Session numbers" className="numbers" {...attrs}>
      {measure}
      {intensity !== null && <Stat label="IF" value={formatIf(intensity)} />}
      {tss !== null && <Stat label={planned ? 'Planned' : 'Stress'} value={`${formatTss(tss)} TSS`} />}
      <Stat label="Duration" value={formatDuration(workout.duration_s)} />
    </div>
  );
}

function Comments({ workoutId, loaded }: { workoutId: string; loaded: Comment[] }) {
  const [posted, setPosted] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const comments = [...loaded, ...posted.filter((mine) => !loaded.some((theirs) => theirs.id === mine.id))];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const { comment } = await post<{ comment: Comment }>(`/api/workouts/${workoutId}/comments`, { body });
      setPosted((current) => [...current, comment]);
      setBody('');
    } catch (failure) {
      setError(fieldErrors(failure)?.['body'] ?? failureMessage(failure));
      field.current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="tile detail-block">
      <h2>Comments</h2>
      <ul aria-label="Comments" className="comment-list">
        {comments.map((comment) => (
          <li key={comment.id} className="comment">
            <strong>{comment.author_name}</strong> <span className="comment-body">{comment.body}</span>
          </li>
        ))}
      </ul>
      {comments.length === 0 && <p className="muted">No comments yet.</p>}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Comment" error={error}>
          {(props) => <textarea {...props} ref={field} rows={3} value={body} onChange={(event) => setBody(event.target.value)} />}
        </Field>
        <Pill tone="navy" type="submit" pending={pending} pendingText="Posting…">
          Post comment
        </Pill>
      </form>
    </section>
  );
}

function DownloadOriginal({ workout }: { workout: Workout }) {
  const [problem, setProblem] = useState<string | null>(null);
  const href = `/api/workouts/${workout.id}/original`;
  const fetchOriginal = async (): Promise<void> => {
    setProblem(null);
    const response = await fetch(href, { credentials: 'same-origin' });
    if (!response.ok) {
      setProblem(failureMessage(new ApiFailure(response.status, await response.json().catch(() => null))));
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = workout.file?.name ?? 'activity';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };
  return (
    <>
      <a
        href={href}
        className="pill pill-cobalt"
        onClick={(event) => {
          event.preventDefault();
          void fetchOriginal();
        }}
      >
        <Download aria-hidden="true" size={18} />
        Download original
      </a>
      {problem && <Panel>{problem}</Panel>}
    </>
  );
}

export function WorkoutPage({ workoutId }: { workoutId: string }) {
  const me = useMe();
  const { pushNotice } = useLive();
  const { data, error } = useLoaded(() => get<WorkoutDetail>(`/api/workouts/${workoutId}`), [workoutId], null);
  const athleteId = data?.workout.athlete_id;
  const athlete = useLoaded(() => (athleteId ? get<AthleteDetail>(`/api/athletes/${athleteId}`) : Promise.resolve(null)), [athleteId], null);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (error && isNotFound(error)) return <NotFound />;
  if (!data) return <section className="wrap page"><Skeleton lines={5} /></section>;

  const { workout, item } = data;
  const history = athlete.data?.thresholds ?? [];
  const parts = workout.steps ? flattenParts(workout.steps) : [];
  const when = workout.start_local ? `${longDayLabel(workout.date)} · ${workout.start_local}` : longDayLabel(workout.date);

  const remove = async (): Promise<void> => {
    setPending(true);
    setProblem(null);
    try {
      await del(`/api/workouts/${workout.id}`);
      pushNotice(`Deleted ${workout.title}.`);
      navigate(me.role === 'athlete' ? `/athletes/${me.id}` : `/athletes/${workout.athlete_id}`);
    } catch (failure) {
      setProblem(failureMessage(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="wrap page workout-page">
      <p className="eyebrow">{workout.kind === 'planned' ? 'Planned workout' : 'Completed workout'}</p>
      <h1 className="page-title">{workout.title}</h1>
      <p className="detail-when">
        {when}
        {athlete.data && <span className="detail-athlete">{` · ${athlete.data.name}`}</span>}
      </p>
      <p>
        <span className={`state-chip state-${item.compliance}`} data-compliance={item.compliance}>
          {COMPLIANCE_LABELS[item.compliance]}
        </span>
      </p>
      <Numbers detail={data} />
      {workout.steps && (
        <section className="tile detail-block">
          <h2>Planned steps</h2>
          <p className="muted">{`${formatDuration(stepsDuration(workout.steps))} · ${formatTss(stepsTss(workout.steps))} TSS · IF ${formatIf(stepsIf(workout.steps))}`}</p>
          <ol className="step-list">
            {parts.map((part, index) => (
              <PartRow key={index} part={part} workout={workout} history={history} />
            ))}
          </ol>
        </section>
      )}
      {workout.file && (
        <section className="tile detail-block">
          <h2>Original file</h2>
          <p>{`${workout.file.name} · ${plainNumber(workout.file.size, 0)} bytes`}</p>
          <p className="hash" data-sha256={workout.file.sha256}>{`SHA-256 ${workout.file.sha256}`}</p>
          <DownloadOriginal workout={workout} />
        </section>
      )}
      <Comments workoutId={workout.id} loaded={data.comments} />
      <div className="detail-actions">
        {workout.kind === 'planned' && (
          <Link to={`/athletes/${workout.athlete_id}/builder?workout=${workout.id}`} className="pill pill-ghost">
            <Pencil aria-hidden="true" size={18} />
            Edit in builder
          </Link>
        )}
        <Pill tone="danger" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden="true" size={18} />
          Delete workout
        </Pill>
      </div>
      {deleting && (
        <Dialog
          title="Delete workout?"
          onClose={() => {
            setDeleting(false);
            setProblem(null);
          }}
        >
          <p>This removes the workout{workout.file ? ', its stored file' : ''} and its stress in one step.</p>
          {problem && <Panel>{problem}</Panel>}
          <div className="dialog-actions">
            <Pill tone="danger" pending={pending} pendingText="Deleting…" onClick={() => void remove()}>
              Delete
            </Pill>
            <Pill tone="ghost" onClick={() => setDeleting(false)}>
              Keep it
            </Pill>
          </div>
        </Dialog>
      )}
    </section>
  );
}

