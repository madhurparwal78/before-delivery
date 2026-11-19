import { useEffect, useState, type FormEvent } from 'react';
import type { ClassDetail, CoTeacherBody, Lesson, SessionState } from '../../shared/wire';
import { api } from '../api';
import { loadMe, useMe } from '../me';
import { Link, navigate } from '../router';
import { Dialog } from '../ui/Dialog';
import { Alert, Empty, NotFound, PageStatus, Skeleton } from '../ui/feedback';
import { Field } from './Field';
import { RoomPlan } from './RoomPlan';
import { useAction } from './useAction';
import { useLoad } from './useLoad';

const STATE_LABEL: Record<SessionState, string> = {
  scheduled: 'Scheduled',
  open: 'Open',
  live: 'Live',
  breakouts: 'Breakouts',
  ended: 'Ended',
};
const LESSON_LABEL = { draft: 'Draft', uploading: 'Uploading', ready: 'Ready' } as const;

const minutes = (wall: string): string => wall.slice(0, 16);

function ScheduleDialog({ detail, onClose, onSaving, onScheduled }: { detail: ClassDetail; onClose: () => void; onSaving: (saving: boolean) => void; onScheduled: () => void }) {
  const [lessonId, setLessonId] = useState(detail.lessons[0]?.id ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const { pending, error, run } = useAction();
  useEffect(() => onSaving(pending), [pending, onSaving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const scheduled = await run(() => api<unknown>('POST', `/api/classes/${detail.id}/sessions`, { lessonId, startsAt, endsAt }));
    if (scheduled) onScheduled();
  };

  return (
    <Dialog title="Schedule session" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <p>
          Times are read in <strong className="mono">{detail.timeZone}</strong>, the class time zone.
        </p>
        <div className="field">
          <label htmlFor="schedule-lesson">Lesson</label>
          <select id="schedule-lesson" value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
            {detail.lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </select>
        </div>
        <Field label="Starts" value={startsAt} onChange={setStartsAt} placeholder="2027-03-09T19:00" autoComplete="off" />
        <Field label="Ends" value={endsAt} onChange={setEndsAt} placeholder="2027-03-09T20:30" autoComplete="off" />
        {error ? <Alert>{error}</Alert> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={pending} aria-busy={pending}>
            Schedule
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ClassPage({ classId }: { classId: string }) {
  const { result, reload } = useLoad<ClassDetail>(`/api/classes/${classId}`);
  const known = useMe();
  const [message, setMessage] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [lessonTitle, setLessonTitle] = useState('');
  const [coTeacherEmail, setCoTeacherEmail] = useState('');
  const addLesson = useAction();
  const addCoTeacher = useAction();

  useEffect(() => {
    void loadMe();
  }, []);

  if (result.state === 'missing') return <NotFound />;
  if (result.state === 'refused') {
    return (
      <main className="page">
        <Alert>{result.message}</Alert>
      </main>
    );
  }
  if (result.state === 'loading' || known.state === 'unknown') {
    return (
      <main className="page">
        <Skeleton rows={4} label="Loading the class" />
      </main>
    );
  }

  const detail = result.data;
  const isOwner = known.state === 'signed-in' && !detail.coTeachers.some((coTeacher) => coTeacher.id === known.me.id);
  const lessonName = (id: string): string => detail.lessons.find((lesson) => lesson.id === id)?.title ?? '';

  const submitLesson = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    const created = await addLesson.run(() => api<Lesson>('POST', `/api/classes/${classId}/lessons`, { title: lessonTitle }));
    if (created) navigate(`/lessons/${created.value.id}`);
  };

  const submitCoTeacher = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    const added = await addCoTeacher.run(() => api<CoTeacherBody>('POST', `/api/classes/${classId}/co-teachers`, { email: coTeacherEmail }));
    if (!added) return;
    setCoTeacherEmail('');
    setMessage(`${added.value.displayName} can now co-teach this class.`);
    await reload();
  };

  const closeSchedule = () => {
    setScheduling(false);
    setDialogSaving(false);
  };

  const saving = addLesson.pending || addCoTeacher.pending || dialogSaving;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link href="/classes">All classes</Link>
      </nav>
      <div className="page-head">
        <div>
          <h1>{detail.title}</h1>
          <p className="class-code mono">Class code {detail.code}</p>
        </div>
        <span className="badge">{isOwner ? 'Owner' : 'Co-teacher'}</span>
      </div>

      <section className="panel" aria-labelledby="region-room">
        <h2 id="region-room">Room</h2>
        <div className="room-summary">
          <RoomPlan layout={detail.layout} seats={detail.seats} tables={detail.tables} />
          <div>
            <p>
              {detail.layout.columns} columns by {detail.layout.rows} rows, with {detail.seats.length} {detail.seats.length === 1 ? 'seat' : 'seats'} at {detail.tables.length}{' '}
              {detail.tables.length === 1 ? 'table' : 'tables'}. The front wall is at the top of the plan.
            </p>
            {isOwner ? (
              <Link className="button" href={`/classes/${classId}/room`}>
                Edit room
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="region-lessons">
        <h2 id="region-lessons">Lessons</h2>
        {detail.lessons.length === 0 ? (
          <Empty drawing="quill">No lessons yet. Name this week's lesson to start adding slides.</Empty>
        ) : (
          <ul className="ruled" aria-label="Lessons">
            {detail.lessons.map((lesson) => (
              <li key={lesson.id} className="list-line">
                <Link href={`/lessons/${lesson.id}`}>{lesson.title}</Link>
                <span className="badge">{LESSON_LABEL[lesson.state]}</span>
              </li>
            ))}
          </ul>
        )}
        {isOwner ? (
          <form className="inline-form" onSubmit={(event) => void submitLesson(event)} noValidate>
            <Field label="Lesson title" value={lessonTitle} onChange={setLessonTitle} autoComplete="off" />
            <button type="submit" className="primary" disabled={addLesson.pending} aria-busy={addLesson.pending}>
              Add lesson
            </button>
          </form>
        ) : null}
        {addLesson.error ? <Alert>{addLesson.error}</Alert> : null}
      </section>

      <section className="panel" aria-labelledby="region-sessions">
        <div className="section-head">
          <h2 id="region-sessions">Sessions</h2>
          {isOwner ? (
            <button type="button" className="primary" onClick={() => setScheduling(true)}>
              Schedule session
            </button>
          ) : null}
        </div>
        {detail.sessions.length === 0 ? (
          <Empty drawing="seats">No sessions yet. Schedule one when a lesson is ready.</Empty>
        ) : (
          <ul className="ruled" aria-label="Sessions">
            {detail.sessions.map((session) => (
              <li key={session.id} className="list-line">
                <Link className="session-link" href={`/sessions/${session.id}`}>
                  <span className="mono">{minutes(session.startsAt)}</span> to <span className="mono">{minutes(session.endsAt)}</span>
                  <span className="session-lesson">{lessonName(session.lessonId)}</span>
                </Link>
                <span className="badge">{STATE_LABEL[session.state]}</span>
                {session.state === 'ended' ? <Link href={`/sessions/${session.id}/summary`}>Summary</Link> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="region-coteachers">
        <h2 id="region-coteachers">Co-teachers</h2>
        {detail.coTeachers.length === 0 ? (
          <p className="hint">No co-teachers yet.</p>
        ) : (
          <ul className="ruled" aria-label="Current co-teachers">
            {detail.coTeachers.map((coTeacher) => (
              <li key={coTeacher.id} className="list-line">
                <span>{coTeacher.displayName}</span>
                <span className="mono">{coTeacher.email}</span>
              </li>
            ))}
          </ul>
        )}
        {isOwner ? (
          <form className="inline-form" onSubmit={(event) => void submitCoTeacher(event)} noValidate>
            <Field label="Co-teacher email" type="email" value={coTeacherEmail} onChange={setCoTeacherEmail} autoComplete="off" />
            <button type="submit" disabled={addCoTeacher.pending} aria-busy={addCoTeacher.pending}>
              Add co-teacher
            </button>
          </form>
        ) : null}
        {addCoTeacher.error ? <Alert>{addCoTeacher.error}</Alert> : null}
      </section>

      <PageStatus text={saving ? 'Saving...' : message} />
      {scheduling ? (
        <ScheduleDialog
          detail={detail}
          onClose={closeSchedule}
          onSaving={setDialogSaving}
          onScheduled={() => {
            closeSchedule();
            setMessage('Session scheduled.');
            void reload();
          }}
        />
      ) : null}
    </main>
  );
}
