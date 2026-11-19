import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { postJson, patchJson } from '../api.js';
import type { ApiFailure } from '../api.js';
import { M } from '../copy.js';
import { say } from '../status.js';
import type { Classroom } from '../../shared/types.js';

const ZONES = [
  'Africa/Cairo', 'Africa/Lagos', 'America/Anchorage', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Mexico_City', 'America/New_York', 'America/Phoenix', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Hong_Kong',
  'Asia/Kolkata', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Pacific/Auckland',
];

import type { RefObject } from 'preact';

// Focus trap helper for every modal dialog.
export function useDialogA11y(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  opener: HTMLElement | null,
): void {
  useDialogA11yWithLanding(ref, onClose, opener, () => true);
}

// The landing guard decides whether focus returns to the opener on close;
// page-specific rules (Remove success) land focus elsewhere.
export function useDialogA11yWithLanding(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  opener: HTMLElement | null,
  landOnOpener: () => boolean,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openerRef = useRef(opener);
  openerRef.current = opener;
  const landRef = useRef(landOnOpener);
  landRef.current = landOnOpener;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'));
    const first = focusables()[0];
    if (first) first.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const firstEl = list[0]!;
        const lastEl = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      if (landRef.current() && openerRef.current && document.contains(openerRef.current)) {
        openerRef.current.focus();
      }
    };
  }, []);
}

interface TimeFieldsProps {
  values: { joinOpens: string; joinCloses: string; handIn: string };
  onChange: (values: { joinOpens: string; joinCloses: string; handIn: string }) => void;
  errors: Record<string, string>;
  showPlaceholders: boolean;
}

function TimeFields(props: TimeFieldsProps): VNode {
  const set = (key: keyof TimeFieldsProps['values']) => (e: Event) => {
    props.onChange({ ...props.values, [key]: (e.target as HTMLInputElement).value });
  };
  const fieldLabel: Record<string, string> = { joinOpens: 'Join opens', joinCloses: 'Join closes', handIn: 'Hand-in time' };
  const placeholders = props.showPlaceholders ? { joinOpens: 'Now', joinCloses: '14 days after Join opens', handIn: '70 days after Join opens' } : {};
  return (
    <>
      {(['joinOpens', 'joinCloses', 'handIn'] as const).map((key) => (
        <div class="field" key={key}>
          <label htmlFor={`tf-${key}`}>{fieldLabel[key]!}</label>
          <input
            id={`tf-${key}`}
            value={props.values[key]}
            placeholder={placeholders[key] ?? ''}
            onInput={set(key)}
            aria-describedby={props.errors[key] ? `tf-${key}-err` : undefined}
          />
          {props.errors[key] && <span class="err" id={`tf-${key}-err`} role="alert">{props.errors[key]}</span>}
        </div>
      ))}
    </>
  );
}

function fieldErr(err: ApiFailure, key: string): string | null {
  const fields = (err.error as { fields?: Record<string, string> }).fields ?? {};
  const map: Record<string, string> = {
    joinOpensLocal: 'joinOpens',
    joinClosesLocal: 'joinCloses',
    handInLocal: 'handIn',
    name: 'name',
    timeZone: 'timeZone',
  };
  for (const [k, v] of Object.entries(fields)) {
    if (map[k] === key) return v;
  }
  return null;
}

export function CreateClassroomDialog(props: {
  opener: HTMLElement | null;
  onClose: (createdName: string | null) => void;
  navigate: (path: string) => void;
  defaultTimeZone?: string;
}): VNode {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState(props.defaultTimeZone ?? 'America/Chicago');
  const [times, setTimes] = useState({ joinOpens: '', joinCloses: '', handIn: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useDialogA11y(ref, () => props.onClose(null), props.opener);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const toApi = (v: string) => (v.trim() === '' ? undefined : v.includes('T') ? v : v.replace(' ', 'T'));
    const res = await postJson<Classroom>('/api/classrooms', {
      name,
      timeZone,
      joinOpensLocal: toApi(times.joinOpens),
      joinClosesLocal: toApi(times.joinCloses),
      handInLocal: toApi(times.handIn),
    });
    setBusy(false);
    if (!res.ok) {
      const e1 = fieldErr(res, 'name') ?? fieldErr(res, 'timeZone');
      const next: Record<string, string> = {};
      const nErr = fieldErr(res, 'name'); if (nErr) next.name = nErr;
      const tzErr = fieldErr(res, 'timeZone'); if (tzErr) next.timeZone = tzErr;
      const jo = fieldErr(res, 'joinOpens'); if (jo) next.joinOpens = jo;
      const jc = fieldErr(res, 'joinCloses'); if (jc) next.joinCloses = jc;
      const hi = fieldErr(res, 'handIn'); if (hi) next.handIn = hi;
      setErrors(next);
      void e1;
      return;
    }
    // Mark that the classroom page should move focus to its heading.
    sessionStorage.setItem('qy-focus-classroom-heading', res.data.id);
    props.navigate(`/classrooms/${res.data.id}`);
    props.onClose(res.data.name);
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Create classroom" ref={ref}>
      <div class="dialog">
        <h2>Create classroom</h2>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div class="field">
            <label htmlFor="cc-name">Classroom name</label>
            <input id="cc-name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-describedby={errors.name ? 'cc-name-err' : undefined} />
            {errors.name && <span class="err" id="cc-name-err" role="alert">{errors.name}</span>}
          </div>
          <div class="field">
            <label htmlFor="cc-tz">Time zone</label>
            <select id="cc-tz" value={timeZone} onChange={(e) => setTimeZone((e.target as HTMLSelectElement).value)} aria-describedby={errors.timeZone ? 'cc-tz-err' : undefined}>
              {ZONES.map((z) => <option value={z} key={z}>{z}</option>)}
            </select>
            {errors.timeZone && <span class="err" id="cc-tz-err" role="alert">{errors.timeZone}</span>}
          </div>
          <TimeFields values={times} onChange={setTimes} errors={errors} showPlaceholders />
          <div class="row">
            <button class="pill ghost" type="button" onClick={() => props.onClose(null)}>Cancel</button>
            <button class="pill" type="submit" disabled={busy}>Save classroom</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ClassroomTimesDialog(props: {
  classroom: Classroom;
  opener: HTMLElement | null;
  onClose: (saved: boolean) => void;
  onSaved: (c: Classroom) => void;
}): VNode {
  const ref = useRef<HTMLDivElement>(null);
  const [times, setTimes] = useState({
    joinOpens: props.classroom.joinOpensLocal.replace('T', ' '),
    joinCloses: props.classroom.joinClosesLocal.replace('T', ' '),
    handIn: props.classroom.handInLocal.replace('T', ' '),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useDialogA11y(ref, () => props.onClose(false), props.opener);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const toApi = (v: string) => (v.trim() === '' ? undefined : v.includes('T') ? v : v.replace(' ', 'T'));
    const res = await patchJson<Classroom>(`/api/classrooms/${props.classroom.id}`, {
      joinOpensLocal: toApi(times.joinOpens),
      joinClosesLocal: toApi(times.joinCloses),
      handInLocal: toApi(times.handIn),
    });
    setBusy(false);
    if (!res.ok) {
      const next: Record<string, string> = {};
      const jo = fieldErr(res, 'joinOpens'); if (jo) next.joinOpens = jo;
      const jc = fieldErr(res, 'joinCloses'); if (jc) next.joinCloses = jc;
      const hi = fieldErr(res, 'handIn'); if (hi) next.handIn = hi;
      setErrors(next);
      return;
    }
    props.onSaved(res.data);
    props.onClose(true);
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Classroom times" ref={ref}>
      <div class="dialog">
        <h2>Classroom times</h2>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <TimeFields values={times} onChange={setTimes} errors={errors} showPlaceholders={false} />
          <div class="row">
            <button class="pill ghost" type="button" onClick={() => props.onClose(false)}>Cancel</button>
            <button class="pill" type="submit" disabled={busy}>Save classroom</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function JoinCodeDialog(props: {
  classroom: Classroom;
  opener: HTMLElement | null;
  onClose: () => void;
}): VNode {
  const ref = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(props.classroom.joinCode);
  const [busy, setBusy] = useState(false);

  useDialogA11y(ref, props.onClose, props.opener);

  const newCode = async () => {
    setBusy(true);
    const res = await postJson<{ joinCode: string }>(`/api/classrooms/${props.classroom.id}/join-code`, {});
    setBusy(false);
    if (res.ok) {
      setCode(res.data.joinCode);
      say(M.newJoinCode);
    }
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Join code" ref={ref}>
      <div class="dialog">
        <h2>Join code</h2>
        <div class="code-boxes" aria-label={code}>
          {code.split('').map((ch, i) => <span class="cb" key={i}>{ch}</span>)}
        </div>
        <div class="row" style="justify-content:center">
          <button class="pill ghost" onClick={() => void newCode()} disabled={busy}>New code</button>
          <button class="pill" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function RenameDialog(props: {
  nickname: string;
  classroomId: string;
  studentId: string;
  opener: HTMLElement | null;
  onClose: (saved: boolean) => void;
  onSaved: (nickname: string) => void;
}): VNode {
  const ref = useRef<HTMLDivElement>(null);
  const [nickname, setNickname] = useState(props.nickname);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const succeededRef = useRef(false);

  useDialogA11yWithLanding(ref, () => props.onClose(false), props.opener, () => !succeededRef.current);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await patchJson<{ id: string; nickname: string }>(`/api/classrooms/${props.classroomId}/students/${props.studentId}`, { nickname });
    setBusy(false);
    if (!res.ok) {
      const fields = (res.error as { fields?: Record<string, string> }).fields ?? {};
      setError(res.error.error === 'nickname_taken' ? M.nicknameTaken : (fields.nickname ?? res.error.message));
      return;
    }
    succeededRef.current = true;
    props.onSaved(res.data.nickname);
    props.onClose(true);
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={`Rename ${props.nickname}`} ref={ref}>
      <div class="dialog">
        <h2>Rename {props.nickname}</h2>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div class="field">
            <label htmlFor="rn-nick">Nickname</label>
            <input id="rn-nick" value={nickname} onInput={(e) => setNickname((e.target as HTMLInputElement).value)} aria-describedby={error ? 'rn-nick-err' : undefined} />
            {error && <span class="err" id="rn-nick-err" role="alert">{error}</span>}
          </div>
          <div class="row">
            <button class="pill ghost" type="button" onClick={() => props.onClose(false)}>Cancel</button>
            <button class="pill" type="submit" disabled={busy}>Save nickname</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function RemoveStudentDialog(props: {
  nickname: string;
  classroomId: string;
  studentId: string;
  opener: HTMLElement | null;
  onClose: (removed: boolean) => void;
}): VNode {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const succeededRef = useRef(false);

  // On success the page lands focus on the next tile, not the opener.
  useDialogA11yWithLanding(ref, () => props.onClose(false), props.opener, () => !succeededRef.current);

  const remove = async () => {
    setBusy(true);
    const res = await fetch(`/api/classrooms/${props.classroomId}/students/${props.studentId}`, { method: 'DELETE' });
    setBusy(false);
    succeededRef.current = res.ok;
    props.onClose(res.ok);
  };

  return (
    <div class="overlay" role="alertdialog" aria-modal="true" aria-label={`Remove ${props.nickname}?`} ref={ref}>
      <div class="dialog alertd">
        <h2>Remove {props.nickname}?</h2>
        <p style="color:var(--slate)">Their projects and files are removed too.</p>
        <div class="row">
          <button class="pill ghost" onClick={() => props.onClose(false)}>Cancel</button>
          <button class="pill" onClick={() => void remove()} disabled={busy}>Remove from classroom</button>
        </div>
      </div>
    </div>
  );
}

export function RemoveEducatorDialog(props: {
  name: string;
  classroomId: string;
  educatorId: string;
  opener: HTMLElement | null;
  onClose: (removed: boolean) => void;
}): VNode {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const succeededRef = useRef(false);

  // On success focus lands on the Assistant's email field.
  useDialogA11yWithLanding(ref, () => props.onClose(false), props.opener, () => !succeededRef.current);

  const remove = async () => {
    setBusy(true);
    const res = await fetch(`/api/classrooms/${props.classroomId}/educators/${props.educatorId}`, { method: 'DELETE' });
    setBusy(false);
    succeededRef.current = res.ok;
    props.onClose(res.ok);
  };

  return (
    <div class="overlay" role="alertdialog" aria-modal="true" aria-label={`Remove ${props.name}?`} ref={ref}>
      <div class="dialog alertd">
        <h2>Remove {props.name}?</h2>
        <p style="color:var(--slate)">They lose access to this classroom on their next request.</p>
        <div class="row">
          <button class="pill ghost" onClick={() => props.onClose(false)}>Cancel</button>
          <button class="pill" onClick={() => void remove()} disabled={busy}>Remove from classroom</button>
        </div>
      </div>
    </div>
  );
}

export function HandInAllDialog(props: {
  classroomName: string;
  classroomId: string;
  opener: HTMLElement | null;
  onClose: (done: boolean) => void;
  onDone: () => void;
}): VNode {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useDialogA11y(ref, () => props.onClose(false), props.opener);

  const handIn = async () => {
    setBusy(true);
    const res = await postJson<Classroom>(`/api/classrooms/${props.classroomId}/hand-in`, {});
    setBusy(false);
    if (res.ok) {
      say(M.handedInClassroom(props.classroomName));
      props.onDone();
      props.onClose(true);
    } else {
      say(res.error.message);
      props.onClose(false);
    }
  };

  return (
    <div class="overlay" role="alertdialog" aria-modal="true" aria-label="Hand in all projects?" ref={ref}>
      <div class="dialog alertd">
        <h2>Hand in all projects?</h2>
        <p style="color:var(--slate)">Every student project becomes read-only. This can't be undone.</p>
        <div class="row">
          <button class="pill ghost" onClick={() => props.onClose(false)}>Cancel</button>
          <button class="pill" onClick={() => void handIn()} disabled={busy}>Hand in now</button>
        </div>
      </div>
    </div>
  );
}
